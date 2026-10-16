import type { RebalanceInput } from '@/lib/adapters/rebalance-input'
import {
  buildTaxPlan,
  krTaxable,
  longTermEligibleOn,
  summarizeTaxCandidates,
  usGainUsd,
  type TaxPlanCandidate,
  type TaxPlanningLot,
} from '@/lib/tax-planning'
import { assumptionNumber, type TaxPolicy } from '@/lib/tax-policy'
import {
  accountKey,
  defaultAccountRule,
  SLEEVES,
  type AccountRule,
  type AllocationPolicy,
  type Sleeve,
  type SleeveTarget,
} from './allocation-policy'
import { computeAllocation, type Allocation } from './allocation'
import { classify, instrumentKey, type InstrumentClasses } from './instrument-classes'
import { withDerivedYtd } from './ytd-realized'

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

const TIERS: Tier[] = ['loss', 'kr_deduction', 'us_long', 'short_term']
const PCT_EPS = 1e-9
/** Amounts within one won count as covered. */
const KRW_EPS = 1
const HOLD_WINDOW_DAYS = 30
const WASH_WINDOW_DAYS = 30
const DAY_MS = 86_400_000
export const STALE_NOTE = 'stale data: check quantity in the broker app'

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / DAY_MS)
}

/** One warning per code, account and ticker; a sleeve-level warning is told apart by its message. */
const warningKey = (w: EngineWarning) =>
  `${w.code}|${w.account ?? ''}|${w.ticker ?? ''}|${w.account || w.ticker ? '' : w.message}`

const roundQty = (value: number) => Math.round(value * 1e8) / 1e8

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

/** A position (instrument) whose value is above positionCapPct of the total, by how much. */
export type CapExcess = { sleeve: Sleeve; market: string; ticker: string; excessKrw: number }

/** Instruments above the position cap, summed across accounts (the cap limits exposure). Cash is never capped. */
export function computeCapExcess(allocation: Allocation, positionCapPct: number): CapExcess[] {
  if (!(positionCapPct > 0) || !(allocation.totalKrw > 0)) return []
  const capKrw = (positionCapPct / 100) * allocation.totalKrw
  const out: CapExcess[] = []
  for (const sleeve of SLEEVES) {
    if (sleeve === 'cash') continue
    const byInstrument = new Map<string, { market: string; ticker: string; valueKrw: number }>()
    for (const p of allocation.positionsBySleeve[sleeve]) {
      const key = instrumentKey(p.market, p.ticker)
      const entry = byInstrument.get(key) ?? { market: p.market, ticker: p.ticker, valueKrw: 0 }
      entry.valueKrw += p.valueKrw ?? p.costKrw
      byInstrument.set(key, entry)
    }
    const rows = [...byInstrument.values()]
      .filter((e) => e.valueKrw > capKrw + KRW_EPS)
      .sort((a, b) => a.ticker.localeCompare(b.ticker) || a.market.localeCompare(b.market))
    for (const e of rows) out.push({ sleeve, market: e.market, ticker: e.ticker, excessKrw: e.valueKrw - capKrw })
  }
  return out
}

/** Everything sell selection needs that does not change when the amounts are rescaled. */
export type SellContext = {
  input: RebalanceInput
  policy: AllocationPolicy
  classes: InstrumentClasses
  /** The tax policy with derived YTD figures and a fixed planning USD/KRW rate. */
  taxPolicy: TaxPolicy
  usdKrwRate: number
  skip: Set<string>
  /** KR basic deduction left before this plan. */
  krDeductionRemainingKrw: number
  krDeductionKrw: number
}

export type SellPick = {
  instructionId: string
  lotId: number
  quantity: number
  candidate: TaxPlanCandidate
  tier: Tier
}

export type SellSelection = {
  instructions: Instruction[]
  warnings: EngineWarning[]
  /** Each picked lot portion, scaled to the quantity sold: the input to the tax summary. */
  picks: SellPick[]
  soldKrw: Partial<Record<Sleeve, number>>
  krDeductionRemainingKrw: number
}

export function prepareSellContext(args: {
  input: RebalanceInput
  policy: AllocationPolicy
  classes: InstrumentClasses
  taxPolicy: TaxPolicy
  skip?: string[]
}): SellContext {
  const taxPolicy = withDerivedYtd(args.taxPolicy, args.input.ytd)
  // One planning rate for every lot, so a lot's figures do not depend on which other lots are
  // evaluated with it (buildTaxPlan otherwise takes the median rate of the lots it is given).
  if (!(assumptionNumber(taxPolicy, 'US', 'planningUsdKrwRate', 0) > 0) && args.input.usdKrwRate > 0) {
    const us = taxPolicy.jurisdictions.find((j) => j.code === 'US')
    if (us) us.manualAssumptions.planningUsdKrwRate = args.input.usdKrwRate
  }
  const usdKrwRate = assumptionNumber(taxPolicy, 'US', 'planningUsdKrwRate', args.input.usdKrwRate)
  const krDeductionKrw = assumptionNumber(taxPolicy, 'KR', 'stockBasicDeductionKrw', 2_500_000)
  return {
    input: args.input,
    policy: args.policy,
    classes: args.classes,
    taxPolicy,
    usdKrwRate,
    skip: new Set(args.skip ?? []),
    krDeductionKrw,
    krDeductionRemainingKrw: Math.max(krDeductionKrw - Math.max(args.input.ytd.krTaxableGainKrw, 0), 0),
  }
}

const SCALED_FIELDS = [
  'open_quantity',
  'native_cost_basis',
  'native_market_value',
  'native_unrealized_gl',
  'cost_basis_krw',
  'acquisition_cost_krw',
  'acquisition_cost_usd',
] as const

function scaleLot(lot: TaxPlanningLot, quantity: number): TaxPlanningLot {
  if (quantity === lot.open_quantity) return lot
  const f = lot.open_quantity > 0 ? quantity / lot.open_quantity : 0
  const out: TaxPlanningLot = { ...lot }
  for (const key of SCALED_FIELDS) {
    const value = lot[key]
    if (value != null) (out as Record<string, unknown>)[key] = Number(value) * f
  }
  out.open_quantity = quantity
  return out
}

const sumOrNull = (values: (number | null | undefined)[]) =>
  values.some((v) => v == null) ? null : values.reduce<number>((sum, v) => sum + Number(v), 0)

type Holding = {
  id: string
  sleeve: Sleeve
  brokerage: string | null
  account: string
  accountKey: string
  market: string
  ticker: string
  currency: string
  rule: AccountRule
  /** Oldest first: acquired_date, then lot id. */
  lots: TaxPlanningLot[]
}

type Unit = {
  holding: Holding
  /** The constituent lots and the quantity of each this unit would sell in full. */
  parts: { lot: TaxPlanningLot; quantity: number }[]
  candidate: TaxPlanCandidate
  quantity: number
}

export function sellInstructionId(brokerage: string | null, account: string, market: string, ticker: string) {
  return `sell:${accountKey(brokerage, account)}:${market}:${ticker}`
}

/**
 * Picks the lots to sell so each sleeve's amount is covered, cheapest tax tier first. Capped
 * instruments are sold first, up to their excess. Run it again with scaled amounts to scale a plan.
 */
export function selectSells(
  ctx: SellContext,
  amounts: Partial<Record<Sleeve, number>>,
  capExcess: CapExcess[] = []
): SellSelection {
  const { input, policy, taxPolicy } = ctx
  const warnings: EngineWarning[] = []
  const warned = new Set<string>()
  const warn = (w: EngineWarning) => {
    const key = warningKey(w)
    if (warned.has(key)) return
    warned.add(key)
    warnings.push(w)
  }

  const evalCache = new Map<string, TaxPlanCandidate | null>()
  const evaluate = (lot: TaxPlanningLot, key: string): TaxPlanCandidate | null => {
    if (!evalCache.has(key)) evalCache.set(key, buildTaxPlan({ lots: [lot], policy: taxPolicy }).candidates[0] ?? null)
    return evalCache.get(key) ?? null
  }
  const lotCandidate = (lot: TaxPlanningLot, quantity: number) =>
    evaluate(scaleLot(lot, quantity), `lot:${lot.id}:${quantity}`)

  // Holdings by sleeve. Managed accounts, skipped instructions and unclassified lots never sell.
  const holdings = new Map<string, Holding>()
  for (const lot of input.lots) {
    const sleeve = classify(lot, ctx.classes)
    if (!sleeve || sleeve === 'cash') continue
    const key = accountKey(lot.brokerage, lot.account)
    const rule = policy.accounts[key] ?? defaultAccountRule(lot.market)
    if (rule.managedBy) continue
    const id = sellInstructionId(lot.brokerage, lot.account, lot.market, lot.ticker)
    if (ctx.skip.has(id)) continue
    const holding = holdings.get(id) ?? {
      id,
      sleeve,
      brokerage: lot.brokerage,
      account: lot.account,
      accountKey: key,
      market: lot.market,
      ticker: lot.ticker,
      currency: lot.currency,
      rule,
      lots: [],
    }
    holding.lots.push(lot)
    holdings.set(id, holding)
  }
  for (const h of holdings.values()) {
    h.lots.sort((a, b) => a.acquired_date.localeCompare(b.acquired_date) || a.id - b.id)
  }
  const orderedHoldings = [...holdings.values()].sort(
    (a, b) => a.ticker.localeCompare(b.ticker) || a.accountKey.localeCompare(b.accountKey) || a.market.localeCompare(b.market)
  )

  const remaining = new Map<number, number>(input.lots.map((lot) => [lot.id, lot.open_quantity]))
  const left = (lot: TaxPlanningLot) => remaining.get(lot.id) ?? 0

  const holdUntil = addDays(input.asOf, HOLD_WINDOW_DAYS)
  const washFrom = addDays(input.asOf, -WASH_WINDOW_DAYS)
  const recentBuy = (market: string, ticker: string) =>
    input.recentBuys
      .filter((b) => b.market === market && b.ticker === ticker && b.date >= washFrom && b.date <= input.asOf)
      .sort((a, b) => b.date.localeCompare(a.date))[0]

  const isLoss = (c: TaxPlanCandidate) => Number(c.gainKrw ?? 0) < 0 || usGainUsd(c, ctx.usdKrwRate) < 0

  /** Whether a lot cannot sell (no price, or about to turn long-term), warning once if so. */
  const lotBlocked = (h: Holding, lot: TaxPlanningLot): boolean => {
    if (lot.native_market_value == null) {
      warn({ code: 'unpriced', ticker: h.ticker, account: h.account, message: `${h.ticker} has no current price, so it is not sold` })
      return true
    }
    const c = lotCandidate(lot, left(lot))
    if (!c || c.proceedsKrw == null) {
      warn({ code: 'unpriced', ticker: h.ticker, account: h.account, message: `${h.ticker} has no current value, so it is not sold` })
      return true
    }
    const eligible = longTermEligibleOn(lot.acquired_date)
    if (c.holdingBucket === 'short' && eligible > input.asOf && eligible <= holdUntil) {
      warn({
        code: 'near_long_term',
        ticker: h.ticker,
        account: h.account,
        message: `${h.ticker} lot ${lot.id} turns long-term on ${eligible}; held`,
      })
      return true
    }
    return false
  }

  const washBlocked = (h: Holding, c: TaxPlanCandidate): boolean => {
    if (!isLoss(c)) return false
    const buy = recentBuy(h.market, h.ticker)
    if (!buy) return false
    warn({
      code: 'wash_sale_block',
      ticker: h.ticker,
      account: h.account,
      message: `${h.ticker} was bought on ${buy.date}, within ${WASH_WINDOW_DAYS} days; its loss is not sold`,
    })
    return true
  }

  const unitsOf = (h: Holding): Unit[] => {
    const open = h.lots.filter((lot) => left(lot) > 1e-12)
    if (!open.length) return []
    if (h.rule.lotMethod === 'average') {
      if (open.some((lot) => lotBlocked(h, lot))) return []
      const parts = open.map((lot) => ({ lot, quantity: left(lot) }))
      const scaled = parts.map((p) => scaleLot(p.lot, p.quantity))
      const allLong = parts.every((p) => lotCandidate(p.lot, p.quantity)?.holdingBucket === 'long')
      const aggregate: TaxPlanningLot = {
        ...scaled[0],
        acquired_date: scaled[scaled.length - 1].acquired_date,
        open_quantity: scaled.reduce((sum, l) => sum + l.open_quantity, 0),
        native_cost_basis: scaled.reduce((sum, l) => sum + l.native_cost_basis, 0),
        native_market_value: sumOrNull(scaled.map((l) => l.native_market_value)),
        native_unrealized_gl: sumOrNull(scaled.map((l) => l.native_unrealized_gl)),
        cost_basis_krw: scaled.reduce((sum, l) => sum + l.cost_basis_krw, 0),
        acquisition_cost_krw: sumOrNull(scaled.map((l) => l.acquisition_cost_krw)),
        acquisition_cost_usd: sumOrNull(scaled.map((l) => l.acquisition_cost_usd)),
        holding_days: null,
        tax_term: allLong ? 'long' : 'short',
      }
      const key = `avg:${parts.map((p) => `${p.lot.id}:${p.quantity}`).join(',')}`
      const candidate = evaluate(aggregate, key)
      if (!candidate || candidate.proceedsKrw == null || washBlocked(h, candidate)) return []
      return [{ holding: h, parts, candidate, quantity: aggregate.open_quantity }]
    }
    const eligible = h.rule.lotMethod === 'fifo' ? [open[0]] : open
    const units: Unit[] = []
    for (const lot of eligible) {
      if (lotBlocked(h, lot)) continue
      const candidate = lotCandidate(lot, left(lot))
      if (!candidate || washBlocked(h, candidate)) continue
      units.push({ holding: h, parts: [{ lot, quantity: left(lot) }], candidate, quantity: left(lot) })
    }
    return units
  }

  let deductionLeft = ctx.krDeductionRemainingKrw
  const usGainKrwAtRate = (c: TaxPlanCandidate) => usGainUsd(c, ctx.usdKrwRate) * ctx.usdKrwRate
  const tierOf = (c: TaxPlanCandidate): Tier => {
    const gain = Number(c.gainKrw ?? 0)
    if (isLoss(c)) return 'loss'
    if (krTaxable(c, taxPolicy) && gain <= deductionLeft + KRW_EPS) return 'kr_deduction'
    return c.holdingBucket === 'long' ? 'us_long' : 'short_term'
  }
  const sortKey = (c: TaxPlanCandidate, tier: Tier): number => {
    const gain = Number(c.gainKrw ?? 0)
    if (tier === 'loss') return Math.min(gain, usGainKrwAtRate(c)) // most negative first
    if (tier === 'kr_deduction') return -gain // largest gain that fits first
    const proceeds = Number(c.proceedsKrw ?? 0)
    return proceeds > 0 ? Math.max(gain, usGainKrwAtRate(c)) / proceeds : 0 // gain/proceeds ascending
  }

  const picks: SellPick[] = []
  const take = (unit: Unit, quantity: number, tier: Tier): number => {
    const f = unit.quantity > 0 ? quantity / unit.quantity : 0
    let proceeds = 0
    for (const part of unit.parts) {
      const q = f === 1 ? part.quantity : roundQty(part.quantity * f)
      if (q <= 0) continue
      const candidate = lotCandidate(part.lot, q)
      if (!candidate) continue
      remaining.set(part.lot.id, Math.max(left(part.lot) - q, 0))
      picks.push({ instructionId: unit.holding.id, lotId: part.lot.id, quantity: q, candidate, tier })
      proceeds += Number(candidate.proceedsKrw ?? 0)
      const gain = Number(candidate.gainKrw ?? 0)
      // Any KR-taxable gain sold uses up deduction, whichever tier it was picked in.
      if (krTaxable(candidate, taxPolicy) && gain > 0) deductionLeft = Math.max(deductionLeft - gain, 0)
    }
    return proceeds
  }

  const decimalsFor = (h: Holding) => (h.rule.fractional ? (h.market === 'CRYPTO' ? 8 : 6) : 0)
  const roundDown = (q: number, decimals: number) => {
    const scale = 10 ** decimals
    return Math.floor(q * scale + 1e-6) / scale
  }

  /** Sells up to `need` from the sleeve's holdings that pass `filter`. */
  const walk = (sleeve: Sleeve, need: number, filter: (h: Holding) => boolean) => {
    let sold = 0
    let exhausted = false
    const pool = orderedHoldings.filter((h) => h.sleeve === sleeve && filter(h))
    while (need - sold > KRW_EPS) {
      const ranked = pool
        .flatMap(unitsOf)
        .map((unit) => {
          const tier = tierOf(unit.candidate)
          return { unit, tier, rank: TIERS.indexOf(tier), key: sortKey(unit.candidate, tier) }
        })
        .sort(
          (a, b) =>
            a.rank - b.rank ||
            a.key - b.key ||
            a.unit.holding.ticker.localeCompare(b.unit.holding.ticker) ||
            a.unit.holding.accountKey.localeCompare(b.unit.holding.accountKey) ||
            a.unit.parts[0].lot.id - b.unit.parts[0].lot.id
        )
      const best = ranked[0]
      if (!best) {
        exhausted = true
        break
      }
      const proceeds = Number(best.unit.candidate.proceedsKrw ?? 0)
      const stillNeeded = need - sold
      if (proceeds <= stillNeeded + KRW_EPS) {
        sold += take(best.unit, best.unit.quantity, best.tier)
        continue
      }
      // The last unit is partial, rounded down to what the account can trade; the rest stays unsold.
      const quantity = Math.min(
        roundDown((best.unit.quantity * stillNeeded) / proceeds, decimalsFor(best.unit.holding)),
        best.unit.quantity
      )
      if (quantity > 0) sold += take(best.unit, quantity, best.tier)
      break
    }
    return { sold, exhausted }
  }

  const soldKrw: Partial<Record<Sleeve, number>> = {}
  for (const sleeve of SLEEVES) {
    const need = amounts[sleeve] ?? 0
    // Cash is a funding source, not something to sell.
    if (sleeve === 'cash' || !(need > KRW_EPS)) continue
    let sold = 0
    for (const cap of capExcess.filter((c) => c.sleeve === sleeve)) {
      const target = Math.min(cap.excessKrw, need - sold)
      if (!(target > KRW_EPS)) continue
      sold += walk(sleeve, target, (h) => h.market === cap.market && h.ticker === cap.ticker).sold
    }
    let exhausted = false
    if (need - sold > KRW_EPS) {
      const rest = walk(sleeve, need - sold, () => true)
      sold += rest.sold
      exhausted = rest.exhausted
    }
    soldKrw[sleeve] = sold
    if (exhausted) {
      warn({
        code: 'no_sellable_lots',
        message:
          sold > 0
            ? `${sleeve}: sellable lots cover ${Math.round(sold)} of the ${Math.round(need)} KRW reduction`
            : `${sleeve}: no sellable lots for a ${Math.round(need)} KRW reduction`,
      })
    }
  }

  const instructions = aggregateSells(picks, holdings, ctx)
  for (const instruction of instructions) {
    if (instruction.notes.includes(STALE_NOTE)) {
      warn({
        code: 'stale_account',
        account: instruction.account,
        message: `${instruction.account}: data is more than ${policy.bounds.staleDataDays} days old`,
      })
    }
  }
  return { instructions, warnings, picks, soldKrw, krDeductionRemainingKrw: deductionLeft }
}

function isStale(ctx: SellContext, key: string): boolean {
  const asOf = ctx.input.accountDataAsOf[key]
  // An account without a date is unknown, not stale.
  if (!asOf) return false
  return daysBetween(asOf, ctx.input.asOf) > ctx.policy.bounds.staleDataDays
}

function aggregateSells(picks: SellPick[], holdings: Map<string, Holding>, ctx: SellContext): Instruction[] {
  const byId = new Map<string, Instruction>()
  for (const pick of picks) {
    const h = holdings.get(pick.instructionId)!
    let instruction = byId.get(pick.instructionId)
    if (!instruction) {
      instruction = {
        id: h.id,
        kind: 'sell',
        sleeve: h.sleeve,
        brokerage: h.brokerage,
        account: h.account,
        market: h.market,
        ticker: h.ticker,
        currency: h.currency,
        lotIds: [],
        lots: [],
        quantity: 0,
        estimatedKrw: 0,
        gainKrw: 0,
        usGainUsd: 0,
        holdingBucket: 'long',
        tier: 'loss',
        notes: isStale(ctx, h.accountKey) ? [STALE_NOTE] : [],
      }
      byId.set(pick.instructionId, instruction)
    }
    const c = pick.candidate
    const gainKrw = c.gainKrw == null ? null : Number(c.gainKrw)
    const usd = usGainUsd(c, ctx.usdKrwRate)
    const existing = instruction.lots.find((l) => l.lotId === pick.lotId)
    if (existing) {
      existing.quantity = roundQty(existing.quantity + pick.quantity)
      existing.gainKrw = existing.gainKrw == null || gainKrw == null ? null : existing.gainKrw + gainKrw
      existing.usGainUsd = existing.usGainUsd == null ? null : existing.usGainUsd + usd
      if (TIERS.indexOf(pick.tier) > TIERS.indexOf(existing.tier)) existing.tier = pick.tier
    } else {
      instruction.lots.push({
        lotId: pick.lotId,
        quantity: pick.quantity,
        gainKrw,
        usGainUsd: usd,
        holdingBucket: c.holdingBucket,
        tier: pick.tier,
      })
    }
    instruction.quantity = roundQty(instruction.quantity + pick.quantity)
    instruction.estimatedKrw += Number(c.proceedsKrw ?? 0)
    instruction.gainKrw = instruction.gainKrw == null || gainKrw == null ? null : instruction.gainKrw + gainKrw
    instruction.usGainUsd = (instruction.usGainUsd ?? 0) + usd
  }
  for (const instruction of byId.values()) {
    instruction.lotIds = instruction.lots.map((l) => l.lotId)
    instruction.holdingBucket = instruction.lots.some((l) => l.holdingBucket === 'short') ? 'short' : 'long'
    instruction.tier = TIERS[Math.max(...instruction.lots.map((l) => TIERS.indexOf(l.tier)))]
  }
  return [...byId.values()]
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

/** Per-sleeve sell amounts: the band reduction, raised to the sum of cap excess in the sleeve. */
export function sellAmounts(moves: SleeveMove[], capExcess: CapExcess[]): Partial<Record<Sleeve, number>> {
  const amounts: Partial<Record<Sleeve, number>> = {}
  for (const sleeve of SLEEVES) {
    if (sleeve === 'cash') continue
    const move = moves.find((m) => m.sleeve === sleeve)
    const bandReduce = move && move.amountKrw < 0 ? -move.amountKrw : 0
    const capTotal = capExcess.filter((c) => c.sleeve === sleeve).reduce((sum, c) => sum + c.excessKrw, 0)
    const amount = Math.max(bandReduce, capTotal)
    if (amount > 0) amounts[sleeve] = amount
  }
  return amounts
}

/** The band moves, with a sleeve's reduction raised where the position cap asks for more. */
function movesWithCap(allocation: Allocation, moves: SleeveMove[], amounts: Partial<Record<Sleeve, number>>): SleeveMove[] {
  const out: SleeveMove[] = []
  for (const row of allocation.sleeves) {
    const move = moves.find((m) => m.sleeve === row.sleeve)
    const amount = amounts[row.sleeve] ?? 0
    if (move && move.amountKrw >= 0) out.push(move)
    else if (amount > 0 && (!move || amount > -move.amountKrw)) {
      out.push({
        sleeve: row.sleeve,
        fromPct: row.pct,
        toPct: row.pct - (amount / allocation.totalKrw) * 100,
        amountKrw: -amount,
      })
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
  const capExcess = computeCapExcess(allocation, policy.bounds.positionCapPct)
  const amounts = sellAmounts(bandMoves, capExcess)
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
    moves: movesWithCap(allocation, bandMoves, amounts),
    instructions: selection.instructions,
    warnings,
    taxSummary: summarize(ctx, selection.picks, allocation.totalKrw),
  }
}
