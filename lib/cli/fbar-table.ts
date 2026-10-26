/**
 * `pnpm fbar:table` — each foreign account's maximum value in a calendar year, as
 * the Observatory computes it for FBAR (FinCEN 114) and Form 8938.
 *
 * The figures are the ones the net-worth page shows (`getForeignAccountMaxima`):
 * a won account's maximum is converted at the Treasury Reporting Rate for the
 * year's last day, a dollar account keeps its own dollar maximum, and the
 * maximum is the highest balance on ANY day of the year (a statement that prints
 * a balance after every transaction also contributes its intraday peak), not the
 * year-end balance. `coverage` says how each maximum was found; a row that is not
 * `daily` may be understated.
 *
 * A brokerage row's maximum comes from month-end holdings, so a peak inside the
 * month is missed (`understated`). Its uninvested cash is known day by day, so
 * `cashDailyMax*` reports the highest day of the cash alone, and `bestKnownMaxUsd`
 * is the larger of the two. For an account that holds only cash (a closed 종합
 * whose dollars sat in 외화RP) that is the account's real maximum.
 *
 * `--csv` prints the table as CSV and nothing else, so `pnpm fbar:table --year
 * 2025 --csv > fbar-2025.csv` saves it. The command itself writes no file.
 * Reference figures: nothing here decides whether, or what, to file.
 */
import type Database from 'better-sqlite3'
import { getForeignAccountMaxima } from '@/lib/adapters/portfolio-db'
import { lastCompleteYear, type ForeignAccountRow } from '@/lib/fbar'
import {
  buildProvenance,
  hasTable,
  krw,
  provenanceLines,
  table,
  todayLosAngeles,
  UsageError,
  usd,
  type CliContext,
  type Command,
  type ParsedFlags,
} from '@/lib/cli/common'

type TableRow = {
  section: 'account' | 'crypto'
  institution: string
  account: string
  kind: string
  maxUsd: number | null
  maxKrw: number | null
  maxDate: string
  coverage: string
  understated: boolean
  cashIncluded: boolean | null
  /** The highest day of a brokerage account's uninvested cash alone, in dollars. */
  cashDailyMaxUsd: number | null
  cashDailyMaxDate: string | null
  /** The larger of `maxUsd` and `cashDailyMaxUsd`: still a floor for a brokerage account. */
  bestKnownMaxUsd: number | null
}

const CSV_HEADER = [
  'section', 'institution', 'account', 'kind', 'max_usd', 'max_krw', 'max_date', 'coverage', 'understated',
  'cash_included', 'cash_daily_max_usd', 'cash_daily_max_date', 'best_known_max_usd',
]

function yearFlag(flags: ParsedFlags): number {
  const raw = flags.year
  if (raw === undefined) return lastCompleteYear(todayLosAngeles())
  const year = Number(raw)
  if (typeof raw !== 'string' || !/^\d{4}$/.test(raw) || year < 2000 || year > 2100) throw new UsageError(`--year must be a four-digit year, got ${String(raw)}`)
  return year
}

/**
 * Each brokerage account's uninvested cash, day by day: the pools (won, dollars,
 * …) summed in dollars at the Treasury rate, each pool carried forward from its
 * last printed balance, the highest day of `year`. End-of-day balances, so a peak
 * that left the same day is not here.
 */
export function cashDailyMax(
  conn: Database.Database,
  year: number,
  krwPerUsd: number | null
): Map<string, { maxUsd: number; date: string }> {
  const out = new Map<string, { maxUsd: number; date: string }>()
  if (!krwPerUsd || !hasTable(conn, 'brokerage_cash')) return out
  const start = `${year}-01-01`
  const end = `${year}-12-31`
  const rows = conn
    .prepare('select account, pool, currency, as_of_date as date, balance from brokerage_cash order by as_of_date, id')
    .all() as { account: string; pool: string; currency: string; date: string; balance: number }[]
  const byAccount = new Map<string, Map<string, { currency: string; points: { date: string; balance: number }[] }>>()
  for (const row of rows) {
    const pools = byAccount.get(row.account) ?? new Map()
    const pool = pools.get(row.pool) ?? { currency: row.currency, points: [] }
    pool.points.push({ date: row.date, balance: Number(row.balance) })
    pools.set(row.pool, pool)
    byAccount.set(row.account, pools)
  }
  for (const [account, pools] of byAccount) {
    const dates = new Set<string>([start])
    for (const { points } of pools.values()) for (const p of points) if (p.date >= start && p.date <= end) dates.add(p.date)
    let best: { maxUsd: number; date: string } | null = null
    for (const date of [...dates].sort()) {
      let total = 0
      for (const { currency, points } of pools.values()) {
        const last = points.filter((p) => p.date <= date).at(-1)
        if (last) total += currency === 'USD' ? last.balance : last.balance / krwPerUsd
      }
      if (!best || total > best.maxUsd) best = { maxUsd: total, date }
    }
    if (best && best.maxUsd > 0) out.set(account, best)
  }
  return out
}

function toRow(section: TableRow['section'], row: ForeignAccountRow, cash?: { maxUsd: number; date: string }): TableRow {
  const cashUsd = usd(cash?.maxUsd)
  return {
    section,
    institution: row.institution,
    account: row.account,
    kind: row.kind,
    maxUsd: usd(row.maxUsd),
    maxKrw: krw(row.maxKrw),
    maxDate: row.maxDate,
    coverage: row.coverage,
    understated: row.understated,
    cashIncluded: row.cashIncluded ?? null,
    cashDailyMaxUsd: cashUsd,
    cashDailyMaxDate: cash?.date ?? null,
    bestKnownMaxUsd: usd(row.maxUsd == null && cashUsd == null ? null : Math.max(row.maxUsd ?? 0, cashUsd ?? 0)),
  }
}

function csvCell(value: string | number | boolean | null) {
  if (value == null) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function fbarCsv(rows: TableRow[]) {
  const lines = rows.map((r) =>
    [r.section, r.institution, r.account, r.kind, r.maxUsd, r.maxKrw, r.maxDate, r.coverage, r.understated, r.cashIncluded, r.cashDailyMaxUsd, r.cashDailyMaxDate, r.bestKnownMaxUsd]
      .map(csvCell)
      .join(',')
  )
  return [CSV_HEADER.join(','), ...lines].join('\n')
}

export function runFbarTable(flags: ParsedFlags, ctx: CliContext) {
  const year = yearFlag(flags)
  const maxima = getForeignAccountMaxima(year)
  const byName = (a: TableRow, b: TableRow) => a.institution.localeCompare(b.institution) || a.account.localeCompare(b.account)
  // Only a brokerage or crypto row has uninvested cash to add; a bank row's maximum is already daily.
  const cash = cashDailyMax(ctx.conn, year, maxima.rate?.krwPerUsd ?? null)
  const cashOf = (r: ForeignAccountRow) => (r.kind === 'brokerage' || r.kind === 'crypto' ? cash.get(r.account) : undefined)
  const rows = [
    ...maxima.rows.map((r) => toRow('account', r, cashOf(r))).sort(byName),
    ...maxima.cryptoRows.map((r) => toRow('crypto', r, cashOf(r))).sort(byName),
  ]
  return {
    provenance: buildProvenance({ conn: ctx.conn, policyState: ctx.policyState, dbPath: ctx.dbPath }),
    year,
    rate: maxima.rate,
    aggregateMaxUsd: usd(maxima.aggregateMaxUsd),
    cryptoSubtotalMaxUsd: usd(maxima.cryptoSubtotalMaxUsd),
    rows,
    csv: flags.csv ? fbarCsv(rows) : null,
  }
}

function textFbarTable(r: Record<string, any>) {
  // --csv is the whole output: the file a caller redirects must hold nothing else.
  if (r.csv) return r.csv
  return [
    `fbar:table — foreign account maxima ${r.year}: ${r.rows.length} row(s)`,
    r.rate ? `Treasury rate ${r.rate.krwPerUsd} KRW/USD (${r.rate.date}); aggregate ${r.aggregateMaxUsd} USD (crypto exchanges apart: ${r.cryptoSubtotalMaxUsd})` : `no Treasury rate for ${r.year}: USD figures are null`,
    '',
    table(
      ['section', 'institution', 'account', 'max USD', 'max KRW', 'on', 'coverage', 'cash-only daily max USD', 'best known USD'],
      r.rows.map((row: TableRow) => [
        row.section,
        row.institution,
        row.account,
        row.maxUsd,
        row.maxKrw,
        row.maxDate,
        row.understated ? `${row.coverage} (may be understated)` : row.coverage,
        row.cashDailyMaxUsd,
        row.bestKnownMaxUsd,
      ])
    ),
    '',
    provenanceLines(r.provenance),
  ].join('\n')
}

export const fbarTableCommand: Command = {
  name: 'fbar:table',
  usage: 'pnpm fbar:table [--year YYYY] [--csv | --json]',
  flags: { year: 'string', csv: 'boolean' },
  run: runFbarTable as Command['run'],
  text: textFbarTable,
}
