import { summarizeTaxCandidates, usGainUsd } from '@/lib/tax-planning'
import type { TaxPolicy } from '@/lib/tax-policy'
import type { RebalanceInput } from '@/lib/adapters/rebalance-input'
import { accountKey, type AllocationPolicy, type Sleeve, type SleeveTarget } from './allocation-policy'
import { computeAllocation, type Allocation } from './allocation'
import type { InstrumentClasses } from './instrument-classes'
import { planBuys } from './buy-funding'
import {
  computeCapExcess,
  fmtKrwAmount,
  KRW_EPS,
  prepareSellContext,
  selectSells,
  inKrPool,
  sellAmounts,
  staleWarning,
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
  | 'managed_account'
/** An account is named by (brokerage, account); currency tells apart per-currency warnings such as transfers. */
export type EngineWarning = {
  code: EngineWarningCode
  message: string
  ticker?: string
  brokerage?: string | null
  account?: string
  currency?: string
}
/**
 * What the plan does to a sleeve: amountKrw is the sum of its buys minus its sells (for cash, the
 * plan's sells minus its buys), and toPct follows from it. amountKrw < 0 reduces the sleeve.
 * intendedAmountKrw is the band move that asked for it, when there was one.
 */
export type SleeveMove = { sleeve: Sleeve; fromPct: number; toPct: number; amountKrw: number; intendedAmountKrw?: number }
export type TaxSummary = {
  krGainKrw: number
  krDeductionUsedKrw: number
  krDeductionRemainingKrw: number
  usShortUsd: number
  usLongUsd: number
  harvestedLossKrw: number
  /** The plan's incremental tax: tax(YTD + plan) − tax(YTD only). Negative when the plan reduces the year's tax. */
  estimatedTaxKrw: number
  /** The year's total estimated tax with the plan: tax(YTD + plan). */
  yearTotalTaxKrw: number
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
    .filter((c) => inKrPool(c, ctx.taxPolicy))
    .reduce((sum, c) => sum + Number(c.gainKrw ?? 0), 0)
  const ytd = ctx.input.ytd.krTaxableGainKrw
  const deduction = ctx.krDeductionKrw
  const used = Math.min(deduction, Math.max(ytd + krGainKrw, 0)) - Math.min(deduction, Math.max(ytd, 0))
  const sumUsd = (bucket: 'short' | 'long') =>
    candidates.filter((c) => c.holdingBucket === bucket).reduce((sum, c) => sum + usGainUsd(c, ctx.usdKrwRate), 0)
  const proceeds = candidates.reduce((sum, c) => sum + Number(c.proceedsKrw ?? 0), 0)
  // The aggregate includes the year's realized gains (YTD), so the plan's own effect is the
  // difference between the year with the plan and the year without it. Both sides run the same
  // aggregate; the YTD-only side simply has no candidates.
  const yearTax = (rows: typeof candidates) =>
    summarizeTaxCandidates({
      candidates: rows,
      policy: ctx.taxPolicy,
      scenario: ctx.taxPolicy.activeScenario,
      year: Number(ctx.input.asOf.slice(0, 4)),
    }).combinedTaxAfterCreditsKrw
  const yearTotalTaxKrw = yearTax(candidates)
  const estimatedTaxKrw = yearTotalTaxKrw - yearTax([])
  return {
    krGainKrw,
    krDeductionUsedKrw: used,
    krDeductionRemainingKrw: Math.max(deduction - Math.max(ytd + krGainKrw, 0), 0),
    usShortUsd: sumUsd('short'),
    usLongUsd: sumUsd('long'),
    harvestedLossKrw: -candidates.reduce((sum, c) => sum + Math.min(Number(c.gainKrw ?? 0), 0), 0),
    estimatedTaxKrw,
    yearTotalTaxKrw,
    turnoverPct: totalKrw > 0 ? (proceeds / totalKrw) * 100 : 0,
  }
}

/**
 * The plan's effect per sleeve, from the instructions actually emitted (transfers move cash between
 * accounts and change no sleeve). A sleeve appears if it had a band move or has instructions.
 */
function planMoves(allocation: Allocation, bandMoves: SleeveMove[], instructions: Instruction[]): SleeveMove[] {
  const net: Partial<Record<Sleeve, number>> = {}
  const traded = new Set<Sleeve>()
  let cashNet = 0
  for (const i of instructions) {
    if (i.kind === 'transfer') continue
    const signed = i.kind === 'buy' ? i.estimatedKrw : -i.estimatedKrw
    net[i.sleeve] = (net[i.sleeve] ?? 0) + signed
    traded.add(i.sleeve)
    cashNet -= signed
  }
  const out: SleeveMove[] = []
  for (const row of allocation.sleeves) {
    const band = bandMoves.find((m) => m.sleeve === row.sleeve)
    if (!band && !traded.has(row.sleeve)) continue
    const amountKrw = row.sleeve === 'cash' ? cashNet : (net[row.sleeve] ?? 0)
    const move: SleeveMove = {
      sleeve: row.sleeve,
      fromPct: row.pct,
      toPct: allocation.totalKrw > 0 ? row.pct + (amountKrw / allocation.totalKrw) * 100 : row.pct,
      amountKrw,
    }
    if (band) move.intendedAmountKrw = band.amountKrw
    out.push(move)
  }
  return out
}

function allocationWarnings(allocation: Allocation): EngineWarning[] {
  const out: EngineWarning[] = []
  for (const p of allocation.unclassified) {
    out.push({
      code: 'unclassified',
      ticker: p.ticker,
      brokerage: p.brokerage,
      account: p.account,
      message: `${p.market}:${p.ticker} has no sleeve in instrument classes and is left out of the totals`,
    })
  }
  for (const p of allocation.unpriced) {
    out.push({
      code: 'unpriced',
      ticker: p.ticker,
      brokerage: p.brokerage,
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
): { selection: SellSelection; scaledFromKrw: number | null } {
  const soldKrw = Object.values(first.soldKrw).reduce<number>((sum, v) => sum + (v ?? 0), 0)
  const capKrw = (capPct / 100) * totalKrw
  if (!(capPct > 0) || !(totalKrw > 0) || soldKrw <= capKrw + KRW_EPS) return { selection: first, scaledFromKrw: null }
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
  return { selection: selectSells(ctx, scaled, scaledCap), scaledFromKrw: soldKrw }
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
  const { selection, scaledFromKrw } = capTurnover(
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

  const sellsKrw = sells.reduce((sum, i) => sum + i.estimatedKrw, 0)
  const turnoverWarning: EngineWarning[] =
    scaledFromKrw == null
      ? []
      : [
          {
            code: 'turnover_capped',
            message: `sells cut from ${fmtKrwAmount(scaledFromKrw)} to ${fmtKrwAmount(sellsKrw)} KRW by the ${policy.bounds.maxTurnoverPctPerProposal}% turnover cap`,
          },
        ]

  const dropped = [...droppedSells, ...buyPlan.droppedIds]
  const minWarning: EngineWarning[] = dropped.length
    ? [
        {
          code: 'below_min_trade',
          message: `left out, below the ${fmtKrwAmount(minTradeKrw)} KRW minimum trade or under one tradable unit: ${dropped.join(', ')}`,
        },
      ]
    : []

  // Stale-account warnings are rebuilt for the accounts, by (brokerage, account), that still trade.
  const trading = new Map<string, Instruction>()
  for (const i of [...sells, ...buyPlan.buys]) {
    const key = accountKey(i.brokerage, i.account)
    if (!trading.has(key)) trading.set(key, i)
  }
  const staleWarnings = [...trading.values()].flatMap((i) => staleWarning({ input, policy }, i.brokerage, i.account) ?? [])
  const warnings: EngineWarning[] = []
  const seen = new Set<string>()
  for (const w of [
    ...allocationWarnings(allocation),
    ...selection.warnings.filter((x) => x.code !== 'stale_account'),
    ...staleWarnings,
    ...turnoverWarning,
    ...minWarning,
    ...buyPlan.warnings,
  ]) {
    const key = warningKey(w)
    if (seen.has(key)) continue
    seen.add(key)
    warnings.push(w)
  }

  return {
    moves: planMoves(allocation, bandMoves, instructions),
    instructions,
    warnings,
    taxSummary: summarize(ctx, picks, allocation.totalKrw),
  }
}
