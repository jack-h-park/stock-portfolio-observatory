import { krTaxable, summarizeTaxCandidates, usGainUsd } from '@/lib/tax-planning'
import type { TaxPolicy } from '@/lib/tax-policy'
import type { RebalanceInput } from '@/lib/adapters/rebalance-input'
import type { AllocationPolicy, Sleeve, SleeveTarget } from './allocation-policy'
import { computeAllocation, type Allocation } from './allocation'
import type { InstrumentClasses } from './instrument-classes'
import { planBuys } from './buy-funding'
import {
  computeCapExcess,
  KRW_EPS,
  prepareSellContext,
  selectSells,
  sellAmounts,
  warningKey,
  type CapExcess,
  type SellContext,
  type SellPick,
  type SellSelection,
} from './sell-selection'

export { buyInstructionId, buyPrice, planBuys, transferInstructionId, type BuyPlan } from './buy-funding'

export {
  computeCapExcess,
  prepareSellContext,
  selectSells,
  sellAmounts,
  sellInstructionId,
  STALE_NOTE,
  type CapExcess,
  type SellContext,
  type SellPick,
  type SellSelection,
} from './sell-selection'

export type InstructionKind = 'sell' | 'buy' | 'transfer'
/** Sell tiers, cheapest in tax first. */
export type Tier = 'loss' | 'kr_deduction' | 'us_long' | 'short_term'
export type InstructionLot = {
  lotId: number
  quantity: number
  gainKrw: number | null
  usGainUsd: number | null
  holdingBucket: 'short' | 'long'
  tier: Tier
}
/** One per (account, market, ticker, kind): a broker order is per ticker, so lots are aggregated. */
export type Instruction = {
  /** `${kind}:${accountKey}:${market}:${ticker}`; a transfer is `transfer:${accountKey}:${currency}`. */
  id: string
  kind: InstructionKind
  sleeve: Sleeve
  brokerage: string | null
  account: string
  market: string
  ticker: string
  currency: string
  /** lots.map((l) => l.lotId). */
  lotIds: number[]
  /** Per-lot detail of a sell; [] otherwise. */
  lots: InstructionLot[]
  quantity: number
  /** Proceeds (sell), cost (buy) or amount (transfer). */
  estimatedKrw: number
  /** Sells: Korea's measure, summed over the lots. */
  gainKrw: number | null
  usGainUsd: number | null
  /** 'short' if any lot is short. */
  holdingBucket: 'short' | 'long' | null
  /** The most tax-costly tier among the lots. */
  tier: Tier | null
  notes: string[]
}
export type EngineWarningCode =
  | 'wash_sale_block'
  | 'near_long_term'
  | 'unclassified'
  | 'unpriced'
  | 'transfer_needed'
  | 'stale_account'
  | 'turnover_capped'
  | 'below_min_trade'
  | 'cash_floor'
  | 'no_sellable_lots'
  | 'no_buy_price'
  | 'no_buy_list'
export type EngineWarning = { code: EngineWarningCode; message: string; ticker?: string; account?: string }
/** amountKrw < 0 reduces the sleeve. */
export type SleeveMove = { sleeve: Sleeve; fromPct: number; toPct: number; amountKrw: number }
export type TaxSummary = {
  krGainKrw: number
  krDeductionUsedKrw: number
  krDeductionRemainingKrw: number
  usShortUsd: number
  usLongUsd: number
  harvestedLossKrw: number
  estimatedTaxKrw: number
  turnoverPct: number
}
export type TradePlan = {
  moves: SleeveMove[]
  instructions: Instruction[]
  warnings: EngineWarning[]
  taxSummary: TaxSummary
}

const PCT_EPS = 1e-9

/**
 * Sleeves outside their band move back to the nearest band edge, not to the target. Band edges are
 * inclusive, compared with a small tolerance so float noise at an edge does not produce a move.
 */
export function computeSleeveMoves(allocation: Allocation, targets: Record<Sleeve, SleeveTarget>): SleeveMove[] {
  if (!(allocation.totalKrw > 0)) return []
  const moves: SleeveMove[] = []
  for (const row of allocation.sleeves) {
    const { target, band } = targets[row.sleeve]
    const lower = target - band
    const upper = target + band
    let edge: number
    if (row.pct < lower - PCT_EPS) edge = lower
    else if (row.pct > upper + PCT_EPS) edge = upper
    else continue
    moves.push({ sleeve: row.sleeve, fromPct: row.pct, toPct: edge, amountKrw: ((edge - row.pct) / 100) * allocation.totalKrw })
  }
  return moves
}

/** The sell-side tax summary of the picked lot portions. */
function summarize(ctx: SellContext, picks: SellPick[], totalKrw: number): TaxSummary {
  const candidates = picks.map((p) => p.candidate)
  const krGainKrw = candidates
    .filter((c) => krTaxable(c, ctx.taxPolicy))
    .reduce((sum, c) => sum + Number(c.gainKrw ?? 0), 0)
  const ytd = ctx.input.ytd.krTaxableGainKrw
  const deduction = ctx.krDeductionKrw
  const used = Math.min(deduction, Math.max(ytd + krGainKrw, 0)) - Math.min(deduction, Math.max(ytd, 0))
  const sumUsd = (bucket: 'short' | 'long') =>
    candidates.filter((c) => c.holdingBucket === bucket).reduce((sum, c) => sum + usGainUsd(c, ctx.usdKrwRate), 0)
  const proceeds = candidates.reduce((sum, c) => sum + Number(c.proceedsKrw ?? 0), 0)
  const estimatedTaxKrw = candidates.length
    ? summarizeTaxCandidates({
        candidates,
        policy: ctx.taxPolicy,
        scenario: ctx.taxPolicy.activeScenario,
        year: Number(ctx.input.asOf.slice(0, 4)),
      }).combinedTaxAfterCreditsKrw
    : 0
  return {
    krGainKrw,
    krDeductionUsedKrw: used,
    krDeductionRemainingKrw: Math.max(deduction - Math.max(ytd + krGainKrw, 0), 0),
    usShortUsd: sumUsd('short'),
    usLongUsd: sumUsd('long'),
    harvestedLossKrw: -candidates.reduce((sum, c) => sum + Math.min(Number(c.gainKrw ?? 0), 0), 0),
    estimatedTaxKrw,
    turnoverPct: totalKrw > 0 ? (proceeds / totalKrw) * 100 : 0,
  }
}

/** The band moves, with a sleeve's reduction raised to what the position-cap walks sold. */
function movesWithCap(allocation: Allocation, moves: SleeveMove[], capSold: Partial<Record<Sleeve, number>>): SleeveMove[] {
  const out: SleeveMove[] = []
  for (const row of allocation.sleeves) {
    const move = moves.find((m) => m.sleeve === row.sleeve)
    const sold = capSold[row.sleeve] ?? 0
    if (sold > 0 && (!move || (move.amountKrw < 0 && sold > -move.amountKrw))) {
      out.push({ sleeve: row.sleeve, fromPct: row.pct, toPct: row.pct - (sold / allocation.totalKrw) * 100, amountKrw: -sold })
    } else if (move) out.push(move)
  }
  return out
}

function allocationWarnings(allocation: Allocation): EngineWarning[] {
  const out: EngineWarning[] = []
  for (const p of allocation.unclassified) {
    out.push({
      code: 'unclassified',
      ticker: p.ticker,
      account: p.account,
      message: `${p.market}:${p.ticker} has no sleeve in instrument classes and is left out of the totals`,
    })
  }
  for (const p of allocation.unpriced) {
    out.push({
      code: 'unpriced',
      ticker: p.ticker,
      account: p.account,
      message: `${p.ticker} has no current price: counted at cost and never sold`,
    })
  }
  return out
}

/**
 * Re-runs selection with every sleeve's reduction scaled so the sells total stays within
 * maxTurnoverPctPerProposal. The scale applies to what the first pass actually sold (band and cap
 * parts alike), so one pass is enough: rounding only sells less.
 */
function capTurnover(
  ctx: SellContext,
  amounts: Partial<Record<Sleeve, number>>,
  capExcess: CapExcess[],
  first: SellSelection,
  totalKrw: number,
  capPct: number
): { selection: SellSelection; warning: EngineWarning | null } {
  const soldKrw = Object.values(first.soldKrw).reduce<number>((sum, v) => sum + (v ?? 0), 0)
  const capKrw = (capPct / 100) * totalKrw
  if (!(capPct > 0) || !(totalKrw > 0) || soldKrw <= capKrw + KRW_EPS) return { selection: first, warning: null }
  const f = capKrw / soldKrw
  const scaled: Partial<Record<Sleeve, number>> = {}
  for (const [sleeve, sold] of Object.entries(first.soldKrw) as [Sleeve, number][]) {
    const band = Math.min(amounts[sleeve] ?? 0, sold)
    if (band > 0) scaled[sleeve] = band * f
  }
  const soldOf = (c: CapExcess) =>
    first.instructions
      .filter((i) => i.sleeve === c.sleeve && i.market === c.market && i.ticker === c.ticker)
      .reduce((sum, i) => sum + i.estimatedKrw, 0)
  const scaledCap = capExcess.map((c) => ({
    ...c,
    excessKrw: c.excessKrw * f,
    sellableKrw: Math.min(c.sellableKrw, soldOf(c)) * f,
  }))
  return {
    selection: selectSells(ctx, scaled, scaledCap),
    warning: {
      code: 'turnover_capped',
      message: `sells scaled from ${Math.round(soldKrw)} to ${Math.round(capKrw)} KRW (${capPct}% turnover cap)`,
    },
  }
}

export function buildTradePlan(args: {
  input: RebalanceInput
  policy: AllocationPolicy
  targets: Record<Sleeve, SleeveTarget>
  classes: InstrumentClasses
  taxPolicy: TaxPolicy
  /** Instruction ids to leave out; the plan is recomputed without them. */
  skip?: string[]
}): TradePlan {
  const { input, policy, targets, classes } = args
  const allocation = computeAllocation(input, policy, classes)
  const bandMoves = computeSleeveMoves(allocation, targets)
  const capExcess = computeCapExcess(allocation, policy)
  const amounts = sellAmounts(bandMoves)
  const ctx = prepareSellContext({ input, policy, classes, taxPolicy: args.taxPolicy, skip: args.skip })
  const { selection, warning: turnoverWarning } = capTurnover(
    ctx,
    amounts,
    capExcess,
    selectSells(ctx, amounts, capExcess),
    allocation.totalKrw,
    policy.bounds.maxTurnoverPctPerProposal
  )

  // Sells below the minimum trade are dropped, with their lots.
  const minTradeKrw = policy.bounds.minTradeKrw
  const droppedSells = selection.instructions.filter((i) => i.estimatedKrw < minTradeKrw).map((i) => i.id)
  const sells = selection.instructions.filter((i) => !droppedSells.includes(i.id))
  const picks = selection.picks.filter((p) => !droppedSells.includes(p.instructionId))

  const cashRow = allocation.sleeves.find((r) => r.sleeve === 'cash')
  const buyPlan = planBuys({
    input,
    policy,
    moves: bandMoves,
    sells,
    capExcess,
    skip: ctx.skip,
    cashSleeveKrw: cashRow?.valueKrw ?? 0,
    totalKrw: allocation.totalKrw,
  })
  // A skipped transfer never appears: planBuys cuts the buys it would have funded instead.
  const instructions = [...sells, ...buyPlan.buys, ...buyPlan.transfers]

  const dropped = [...droppedSells, ...buyPlan.droppedIds]
  const minWarning: EngineWarning[] = dropped.length
    ? [
        {
          code: 'below_min_trade',
          message: `left out, below the ${minTradeKrw} KRW minimum trade or under one tradable unit: ${dropped.join(', ')}`,
        },
      ]
    : []

  // A stale-account warning stays only while that account still has an instruction.
  const accounts = new Set(instructions.map((i) => i.account))
  const warnings: EngineWarning[] = []
  const seen = new Set<string>()
  for (const w of [
    ...allocationWarnings(allocation),
    ...selection.warnings,
    ...(turnoverWarning ? [turnoverWarning] : []),
    ...minWarning,
    ...buyPlan.warnings,
  ]) {
    if (w.code === 'stale_account' && w.account && !accounts.has(w.account)) continue
    const key = warningKey(w)
    if (seen.has(key)) continue
    seen.add(key)
    warnings.push(w)
  }

  return {
    moves: movesWithCap(allocation, bandMoves, selection.capSoldKrw),
    instructions,
    warnings,
    taxSummary: summarize(ctx, picks, allocation.totalKrw),
  }
}
