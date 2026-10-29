/**
 * Every asset the net worth counts, split two ways: by what it is (Korean or US
 * equity, bonds, gold, crypto, pension, cash) and by the account wrapper it sits
 * in (taxable, ISA, pension). A pension is one class, whatever it holds: its
 * funds have no ticker or market to classify by, and are not split.
 *
 * A taxable or ISA security takes its class from data/instrument-classes.json,
 * the mapping the rebalance engine reads, so a gold ETF counts as gold on both
 * pages. Without a mapping it falls back to its market (KR or US), and is listed
 * so the fallback can be checked. Any other market stays unclassified: nothing
 * is guessed.
 */
import { classify, type InstrumentClasses } from './rebalance/instrument-classes'

export const ALLOCATION_CLASSES = ['kr_equity', 'us_equity', 'bonds', 'gold', 'crypto', 'pension', 'cash', 'unclassified'] as const
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
  /**
   * Securities classed by their market because no mapping names them, one row
   * per market and ticker across accounts, largest first.
   */
  marketDefaults: AllocationSecurity[]
  /** One row per market and ticker, as marketDefaults. */
  unclassified: AllocationSecurity[]
}

const PENSION_WRAPPERS = new Set(['irp', 'pension_savings'])

function classOf(row: AllocationSecurity, classes: InstrumentClasses): { key: AllocationClass; byMarket: boolean } {
  if (PENSION_WRAPPERS.has(row.wrapper)) return { key: 'pension', byMarket: false }
  const mapped = classify(row, classes)
  if (mapped) return { key: mapped, byMarket: false }
  if (row.market === 'KR') return { key: 'kr_equity', byMarket: true }
  if (row.market === 'US') return { key: 'us_equity', byMarket: true }
  return { key: 'unclassified', byMarket: false }
}

/**
 * Rows with the same key summed into one, which keeps the name of its largest
 * holding (brokers spell one company differently), largest first.
 */
function oneRowPer(rows: AllocationSecurity[], keyOf: (row: AllocationSecurity) => string): AllocationSecurity[] {
  const largestFirst = (a: AllocationSecurity, b: AllocationSecurity) => b.valueKrw - a.valueKrw || a.ticker.localeCompare(b.ticker)
  const merged = new Map<string, AllocationSecurity>()
  for (const row of [...rows].sort(largestFirst)) {
    const key = keyOf(row)
    const seen = merged.get(key)
    merged.set(key, seen ? { ...seen, valueKrw: seen.valueKrw + row.valueKrw } : row)
  }
  return [...merged.values()].sort(largestFirst)
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
  return {
    totalKrw,
    classes: shares(ALLOCATION_CLASSES, byClass, totalKrw),
    wrappers: shares(ALLOCATION_WRAPPERS, byWrapper, totalKrw),
    marketDefaults: oneRowPer(marketDefaults, (row) => `${row.market}:${row.ticker}`),
    unclassified: oneRowPer(unclassified, (row) => `${row.market}:${row.ticker}`),
  }
}
