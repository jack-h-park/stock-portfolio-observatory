import type { StatementPeriodEvidence } from '@/lib/domain/assets/statement-periods'
import type { NetWorth } from '@/lib/net-worth'

type StatusRow = { status: string }
type AccountRow = StatusRow & { account?: string; statementPeriodEnd?: string | null; statementPeriodEvidence?: StatementPeriodEvidence }
type FileSummary = { fresh: number; stale: number; drift: number; missing: number }
export type CoverageReaders = {
  accounts: () => { rows: AccountRow[] }
  supplementary: () => { rows: StatusRow[] }
  checks: () => StatusRow[]
  files: () => { summary: FileSummary }
}

/** Dates describe observations, not proof that a complete period was supplied. */
export function dateRange(dates: (string | null | undefined)[]) {
  const known = dates.filter((date): date is string => Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(date))).sort()
  return { oldest: known[0] ?? null, newest: known.at(-1) ?? null, undated: dates.length - known.length }
}

function read<T>(reader: () => T): T | null {
  try { return reader() } catch { return null }
}
function counts(rows: StatusRow[] | undefined) {
  if (!rows?.length) return null
  return {
    current: rows.filter(row => row.status === 'current').length,
    dueSoon: rows.filter(row => row.status === 'due_soon').length,
    actionNeeded: rows.filter(row => row.status === 'action_needed').length,
    missing: rows.filter(row => row.status === 'missing' || row.status === 'unconfirmed').length,
  }
}

/** Read each signal independently; missing evidence must never become a green zero. */
export function collectAssetCoverage(summary: NetWorth, readers: CoverageReaders) {
  const accounts = read(readers.accounts), supplementary = read(readers.supplementary)
  const checks = read(readers.checks), files = read(readers.files)
  const nonzero = summary.cash.filter(row => row.balance !== 0)
  const statementEvidence = accounts?.rows.map(row => ({ account: row.account ?? null, ...(row.statementPeriodEvidence ?? { state: 'unconfirmed' as const, periodEnd: null, sources: [] }) })) ?? null
  return {
    cash: { ...dateRange(nonzero.map(row => row.asOfDate)), nonzero: nonzero.length, zero: summary.cash.length - nonzero.length },
    accounts: counts(accounts?.rows),
    supplementary: counts(supplementary?.rows),
    statementPeriods: accounts?.rows.length ? dateRange(accounts.rows.map(row => row.statementPeriodEvidence?.state === 'declared' ? row.statementPeriodEvidence.periodEnd : null)) : null,
    statementEvidence,
    statementPeriodCounts: statementEvidence?.length ? { declared: statementEvidence.filter(row => row.state === 'declared').length, conflicting: statementEvidence.filter(row => row.state === 'conflicting').length, unconfirmed: statementEvidence.filter(row => row.state === 'unconfirmed').length } : null,
    failedChecks: checks?.length ? checks.filter(row => row.status !== 'pass').length : null,
    files: files?.summary ?? null,
  }
}
export type AssetCoverageReview = ReturnType<typeof collectAssetCoverage>
