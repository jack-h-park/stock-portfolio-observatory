/**
 * The period buttons over every trend chart (`?trend=<key>`), shared so the
 * overview and the net worth page offer the same periods and default to 2Y.
 */
export const TREND_RANGES = [
  { key: '30', label: '1M', days: 30 },
  { key: '90', label: '3M', days: 90 },
  { key: '180', label: '6M', days: 180 },
  { key: 'ytd', label: 'YTD', days: 'ytd' },
  { key: '365', label: '1Y', days: 365 },
  { key: '730', label: '2Y', days: 730 },
  { key: '1095', label: '3Y', days: 1095 },
  { key: '1825', label: '5Y', days: 1825 },
  { key: 'all', label: 'All', days: 3650 },
] as const
export type TrendRange = (typeof TREND_RANGES)[number]
export const DEFAULT_TREND_RANGE = TREND_RANGES.find((range) => range.key === '730')!

/** The range a `?trend=` value names, or the default for a missing or unknown one. */
export function resolveTrendRange(param: string | string[] | undefined): TrendRange {
  const key = Array.isArray(param) ? param[0] : param
  return TREND_RANGES.find((range) => range.key === key) ?? DEFAULT_TREND_RANGE
}

/** Days back from today; YTD counts January 1 as day 1. */
export function trendRangeDays(days: TrendRange['days'], now = new Date()) {
  if (days !== 'ytd') return days
  const yearStart = new Date(now.getFullYear(), 0, 1)
  return Math.max(1, Math.floor((now.getTime() - yearStart.getTime()) / 86_400_000) + 1)
}
