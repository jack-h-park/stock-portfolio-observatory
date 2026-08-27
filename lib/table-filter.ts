/**
 * Filtering a table from the URL.
 *
 * The four tables in PortfolioTables each kept their filters in `useState`, so
 * a filtered view could not be linked or bookmarked, the back button did not
 * undo a filter, and reloading the page threw the selection away. Worse, the
 * same four filters — market, broker, account, type — were re-implemented per
 * table with slightly different option lists.
 *
 * Filters live in the query string instead, which keeps the tables server
 * components and makes a filtered view a URL like any other.
 */
export type FilterGroup<Row> = {
  /** Query-string key, and the row property it filters on when `valueFor` is absent. */
  key: string
  label: string
  /** Reads the value this row should be grouped under. */
  valueFor?: (row: Row) => string | null | undefined
}

export const ALL = 'All'

function read(params: Record<string, string | string[] | undefined>, key: string) {
  const raw = params[key]
  const value = Array.isArray(raw) ? raw[0] : raw
  return value && value !== ALL ? value : ALL
}

function valueOf<Row>(row: Row, group: FilterGroup<Row>) {
  return group.valueFor ? group.valueFor(row) : (row as Record<string, any>)[group.key]
}

/** The selected value for each group, defaulting to "All". */
export function readFilters<Row>(
  params: Record<string, string | string[] | undefined>,
  groups: FilterGroup<Row>[]
): Record<string, string> {
  return Object.fromEntries(groups.map((group) => [group.key, read(params, group.key)]))
}

export function applyFilters<Row>(rows: Row[], groups: FilterGroup<Row>[], selected: Record<string, string>) {
  return rows.filter((row) =>
    groups.every((group) => {
      const value = selected[group.key]
      return value === ALL || String(valueOf(row, group) ?? '') === value
    })
  )
}

/**
 * The options to offer for each group.
 *
 * A group's options are drawn from the rows that survive *the other* groups, so
 * the brokers listed under a chosen market are only that market's brokers. The
 * group's own selection is excluded from that narrowing, or picking a broker
 * would leave its own chip as the only one left and there would be no way back.
 */
export function filterOptions<Row>(rows: Row[], groups: FilterGroup<Row>[], selected: Record<string, string>) {
  return Object.fromEntries(
    groups.map((group) => {
      const others = groups.filter((other) => other.key !== group.key)
      const scoped = applyFilters(rows, others, selected)
      const values = Array.from(
        new Set(scoped.map((row) => valueOf(row, group)).filter((v): v is string => Boolean(v)))
      ).sort()
      return [group.key, [ALL, ...values]]
    })
  )
}

/** Free-text match across the columns a reader would type into a search box. */
export function applySearch<Row>(rows: Row[], query: string, fields: (row: Row) => Array<string | null | undefined>) {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return rows
  return rows.filter((row) =>
    fields(row)
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(trimmed)
  )
}

/**
 * A URL with one parameter changed, everything else preserved.
 *
 * Preserving the rest is the point: changing a filter must not silently drop
 * the sort, and changing the sort must not drop the filters.
 */
export function withParam(
  basePath: string,
  params: Record<string, string | string[] | undefined>,
  key: string,
  value: string | null
) {
  const next = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    const single = Array.isArray(v) ? v[0] : v
    if (single != null && k !== key) next.set(k, single)
  }
  if (value != null && value !== ALL) next.set(key, value)
  const query = next.toString()
  return query ? `${basePath}?${query}` : basePath
}
