import type { PortfolioSnapshot } from '@/lib/adapters/portfolio-db'

/**
 * The Overview's stock trend: scopes, the snapshot field each metric reads, and
 * the points the two chart views plot. Stock-only in both asset views. Deposits,
 * pensions and gold have their own stacked chart (the total-assets trend), so
 * nothing here adds them to a stock figure.
 */

export const TREND_METRICS = [
  { key: 'market_value', label: 'Market value', color: 'var(--brand-blue)' },
  { key: 'cost_basis', label: 'Cost basis', color: 'var(--brand-purple)' },
  { key: 'unrealized_gl', label: 'Unrealized G/L', color: 'var(--accent-success)' },
  { key: 'realized_gl', label: 'Realized G/L', color: 'var(--brand-pink)' },
  { key: 'return_pct', label: 'Return %', color: 'var(--accent-warning)' },
] as const

export const TREND_SCOPES = [
  { key: 'global', label: 'Global' },
  { key: 'KR', label: 'Korea' },
  { key: 'US', label: 'United States' },
  { key: 'CRYPTO', label: 'Crypto' },
] as const

export const TREND_FIELDS = {
  global: {
    market_value: 'global_base_market_value',
    cost_basis: 'global_base_cost',
    unrealized_gl: 'global_base_unrealized_gl',
    realized_gl: 'global_realized_gl',
    return_pct: 'global_base_return_pct',
  },
  KR: {
    market_value: 'kr_market_value',
    cost_basis: 'kr_cost_basis',
    unrealized_gl: 'kr_unrealized_gl',
    realized_gl: 'kr_realized_gl',
    return_pct: 'kr_return_pct',
  },
  US: {
    market_value: 'us_market_value_base',
    cost_basis: 'us_cost_basis_base',
    unrealized_gl: 'us_unrealized_gl_base',
    realized_gl: 'us_realized_gl_base',
    return_pct: 'us_return_pct',
  },
  CRYPTO: {
    market_value: 'crypto_market_value_base',
    cost_basis: 'crypto_cost_basis_base',
    unrealized_gl: 'crypto_unrealized_gl_base',
    realized_gl: 'crypto_realized_gl_base',
    return_pct: 'crypto_return_pct',
  },
} as const

export const TREND_COVERAGE_FIELDS = {
  global: 'market_value_coverage',
  KR: 'kr_market_value_coverage',
  US: 'us_market_value_coverage',
  CRYPTO: 'crypto_market_value_coverage',
} as const

export const MIN_TREND_COST_COVERAGE = 0.9
// Metrics that need no market price, so a thinly priced snapshot still plots them.
export const PRICE_FREE_TREND_METRICS: readonly TrendMetricKey[] = ['cost_basis', 'realized_gl']
export const HEALTHY_TREND_COST_COVERAGE = 0.95

export type TrendMetricKey = (typeof TREND_METRICS)[number]['key']
export type TrendScopeKey = (typeof TREND_SCOPES)[number]['key']
type TrendFieldKey = keyof PortfolioSnapshot

/** The scope a `?scope=` value names. Anything else, `deposits` included, is Global. */
export function resolveTrendScope(param: string | undefined): TrendScopeKey {
  return TREND_SCOPES.find((scope) => scope.key === param)?.key ?? 'global'
}

/**
 * The single-metric view: one point per snapshot. A priced metric is null where
 * the scope's coverage is under the minimum; a return is plotted as is, and
 * every other metric goes through `toDisplay` (KRW to display-currency millions).
 */
export function singleTrendPoints(
  snapshots: PortfolioSnapshot[],
  scope: TrendScopeKey,
  metric: TrendMetricKey,
  toDisplay: (value: number) => number
) {
  const field = TREND_FIELDS[scope][metric] as TrendFieldKey
  const coverageField = TREND_COVERAGE_FIELDS[scope]
  return snapshots.map((snapshot) => ({
    date: snapshot.snapshot_date,
    value:
      snapshot[field] == null || (!PRICE_FREE_TREND_METRICS.includes(metric) && Number(snapshot[coverageField]) < MIN_TREND_COST_COVERAGE)
        ? null
        : metric === 'return_pct'
          ? Number(snapshot[field])
          : toDisplay(Number(snapshot[field])),
    coverage: snapshot[coverageField],
  }))
}

/** The combined view: market value, cost basis and both G/Ls per snapshot, priced ones gated on coverage. */
export function combinedTrendPoints(snapshots: PortfolioSnapshot[], scope: TrendScopeKey, toDisplay: (value: number) => number) {
  const fields = TREND_FIELDS[scope]
  const coverageField = TREND_COVERAGE_FIELDS[scope]
  const read = (snapshot: PortfolioSnapshot, key: keyof typeof fields, priced: boolean) => {
    const raw = snapshot[fields[key] as TrendFieldKey]
    return raw == null || (priced && Number(snapshot[coverageField]) < MIN_TREND_COST_COVERAGE) ? null : toDisplay(Number(raw))
  }
  return snapshots.map((snapshot) => ({
    date: snapshot.snapshot_date,
    market_value: read(snapshot, 'market_value', true),
    cost_basis: read(snapshot, 'cost_basis', false),
    unrealized_gl: read(snapshot, 'unrealized_gl', true),
    realized_gl: read(snapshot, 'realized_gl', false),
  }))
}
