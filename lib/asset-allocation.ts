/**
 * Every asset the net worth counts, split two ways: by what it is (Korean or US
 * equity, bonds, gold, crypto, cash) and by the account wrapper it sits in
 * (taxable, ISA, pension). A pension is a wrapper, not an asset class, so its
 * holdings are split by what they hold like any other account's.
 *
 * A security takes its class from data/instrument-classes.json, the mapping the
 * rebalance engine reads, so a gold ETF counts as gold on both pages. Without a
 * mapping it falls back to its market (KR or US), and is listed so the fallback
 * can be checked. A pension fund has no market to fall back on and stays
 * unclassified: nothing is guessed.
 */
import { classify, type InstrumentClasses } from './rebalance/instrument-classes'

export const ALLOCATION_CLASSES = ['kr_equity', 'us_equity', 'bonds', 'gold', 'crypto', 'cash', 'unclassified'] as const
export type AllocationClass = (typeof ALLOCATION_CLASSES)[number]
export const ALLOCATION_WRAPPERS = ['taxable', 'isa', 'pension'] as const
export type AllocationWrapper = (typeof ALLOCATION_WRAPPERS)[number]

/** One holdings row: a taxable or ISA security, or anything a pension holds. */
export type AllocationSecurity = { wrapper: string; market: string; ticker: string; name: string; asset_class: string; valueKrw: number }
export type AllocationShare<K extends string> = { key: K; valueKrw: number; /** Percent of totalKrw, 0-100. */ pct: number }
export type AssetAllocation = {
  totalKrw: number
  /** Non-empty classes only, in ALLOCATION_CLASSES order. */
  classes: AllocationShare<AllocationClass>[]
  wrappers: AllocationShare<AllocationWrapper>[]
  /** Securities classed by their market because no mapping names them, largest first. */
  marketDefaults: AllocationSecurity[]
  unclassified: AllocationSecurity[]
}

const PENSION_WRAPPERS = new Set(['irp', 'pension_savings'])
/** A pension snapshot's cash row; see scripts/pension-ids.mjs. */
const isPensionCash = (ticker: string) => ticker.startsWith('PENSION:') && ticker.includes(':cash:')

function classOf(row: AllocationSecurity, classes: InstrumentClasses): { key: AllocationClass; byMarket: boolean } {
  if (isPensionCash(row.ticker)) return { key: 'cash', byMarket: false }
  const mapped = classify(row, classes)
  if (mapped) return { key: mapped, byMarket: false }
  if (row.ticker.startsWith('PENSION:')) return { key: 'unclassified', byMarket: false }
  if (row.market === 'KR') return { key: 'kr_equity', byMarket: true }
  if (row.market === 'US') return { key: 'us_equity', byMarket: true }
  return { key: 'unclassified', byMarket: false }
}

function shares<K extends string>(order: readonly K[], values: Record<K, number>, totalKrw: number): AllocationShare<K>[] {
  return order
    .filter((key) => values[key] !== 0)
    .map((key) => ({ key, valueKrw: values[key], pct: totalKrw > 0 ? (values[key] / totalKrw) * 100 : 0 }))
}

/**
 * `cryptoKrw`, `goldKrw` and `cashKrw` are the net worth's own class totals, all
 * held outside a pension or ISA wrapper, so the total here is the net worth's.
 */
export function summarizeAllocation(input: {
  securities: AllocationSecurity[]
  cryptoKrw: number
  goldKrw: number
  cashKrw: number
  classes: InstrumentClasses
}): AssetAllocation {
  const byClass = Object.fromEntries(ALLOCATION_CLASSES.map((key) => [key, 0])) as Record<AllocationClass, number>
  const byWrapper = Object.fromEntries(ALLOCATION_WRAPPERS.map((key) => [key, 0])) as Record<AllocationWrapper, number>
  const marketDefaults: AllocationSecurity[] = []
  const unclassified: AllocationSecurity[] = []

  for (const row of input.securities) {
    const { key, byMarket } = classOf(row, input.classes)
    byClass[key] += row.valueKrw
    byWrapper[PENSION_WRAPPERS.has(row.wrapper) ? 'pension' : row.wrapper === 'isa' ? 'isa' : 'taxable'] += row.valueKrw
    if (byMarket) marketDefaults.push(row)
    if (key === 'unclassified') unclassified.push(row)
  }
  byClass.crypto += input.cryptoKrw
  byClass.gold += input.goldKrw
  byClass.cash += input.cashKrw
  byWrapper.taxable += input.cryptoKrw + input.goldKrw + input.cashKrw

  const totalKrw = ALLOCATION_CLASSES.reduce((sum, key) => sum + byClass[key], 0)
  const largestFirst = (a: AllocationSecurity, b: AllocationSecurity) => b.valueKrw - a.valueKrw || a.ticker.localeCompare(b.ticker)
  return {
    totalKrw,
    classes: shares(ALLOCATION_CLASSES, byClass, totalKrw),
    wrappers: shares(ALLOCATION_WRAPPERS, byWrapper, totalKrw),
    marketDefaults: marketDefaults.sort(largestFirst),
    unclassified: unclassified.sort(largestFirst),
  }
}
