import Link from 'next/link'
import { FreshnessInline } from '@/components/Freshness'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, Label, MetricField, MetricHeroCard, marketTone } from '@/components/ui'
import { PortfolioMultiTrendChart, PortfolioTrendChart, TrendBarChart } from '@/components/charts'
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
import { dividendChartAmount, fmtDateTime, fmtNumber } from '@/lib/format'
import { convertMoney, createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { getGlossary } from '@/lib/glossary'
import { getLanguage } from '@/lib/i18n-server'
import { positionHref } from '@/lib/position-url'
import { signClass, signTone } from '@/lib/tone'
import { getPageCopy } from '@/lib/ui-copy'
import { routeMetadata } from '@/lib/page-names'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/')

const TREND_RANGES = [
  { key: '30', label: '1M', days: 30 },
  { key: '90', label: '3M', days: 90 },
  { key: '180', label: '6M', days: 180 },
  { key: 'ytd', label: 'YTD', days: 'ytd' },
  { key: '365', label: '1Y', days: 365 },
  { key: '1095', label: '3Y', days: 1095 },
  { key: '1825', label: '5Y', days: 1825 },
  { key: 'all', label: 'All', days: 3650 },
] as const

function trendRangeDays(days: number | 'ytd') {
  if (days !== 'ytd') return days
  const now = new Date()
  const yearStart = new Date(now.getFullYear(), 0, 1)
  return Math.max(1, Math.floor((now.getTime() - yearStart.getTime()) / 86_400_000) + 1)
}

const shortAxisLabel = (value: string) => value.length > 20 ? `${value.slice(0, 19)}...` : value
const positionAxisLabel = (market: string, name: string, ticker: string) => {
  if (market === 'KR') return shortAxisLabel(name || ticker)
  return shortAxisLabel(ticker || name)
}
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

const TREND_COVERAGE_FIELDS = {
  global: 'market_value_coverage',
  KR: 'kr_market_value_coverage',
  US: 'us_market_value_coverage',
  CRYPTO: 'crypto_market_value_coverage',
} as const

const MIN_TREND_COST_COVERAGE = 0.9
const HEALTHY_TREND_COST_COVERAGE = 0.95

type TrendMetricKey = (typeof TREND_METRICS)[number]['key']
type TrendFieldKey = keyof PortfolioSnapshot
type TrendViewKey = 'single' | 'combined'


export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ trend?: string; metric?: string; scope?: string; view?: string }>
}) {
  const language = await getLanguage()
  const currencyPreferences = await getCurrencyPreferences()
  const copy = getPageCopy('overview', language)
  const money = createMoneyFormatter(currencyPreferences)
  const displayBaseValue = (value: number | null | undefined) =>
    convertMoney(Number(value ?? 0), 'KRW', currencyPreferences.displayCurrency, currencyPreferences.usdKrwRate).value
  const displayBaseMillions = (value: number | null | undefined) => displayBaseValue(value) / 1_000_000
  const displayPrefix = currencyPreferences.displayCurrency === 'USD' ? '$' : '₩'
  const displayMillionsLabel = currencyPreferences.displayCurrency === 'USD' ? copy.usdMillions : copy.krwMillions
  const displayAxisLabel = currencyPreferences.displayCurrency === 'USD' ? copy.chartAxisUsd : copy.chartAxisKrw
  const glossary = getGlossary(language)
  if (!dbAvailable()) {
    return (
      <>
        <PageHeader eyebrow={copy.appEyebrow} title={copy.title} emphasis={copy.emphasis} />
        <Card title={copy.dbMissingTitle}>
          <p className="text-body text-ink-2">
            {copy.dbMissingHint(config.stockDbPath)}
          </p>
        </Card>
      </>
    )
  }

  const meta = getMeta()
  const params = await searchParams
  const selectedRange = TREND_RANGES.find((range) => range.key === params.trend) ?? TREND_RANGES[TREND_RANGES.length - 1]
  const selectedScope = TREND_SCOPES.find((scope) => scope.key === params.scope)?.key ?? 'global'
  const legacyMetricMap: Record<string, TrendMetricKey> = {
    global_base_market_value: 'market_value',
    global_base_cost: 'cost_basis',
    global_base_unrealized_gl: 'unrealized_gl',
    global_base_return_pct: 'return_pct',
  }
  const selectedMetricKey = legacyMetricMap[params.metric ?? ''] ?? params.metric
  const selectedMetric = TREND_METRICS.find((metric) => metric.key === selectedMetricKey) ?? TREND_METRICS[0]
  const selectedMetricLabel = copy.metricLabels[selectedMetric.key]
  const selectedField = TREND_FIELDS[selectedScope][selectedMetric.key]
  const selectedCoverageField = TREND_COVERAGE_FIELDS[selectedScope]
  const selectedScopeLabel = copy.scopeLabels[selectedScope]
  const selectedView: TrendViewKey = params.view === 'combined' ? 'combined' : 'single'
  const combinedMetrics = TREND_METRICS.filter((metric) => metric.key !== 'return_pct')
  const overview = getOverview()
  const portfolioSnapshots = getPortfolioSnapshots(trendRangeDays(selectedRange.days))
  const top = getTopHoldings(10)
  const accounts = getAccountAllocation()
  const dividendYears = getDividendByYear()
  const txTypes = getTransactionTypes()
  const operational = getOperationalHealth()
  const usdKrw = overview.fxRates.find((r: any) => r.from_currency === 'USD' && r.to_currency === 'KRW')
  const operationalIssues = operational.staleItems.length
  const fxLabel = usdKrw ? `USD/KRW ${fmtNumber(usdKrw.rate, 2)} (${usdKrw.as_of_date})` : null

  const termClassifiedValue = overview.totals.term_classified_base_value ?? 0
  const termLongValue = overview.totals.term_long_base_value ?? 0
  const termShortValue = overview.totals.term_short_base_value ?? 0
  const termUnclassifiedValue = overview.totals.term_unclassified_base_value ?? 0
  const termTotalValue = termClassifiedValue + termUnclassifiedValue
  const termCoveragePct = termTotalValue > 0 ? Math.round((termClassifiedValue / termTotalValue) * 100) : 0
  const shortTermExposurePct = termClassifiedValue > 0 ? Math.round((termShortValue / termClassifiedValue) * 100) : 0
  const termSegmentWidth = (value: number) => (termTotalValue > 0 ? Math.max(value > 0 ? 1 : 0, (value / termTotalValue) * 100) : 0)
  const termShortByMarket = [
    { market: 'KR', label: copy.korea, value: overview.totals.kr_term_short_base_value ?? 0 },
    { market: 'US', label: copy.us, value: overview.totals.us_term_short_base_value ?? 0 },
    { market: 'CRYPTO', label: copy.crypto, value: overview.totals.crypto_term_short_base_value ?? 0 },
  ]
  // Market-scoped, not currency-scoped: crypto holds KRW positions on Bithumb and
  // USD positions on Robinhood, so summing by currency would file each of them
  // under the KR or US card.
  const krBase = overview.totals.kr_base_cost
  const usBase = overview.totals.us_base_cost
  const cryptoBase = overview.totals.crypto_base_cost
  const globalBase = overview.totals.global_base_cost
  const globalValue = overview.totals.global_base_market_value
  const usUnrealizedPct =
    overview.totals.us_priced_base_cost > 0 ? (overview.totals.us_base_unrealized_gl / overview.totals.us_priced_base_cost) * 100 : 0
  const krUnrealizedPct =
    overview.totals.kr_priced_base_cost > 0 ? (overview.totals.kr_base_unrealized_gl / overview.totals.kr_priced_base_cost) * 100 : 0
  const cryptoUnrealizedPct =
    overview.totals.crypto_priced_base_cost > 0
      ? (overview.totals.crypto_base_unrealized_gl / overview.totals.crypto_priced_base_cost) * 100
      : 0
  const globalUnrealizedPct =
    overview.totals.global_priced_base_cost > 0 ? (overview.totals.global_base_unrealized_gl / overview.totals.global_priced_base_cost) * 100 : 0
  const krShare = globalValue > 0 ? Math.round((overview.totals.kr_base_market_value / globalValue) * 100) : 0
  const usShare = globalValue > 0 ? Math.round((overview.totals.us_base_market_value / globalValue) * 100) : 0
  const cryptoShare = globalValue > 0 ? Math.round((overview.totals.crypto_base_market_value / globalValue) * 100) : 0
  const topFiveBase = top.slice(0, 5).reduce((sum, r) => sum + (r.base_cost ?? 0), 0)
  const topFiveShare = globalBase > 0 ? Math.round((topFiveBase / globalBase) * 100) : 0
  const largestPositions = top
  const topHoldingChartData = top.map((r) => ({
    name: positionAxisLabel(r.market, r.name, r.ticker),
    market: r.market,
    value: Math.round(displayBaseMillions(r.base_cost ?? 0)),
  }))
  const marketBreakdown = [
    {
      key: 'KR',
      label: copy.korea,
      tone: 'success' as const,
      cost: krBase,
      marketValue: overview.totals.kr_base_market_value,
      gain: overview.totals.kr_base_unrealized_gl,
      returnPct: krUnrealizedPct,
      share: krShare,
      barStyle: 'linear-gradient(90deg, var(--accent-success), var(--brand-cyan))',
    },
    {
      key: 'US',
      label: copy.us,
      tone: 'info' as const,
      cost: usBase,
      marketValue: overview.totals.us_base_market_value,
      gain: overview.totals.us_base_unrealized_gl,
      returnPct: usUnrealizedPct,
      share: usShare,
      barStyle: 'linear-gradient(90deg, var(--accent-info), var(--brand-blue))',
    },
    {
      key: 'CRYPTO',
      label: copy.crypto,
      tone: 'warning' as const,
      cost: cryptoBase,
      marketValue: overview.totals.crypto_base_market_value,
      gain: overview.totals.crypto_base_unrealized_gl,
      returnPct: cryptoUnrealizedPct,
      share: cryptoShare,
      barStyle: 'linear-gradient(90deg, var(--accent-warning), var(--brand-purple))',
    },
  ]
  const trendData = portfolioSnapshots
    .map((snapshot) => ({
      date: snapshot.snapshot_date,
      value: snapshot[selectedField as TrendFieldKey] == null || (
        selectedMetric.key !== 'cost_basis' && Number(snapshot[selectedCoverageField]) < MIN_TREND_COST_COVERAGE
      )
        ? null
        : selectedMetric.key === 'return_pct'
          ? Number(snapshot[selectedField as TrendFieldKey])
          : displayBaseMillions(Number(snapshot[selectedField as TrendFieldKey])),
      coverage: snapshot[selectedCoverageField],
    }))
  const combinedTrendData = portfolioSnapshots
    .map((snapshot) => ({
      date: snapshot.snapshot_date,
      market_value: snapshot[TREND_FIELDS[selectedScope].market_value as TrendFieldKey] == null || Number(snapshot[selectedCoverageField]) < MIN_TREND_COST_COVERAGE ? null : displayBaseMillions(Number(snapshot[TREND_FIELDS[selectedScope].market_value as TrendFieldKey])),
      cost_basis: snapshot[TREND_FIELDS[selectedScope].cost_basis as TrendFieldKey] == null ? null : displayBaseMillions(Number(snapshot[TREND_FIELDS[selectedScope].cost_basis as TrendFieldKey])),
      unrealized_gl: snapshot[TREND_FIELDS[selectedScope].unrealized_gl as TrendFieldKey] == null || Number(snapshot[selectedCoverageField]) < MIN_TREND_COST_COVERAGE ? null : displayBaseMillions(Number(snapshot[TREND_FIELDS[selectedScope].unrealized_gl as TrendFieldKey])),
    }))
  const valuedTrendData = trendData.filter((point): point is typeof point & { value: number } => typeof point.value === 'number')
  const firstTrendPoint = valuedTrendData[0]
  const latestTrendPoint = valuedTrendData[valuedTrendData.length - 1]
  const firstTrendValue = firstTrendPoint?.value ?? 0
  const latestTrendValue = latestTrendPoint?.value ?? 0
  const trendChange = latestTrendValue - firstTrendValue
  const trendChangePct = firstTrendValue !== 0 ? (trendChange / Math.abs(firstTrendValue)) * 100 : null
  const latestSnapshot = portfolioSnapshots[portfolioSnapshots.length - 1]
  const latestTrendCoverage = latestSnapshot?.[selectedCoverageField] ?? null
  const latestPositionCoverage = selectedScope === 'global' ? latestSnapshot?.position_coverage ?? null : null
  const missingTrendPoints = trendData.length - valuedTrendData.length
  const trendValueLabel = (value: number) => selectedMetric.key === 'return_pct' ? `${fmtNumber(value, 1)}%` : money(value * 1_000_000, currencyPreferences.displayCurrency)
  const trendChangeLabel = selectedMetric.key === 'return_pct'
    ? `${trendChange >= 0 ? '+' : ''}${fmtNumber(trendChange, 1)}%p`
    : `${trendChange >= 0 ? '+' : ''}${trendValueLabel(trendChange)}${trendChangePct == null ? '' : ` · ${trendChangePct >= 0 ? '+' : ''}${fmtNumber(trendChangePct, 1)}%`}`

  return (
    <>
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle(fmtDateTime(meta.ingested_at), fxLabel)}
        action={overview.failedChecks + operationalIssues > 0 ? <Badge tone="warning">{copy.needsReview(overview.failedChecks + operationalIssues)}</Badge> : <Badge tone="success">{copy.healthy}</Badge>}
      />

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.9fr)]">
        <MetricHeroCard
          title={copy.portfolioValue}
          info={copy.portfolioValueInfo}
          eyebrow={copy.allMarkets}
          value={money(globalValue, 'KRW')}
          hint={copy.valueHint}
        >
          <div className="grid gap-4 border-t border-line-subtle pt-4 sm:grid-cols-3">
            <MetricField label={copy.totalCost} value={money(globalBase, 'KRW')} info={glossary.costBasis.description} valueClassName="text-title" />
            <MetricField
              label={copy.totalGain}
              value={money(overview.totals.global_base_unrealized_gl, 'KRW')}
              info={glossary.unrealizedGl.description}
              tone={signTone(overview.totals.global_base_unrealized_gl)}
              valueClassName="text-title"
            />
            <MetricField
              label={copy.returnOnPricedCost}
              value={`${fmtNumber(globalUnrealizedPct, 2)}%`}
              info={`${glossary.unrealizedGl.description} This percentage is measured against priced cost basis.`}
              tone={signTone(globalUnrealizedPct)}
              valueClassName="text-title"
            />
          </div>
        </MetricHeroCard>

        <Card title={copy.supportingMetrics}>
          <div className="flex min-h-[16rem] flex-col justify-between gap-4">
            <div className="space-y-4">
              <MetricField
                label={copy.holdings}
                value={fmtNumber(overview.totals.holding_count)}
                hint={`${copy.totalQuantity} ${fmtNumber(overview.totals.share_count, 2)}`}
                valueClassName="text-metric"
              />
              <div className="h-px bg-line-subtle" />
              <MetricField
                label={copy.dividends}
                value={money(overview.dividends.krw_amount, 'KRW')}
                hint={`${money(overview.dividends.usd_amount, 'USD')} · ${copy.count(fmtNumber(overview.dividends.count))}`}
                tone="success"
                valueClassName="text-title"
              />
            </div>
            <div className="rounded-md bg-surface px-3 py-2 text-label leading-relaxed text-ink-3">
              {copy.fxNote(fxLabel)}
            </div>
          </div>
        </Card>
      </div>

      <Card title={copy.marketBreakdown} info={copy.marketBreakdownInfo} className="mb-5">
        <div className="mb-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div className="text-caption font-medium text-ink-2">{copy.marketAllocation}</div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {marketBreakdown.map((market) => (
                <div key={market.key} className="flex items-center gap-1.5 text-caption text-ink-3">
                  <span className="h-2 w-2 rounded-pill" style={{ backgroundImage: market.barStyle }} />
                  <span>{market.label}</span>
                  <span className="font-medium tabular-nums text-ink">{market.share}%</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex h-3 overflow-hidden rounded-pill bg-surface">
            {marketBreakdown.map((market, index) => (
              <div
                key={market.key}
                className="h-full"
                title={`${market.label} ${market.share}%`}
                style={{
                  width: `${Math.max(market.share > 0 ? 1 : 0, market.share)}%`,
                  backgroundImage: market.barStyle,
                  borderLeft: index === 0 ? undefined : '1px solid var(--bg-card)',
                }}
              />
            ))}
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {marketBreakdown.map((market) => (
            <div key={market.key} className="min-w-0">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge tone={market.tone}>{market.key}</Badge>
                  <span className="text-body font-medium text-ink">{market.label}</span>
                </div>
                <span className="text-caption tabular-nums text-ink-3">{copy.share} {market.share}%</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-caption">
                <MetricField label={copy.marketValue} value={money(market.marketValue, 'KRW')} labelClassName="normal-case tracking-normal" />
                <MetricField label={copy.costBasis} value={money(market.cost, 'KRW')} info={glossary.costBasis.description} labelClassName="normal-case tracking-normal" />
                <MetricField
                  label={copy.gain}
                  value={money(market.gain, 'KRW')}
                  info={glossary.unrealizedGl.description}
                  tone={signTone(market.gain)}
                  labelClassName="normal-case tracking-normal"
                />
                <MetricField
                  label={copy.return}
                  value={`${fmtNumber(market.returnPct, 2)}%`}
                  tone={signTone(market.returnPct)}
                  labelClassName="normal-case tracking-normal"
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title={copy.freshnessTitle} info={glossary.freshness.description} className="mb-5">
        <div className="grid gap-2 lg:grid-cols-3">
          {operational.snapshots.map((item) => (
            <div key={item.key} className="rounded-md border border-line-subtle bg-surface px-3 py-2">
              <Label className="mb-1">{item.label}</Label>
              <FreshnessInline item={item} language={language} />
            </div>
          ))}
        </div>
      </Card>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title={copy.concentration} info={copy.concentrationInfo}>
          <div className="flex h-full min-h-[190px] flex-col justify-center">
            <div className="text-hero font-medium leading-none tabular-nums text-ink">{topFiveShare}%</div>
            <div className="mt-1 text-caption text-ink-3">{copy.concentrationHint}</div>
            <div className="mt-5 space-y-2">
              {largestPositions.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 text-caption">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge tone={marketTone(p.market)}>{p.market}</Badge>
                    <span className="min-w-0 truncate text-ink">{p.name}</span>
                    <span className="shrink-0 font-mono text-label text-ink-3">{p.ticker}</span>
                  </div>
                  <span className="shrink-0 tabular-nums text-ink-3">{money(p.base_cost ?? 0, 'KRW')}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card title={copy.termMix} info={copy.termMixInfo}>
          <div className="flex h-full min-h-[190px] flex-col justify-center">
            <div className="text-hero font-medium leading-none tabular-nums text-ink">{termCoveragePct}%</div>
            <div className="mt-1 text-caption text-ink-3">{copy.termCoverage} · {copy.shortTermExposure} {shortTermExposurePct}%</div>
            <div className="mt-5 flex h-2 overflow-hidden rounded-pill bg-surface">
              <div className="h-full bg-success" style={{ width: `${termSegmentWidth(termLongValue)}%` }} />
              <div className="h-full bg-warning" style={{ width: `${termSegmentWidth(termShortValue)}%` }} />
              <div className="h-full bg-line" style={{ width: `${termSegmentWidth(termUnclassifiedValue)}%` }} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-caption">
              <div>
                <div className="text-ink-3">{copy.longTerm}</div>
                <div className="font-medium tabular-nums text-ink">{money(termLongValue, 'KRW')}</div>
              </div>
              <div>
                <div className="text-ink-3">{copy.shortTerm}</div>
                <div className="font-medium tabular-nums text-ink">{money(termShortValue, 'KRW')}</div>
              </div>
              <div>
                <div className="text-ink-3">{copy.unclassifiedTerm}</div>
                <div className="font-medium tabular-nums text-ink">{money(termUnclassifiedValue, 'KRW')}</div>
              </div>
            </div>
            <div className="mt-4 grid gap-2 text-caption">
              {termShortByMarket.map((row) => (
                <div key={row.market} className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge tone={marketTone(row.market)}>{row.market}</Badge>
                    <span className="truncate text-ink-3">{row.label}</span>
                  </div>
                  <span className="shrink-0 font-medium tabular-nums text-ink">{money(row.value, 'KRW')}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <Card
        title={copy.snapshotTrend(selectedScopeLabel)}
        className="mb-5"
        action={
          <div className="flex flex-wrap items-center justify-end gap-1">
            {TREND_RANGES.map((range) => (
              <Link
                key={range.key}
                href={`/?trend=${range.key}&scope=${selectedScope}&metric=${selectedMetric.key}&view=${selectedView}`}
                scroll={false}
                className={`rounded-sm border px-2 py-1 text-label font-medium ${selectedRange.key === range.key ? 'border-info bg-info/10 text-info' : 'border-line text-ink-3 hover:border-info hover:text-info'}`}
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
                <div className="text-caption text-ink-3">{copy.combinedTrendSummary(selectedScopeLabel)}</div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                  {combinedMetrics.map((metric) => {
                    const latest = combinedTrendData[combinedTrendData.length - 1]?.[metric.key]
                    return (
                      <div key={metric.key}>
                        <div className="flex items-center gap-1.5 text-label text-ink-3"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: metric.color }} />{copy.metricLabels[metric.key]}</div>
                        <div className="mt-0.5 text-title font-medium tabular-nums text-ink">{typeof latest === 'number' ? money(latest * 1_000_000, currencyPreferences.displayCurrency) : '—'}</div>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="text-caption text-ink-3">
                  {copy.trendUnit(`${selectedScopeLabel} · ${selectedMetricLabel}`, selectedMetric.key === 'return_pct' ? copy.percentagePoints : displayMillionsLabel)}
                  {latestTrendCoverage != null && latestTrendCoverage < 1 ? ` · ${copy.costPriced(fmtNumber(latestTrendCoverage * 100, 2))}` : ''}
                  {latestPositionCoverage != null && latestPositionCoverage < 1 ? ` · ${copy.positionsPriced(fmtNumber(latestPositionCoverage * 100, 1))}` : ''}
                </div>
                <div className="mt-1 text-title font-medium tabular-nums text-ink">{valuedTrendData.length ? trendValueLabel(latestTrendValue) : copy.noCoveredHistory}</div>
                {latestTrendCoverage != null && latestTrendCoverage >= MIN_TREND_COST_COVERAGE && latestTrendCoverage < HEALTHY_TREND_COST_COVERAGE && (
                  <div className="mt-1 text-label text-warning">{copy.partialValuation}</div>
                )}
              </>
            )}
          </div>
          {selectedView === 'single' && <div className={`text-right text-caption tabular-nums ${signClass(trendChange)}`}>{valuedTrendData.length > 1 ? <>{trendChangeLabel}<div className="text-micro font-normal text-ink-3">{copy.since(firstTrendPoint.date)}</div></> : copy.needTwoSnapshots}</div>}
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-1">
          <Link
            href={`/?trend=${selectedRange.key}&scope=${selectedScope}&metric=${selectedMetric.key}&view=single`}
            scroll={false}
            className={`rounded-sm border px-2 py-1 text-label ${selectedView === 'single' ? 'border-info bg-info/10 font-medium text-info' : 'border-line text-ink-3 hover:border-info hover:text-info'}`}
          >{copy.individual}</Link>
          <Link
            href={`/?trend=${selectedRange.key}&scope=${selectedScope}&metric=${selectedMetric.key}&view=combined`}
            scroll={false}
            className={`rounded-sm border px-2 py-1 text-label ${selectedView === 'combined' ? 'border-info bg-info/10 font-medium text-info' : 'border-line text-ink-3 hover:border-info hover:text-info'}`}
          >{copy.combined}</Link>
          <span className="mx-1 h-4 w-px bg-line-subtle" />
          {TREND_SCOPES.map((scope) => (
            <Link
              key={scope.key}
              href={`/?trend=${selectedRange.key}&scope=${scope.key}&metric=${selectedMetric.key}&view=${selectedView}`}
              scroll={false}
              className={`rounded-sm border px-2 py-1 text-label ${selectedScope === scope.key ? 'border-info bg-info/10 font-medium text-info' : 'border-line text-ink-3 hover:border-info hover:text-info'}`}
            >
              {copy.scopeLabels[scope.key]}
            </Link>
          ))}
          <span className="mx-1 h-4 w-px bg-line-subtle" />
          {TREND_METRICS.map((metric) => (
            <Link
              key={metric.key}
              href={`/?trend=${selectedRange.key}&scope=${selectedScope}&metric=${metric.key}&view=single`}
              scroll={false}
              className={`rounded-sm border px-2 py-1 text-label ${selectedMetric.key === metric.key ? 'border-line bg-surface font-medium text-ink' : 'border-transparent text-ink-3 hover:border-line hover:text-ink'}`}
            >
              {copy.metricLabels[metric.key]}
            </Link>
          ))}
        </div>
        {selectedView === 'combined' ? (
          combinedTrendData.length === 0 ? (
            <EmptyState hint={copy.firstSnapshotHint}>{copy.noCombinedHistory}</EmptyState>
          ) : (
            <PortfolioMultiTrendChart
              data={combinedTrendData}
              series={combinedMetrics.map((metric) => ({ dataKey: metric.key, name: copy.metricLabels[metric.key], color: metric.color }))}
            />
          )
        ) : valuedTrendData.length === 0 ? (
          <EmptyState hint={copy.firstSnapshotHint}>{copy.noPortfolioHistory}</EmptyState>
        ) : (
          <PortfolioTrendChart
            data={trendData}
            dataKey="value"
            color={selectedMetric.color}
            valuePrefix={selectedMetric.key === 'return_pct' ? '' : displayPrefix}
            valueSuffix={selectedMetric.key === 'return_pct' ? '%' : 'M'}
            axisLabel={selectedMetric.key === 'return_pct' ? copy.chartAxisReturn : displayAxisLabel}
          />
        )}
        <div className="mt-1 text-label text-ink-3">
          {trendData.length ? copy.trendRangeSummary(trendData[0].date, trendData[trendData.length - 1].date, valuedTrendData.length, trendData.length, missingTrendPoints) : copy.snapshotsOnce}
        </div>
        <div className="mt-2 text-label leading-relaxed text-ink-3">
          {copy.trendExplanation}
        </div>
      </Card>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title={copy.topHoldingsByCost}>
          <TrendBarChart
            data={topHoldingChartData}
            xKey="name"
            yKey="value"
            height={240}
            xAxisInterval={0}
            xAxisHeight={52}
            xTickAngle={-16}
            barColorKey="market"
            yAxisPrefix={displayPrefix}
            yAxisSuffix="M"
            yAxisLabel={displayAxisLabel}
          />
          <p className="mt-2 text-label text-ink-3">{copy.topHoldingsNote}</p>
        </Card>

        <Card title={copy.dividendTrend}>
          <TrendBarChart
            data={dividendYears.map((r) => ({ year: `${r.currency} ${r.year}`, currency: r.currency, amount: dividendChartAmount(r.currency, r.amount) }))}
            xKey="year"
            yKey="amount"
            height={240}
            color="var(--accent-success)"
            barColorKey="currency"
            allowDecimals
            yAxisLabel={copy.dividendAxis}
          />
          <p className="mt-2 text-label text-ink-3">{copy.dividendTrendNote}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title={copy.accountAllocation}>
          {accounts.length === 0 ? (
            <EmptyState>{copy.noAccountData}</EmptyState>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {accounts.map((a) => (
                <li key={a.account} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1 truncate text-body text-ink">{a.account}</div>
                  <div className="text-caption tabular-nums text-ink-3">{copy.holdingRows(a.count)}</div>
                  <div className="w-36 text-right text-caption font-medium tabular-nums text-ink">{money(a.value, a.currency)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={copy.largestPositions}>
          <ul className="divide-y divide-line-subtle">
            {largestPositions.map((h) => (
              <li key={h.id} className="flex items-center gap-3 py-2">
                <Badge tone={marketTone(h.market)}>{h.market}</Badge>
                <Badge tone="neutral">{h.ticker}</Badge>
                <Link href={positionHref(h.market, h.ticker)} className="min-w-0 flex-1 truncate text-body font-medium text-ink hover:underline">
                  {h.name}
                </Link>
                <span className="text-caption tabular-nums text-ink-3">{money(h.base_cost ?? 0, 'KRW')}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={copy.transactionTypes}>
          <ul className="divide-y divide-line-subtle">
            {txTypes.map((t) => (
              <li key={`${t.market}:${t.type}`} className="flex items-center justify-between gap-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge tone={marketTone(t.market)}>{t.market}</Badge>
                  <Badge tone={t.type === 'DIVIDEND' ? 'success' : t.type === 'SELL' ? 'warning' : 'info'}>
                    {t.type}
                  </Badge>
                </div>
                <span className="text-caption tabular-nums text-ink-3">{copy.count(fmtNumber(t.count))}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}
