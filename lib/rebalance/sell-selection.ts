import type { RebalanceInput } from '@/lib/adapters/rebalance-input'
import {
  buildTaxPlan,
  krTaxable,
  longTermEligibleOn,
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
} from './allocation-policy'
import type { Allocation } from './allocation'
import type { EngineWarning, Instruction, SleeveMove, Tier } from './engine'
import { classify, instrumentKey, type InstrumentClasses } from './instrument-classes'
import { withDerivedYtd } from './ytd-realized'

export const TIERS: Tier[] = ['loss', 'kr_deduction', 'us_long', 'short_term']
/** Amounts within one won count as covered. */
export const KRW_EPS = 1
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

/** One warning per code, account and ticker; a warning with neither is told apart by its message. */
export const warningKey = (w: EngineWarning) =>
  `${w.code}|${w.account ?? ''}|${w.ticker ?? ''}|${w.account || w.ticker ? '' : w.message}`

const roundQty = (value: number) => Math.round(value * 1e8) / 1e8

/**
 * An instrument above the position cap. excessKrw is measured on its whole exposure (every
 * account, priced at cost where there is no price); sellableKrw is the part held at a known price
 * in accounts the plan may trade, which bounds what the cap walk tries to sell.
 */
export type CapExcess = { sleeve: Sleeve; market: string; ticker: string; excessKrw: number; sellableKrw: number }

/** Instruments above the position cap, summed across accounts (the cap limits exposure). Cash is never capped. */
export function computeCapExcess(allocation: Allocation, policy: AllocationPolicy): CapExcess[] {
  const positionCapPct = policy.bounds.positionCapPct
  if (!(positionCapPct > 0) || !(allocation.totalKrw > 0)) return []
  const capKrw = (positionCapPct / 100) * allocation.totalKrw
  const out: CapExcess[] = []
  for (const sleeve of SLEEVES) {
    if (sleeve === 'cash') continue
    const byInstrument = new Map<string, { market: string; ticker: string; valueKrw: number; sellableKrw: number }>()
    for (const p of allocation.positionsBySleeve[sleeve]) {
      const key = instrumentKey(p.market, p.ticker)
      const entry = byInstrument.get(key) ?? { market: p.market, ticker: p.ticker, valueKrw: 0, sellableKrw: 0 }
      entry.valueKrw += p.valueKrw ?? p.costKrw
      const rule = policy.accounts[accountKey(p.brokerage, p.account)] ?? defaultAccountRule(p.market)
      if (p.valueKrw != null && !rule.managedBy) entry.sellableKrw += p.valueKrw
      byInstrument.set(key, entry)
    }
    const rows = [...byInstrument.values()]
      .filter((e) => e.valueKrw > capKrw + KRW_EPS)
      .sort((a, b) => a.ticker.localeCompare(b.ticker) || a.market.localeCompare(b.market))
    for (const e of rows) {
      const excessKrw = e.valueKrw - capKrw
      out.push({ sleeve, market: e.market, ticker: e.ticker, excessKrw, sellableKrw: Math.min(excessKrw, e.sellableKrw) })
    }
  }
  return out
}

/** Per-sleeve band reductions (positive amounts). Cash is a funding source and never sells. */
export function sellAmounts(moves: SleeveMove[]): Partial<Record<Sleeve, number>> {
  const amounts: Partial<Record<Sleeve, number>> = {}
  for (const move of moves) {
    if (move.sleeve === 'cash' || !(move.amountKrw < 0)) continue
    amounts[move.sleeve] = -move.amountKrw
  }
  return amounts
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
  /** Everything sold per sleeve. */
  soldKrw: Partial<Record<Sleeve, number>>
  /** The part of soldKrw the position-cap walks sold. */
  capSoldKrw: Partial<Record<Sleeve, number>>
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

const unitKey = (unit: Unit) => `${unit.holding.id}|${unit.parts.map((p) => `${p.lot.id}:${p.quantity}`).join(',')}`

export function sellInstructionId(brokerage: string | null, account: string, market: string, ticker: string) {
  return `sell:${accountKey(brokerage, account)}:${market}:${ticker}`
}

type WalkResult = {
  sold: number
  /** 'covered': the amount is met; 'partial': the last unit was sold in part; 'exhausted': no unit is left. */
  stop: 'covered' | 'partial' | 'exhausted'
  /** Units skipped because not even one share fitted the amount left. */
  roundedOut: boolean
}

/**
 * Picks the lots to sell, cheapest tax tier first. Capped instruments are sold first, up to their
 * sellable excess; a cap shortfall is warned and never moves to other instruments. The general walk
 * then covers what is left of each sleeve's band reduction (`amounts`). Run it again with scaled
 * amounts and cap excess to scale a plan.
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
  const walk = (sleeve: Sleeve, need: number, filter: (h: Holding) => boolean): WalkResult => {
    let sold = 0
    let roundedOut = false
    // Units of which not even one share fits what is left; they stay out for the rest of this walk.
    const dropped = new Set<string>()
    const pool = orderedHoldings.filter((h) => h.sleeve === sleeve && filter(h))
    while (need - sold > KRW_EPS) {
      const ranked = pool
        .flatMap(unitsOf)
        .filter((unit) => !dropped.has(unitKey(unit)))
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
      if (!best) return { sold, stop: 'exhausted', roundedOut }
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
      if (quantity > 0) {
        sold += take(best.unit, quantity, best.tier)
        return { sold, stop: 'partial', roundedOut }
      }
      dropped.add(unitKey(best.unit))
      roundedOut = true
    }
    return { sold, stop: 'covered', roundedOut }
  }

  const soldKrw: Partial<Record<Sleeve, number>> = {}
  const capSoldKrw: Partial<Record<Sleeve, number>> = {}
  for (const sleeve of SLEEVES) {
    // Cash is a funding source, not something to sell.
    if (sleeve === 'cash') continue
    let capSold = 0
    for (const cap of capExcess.filter((c) => c.sleeve === sleeve)) {
      const result =
        cap.sellableKrw > KRW_EPS
          ? walk(sleeve, cap.sellableKrw, (h) => h.market === cap.market && h.ticker === cap.ticker)
          : { sold: 0, stop: 'exhausted' as const, roundedOut: false }
      capSold += result.sold
      // A remainder below one share after a partial sale is not a shortfall worth a warning.
      const short = cap.excessKrw - result.sold
      if (short > KRW_EPS && (result.stop === 'exhausted' || cap.sellableKrw < cap.excessKrw - KRW_EPS)) {
        warn({
          code: 'no_sellable_lots',
          ticker: cap.ticker,
          message: `${cap.ticker} is ${Math.round(cap.excessKrw)} KRW over the ${policy.bounds.positionCapPct}% position cap; sellable lots cover ${Math.round(result.sold)} KRW`,
        })
      }
    }
    // What the cap walks sold counts toward the band reduction; a cap shortfall never moves to other holdings.
    const bandNeed = amounts[sleeve] ?? 0
    let sold = capSold
    const need = bandNeed - capSold
    if (need > KRW_EPS) {
      const rest = walk(sleeve, need, () => true)
      sold += rest.sold
      const uncovered = need - rest.sold
      if (rest.stop === 'exhausted' && uncovered > KRW_EPS) {
        warn({
          code: 'no_sellable_lots',
          message: rest.roundedOut
            ? `${sleeve}: ${Math.round(uncovered)} KRW of the reduction is left unsold, too small for a whole share of the sellable lots`
            : rest.sold + capSold > 0
              ? `${sleeve}: sellable lots cover ${Math.round(rest.sold + capSold)} of the ${Math.round(bandNeed)} KRW reduction`
              : `${sleeve}: no sellable lots for a ${Math.round(bandNeed)} KRW reduction`,
        })
      }
    }
    if (sold > 0) soldKrw[sleeve] = sold
    if (capSold > 0) capSoldKrw[sleeve] = capSold
  }

  const instructions = aggregateSells(picks, holdings, ctx)
  for (const instruction of instructions) {
    const staleness = staleAccount(ctx, accountKey(instruction.brokerage, instruction.account))
    if (staleness) {
      warn({
        code: 'stale_account',
        account: instruction.account,
        message:
          staleness === 'unknown'
            ? `${instruction.account}: data date is unknown`
            : `${instruction.account}: data is more than ${policy.bounds.staleDataDays} days old`,
      })
    }
  }
  return { instructions, warnings, picks, soldKrw, capSoldKrw, krDeductionRemainingKrw: deductionLeft }
}

/** 'unknown' when the account has no data date (as risky as old data), 'old' past staleDataDays, else null. */
function staleAccount(ctx: SellContext, key: string): 'unknown' | 'old' | null {
  const asOf = ctx.input.accountDataAsOf[key]
  if (!asOf) return 'unknown'
  return daysBetween(asOf, ctx.input.asOf) > ctx.policy.bounds.staleDataDays ? 'old' : null
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
        notes: staleAccount(ctx, h.accountKey) ? [STALE_NOTE] : [],
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
