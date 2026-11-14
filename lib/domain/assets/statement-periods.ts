export type StatementPeriodReceipt = { source: string; sha256: string; page: 1; start: string; end: string }
export type StatementPeriodEvidence = { state: 'declared' | 'conflicting' | 'unconfirmed'; periodEnd: string | null; sources: StatementPeriodReceipt[] }
const unknown = (): StatementPeriodEvidence => ({ state: 'unconfirmed', periodEnd: null, sources: [] })
const object = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
function date(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}

/** Use parser-declared, unfiltered periods, never quote dates or filenames. */
export function bithumbStatementEnd(value: unknown, account: string, today: string): string | null {
  if (!object(value) || !Array.isArray(value.documents)) return null
  const documents = value.documents.filter(row => object(row) && row.category === 'bithumb_statement' && row.venue === 'Bithumb' && row.account === account)
  if (!documents.length) return null
  const periods: { start: string; end: string }[] = []
  for (const row of documents) {
    const metrics = row.metrics
    if (!object(metrics) || metrics.scopeAssets !== '전체' || metrics.scopeTypes !== '매수/매도/입금/출금' ||
      !date(metrics.periodStart) || !date(metrics.periodEnd) || metrics.periodStart > metrics.periodEnd || metrics.periodEnd > today) return null
    periods.push({ start: metrics.periodStart, end: metrics.periodEnd })
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

/** Parser-recorded receipt only. No original-file I/O or current-byte verification. */
export function readStatementPeriodEvidence(value: unknown, account: string): StatementPeriodEvidence {
  if (!object(value) || !object(value.statementPeriods)) return unknown()
  const metadata = value.statementPeriods
  if (metadata.schemaVersion !== 1 || !object(metadata.accounts) || !Object.hasOwn(metadata.accounts, account)) return unknown()
  const entry = metadata.accounts[account]
  if (!object(entry) || !['declared', 'conflicting', 'unconfirmed'].includes(entry.state) || !Array.isArray(entry.sources)) return unknown()
  const sources: StatementPeriodReceipt[] = []
  const bySource = new Map<string, StatementPeriodReceipt>()
  const disputed = new Set<string>()
  let conflict = entry.state === 'conflicting'
  for (const row of entry.sources) {
    if (!object(row) || typeof row.source !== 'string' || !row.source.trim() || !/\.pdf$/i.test(row.source) || /[\\/\x00-\x1f]/.test(row.source) || ['.', '..'].includes(row.source) ||
      typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256) || row.page !== 1 || !date(row.start) || !date(row.end) || row.start > row.end) return unknown()
    const source: StatementPeriodReceipt = { source: row.source, sha256: row.sha256, page: 1, start: row.start, end: row.end }
    const previous = bySource.get(source.source)
    if (previous && (previous.sha256 !== source.sha256 || previous.start !== source.start || previous.end !== source.end)) { conflict = true; disputed.add(source.source) }
    if (!previous) sources.push(source)
    bySource.set(source.source, source)
  }
  const stableSources = sources.filter(source => !disputed.has(source.source))
  stableSources.sort((a, b) => a.end < b.end ? -1 : a.end > b.end ? 1 : a.source < b.source ? -1 : a.source > b.source ? 1 : 0)
  const state = conflict ? 'conflicting' : entry.state === 'declared' && stableSources.length ? 'declared' : 'unconfirmed'
  return { state, periodEnd: state === 'declared' ? stableSources.at(-1)!.end : null, sources: stableSources }
}
