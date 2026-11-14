const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

/** Calendar date only: Date.parse alone silently normalizes some invalid days. */
export function strictIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null
}

type CryptoStatementSelection = {
  venue: string
  account: string
  category: string
  today: string
}

/**
 * The end of contiguous parser-declared statement periods for one crypto account.
 * Quiet statements count even with zero activity. A malformed selected document,
 * incomplete scope or gap leaves coverage unconfirmed rather than using trades.
 */
export function cryptoStatementCoverageEnd(value: unknown, selection: CryptoStatementSelection): string | null {
  const { venue, account, category } = selection
  const today = strictIsoDate(selection.today)
  if (!today || !['bithumb_statement', 'robinhood_crypto_statement'].includes(category) || !object(value) || !Array.isArray(value.documents)) return null
  const documents = value.documents.filter(row => object(row) && row.venue === venue && row.account === account && row.category === category)
  if (!documents.length) return null
  const periods: { start: string; end: string }[] = []
  for (const row of documents) {
    if (!object(row) || !object(row.metrics)) return null
    const metrics = row.metrics
    if (category === 'bithumb_statement' && (metrics.scopeAssets !== '전체' || metrics.scopeTypes !== '매수/매도/입금/출금')) return null
    const start = strictIsoDate(metrics.periodStart)
    const end = strictIsoDate(metrics.periodEnd)
    if (!start || !end || start > end || end > today) return null
    periods.push({ start, end })
  }
  periods.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))
  let end = periods[0].end
  for (const period of periods.slice(1)) {
    const next = new Date(`${end}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    if (period.start > next.toISOString().slice(0, 10)) return null
    if (period.end > end) end = period.end
  }
  return end
}
