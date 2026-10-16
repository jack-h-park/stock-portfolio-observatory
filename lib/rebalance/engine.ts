import { krTaxable, summarizeTaxCandidates, usGainUsd } from '@/lib/tax-planning'
import type { TaxPolicy } from '@/lib/tax-policy'
import type { RebalanceInput } from '@/lib/adapters/rebalance-input'
import type { AllocationPolicy, Sleeve, SleeveTarget } from './allocation-policy'
import { computeAllocation, type Allocation } from './allocation'
import type { InstrumentClasses } from './instrument-classes'
import {
  computeCapExcess,
  prepareSellContext,
  selectSells,
  sellAmounts,
  warningKey,
  type SellContext,
  type SellPick,
} from './sell-selection'

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

export function buildTradePlan(args: {
  input: RebalanceInput
  policy: AllocationPolicy
  targets: Record<Sleeve, SleeveTarget>
  classes: InstrumentClasses
  taxPolicy: TaxPolicy
  /** Instruction ids to leave out. */
  skip?: string[]
}): TradePlan {
  const { input, policy, targets, classes } = args
  const allocation = computeAllocation(input, policy, classes)
  const bandMoves = computeSleeveMoves(allocation, targets)
  const capExcess = computeCapExcess(allocation, policy)
  const amounts = sellAmounts(bandMoves)
  const ctx = prepareSellContext({ input, policy, classes, taxPolicy: args.taxPolicy, skip: args.skip })
  const selection = selectSells(ctx, amounts, capExcess)

  const warnings: EngineWarning[] = []
  const seen = new Set<string>()
  for (const w of [...allocationWarnings(allocation), ...selection.warnings]) {
    const key = warningKey(w)
    if (seen.has(key)) continue
    seen.add(key)
    warnings.push(w)
  }

  return {
    moves: movesWithCap(allocation, bandMoves, selection.capSoldKrw),
    instructions: selection.instructions,
    warnings,
    taxSummary: summarize(ctx, selection.picks, allocation.totalKrw),
  }
}

