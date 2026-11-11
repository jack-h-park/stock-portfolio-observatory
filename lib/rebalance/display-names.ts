import { instrumentKey } from './instrument-classes'

/** A row that names an instrument: a position or a lot, weighted by its value when it has one. */
export type NamedRow = { market: string; ticker: string; name?: string | null; valueKrw?: number | null }

/**
 * One display name per instrument (market and ticker). The same KR code can arrive under two names from two
 * brokerages (a Korean-script name and a romanized one), so anything that groups or labels by instrument reads
 * the name from here rather than from whichever row it saw first. The pick is deterministic: the name of the
 * largest-value row for that instrument, ties broken alphabetically; blank names are ignored. Stored data is
 * never rewritten.
 */
export function displayNames(rows: Iterable<NamedRow>): Map<string, string> {
  const best = new Map<string, { name: string; value: number }>()
  for (const row of rows) {
    const name = String(row.name ?? '').trim()
    if (!name) continue
    const key = instrumentKey(row.market, row.ticker)
    const value = Number.isFinite(row.valueKrw) ? Number(row.valueKrw) : 0
    const current = best.get(key)
    if (!current || value > current.value || (value === current.value && name.localeCompare(current.name) < 0)) {
      best.set(key, { name, value })
    }
  }
  return new Map([...best.entries()].map(([key, entry]) => [key, entry.name]))
}

/** The display name for an instrument, or its ticker when no row names it. */
export function displayName(names: Map<string, string>, market: string, ticker: string): string {
  return names.get(instrumentKey(market, ticker)) ?? ticker
}

/**
 * The display names of a rebalance snapshot: positions first (by value, at cost when unpriced); a lot names an
 * instrument only when no position does.
 */
export function snapshotDisplayNames(input: {
  positions: { market: string; ticker: string; name: string; valueKrw: number | null; costKrw: number }[]
  lots?: { market: string; ticker: string; name: string; cost_basis_krw: number }[]
}): Map<string, string> {
  const names = displayNames(input.positions.map((p) => ({ market: p.market, ticker: p.ticker, name: p.name, valueKrw: p.valueKrw ?? p.costKrw })))
  const fromLots = displayNames((input.lots ?? []).map((l) => ({ market: l.market, ticker: l.ticker, name: l.name, valueKrw: l.cost_basis_krw })))
  for (const [key, name] of fromLots) if (!names.has(key)) names.set(key, name)
  return names
}
