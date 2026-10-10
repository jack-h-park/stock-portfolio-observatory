/**
 * Foreign-account maximum balances for FBAR and Form 8938, kept free of the
 * database so the rules can be tested on their own. Reference figures only:
 * nothing here decides whether a filing is required.
 */

/**
 * How a maximum was found:
 * - `daily`: balances carried forward day by day through the whole year;
 * - `month_end`: month-end values, so an intra-month peak is missed;
 * - `year_end`: certificate or snapshot totals only;
 * - `partial`: the history starts after 1 January or ends before 31 December,
 *   or (gold) part of the year is valued at cost.
 */
export type FbarCoverage = 'daily' | 'month_end' | 'year_end' | 'partial'
export type FbarResolution = Exclude<FbarCoverage, 'partial'>
export type BalancePoint = { date: string; valueKrw: number }
export type FbarKind = 'cash' | 'brokerage' | 'pension' | 'gold'

/**
 * The highest value in `year`. The last point before the year is carried in as
 * the balance held on 1 January, so an account that did not move all year still
 * has its maximum. The history covers the year when it reaches back to 1 January
 * (a point on or before it) and forward to 31 December (a point on or after it);
 * otherwise the coverage is `partial`, whatever the resolution. Ties keep the
 * earliest date. Null when no point falls in or before the year.
 *
 * `valueKrw` is the account's own unit: a USD account passes dollars and reads
 * its maximum in dollars.
 */
export function maxBalance(
  points: BalancePoint[],
  year: number,
  resolution: FbarResolution = 'daily'
): { maxKrw: number; date: string; coverage: FbarCoverage } | null {
  const start = `${year}-01-01`
  const end = `${year}-12-31`
  // Stable sort: points that share a date keep their input order, so the last wins.
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
  const carried = sorted.filter((point) => point.date < start).at(-1)
  const inYear = sorted.filter((point) => point.date >= start && point.date <= end)
  const candidates = [...(carried ? [{ date: start, valueKrw: carried.valueKrw }] : []), ...inYear]
  if (!candidates.length) return null
  let best = candidates[0]
  for (const point of candidates) if (point.valueKrw > best.valueKrw) best = point
  const reachesStart = Boolean(carried) || inYear[0]?.date === start
  const reachesEnd = sorted.some((point) => point.date >= end)
  return { maxKrw: best.valueKrw, date: best.date, coverage: reachesStart && reachesEnd ? resolution : 'partial' }
}

export type TreasuryRate = { year: number; date: string; krwPerUsd: number }

/** The Treasury Reporting Rate of Exchange for the year's last day, or null when the file has none. */
export function treasuryRateFor(year: number, rates: TreasuryRate[]): { krwPerUsd: number; date: string } | null {
  const found = rates.find((rate) => rate.year === year && rate.krwPerUsd > 0)
  return found ? { krwPerUsd: found.krwPerUsd, date: found.date } : null
}

/**
 * Cash institutions in the United States. A cash account anywhere else is
 * foreign. Brokerage accounts are split by market instead: US-market accounts
 * (Robinhood, Fidelity, Chase, Merrill) are domestic, KR-market ones foreign.
 */
export const US_CASH_INSTITUTIONS: readonly string[] = ['chase', 'boa', 'robinhood-bank', 'fidelity']

export function isUsCashInstitution(institution: string) {
  return US_CASH_INSTITUTIONS.includes(institution.trim().toLowerCase())
}

/** The last calendar year that has ended on `today` (YYYY-MM-DD). */
export function lastCompleteYear(today: string) {
  return Number(today.slice(0, 4)) - 1
}

export type ForeignAccountInput = {
  account: string
  kind: FbarKind
  maxKrw: number
  maxDate: string
  coverage: FbarCoverage
  /** A USD account's maximum in dollars, which is its FBAR figure as it stands. */
  maxUsdNative?: number
}
export type ForeignAccountRow = {
  account: string
  kind: FbarKind
  maxKrw: number
  maxDate: string
  maxUsd: number | null
  coverage: FbarCoverage
  understated: boolean
}
export type ForeignAccountMaxima = {
  year: number
  rate: { krwPerUsd: number; date: string } | null
  rows: ForeignAccountRow[]
  aggregateMaxUsd: number | null
}

/**
 * Rows for the table. A KRW maximum is converted at the Treasury year-end rate,
 * as the FBAR instructions direct. A USD account keeps its own dollar maximum,
 * and its won figure is that times the same rate. With no rate for the year,
 * every USD figure is null and the won figures stand as given. Any row not
 * found from daily balances may be understated.
 */
export function foreignAccountMaxima(
  year: number,
  rate: { krwPerUsd: number; date: string } | null,
  accounts: ForeignAccountInput[]
): ForeignAccountMaxima {
  const rows = accounts.map(({ maxUsdNative, ...account }): ForeignAccountRow => {
    const native = maxUsdNative != null && rate
    return {
      account: account.account,
      kind: account.kind,
      maxKrw: native ? maxUsdNative * rate.krwPerUsd : account.maxKrw,
      maxDate: account.maxDate,
      maxUsd: !rate ? null : native ? maxUsdNative : account.maxKrw / rate.krwPerUsd,
      coverage: account.coverage,
      understated: account.coverage !== 'daily',
    }
  })
  return { year, rate, rows, aggregateMaxUsd: rate ? rows.reduce((sum, row) => sum + (row.maxUsd ?? 0), 0) : null }
}
