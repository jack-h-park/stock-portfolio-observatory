import { ALL_YEARS, defaultSoldYear, type RealizedLotView } from '@/lib/realized-lots'
import { applyFilters, applySearch, filterOptions, readFilters, type FilterGroup } from '@/lib/table-filter'

type Params = Record<string, string | string[] | undefined>

/** `label` is a key into the page copy, resolved per language at render time. */
export const REALIZED_GROUPS: FilterGroup<RealizedLotView>[] = [
  { key: 'market', label: 'market' },
  { key: 'brokerage', label: 'broker' },
  { key: 'term', label: 'term', valueFor: (row) => row.tax_term || 'Unknown' },
]

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * The page's and the CSV's one reading of the URL, so a download always holds
 * exactly the rows the table shows.
 *
 * The year is not one of the ordinary groups: it opens on this year rather than
 * on "All", and the table-filter helpers drop the "All" value from the URL,
 * which would make "All years" unselectable behind a default. It therefore has
 * a value of its own (`ALL_YEARS`) that stays in the query string.
 */
export function queryRealized(rows: RealizedLotView[], params: Params, currentYear: string) {
  const years = Array.from(new Set(rows.map((row) => row.sold_year).filter(Boolean))).sort().reverse()
  const defaultYear = defaultSoldYear(years, currentYear)
  const requested = first(params.year)
  const year = requested === ALL_YEARS || (requested && years.includes(requested)) ? requested : defaultYear

  const inYear = year === ALL_YEARS ? rows : rows.filter((row) => row.sold_year === year)
  const selected = readFilters(params, REALIZED_GROUPS)
  const options = filterOptions(inYear, REALIZED_GROUPS, selected)
  const rawQuery = first(params.q)
  const query = typeof rawQuery === 'string' ? rawQuery : ''
  const filtered = applySearch(applyFilters(inYear, REALIZED_GROUPS, selected), query, (row) => [
    row.ticker,
    row.name,
    row.account,
    row.brokerage,
  ])
  return { years, defaultYear, year: year as string, selected, options, query, inYear, filtered }
}
