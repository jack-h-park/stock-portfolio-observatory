import { FinanceTaxSummary } from '@/components/FinanceTaxSummary'
import { AssetCoverageNote } from '@/components/AssetCoverageNote'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, HeroAside, MetricField, MetricHeroCard, Note, Panel, TextLink, marketTone } from '@/components/ui'
import { PortfolioMultiTrendChart, PortfolioTrendChart, StackedAssetChart } from '@/components/charts'
import type { ChartUnit } from '@/lib/chart-format'
import {
  dbAvailable,
  getAssetCoverageReview,
  getCashInflow,
  getDataOpsReview,
  getIncomeReview,
  getMeta,
  getNetWorth,
  getOverview,
  getPortfolioSnapshots,
  getRebalanceReview,
  getRealizedLots,
  getSnapshotDates,
  getTopHoldings,
  getTotalAssetsSeries,
  getWashSaleReview,
  portfolioToday,
  portfolioYearMonth,
  withGoldScope,
} from '@/lib/adapters/portfolio-db'
import { periodTiles } from '@/lib/overview-period-tiles'
import { attentionItems } from '@/lib/overview-attention'
import { fmtCount, overviewLinkedStatus } from '@/lib/header-status'
import { isoDaysBefore, previousYearEnd, totalAssetsChange, type TotalAssetsChange } from '@/lib/total-assets-change'
import {
  HEALTHY_TREND_COST_COVERAGE,
  MIN_TREND_COST_COVERAGE,
  TREND_COVERAGE_FIELDS,
  TREND_METRICS,
  TREND_SCOPES,
  combinedTrendPoints,
  isSnapshotStale,
  resolveTrendScope,
  snapshotPriceDates,
  singleTrendPoints,
  type TrendMetricKey,
} from '@/lib/overview-trend'
import { config } from '@/config'
import { EMPTY_VALUE, fmtDate, fmtDateTime, fmtNumber, fmtPct, fmtSigned } from '@/lib/format'
import { convertMoney, createMoneyFormatter } from '@/lib/currency'
import { getAssetView } from '@/lib/asset-view-server'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { getGlossary } from '@/lib/glossary'
import { getLanguage } from '@/lib/i18n-server'
import { deltaTone, signClass, signTone } from '@/lib/tone'
import { getPageCopy } from '@/lib/ui-copy'
import { routeMetadata, routeSection } from '@/lib/page-names'
import { CardRow, KpiBand, MiniStat, MiniStatGrid, Stat, StatStrip } from '@/components/layout'
import { ShareBar } from '@/components/bars'
import { AssetViewLink } from '@/components/LanguageSwitcher'
import { WashSaleBanner } from '@/components/WashSaleBanner'
import { TrendRangeLinks } from '@/components/TrendRangeLinks'
import { LinkChip, LinkChips } from '@/components/LinkChips'
import { resolveTrendRange, trendRangeDays } from '@/lib/trend-ranges'
import { maskAccountLabel } from '@/lib/account-label'
import { ASSET_CLASS_COLOR, marketColor } from '@/lib/palette'
import { ShareSummary } from '@/components/ShareSummary'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/')

type TrendViewKey = 'single' | 'combined'


export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ trend?: string; metric?: string; scope?: string; view?: string }>
}) {
  const language = await getLanguage()
  const currencyPreferences = await getCurrencyPreferences()
  const assetView = await getAssetView()
  const copy = getPageCopy('overview', language)
  const money = createMoneyFormatter(currencyPreferences)
  const displayBaseValue = (value: number | null | undefined) =>
    convertMoney(Number(value ?? 0), 'KRW', currencyPreferences.displayCurrency, currencyPreferences.usdKrwRate).value
  const moneyUnit: ChartUnit = { kind: 'money', currency: currencyPreferences.displayCurrency }
  const displayAxisLabel = currencyPreferences.displayCurrency === 'USD' ? copy.chartAxisUsd : copy.chartAxisKrw
  const glossary = getGlossary(language)
  if (!dbAvailable()) {
    return (
      <>
        <PageHeader eyebrow={routeSection('/', language)} title={copy.title} emphasis={copy.emphasis} />
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
  const selectedRange = resolveTrendRange(params.trend)
  const selectedScope = resolveTrendScope(params.scope)
  const legacyMetricMap: Record<string, TrendMetricKey> = {
    global_base_market_value: 'market_value',
    global_base_cost: 'cost_basis',
    global_base_unrealized_gl: 'unrealized_gl',
    global_base_return_pct: 'return_pct',
  }
  const selectedMetricKey = legacyMetricMap[params.metric ?? ''] ?? params.metric
  const selectedMetric = TREND_METRICS.find((metric) => metric.key === selectedMetricKey) ?? TREND_METRICS[0]
  const selectedMetricLabel = copy.metricLabels[selectedMetric.key]
  const selectedCoverageField = TREND_COVERAGE_FIELDS[selectedScope]
  const selectedScopeLabel = copy.scopeLabels[selectedScope]
  const selectedView: TrendViewKey = params.view === 'single' ? 'single' : 'combined'
  const combinedMetrics = TREND_METRICS.filter((metric) => metric.key !== 'return_pct')
  const overview = getOverview()
  const netWorthSummary = getNetWorth(overview)
  const netWorth = assetView === 'all' ? netWorthSummary : null
  // The all view leads with total assets: a control-less 12-month summary of
  // the /net-worth chart, and the change over a month and since the year began.
  const assetsSeries = netWorth ? getTotalAssetsSeries(getSnapshotDates(366), netWorth) : null
  const today = portfolioToday()
  const monthChange = assetsSeries ? totalAssetsChange(assetsSeries.points, isoDaysBefore(today, 30)) : null
  const yearChange = assetsSeries ? totalAssetsChange(assetsSeries.points, previousYearEnd(today)) : null
  // This month / this year, all view only: each figure is a summary of its own page.
  const display = currencyPreferences.displayCurrency
  const tiles = netWorth
    ? (() => {
        const { year, month } = portfolioYearMonth()
        const inflow = getCashInflow('month', display)
        const income = getIncomeReview(display)
        return periodTiles({
          currentMonth: `${year}-${String(month).padStart(2, '0')}`,
          currentYear: String(year),
          inflow: { periods: inflow.periods, monthlyAverage: inflow.totals.monthlyAverage, hasRecords: inflow.periods.length > 0 || inflow.hasBankData },
          income: { rowCount: income.totals.row_count, ytd: income.totals.ytd_base_income, trailing12m: income.totals.trailing_12m_base_income },
          realized: getRealizedLots(),
        })
      })()
    : null
  const rebalance = getRebalanceReview()
  // One read of the /data-ops queue feeds the header pill and the attention strip, so they agree with /data-ops.
  const opsQueue = getDataOpsReview().actionQueue
  const attention = attentionItems({
    queue: opsQueue,
    overCap: rebalance.reduceCandidates.length,
    marketActions: rebalance.marketGaps,
  })
  const storedSnapshots = getPortfolioSnapshots(trendRangeDays(selectedRange.days))
  // The gold scope is derived on read (lib/gold-trend.ts), so only that scope pays for it.
  const portfolioSnapshots = selectedScope === 'GOLD' ? withGoldScope(storedSnapshots) : storedSnapshots
  const top = getTopHoldings(5)
  const usdKrw = overview.fxRates.find((r: any) => r.from_currency === 'USD' && r.to_currency === 'KRW')
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
  const marketBreakdown = [
    {
      market: 'KR',
      label: copy.korea,
      tone: 'success' as const,
      cost: krBase,
      marketValue: overview.totals.kr_base_market_value,
      gain: overview.totals.kr_base_unrealized_gl,
      returnPct: krUnrealizedPct,
      share: krShare,
      color: marketColor('KR'),
    },
    {
      market: 'US',
      label: copy.us,
      tone: 'info' as const,
      cost: usBase,
      marketValue: overview.totals.us_base_market_value,
      gain: overview.totals.us_base_unrealized_gl,
      returnPct: usUnrealizedPct,
      share: usShare,
      color: marketColor('US'),
    },
    {
      market: 'CRYPTO',
      label: copy.crypto,
      tone: 'warning' as const,
      cost: cryptoBase,
      marketValue: overview.totals.crypto_base_market_value,
      gain: overview.totals.crypto_base_unrealized_gl,
      returnPct: cryptoUnrealizedPct,
      share: cryptoShare,
      color: marketColor('CRYPTO'),
    },
  ]
  const trendData = singleTrendPoints(portfolioSnapshots, selectedScope, selectedMetric.key, displayBaseValue)
  const combinedTrendData = combinedTrendPoints(portfolioSnapshots, selectedScope, displayBaseValue)
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
  // Which prices the latest point was valued at, and whether the ingest that
  // wrote it is recent: a failed refresh leaves the last good snapshot in place.
  const latestPriceDates = snapshotPriceDates(latestSnapshot, selectedScope)
  const latestSnapshotStale = isSnapshotStale(latestSnapshot?.captured_at)
  const trendValueLabel = (value: number) => selectedMetric.key === 'return_pct' ? fmtPct(value, { digits: 1 }) : money(value, currencyPreferences.displayCurrency)
  const trendChangeLabel = selectedMetric.key === 'return_pct'
    ? fmtPct(trendChange, { digits: 1, unit: 'pp', signed: true })
    : `${fmtSigned(trendChange, trendValueLabel)}${trendChangePct == null ? '' : ` · ${fmtPct(trendChangePct, { digits: 1, signed: true })}`}`

  // What the snapshot card used to print under the chart: which prices the
  // latest point used, the range it covers and how it is built.
  const trendInfo = (
    <span className="flex flex-col gap-2">
      {selectedScope === 'GOLD' ? <span>{copy.goldScopeInfo}</span> : null}
      {latestSnapshot ? (
        <span className="tabular-nums">
          {latestPriceDates.length ? (
            <>
              {copy.priceBasis}{' '}
              {latestPriceDates.map((item, index) => (
                <span key={item.market}>
                  {index ? ' · ' : ''}{copy.scopeLabels[item.market]} {item.newest}{item.oldest ? ` (${copy.priceOldest(item.oldest)})` : ''}
                </span>
              ))}
              {' · '}
            </>
          ) : null}
          {copy.snapshotWritten(fmtDateTime(latestSnapshot.captured_at, language))}
        </span>
      ) : null}
      <span>{trendData.length ? copy.trendRangeSummary(trendData[0].date, trendData[trendData.length - 1].date, valuedTrendData.length, trendData.length, missingTrendPoints) : copy.snapshotsOnce}</span>
      <span>{copy.trendExplanation}</span>
    </span>
  )

  // Unavailable is not zero: with no snapshot that old the field says so.
  const changeField = (label: string, change: TotalAssetsChange | null) => (
    <MetricField
      label={label}
      value={change ? fmtSigned(change.change, (v) => money(v, 'KRW')) : EMPTY_VALUE}
      tone={change ? signTone(change.change) : 'neutral'}
      hint={
        change
          ? [
              change.pct == null ? null : fmtPct(change.pct, { digits: 1, signed: true }),
              copy.changeSince(fmtDate(change.baseDate, language)),
              change.addedClasses.length ? copy.changeAddedClasses(change.addedClasses.map((key) => copy.assetClasses[key]).join(', ')) : null,
            ].filter(Boolean).join(' · ')
          : copy.changeUnavailable
      }
    />
  )

  return (
    <>
      <PageHeader
        eyebrow={routeSection('/', language)}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle(fmtDateTime(meta.ingested_at, language), fxLabel)}
        status={overviewLinkedStatus(getPageCopy('dataOps', language), opsQueue, language, copy.healthy)}
      />

      <WashSaleBanner review={getWashSaleReview()} copy={getPageCopy('washSale', language)} />

      <CardRow columns="hero">
        {netWorth && assetsSeries ? (
          <MetricHeroCard
            id="overview-lead"
            title={copy.totalAssets}
            info={copy.totalAssetsInfo}
            eyebrow={copy.allAssetClasses}
            value={money(netWorth.totalKrw, 'KRW')}
            hint={copy.totalAssetsHint}
          >
            <div>
              <StackedAssetChart
                points={assetsSeries.points.map((point) => ({
                  date: point.date,
                  stocks: point.stocks == null ? null : displayBaseValue(point.stocks),
                  crypto: point.crypto == null ? null : displayBaseValue(point.crypto),
                  cash: point.cash == null ? null : displayBaseValue(point.cash),
                  pensions: point.pensions == null ? null : displayBaseValue(point.pensions),
                  gold: point.gold == null ? null : displayBaseValue(point.gold),
                  total: displayBaseValue(point.total),
                }))}
                startsOn={assetsSeries.startsOn}
                labels={{ ...copy.assetClasses, total: copy.totalAssets }}
                height={180}
                unit={moneyUnit}
                language={language}
                emptyMessage={copy.snapshotsOnce}
              />
              <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 text-label text-ink-3">
                <span>{copy.totalAssetsTrend}</span>
                <TextLink href="/net-worth">{copy.openTotalAssets}</TextLink>
              </div>
            </div>
            <KpiBand columns={4}>
              {changeField(copy.change1m, monthChange)}
              {changeField(copy.changeYtd, yearChange)}
            </KpiBand>
          </MetricHeroCard>
        ) : (
          <MetricHeroCard
            title={copy.portfolioValue}
            info={copy.portfolioValueInfo}
            eyebrow={copy.allMarkets}
            value={money(globalValue, 'KRW')}
            hint={assetView === 'stocks' && (netWorthSummary.cash.length > 0 || netWorthSummary.byClass.pensions > 0 || netWorthSummary.byClass.gold > 0) ? (
              <>
                {copy.valueHint}
                <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-caption">
                  <span>{copy.totalAssetsInclDeposits}</span>
                  <span className="tabular-nums text-ink">{money(netWorthSummary.totalKrw, 'KRW')}</span>
                  <AssetViewLink to="all">{copy.viewAllAssets}</AssetViewLink>
                </div>
              </>
            ) : copy.valueHint}
          >
            <KpiBand>
              <MetricField label={copy.totalCost} value={money(globalBase, 'KRW')} info={glossary.costBasis.description} />
              <MetricField
                label={copy.totalGain}
                value={money(overview.totals.global_base_unrealized_gl, 'KRW')}
                info={glossary.unrealizedGl.description}
                tone={signTone(overview.totals.global_base_unrealized_gl)}
              />
              <MetricField
                label={copy.returnOnPricedCost}
                value={fmtPct(globalUnrealizedPct, { digits: 2 })}
                info={`${glossary.unrealizedGl.description} ${copy.returnOnPricedCostInfo}`}
                tone={signTone(globalUnrealizedPct)}
              />
            </KpiBand>
          </MetricHeroCard>
        )}

        <HeroAside title={copy.supportingMetrics} note={copy.fxNote(fxLabel)}>
          {netWorth ? (
            <MetricField
              label={copy.stockValue}
              value={money(globalValue, 'KRW')}
              hint={`${copy.totalGain} ${fmtSigned(overview.totals.global_base_unrealized_gl, (v) => money(v, 'KRW'))} · ${fmtPct(globalUnrealizedPct, { digits: 2, signed: true })}`}
              info={copy.portfolioValueInfo}
              size="metric"
            />
          ) : null}
          <MetricField
            label={copy.holdings}
            value={fmtNumber(overview.totals.holding_count)}
            hint={`${copy.totalQuantity} ${fmtNumber(overview.totals.share_count, 2)}`}
            size="metric"
          />
          <MetricField
            label={copy.dividends}
            value={money(overview.dividends.krw_amount, 'KRW')}
            hint={`${money(overview.dividends.usd_amount, 'USD')} · ${copy.count(fmtNumber(overview.dividends.count))}`}
            tone="success"
          />
        </HeroAside>
      </CardRow>

      {/* The snapshot trend sits right under the hero: the page's one picture of how the portfolio moved. */}
      <Card
        title={copy.snapshotTrend(selectedScopeLabel)}
        info={trendInfo}
        className="mb-5"
        action={
          <div className="flex flex-wrap items-center justify-end gap-1">
            <TrendRangeLinks selected={selectedRange} hrefFor={(key) => `/?trend=${key}&scope=${selectedScope}&metric=${selectedMetric.key}&view=${selectedView}`} />
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            {selectedView === 'combined' ? (
              <>
                <div className="text-caption text-ink-3">{copy.combinedTrendSummary(selectedScopeLabel, displayAxisLabel)}</div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                  {combinedMetrics.map((metric) => {
                    const latest = combinedTrendData[combinedTrendData.length - 1]?.[metric.key]
                    return (
                      <div key={metric.key}>
                        <div className="flex items-center gap-1.5 text-label text-ink-3"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: metric.color }} />{copy.metricLabels[metric.key]}</div>
                        <div className="mt-0.5 text-title font-medium tabular-nums text-ink">{typeof latest === 'number' ? money(latest, currencyPreferences.displayCurrency) : EMPTY_VALUE}</div>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="text-caption text-ink-3">
                  {copy.trendUnit(`${selectedScopeLabel} · ${selectedMetricLabel}`, selectedMetric.key === 'return_pct' ? copy.percentagePoints : displayAxisLabel)}
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
        {/* The price basis lives in the info popover; only a stale snapshot is said out loud. */}
        {latestSnapshot && latestSnapshotStale ? (
          <div className="-mt-1 mb-3 text-label text-warning">{copy.snapshotStale}</div>
        ) : null}
        <div className="mb-3 flex flex-wrap items-center gap-1">
          <LinkChip
            href={`/?trend=${selectedRange.key}&scope=${selectedScope}&metric=${selectedMetric.key}&view=single`}
            active={selectedView === 'single'}
          >{copy.individual}</LinkChip>
          <LinkChip
            href={`/?trend=${selectedRange.key}&scope=${selectedScope}&metric=${selectedMetric.key}&view=combined`}
            active={selectedView === 'combined'}
          >{copy.combined}</LinkChip>
          <span className="mx-1 h-4 w-px bg-line-subtle" />
          <LinkChips
            items={TREND_SCOPES.map((scope) => ({
              key: scope.key,
              href: `/?trend=${selectedRange.key}&scope=${scope.key}&metric=${selectedMetric.key}&view=${selectedView}`,
              label: copy.scopeLabels[scope.key],
              title: scope.key === 'GOLD' ? copy.scopeHints.GOLD : undefined,
            }))}
            current={selectedScope}
          />
          {/* Metric chips pick the single-metric chart; the combined view already draws every metric. */}
          {selectedView === 'single' ? (
            <>
              <span className="mx-1 h-4 w-px bg-line-subtle" />
              <LinkChips
                variant="subtle"
                items={TREND_METRICS.map((metric) => ({
                  key: metric.key,
                  href: `/?trend=${selectedRange.key}&scope=${selectedScope}&metric=${metric.key}&view=single`,
                  label: copy.metricLabels[metric.key],
                }))}
                current={selectedMetric.key}
              />
            </>
          ) : null}
        </div>
        {selectedScope === 'GOLD' ? (
          <Panel bordered={false} text="label-note" spacing="mb-3">{copy.goldScopeNote}</Panel>
        ) : null}
        {selectedView === 'combined' ? (
          combinedTrendData.length === 0 ? (
            <EmptyState hint={copy.firstSnapshotHint}>{copy.noCombinedHistory}</EmptyState>
          ) : (
            <PortfolioMultiTrendChart
              data={combinedTrendData}
              series={combinedMetrics.map((metric) => metric.key === 'realized_gl'
                ? { dataKey: metric.key, name: copy.onRightAxis(copy.metricLabels[metric.key]), color: metric.color, axis: 'right' as const }
                : { dataKey: metric.key, name: copy.metricLabels[metric.key], color: metric.color })}
              axisLabel={displayAxisLabel}
              rightAxisLabel={`${copy.metricLabels.realized_gl} · ${displayAxisLabel}`}
              unit={moneyUnit}
              language={language}
              emptyMessage={copy.noCombinedHistory}
            />
          )
        ) : valuedTrendData.length === 0 ? (
          <EmptyState hint={copy.firstSnapshotHint}>{copy.noPortfolioHistory}</EmptyState>
        ) : (
          <PortfolioTrendChart
            data={trendData}
            dataKey="value"
            color={selectedMetric.color}
            axisLabel={selectedMetric.key === 'return_pct' ? copy.chartAxisReturn : displayAxisLabel}
            valueName={copy.chartValueName}
            unit={selectedMetric.key === 'return_pct' ? { kind: 'percent' } : moneyUnit}
            language={language}
            emptyMessage={copy.noPortfolioHistory}
          />
        )}
      </Card>

      {tiles ? (
        <Card title={copy.periodTitle} info={copy.periodInfo} className="mb-5">
          <StatStrip columns="sm-3">
            <Stat
              label={copy.inflowMonth}
              value={tiles.inflowMonth == null ? EMPTY_VALUE : money(tiles.inflowMonth, display)}
              sub={<>{tiles.inflowMonthlyAverage == null ? copy.noRecordsYet : copy.inflowMonthHint(money(tiles.inflowMonthlyAverage, display))}{tiles.inflowLastMonth ? ` · ${copy.inflowLastRecord(tiles.inflowLastMonth)}` : ''} · <TextLink href="/cash-inflow">{copy.openCashInflow}</TextLink></>}
            />
            <Stat
              label={copy.incomeYtd}
              value={tiles.incomeYtd == null ? EMPTY_VALUE : money(tiles.incomeYtd, display)}
              tone={deltaTone(tiles.incomeYtd)}
              sub={<>{tiles.incomeTrailing12m == null ? copy.noRecordsYet : copy.incomeYtdHint(money(tiles.incomeTrailing12m, display))} · <TextLink href="/income">{copy.openIncome}</TextLink></>}
            />
            <Stat
              label={copy.realizedYtd}
              value={tiles.realizedYtdKrw == null ? EMPTY_VALUE : fmtSigned(tiles.realizedYtdKrw, (v) => money(v, 'KRW'))}
              tone={deltaTone(tiles.realizedYtdKrw)}
              sub={<>{tiles.realizedYtdKrw == null ? copy.noRecordsYet : copy.realizedYtdHint(tiles.realizedYtdCount)} · <TextLink href="/realized">{copy.openRealized}</TextLink></>}
            />
          </StatStrip>
        </Card>
      ) : null}

      {/* One allocation card: how the whole is split, each split linking to the page with the full breakdown. */}
      <Card title={copy.allocation} info={copy.allocationInfo} className="mb-5">
        {netWorth ? <AssetCoverageNote summary={netWorth} language={language} review={getAssetCoverageReview(netWorth)} /> : null}
        <CardRow columns={netWorth ? 3 : 2} spacing="none">
          {netWorth ? (
            <ShareSummary
              title={copy.byAssetClass}
              action={<TextLink href="/net-worth">{copy.openTotalAssets}</TextLink>}
              items={(['stocks', 'crypto', 'cash', 'pensions', 'gold'] as const).map((key) => ({
                key,
                label: copy.assetClasses[key],
                color: ASSET_CLASS_COLOR[key],
                pct: netWorth.totalKrw > 0 ? (netWorth.byClass[key] / netWorth.totalKrw) * 100 : 0,
                detail: money(netWorth.byClass[key], 'KRW'),
              }))}
            >
              {netWorth.asOfNotes.length > 0 ? (
                <Note spacing="above-2">
                  {netWorth.asOfNotes.map((note) => `${copy.assetClasses[note.assetClass as keyof typeof copy.assetClasses] ?? note.assetClass}: ${copy.asOfNote(maskAccountLabel(note.label), fmtDate(note.asOf, language))}`).join(' · ')}
                  {' '}{copy.asOfNotesHint}
                </Note>
              ) : null}
              {netWorth.unpricedCash.length > 0 ? <Note spacing="above-2">{copy.unpricedCash(netWorth.unpricedCash.length)}</Note> : null}
            </ShareSummary>
          ) : null}
          <ShareSummary
            title={copy.marketAllocation}
            action={<TextLink href="/holdings">{copy.openHoldings}</TextLink>}
            items={marketBreakdown.map((market) => ({
              key: market.market,
              label: market.label,
              color: market.color,
              pct: globalValue > 0 ? (market.marketValue / globalValue) * 100 : 0,
              detail: (
                <>
                  {money(market.marketValue, 'KRW')} · <span className={signClass(market.returnPct)}>{fmtPct(market.returnPct, { digits: 1, signed: true })}</span>
                </>
              ),
            }))}
          >
            <Note spacing="above-2">{copy.marketAllocationNote}</Note>
          </ShareSummary>
          <ShareSummary
            title={copy.concentrationTitle(fmtPct(topFiveShare, { digits: 0 }))}
            action={<TextLink href="/holdings">{copy.openHoldings}</TextLink>}
            items={top.slice(0, 5).map((p) => ({
              key: String(p.id),
              label: (
                <>
                  {p.name} <span className="font-mono text-label">{p.ticker}</span>
                </>
              ),
              color: marketColor(p.market),
              pct: globalBase > 0 ? ((p.base_cost ?? 0) / globalBase) * 100 : 0,
              detail: money(p.base_cost ?? 0, 'KRW'),
            }))}
          >
            <Note spacing="above-2">{copy.concentrationBasis}</Note>
          </ShareSummary>
        </CardRow>
      </Card>

      {attention.length > 0 ? (
        <Card id="overview-attention" title={copy.attentionTitle} info={copy.attentionInfo} className="mb-5">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-body">
            {attention.map((item) => (
              <li key={item.kind}>
                <TextLink href={item.href}>{copy.attention[item.kind](fmtCount(item.count, item.capped, language))}</TextLink>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <FinanceTaxSummary language={language} />
      <Card title={copy.termMix} info={copy.termMixInfo} className="mb-5">
        <div className="flex h-full min-h-[190px] flex-col justify-center">
          <div className="text-metric font-medium leading-none tabular-nums text-ink">{fmtPct(termCoveragePct, { digits: 0 })}</div>
          <div className="mt-1 text-caption text-ink-3">{copy.termCoverage} · {copy.shortTermExposure} {fmtPct(shortTermExposurePct, { digits: 0 })}</div>
          <ShareBar
            height="md"
            spacing="mt-5"
            segments={[
              { key: 'long', pct: termSegmentWidth(termLongValue), className: 'bg-success' },
              { key: 'short', pct: termSegmentWidth(termShortValue), className: 'bg-warning' },
              { key: 'unclassified', pct: termSegmentWidth(termUnclassifiedValue), className: 'bg-line' },
            ]}
          />
          <MiniStatGrid columns={3} spacing="mt-3">
            <MiniStat label={copy.longTerm} value={money(termLongValue, 'KRW')} />
            <MiniStat label={copy.shortTerm} value={money(termShortValue, 'KRW')} />
            <MiniStat label={copy.unclassifiedTerm} value={money(termUnclassifiedValue, 'KRW')} />
          </MiniStatGrid>
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

    </>
  )
}
