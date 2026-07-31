import Link from 'next/link'
import { FreshnessInline } from '@/components/Freshness'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, StatCard , marketTone } from '@/components/ui'
import { AllocationPieChart, PortfolioMultiTrendChart, PortfolioTrendChart, TrendBarChart } from '@/components/charts'
import {
  dbAvailable,
  getAccountAllocation,
  getDividendByYear,
  getMeta,
  getOperationalHealth,
  getOverview,
  getPortfolioSnapshots,
  getTopHoldings,
  getTransactionTypes,
} from '@/lib/adapters/portfolio-db'
import type { PortfolioSnapshot } from '@/lib/adapters/portfolio-db'
import { config } from '@/config'
import { fmtDateTime, fmtKrw, fmtMoney, fmtNumber } from '@/lib/format'
import { positionHref } from '@/lib/position-url'

export const dynamic = 'force-dynamic'

const TREND_RANGES = [
  { key: '30', label: '1M', days: 30 },
  { key: '90', label: '3M', days: 90 },
  { key: '365', label: '1Y', days: 365 },
  { key: 'all', label: 'All', days: 3650 },
] as const

const TREND_METRICS = [
  { key: 'market_value', label: 'Market value', color: 'var(--brand-blue)' },
  { key: 'cost_basis', label: 'Cost basis', color: 'var(--brand-purple)' },
  { key: 'unrealized_gl', label: 'Unrealized G/L', color: 'var(--accent-success)' },
  { key: 'return_pct', label: 'Return %', color: 'var(--accent-warning)' },
] as const

const TREND_SCOPES = [
  { key: 'global', label: 'Global' },
  { key: 'KR', label: 'Korea' },
  { key: 'US', label: 'United States' },
  { key: 'CRYPTO', label: 'Crypto' },
] as const

const TREND_FIELDS = {
  global: {
    market_value: 'global_base_market_value',
    cost_basis: 'global_base_cost',
    unrealized_gl: 'global_base_unrealized_gl',
    return_pct: 'global_base_return_pct',
  },
  KR: {
    market_value: 'kr_market_value',
    cost_basis: 'kr_cost_basis',
    unrealized_gl: 'kr_unrealized_gl',
    return_pct: 'kr_return_pct',
  },
  US: {
    market_value: 'us_market_value_base',
    cost_basis: 'us_cost_basis_base',
    unrealized_gl: 'us_unrealized_gl_base',
    return_pct: 'us_return_pct',
  },
  CRYPTO: {
    market_value: 'crypto_market_value_base',
    cost_basis: 'crypto_cost_basis_base',
    unrealized_gl: 'crypto_unrealized_gl_base',
    return_pct: 'crypto_return_pct',
  },
} as const

type TrendMetricKey = (typeof TREND_METRICS)[number]['key']
type TrendScopeKey = (typeof TREND_SCOPES)[number]['key']
type TrendFieldKey = keyof PortfolioSnapshot
type TrendViewKey = 'single' | 'combined'

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ trend?: string; metric?: string; scope?: string; view?: string }>
}) {
  if (!dbAvailable()) {
    return (
      <>
        <PageHeader eyebrow="Stock Portfolio Observatory" title="Overview" emphasis="Overview" />
        <Card title="Portfolio DB not found">
          <p className="text-[13px] text-ink-2">
            Run <code className="font-mono text-[12px]">pnpm ingest</code> to generate{' '}
            <code className="font-mono text-[12px]">{config.stockDbPath}</code>.
          </p>
        </Card>
      </>
    )
  }

  const meta = getMeta()
  const params = await searchParams
  const selectedRange = TREND_RANGES.find((range) => range.key === params.trend) ?? TREND_RANGES[3]
  const selectedScope = TREND_SCOPES.find((scope) => scope.key === params.scope)?.key ?? 'global'
  const legacyMetricMap: Record<string, TrendMetricKey> = {
    global_base_market_value: 'market_value',
    global_base_cost: 'cost_basis',
    global_base_unrealized_gl: 'unrealized_gl',
    global_base_return_pct: 'return_pct',
  }
  const selectedMetricKey = legacyMetricMap[params.metric ?? ''] ?? params.metric
  const selectedMetric = TREND_METRICS.find((metric) => metric.key === selectedMetricKey) ?? TREND_METRICS[0]
  const selectedField = TREND_FIELDS[selectedScope][selectedMetric.key]
  const selectedScopeLabel = TREND_SCOPES.find((scope) => scope.key === selectedScope)?.label ?? 'Global'
  const selectedView: TrendViewKey = params.view === 'combined' ? 'combined' : 'single'
  const combinedMetrics = TREND_METRICS.filter((metric) => metric.key !== 'return_pct')
  const overview = getOverview()
  const portfolioSnapshots = getPortfolioSnapshots(selectedRange.days)
  const top = getTopHoldings(10)
  const accounts = getAccountAllocation()
  const dividendYears = getDividendByYear()
  const txTypes = getTransactionTypes()
  const operational = getOperationalHealth()
  const usdKrw = overview.fxRates.find((r: any) => r.from_currency === 'USD' && r.to_currency === 'KRW')
  const operationalIssues = operational.staleItems.length

  const totalTerm = (overview.totals.long_term_qty ?? 0) + (overview.totals.short_term_qty ?? 0)
  const longTermPct = totalTerm > 0 ? Math.round((overview.totals.long_term_qty / totalTerm) * 100) : 0
  // Market-scoped, not currency-scoped: crypto holds KRW positions on Bithumb and
  // USD positions on Robinhood, so summing by currency would file each of them
  // under the KR or US card.
  const krBase = overview.totals.kr_base_cost
  const usBase = overview.totals.us_base_cost
  const cryptoBase = overview.totals.crypto_base_cost
  const globalBase = overview.totals.global_base_cost
  const usUnrealizedPct =
    overview.totals.us_base_cost > 0 ? (overview.totals.us_base_unrealized_gl / overview.totals.us_base_cost) * 100 : 0
  const krUnrealizedPct =
    overview.totals.kr_base_cost > 0 ? (overview.totals.kr_base_unrealized_gl / overview.totals.kr_base_cost) * 100 : 0
  const cryptoUnrealizedPct =
    overview.totals.crypto_base_cost > 0
      ? (overview.totals.crypto_base_unrealized_gl / overview.totals.crypto_base_cost) * 100
      : 0
  const globalUnrealizedPct =
    overview.totals.global_base_cost > 0 ? (overview.totals.global_base_unrealized_gl / overview.totals.global_base_cost) * 100 : 0
  const krShare = globalBase > 0 ? Math.round((krBase / globalBase) * 100) : 0
  const usShare = globalBase > 0 ? Math.round((usBase / globalBase) * 100) : 0
  const cryptoShare = globalBase > 0 ? Math.round((cryptoBase / globalBase) * 100) : 0
  const topFiveBase = top.slice(0, 5).reduce((sum, r) => sum + (r.base_cost ?? 0), 0)
  const topFiveShare = globalBase > 0 ? Math.round((topFiveBase / globalBase) * 100) : 0
  const largestPositions = top.slice(0, 5)
  const topHoldingChartData = top.map((r) => ({
    name: `${r.name} (${r.ticker})`,
    value: Math.round((r.base_cost ?? 0) / 1_000_000),
  }))
  const allocationData = [
    { name: 'Korea', value: krBase, label: `${fmtKrw(krBase)} · ${krShare}%` },
    { name: 'United States', value: usBase, label: `${fmtKrw(usBase)} · ${usShare}%` },
  ]
  const trendData = portfolioSnapshots
    .filter((snapshot) => snapshot[selectedField as TrendFieldKey] != null)
    .map((snapshot) => ({
      date: snapshot.snapshot_date,
      value: selectedMetric.key === 'return_pct'
        ? Number(snapshot[selectedField as TrendFieldKey])
        : Number(snapshot[selectedField as TrendFieldKey]) / 1_000_000,
      coverage: snapshot.market_value_coverage,
    }))
  const combinedTrendData = portfolioSnapshots
    .map((snapshot) => ({
      date: snapshot.snapshot_date,
      market_value: snapshot[TREND_FIELDS[selectedScope].market_value as TrendFieldKey] == null ? null : Number(snapshot[TREND_FIELDS[selectedScope].market_value as TrendFieldKey]) / 1_000_000,
      cost_basis: snapshot[TREND_FIELDS[selectedScope].cost_basis as TrendFieldKey] == null ? null : Number(snapshot[TREND_FIELDS[selectedScope].cost_basis as TrendFieldKey]) / 1_000_000,
      unrealized_gl: snapshot[TREND_FIELDS[selectedScope].unrealized_gl as TrendFieldKey] == null ? null : Number(snapshot[TREND_FIELDS[selectedScope].unrealized_gl as TrendFieldKey]) / 1_000_000,
    }))
    .filter((snapshot) => combinedMetrics.every((metric) => snapshot[metric.key] != null))
  const firstTrendValue = trendData[0]?.value ?? 0
  const latestTrendValue = trendData[trendData.length - 1]?.value ?? 0
  const trendChange = latestTrendValue - firstTrendValue
  const trendChangePct = firstTrendValue !== 0 ? (trendChange / Math.abs(firstTrendValue)) * 100 : null
  const latestTrendCoverage = selectedScope === 'global' ? trendData[trendData.length - 1]?.coverage : null
  const trendValueLabel = (value: number) => selectedMetric.key === 'return_pct' ? `${fmtNumber(value, 1)}%` : fmtKrw(value * 1_000_000)
  const trendChangeLabel = selectedMetric.key === 'return_pct'
    ? `${trendChange >= 0 ? '+' : ''}${fmtNumber(trendChange, 1)}%p`
    : `${trendChange >= 0 ? '+' : ''}${trendValueLabel(trendChange)}${trendChangePct == null ? '' : ` · ${trendChangePct >= 0 ? '+' : ''}${fmtNumber(trendChangePct, 1)}%`}`

  return (
    <>
      <PageHeader
        eyebrow="Stock Portfolio Observatory"
        title="Portfolio Overview"
        emphasis="Overview"
        subtitle={`Read-only snapshot ingested ${fmtDateTime(meta.ingested_at)} from local stock-management files.${usdKrw ? ` FX: USD/KRW ${fmtNumber(usdKrw.rate, 2)} as of ${usdKrw.as_of_date}.` : ''}`}
        action={overview.failedChecks + operationalIssues > 0 ? <Badge tone="warning">{overview.failedChecks + operationalIssues} health issue(s)</Badge> : <Badge tone="success">Healthy</Badge>}
      />

      <Card title="Data freshness" className="mb-5">
        <div className="grid gap-2 lg:grid-cols-3">
          {operational.snapshots.map((item) => (
            <div key={item.key} className="rounded-md border border-line-subtle bg-surface px-3 py-2">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{item.label}</div>
              <FreshnessInline item={item} />
            </div>
          ))}
        </div>
      </Card>

      <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Global snapshot</div>
      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4 2xl:grid-cols-6">
        <StatCard label="Global Cost Basis" value={fmtKrw(overview.totals.global_base_cost)} accent />
        <StatCard
          label="Global Unrealized G/L"
          value={fmtKrw(overview.totals.global_base_unrealized_gl)}
          hint={`${fmtNumber(globalUnrealizedPct, 2)}%`}
          tone={overview.totals.global_base_unrealized_gl >= 0 ? 'success' : 'danger'}
        />
        <StatCard
          label="KR Unrealized G/L"
          value={fmtKrw(overview.totals.kr_base_unrealized_gl)}
          hint={`${fmtKrw(overview.totals.kr_base_market_value)} market · ${fmtNumber(krUnrealizedPct, 2)}%`}
          tone={overview.totals.kr_base_unrealized_gl >= 0 ? 'success' : 'danger'}
        />
        <StatCard
          label="US Unrealized G/L"
          value={fmtKrw(overview.totals.us_base_unrealized_gl)}
          hint={`${fmtKrw(overview.totals.us_base_market_value)} market · ${fmtNumber(usUnrealizedPct, 2)}%`}
          tone={overview.totals.us_base_unrealized_gl >= 0 ? 'success' : 'danger'}
        />
        <StatCard
          label="Crypto Unrealized G/L"
          value={fmtKrw(overview.totals.crypto_base_unrealized_gl)}
          hint={`${fmtKrw(overview.totals.crypto_base_market_value)} market · ${fmtNumber(cryptoUnrealizedPct, 2)}%`}
          tone={overview.totals.crypto_base_unrealized_gl >= 0 ? 'success' : 'danger'}
        />
        <StatCard label="KR Cost Basis" value={fmtKrw(overview.totals.kr_base_cost)} />
        <StatCard label="US Cost Basis" value={fmtKrw(overview.totals.us_base_cost)} hint={`${fmtMoney(overview.totals.usd_cost, 'USD')} native`} />
        <StatCard label="Crypto Cost Basis" value={fmtKrw(overview.totals.crypto_base_cost)} hint={`${fmtNumber(cryptoShare)}% of portfolio`} />
        <StatCard label="Holdings" value={fmtNumber(overview.totals.holding_count)} hint={`${fmtNumber(overview.totals.share_count, 2)} shares`} />
        <StatCard label="Dividends" value={`${fmtKrw(overview.dividends.krw_amount)} / ${fmtMoney(overview.dividends.usd_amount, 'USD')}`} hint={`${fmtNumber(overview.dividends.count)} rows`} tone="success" />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Market allocation">
          <div className="grid min-h-[190px] grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_150px] sm:items-center">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 text-[12px]">
                <span className="flex items-center gap-2 font-medium text-ink">
                  <span className="h-2.5 w-2.5 rounded-full bg-success" aria-hidden />
                  Korea
                </span>
                <span className="tabular-nums text-ink-3">{krShare}%</span>
              </div>
              <div className="text-[18px] font-medium tabular-nums text-ink">{fmtKrw(krBase)}</div>
              <div className="flex items-center justify-between gap-3 text-[12px]">
                <span className="flex items-center gap-2 font-medium text-ink">
                  <span className="h-2.5 w-2.5 rounded-full bg-info" aria-hidden />
                  United States
                </span>
                <span className="tabular-nums text-ink-3">{usShare}%</span>
              </div>
              <div className="text-[18px] font-medium tabular-nums text-ink">{fmtKrw(usBase)}</div>
              <div className="rounded-md bg-surface px-3 py-2 text-[11px] leading-relaxed text-ink-3">
                USD values use {usdKrw ? `USD/KRW ${fmtNumber(usdKrw.rate, 2)} (${usdKrw.as_of_date})` : 'the configured FX snapshot'}.
              </div>
            </div>
            <AllocationPieChart data={allocationData} height={170} />
          </div>
        </Card>

        <Card title="Concentration">
          <div className="flex h-full min-h-[190px] flex-col justify-center">
            <div className="text-[44px] font-medium leading-none tabular-nums text-ink">{topFiveShare}%</div>
            <div className="mt-1 text-[12px] text-ink-3">top 5 cost-basis concentration</div>
            <div className="mt-5 space-y-2">
              {largestPositions.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 text-[12px]">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge tone={marketTone(p.market)}>{p.market}</Badge>
                    <span className="min-w-0 truncate text-ink">{p.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-ink-3">{p.ticker}</span>
                  </div>
                  <span className="shrink-0 tabular-nums text-ink-3">{fmtKrw(p.base_cost ?? 0)}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Term mix">
          <div className="flex h-full min-h-[190px] flex-col justify-center">
            <div className="text-[44px] font-medium leading-none tabular-nums text-ink">{longTermPct}%</div>
            <div className="mt-1 text-[12px] text-ink-3">long-term quantity share</div>
            <div className="mt-5 h-2 overflow-hidden rounded-pill bg-surface">
              <div className="h-full rounded-pill bg-success" style={{ width: `${longTermPct}%` }} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
              <div>
                <div className="text-ink-3">Long-term</div>
                <div className="font-medium tabular-nums text-ink">{fmtNumber(overview.totals.long_term_qty)}</div>
              </div>
              <div>
                <div className="text-ink-3">Short-term</div>
                <div className="font-medium tabular-nums text-ink">{fmtNumber(overview.totals.short_term_qty)}</div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card
        title={`${selectedScopeLabel} snapshot trend`}
        className="mb-5"
        action={
          <div className="flex flex-wrap items-center justify-end gap-1">
            {TREND_RANGES.map((range) => (
              <Link
                key={range.key}
                href={`/?trend=${range.key}&scope=${selectedScope}&metric=${selectedMetric.key}&view=${selectedView}`}
                scroll={false}
                className={`rounded-sm border px-2 py-1 text-[11px] font-medium ${selectedRange.key === range.key ? 'border-info bg-info/10 text-info' : 'border-line text-ink-3 hover:border-info hover:text-info'}`}
              >
                {range.label}
              </Link>
            ))}
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            {selectedView === 'combined' ? (
              <>
                <div className="text-[12px] text-ink-3">{selectedScopeLabel} · Market value, cost basis, and unrealized G/L · KRW millions</div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                  {combinedMetrics.map((metric) => {
                    const latest = combinedTrendData[combinedTrendData.length - 1]?.[metric.key]
                    return (
                      <div key={metric.key}>
                        <div className="flex items-center gap-1.5 text-[11px] text-ink-3"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: metric.color }} />{metric.label}</div>
                        <div className="mt-0.5 text-[18px] font-medium tabular-nums text-ink">{typeof latest === 'number' ? fmtKrw(latest * 1_000_000) : '—'}</div>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="text-[12px] text-ink-3">{selectedScopeLabel} · {selectedMetric.label} · {selectedMetric.key === 'return_pct' ? 'percentage points' : 'KRW millions'}{latestTrendCoverage != null && latestTrendCoverage < 1 ? ` · ${fmtNumber(latestTrendCoverage * 100, 1)}% priced` : ''}</div>
                <div className="mt-1 text-[22px] font-medium tabular-nums text-ink">{trendData.length ? trendValueLabel(latestTrendValue) : 'No history yet'}</div>
              </>
            )}
          </div>
          {selectedView === 'single' && <div className={`text-right text-[12px] tabular-nums ${trendChange >= 0 ? 'text-success' : 'text-danger'}`}>{trendData.length > 1 ? trendChangeLabel : 'Need at least two snapshots'}</div>}
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-1">
          <Link
            href={`/?trend=${selectedRange.key}&scope=${selectedScope}&metric=${selectedMetric.key}&view=single`}
            scroll={false}
            className={`rounded-sm border px-2 py-1 text-[11px] ${selectedView === 'single' ? 'border-info bg-info/10 font-medium text-info' : 'border-line text-ink-3 hover:border-info hover:text-info'}`}
          >Individual</Link>
          <Link
            href={`/?trend=${selectedRange.key}&scope=${selectedScope}&metric=${selectedMetric.key}&view=combined`}
            scroll={false}
            className={`rounded-sm border px-2 py-1 text-[11px] ${selectedView === 'combined' ? 'border-info bg-info/10 font-medium text-info' : 'border-line text-ink-3 hover:border-info hover:text-info'}`}
          >Combined</Link>
          <span className="mx-1 h-4 w-px bg-line-subtle" />
          {TREND_SCOPES.map((scope) => (
            <Link
              key={scope.key}
              href={`/?trend=${selectedRange.key}&scope=${scope.key}&metric=${selectedMetric.key}&view=${selectedView}`}
              scroll={false}
              className={`rounded-sm border px-2 py-1 text-[11px] ${selectedScope === scope.key ? 'border-info bg-info/10 font-medium text-info' : 'border-line text-ink-3 hover:border-info hover:text-info'}`}
            >
              {scope.label}
            </Link>
          ))}
          <span className="mx-1 h-4 w-px bg-line-subtle" />
          {TREND_METRICS.map((metric) => (
            <Link
              key={metric.key}
              href={`/?trend=${selectedRange.key}&scope=${selectedScope}&metric=${metric.key}&view=single`}
              scroll={false}
              className={`rounded-sm border px-2 py-1 text-[11px] ${selectedMetric.key === metric.key ? 'border-line bg-surface font-medium text-ink' : 'border-transparent text-ink-3 hover:border-line hover:text-ink'}`}
            >
              {metric.label}
            </Link>
          ))}
        </div>
        {selectedView === 'combined' ? (
          combinedTrendData.length === 0 ? (
            <EmptyState hint="Run pnpm refresh or pnpm ingest to record the first snapshot.">No combined history recorded</EmptyState>
          ) : (
            <PortfolioMultiTrendChart
              data={combinedTrendData}
              series={combinedMetrics.map((metric) => ({ dataKey: metric.key, name: metric.label, color: metric.color }))}
            />
          )
        ) : trendData.length === 0 ? (
          <EmptyState hint="Run pnpm refresh or pnpm ingest to record the first snapshot.">No portfolio history recorded</EmptyState>
        ) : (
          <PortfolioTrendChart
            data={trendData}
            dataKey="value"
            color={selectedMetric.color}
            valuePrefix={selectedMetric.key === 'return_pct' ? '' : '₩'}
            valueSuffix={selectedMetric.key === 'return_pct' ? '%' : 'M'}
            axisLabel={selectedMetric.key === 'return_pct' ? 'Percentage points' : 'KRW million'}
          />
        )}
        <div className="mt-1 text-[11px] text-ink-3">
          {trendData.length ? `${trendData[0].date} to ${trendData[trendData.length - 1].date} · ${trendData.length} snapshot(s)` : 'Snapshots are recorded once per ingest date.'}
        </div>
        <div className="mt-2 text-[11px] leading-relaxed text-ink-3">
          Cost basis, holdings, and dividends are reconstructed from tax-lot and transaction dates. US values are converted to KRW using historical FX snapshots. Dates with coverage below 90% are excluded, and partial coverage is shown beside the selected metric.
        </div>
      </Card>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Top holdings by base cost">
          <TrendBarChart
            data={topHoldingChartData}
            xKey="name"
            yKey="value"
            height={240}
            multicolor
            yAxisPrefix="₩"
            yAxisSuffix="M"
            yAxisLabel="KRW million"
          />
          <p className="mt-2 text-[11px] text-ink-3">Bar values are KRW millions after applying the configured FX snapshot.</p>
        </Card>

        <Card title="Dividend trend">
          <TrendBarChart
            data={dividendYears.map((r) => ({ year: `${r.currency} ${r.year}`, amount: Math.round(r.currency === 'KRW' ? r.amount / 1000 : r.amount) }))}
            xKey="year"
            yKey="amount"
            height={240}
            color="var(--accent-success)"
            yAxisLabel="KRW thousand / USD"
          />
          <p className="mt-2 text-[11px] text-ink-3">KR bars are KRW thousands; US bars are native USD.</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Account allocation">
          {accounts.length === 0 ? (
            <EmptyState>No account data</EmptyState>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {accounts.map((a) => (
                <li key={a.account} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1 truncate text-[13px] text-ink">{a.account}</div>
                  <div className="text-[12px] tabular-nums text-ink-3">{a.count} holdings</div>
                  <div className="w-36 text-right text-[12px] font-medium tabular-nums text-ink">{fmtMoney(a.value, a.currency)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Largest positions">
          <ul className="divide-y divide-line-subtle">
            {largestPositions.map((h) => (
              <li key={h.id} className="flex items-center gap-3 py-2">
                <Badge tone={marketTone(h.market)}>{h.market}</Badge>
                <Badge tone="neutral">{h.ticker}</Badge>
                <Link href={positionHref(h.market, h.ticker)} className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink hover:underline">
                  {h.name}
                </Link>
                <span className="text-[12px] tabular-nums text-ink-3">{fmtKrw(h.base_cost ?? 0)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Transaction types">
          <ul className="divide-y divide-line-subtle">
            {txTypes.map((t) => (
              <li key={`${t.market}:${t.type}`} className="flex items-center justify-between gap-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge tone={marketTone(t.market)}>{t.market}</Badge>
                  <Badge tone={t.type === 'DIVIDEND' ? 'success' : t.type === 'SELL' ? 'warning' : 'info'}>
                    {t.type}
                  </Badge>
                </div>
                <span className="text-[12px] tabular-nums text-ink-3">{fmtNumber(t.count)} rows</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}
