/**
 * Sorting a table from the URL.
 *
 * The dashboard's tables were split in two: nine pages rendered `DataTable` on
 * the server with no sorting at all, while four client tables in
 * PortfolioTables each carried their own `useState` sort. So whether a column
 * could be sorted depended on which page you were looking at, and a sorted view
 * could not be linked, bookmarked, or reached with the back button.
 *
 * State lives in the query string instead, which keeps the table a server
 * component: the header cells are links, the server sorts the rows, and the
 * result works with JavaScript disabled.
 */
export type SortDirection = 'asc' | 'desc'
export type TableSort = { key: string; direction: SortDirection }

/** Read `?sort=key:desc`, falling back when it is absent or malformed. */
export function parseSort(value: string | string[] | undefined, fallback: TableSort | null = null): TableSort | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) return fallback
  const [key, direction] = raw.split(':')
  if (!key) return fallback
  return { key, direction: direction === 'asc' ? 'asc' : 'desc' }
}

export function formatSort(sort: TableSort) {
  return `${sort.key}:${sort.direction}`
}

/**
 * The sort a header click should produce.
 *
 * Clicking a new column starts at the direction that reads as "most
 * interesting" for its type — largest first for numbers, A–Z for text — and
 * clicking the current column flips it.
 */
export function nextSort(current: TableSort | null, key: string, firstDirection: SortDirection = 'desc'): TableSort {
  if (current?.key === key) return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  return { key, direction: firstDirection }
}

type Comparable = string | number | null | undefined

function compare(a: Comparable, b: Comparable) {
  // Nulls sort last in both directions: a missing value is not a small one, and
  // burying the rows that need attention under a descending sort would hide
  // exactly what a reader is looking for.
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

/**
 * Sort a copy of `rows`. `valueFor` reads the sortable value for a column,
 * which is not always what the cell renders — a badge shows "KR" but sorts on
 * the market code, and a formatted amount sorts on the number behind it.
 */
export function sortRows<Row>(
  rows: Row[],
  sort: TableSort | null,
  valueFor: (row: Row, key: string) => Comparable
): Row[] {
  if (!sort) return rows
  const sorted = [...rows].sort((a, b) => compare(valueFor(a, sort.key), valueFor(b, sort.key)))
  // Nulls stay at the end rather than flipping to the front with the direction.
  if (sort.direction === 'desc') {
    const present = sorted.filter((row) => valueFor(row, sort.key) != null).reverse()
    const missing = sorted.filter((row) => valueFor(row, sort.key) == null)
    return [...present, ...missing]
  }
  return sorted
}
