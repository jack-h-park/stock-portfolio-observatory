import type { RebalanceInput } from '@/lib/adapters/rebalance-input'
import type { TaxPolicy } from '@/lib/tax-policy'
import type { AllocationPolicy, Sleeve } from './allocation-policy'
import { accountKey } from './allocation-policy'
import { displayName, snapshotDisplayNames } from './display-names'
import { classify, instrumentKey, type InstrumentClasses } from './instrument-classes'
import { harvestCandidates, prepareSellContext, yearTaxKrw } from './sell-selection'

/** One instrument (market and ticker) with loss lots, summed across accounts. */
export type HarvestRow = {
  market: string
  ticker: string
  /** One name per instrument (display-names.ts), whichever brokerage spelled it. */
  name: string
  sleeve: Sleeve | null
  /** Positive: the won loss selling every loss lot of it would realize. */
  lossKrw: number
  lotCount: number
  /** The part of lossKrw in lots short-term and long-term under the US measure. */
  shortLossKrw: number
  longLossKrw: number
  accountCount: number
}

/** An instrument whose loss lots are left out because it was bought within the 30-day wash-sale window. */
export type HarvestExcluded = { market: string; ticker: string; name: string; lossKrw: number; lastBuy: string }

/**
 * What selling every harvestable loss lot would do, as a scenario for the maintainer: the engine never turns it
 * into instructions (it sells only to bring sleeves back to their bands). Serializable; stored on a proposal as
 * `harvest` when there is a loss to show.
 */
export type HarvestScenario = {
  asOf: string
  /** Positive KRW; equals harvestableLossKrw, the figure the harvest trigger reads. */
  totalLossKrw: number
  lotCount: number
  /** yearTax(all loss lots) − yearTax(none), as the plan's own tax effect is computed. Negative is a reduction. */
  taxEffectKrw: number
  yearTotalWithKrw: number
  yearTotalWithoutKrw: number
  /** By loss, largest first; ties by market and ticker. */
  rows: HarvestRow[]
  excludedForWashSale: HarvestExcluded[]
  /** policy.investor.usTaxPerson when the scenario was computed: decides the KR-listed caveat. */
  usTaxPerson: boolean
}

export function buildHarvestScenario(args: {
  input: RebalanceInput
  policy: AllocationPolicy
  classes: InstrumentClasses
  taxPolicy: TaxPolicy
  today: string
}): HarvestScenario {
  const { input, policy, classes } = args
  const ctx = prepareSellContext({ input, policy, classes, taxPolicy: args.taxPolicy })
  const { candidates, washExcluded } = harvestCandidates(ctx, args.today)
  const names = snapshotDisplayNames(input)

  const byKey = new Map<string, HarvestRow>()
  const accountsOf = new Map<string, Set<string>>()
  for (const c of candidates) {
    const key = instrumentKey(c.market, c.ticker)
    const row = byKey.get(key) ?? {
      market: c.market,
      ticker: c.ticker,
      name: displayName(names, c.market, c.ticker),
      sleeve: classify(c, classes),
      lossKrw: 0,
      lotCount: 0,
      shortLossKrw: 0,
      longLossKrw: 0,
      accountCount: 0,
    }
    const loss = -Number(c.gainKrw)
    row.lossKrw += loss
    row.lotCount += 1
    if (c.holdingBucket === 'short') row.shortLossKrw += loss
    else row.longLossKrw += loss
    const accounts = accountsOf.get(key) ?? new Set<string>()
    accounts.add(accountKey(c.brokerage, c.account))
    accountsOf.set(key, accounts)
    row.accountCount = accounts.size
    byKey.set(key, row)
  }
  const rows: HarvestRow[] = [...byKey.values()].sort((a, b) => b.lossKrw - a.lossKrw || a.market.localeCompare(b.market) || a.ticker.localeCompare(b.ticker))

  const excluded = new Map<string, HarvestExcluded>()
  for (const { candidate: c, lastBuy } of washExcluded) {
    const key = instrumentKey(c.market, c.ticker)
    const entry = excluded.get(key) ?? { market: c.market, ticker: c.ticker, name: displayName(names, c.market, c.ticker), lossKrw: 0, lastBuy }
    entry.lossKrw += -Number(c.gainKrw)
    excluded.set(key, entry)
  }

  const yearTotalWithoutKrw = yearTaxKrw(ctx, [])
  const yearTotalWithKrw = yearTaxKrw(ctx, candidates)
  return {
    asOf: input.asOf,
    totalLossKrw: candidates.reduce((sum, c) => sum + -Number(c.gainKrw), 0),
    lotCount: candidates.length,
    taxEffectKrw: yearTotalWithKrw - yearTotalWithoutKrw,
    yearTotalWithKrw,
    yearTotalWithoutKrw,
    rows,
    excludedForWashSale: [...excluded.values()].sort((a, b) => b.lossKrw - a.lossKrw || a.ticker.localeCompare(b.ticker)),
    usTaxPerson: policy.investor?.usTaxPerson ?? false,
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A stored scenario the page can render; anything else (a hand-edited or truncated file) reads as absent. */
export function isHarvestScenario(value: unknown): value is HarvestScenario {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const h = value as Record<string, unknown>
  return (
    typeof h.asOf === 'string' &&
    ['totalLossKrw', 'lotCount', 'taxEffectKrw', 'yearTotalWithKrw', 'yearTotalWithoutKrw'].every((k) => isNum(h[k])) &&
    Array.isArray(h.rows) &&
    h.rows.every((r) => r !== null && typeof r === 'object' && typeof (r as HarvestRow).ticker === 'string' && isNum((r as HarvestRow).lossKrw)) &&
    Array.isArray(h.excludedForWashSale) &&
    typeof h.usTaxPerson === 'boolean'
  )
}
