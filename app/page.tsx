import Link from 'next/link'
import { FreshnessInline } from '@/components/Freshness'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, MetricField, MetricHeroCard, marketTone } from '@/components/ui'
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
import { fmtDateTime, fmtKrw, fmtMoney, fmtNumber } from '@/lib/format'
import { getGlossary } from '@/lib/glossary'
import { getLanguage } from '@/lib/i18n-server'
import { positionHref } from '@/lib/position-url'

export const dynamic = 'force-dynamic'

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
const dividendChartAmount = (currency: string, amount: number) =>
  currency === 'KRW' ? Number((amount / 1000).toFixed(1)) : Number(amount.toFixed(2))

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

const COPY = {
  en: {
    eyebrow: 'Portfolio',
    title: 'Portfolio Overview',
    emphasis: 'Overview',
    subtitle: (ingestedAt: string, fx: string | null) =>
      `Read-only status loaded from local investment data at ${ingestedAt}.${fx ? ` Applied FX: ${fx}.` : ''}`,
    needsReview: (count: number) => `Needs review ${count}`,
    healthy: 'Healthy',
    freshnessTitle: 'Data Freshness',
    allAssets: 'All Assets Summary',
    portfolioValue: 'Total Portfolio Value',
    portfolioValueInfo: 'Current market value converted to KRW across all priced holdings.',
    allMarkets: 'All markets',
    valueHint: 'Current value after applying prices and FX',
    returnOnPricedCost: 'Return on priced cost',
    primaryMetrics: 'Primary Metrics',
    supportingMetrics: 'Supporting Metrics',
    totalCost: 'Total Cost Basis',
    totalGain: 'Total Unrealized G/L',
    koreaGain: 'Korea Unrealized G/L',
    usGain: 'US Unrealized G/L',
    cryptoGain: 'Crypto Unrealized G/L',
    koreaCost: 'Korea Cost Basis',
    usCost: 'US Cost Basis',
    cryptoCost: 'Crypto Cost Basis',
    nativeCurrency: 'Native currency',
    totalShare: 'Share of total',
    holdings: 'Holdings',
    totalQuantity: 'Total quantity',
    dividends: 'Dividends',
    count: (value: string) => `${value} rows`,
    marketAllocation: 'Market Allocation',
    marketBreakdown: 'Market Breakdown',
    marketBreakdownInfo: 'Market-value share, cost basis, and unrealized gain/loss by market. Use this after the headline portfolio value.',
    activitySummary: 'Activity Summary',
    korea: 'Korea',
    us: 'United States',
    crypto: 'Crypto',
    fxNote: (fx: string | null) => `USD assets use ${fx ?? 'the configured FX rate'}.`,
    concentration: 'Top Holding Concentration',
    concentrationInfo: 'Share of the total portfolio held by the top five positions, measured by cost basis.',
    concentrationHint: 'Cost-basis share of the top five holdings',
    termMix: 'Holding-Period Mix',
    termMixInfo: 'Splits quantity into long-term and short-term buckets for tax review.',
    longTermShare: 'Long-term quantity share',
    longTerm: 'Long term',
    shortTerm: 'Short term',
    marketValue: 'Market value',
    costBasis: 'Cost basis',
    gain: 'Gain',
    return: 'Return',
    share: 'Share',
    appEyebrow: 'Stock Portfolio Observatory',
    dbMissingTitle: 'Portfolio DB not found',
    dbMissingHint: (path: string) => <>Run <code className="font-mono text-[12px]">pnpm ingest</code> to generate <code className="font-mono text-[12px]">{path}</code>.</>,
    snapshotTrend: (scope: string) => `${scope} snapshot trend`,
    combinedTrendSummary: (scope: string) => `${scope} · Market value, cost basis, and unrealized G/L · KRW millions`,
    trendUnit: (metric: string, unit: string) => `${metric} · ${unit}`,
    percentagePoints: 'percentage points',
    krwMillions: 'KRW millions',
    costPriced: (value: string) => `${value}% of cost basis priced`,
    positionsPriced: (value: string) => `${value}% of positions priced`,
    noCoveredHistory: 'No sufficiently covered history',
    partialValuation: 'Partial valuation: less than 95% of cost basis is priced.',
    since: (date: string) => `since ${date}`,
    needTwoSnapshots: 'Need at least two covered snapshots',
    individual: 'Individual',
    combined: 'Combined',
    noCombinedHistory: 'No combined history recorded',
    noPortfolioHistory: 'No portfolio history recorded',
    firstSnapshotHint: 'Run pnpm refresh or pnpm ingest to record the first snapshot.',
    chartAxisReturn: 'Percentage points',
    chartAxisKrw: 'KRW million',
    trendRangeSummary: (start: string, end: string, valued: number, total: number, gaps: number) =>
      `${start} to ${end} · ${valued} valued / ${total} total snapshot(s)${gaps ? ` · ${gaps} gap(s)` : ''}`,
    snapshotsOnce: 'Snapshots are recorded once per ingest date.',
    trendExplanation: 'Cost basis, holdings, and dividends are reconstructed from tax-lot and transaction dates. Foreign-currency quotes are converted to KRW using historical FX snapshots. Valuation points below 90% cost-basis coverage remain visible as chart gaps; 90–95% coverage is marked partial. Cost-basis history itself does not require a market price.',
    topHoldingsByCost: 'Top holdings by base cost',
    topHoldingsNote: 'Bar values are KRW millions after applying the configured FX snapshot.',
    dividendTrend: 'Dividend trend',
    dividendTrendNote: 'KR bars are KRW thousands; US bars are native USD.',
    dividendAxis: 'KRW thousand / USD',
    accountAllocation: 'Account allocation',
    noAccountData: 'No account data',
    holdingRows: (count: number) => `${count} holdings`,
    largestPositions: 'Largest positions',
    transactionTypes: 'Transaction types',
    metricLabels: {
      market_value: 'Market value',
      cost_basis: 'Cost basis',
      unrealized_gl: 'Unrealized G/L',
      return_pct: 'Return %',
    },
    scopeLabels: {
      global: 'Global',
      KR: 'Korea',
      US: 'United States',
      CRYPTO: 'Crypto',
    },
  },
  ko: {
    eyebrow: '포트폴리오',
    title: '포트폴리오 개요',
    emphasis: '개요',
    subtitle: (ingestedAt: string, fx: string | null) =>
      `로컬 투자 자료를 ${ingestedAt}에 불러온 읽기 전용 현황입니다.${fx ? ` 적용 환율: ${fx}.` : ''}`,
    needsReview: (count: number) => `확인 필요 ${count}건`,
    healthy: '정상',
    freshnessTitle: '데이터 최신 상태',
    allAssets: '전체 자산 요약',
    portfolioValue: '전체 평가금액',
    portfolioValueInfo: '가격과 환율을 적용해 원화로 환산한 전체 보유자산의 현재 평가금액입니다.',
    allMarkets: '전체 시장',
    valueHint: '현재 가격과 환율을 적용한 평가금액',
    returnOnPricedCost: '가격 확인된 취득원가 대비 수익률',
    primaryMetrics: '핵심 지표',
    supportingMetrics: '보조 지표',
    totalCost: '전체 취득원가',
    totalGain: '전체 평가손익',
    koreaGain: '한국 평가손익',
    usGain: '미국 평가손익',
    cryptoGain: '가상자산 평가손익',
    koreaCost: '한국 취득원가',
    usCost: '미국 취득원가',
    cryptoCost: '가상자산 취득원가',
    nativeCurrency: '현지 통화',
    totalShare: '전체의',
    holdings: '보유종목',
    totalQuantity: '총 수량',
    dividends: '배당',
    count: (value: string) => `${value}건`,
    marketAllocation: '시장별 비중',
    marketBreakdown: '시장별 상세',
    marketBreakdownInfo: '시장별 평가액 비중, 취득원가, 평가손익입니다. 전체 평가금액을 먼저 본 뒤 원인을 확인할 때 사용합니다.',
    activitySummary: '활동 요약',
    korea: '한국',
    us: '미국',
    crypto: '가상자산',
    fxNote: (fx: string | null) => `달러 자산은 ${fx ?? '설정된 환율'}을 적용했습니다.`,
    concentration: '상위 종목 집중도',
    concentrationInfo: '취득원가 기준 상위 5개 종목이 전체 포트폴리오에서 차지하는 비율입니다.',
    concentrationHint: '상위 5개 종목의 취득원가 비중',
    termMix: '보유기간 구성',
    termMixInfo: '세금 계산 기준에 따라 장기 보유와 단기 보유 수량을 나눕니다.',
    longTermShare: '장기 보유 수량 비중',
    longTerm: '장기 보유',
    shortTerm: '단기 보유',
    marketValue: '평가금액',
    costBasis: '취득원가',
    gain: '손익',
    return: '수익률',
    share: '비중',
    appEyebrow: 'Stock Portfolio Observatory',
    dbMissingTitle: '포트폴리오 DB를 찾을 수 없습니다',
    dbMissingHint: (path: string) => <><code className="font-mono text-[12px]">pnpm ingest</code>를 실행해 <code className="font-mono text-[12px]">{path}</code>를 생성하세요.</>,
    snapshotTrend: (scope: string) => `${scope} 스냅샷 추이`,
    combinedTrendSummary: (scope: string) => `${scope} · 평가금액, 취득원가, 평가손익 · 백만 원 단위`,
    trendUnit: (metric: string, unit: string) => `${metric} · ${unit}`,
    percentagePoints: '퍼센트포인트',
    krwMillions: '백만 원 단위',
    costPriced: (value: string) => `취득원가의 ${value}% 가격 확인`,
    positionsPriced: (value: string) => `종목의 ${value}% 가격 확인`,
    noCoveredHistory: '충분히 가격이 확인된 이력이 없습니다.',
    partialValuation: '부분 평가: 취득원가의 95% 미만만 가격이 확인되었습니다.',
    since: (date: string) => `${date} 이후`,
    needTwoSnapshots: '가격이 확인된 스냅샷이 최소 2개 필요합니다.',
    individual: '개별',
    combined: '통합',
    noCombinedHistory: '통합 이력이 없습니다.',
    noPortfolioHistory: '포트폴리오 이력이 없습니다.',
    firstSnapshotHint: '첫 스냅샷을 기록하려면 pnpm refresh 또는 pnpm ingest를 실행하세요.',
    chartAxisReturn: '퍼센트포인트',
    chartAxisKrw: '백만 원',
    trendRangeSummary: (start: string, end: string, valued: number, total: number, gaps: number) =>
      `${start}부터 ${end}까지 · 가격 확인 ${valued}개 / 전체 ${total}개 스냅샷${gaps ? ` · 공백 ${gaps}개` : ''}`,
    snapshotsOnce: '스냅샷은 ingest 날짜마다 한 번 기록됩니다.',
    trendExplanation: '취득원가, 보유수량, 배당은 세금 단위와 거래일 기준으로 재구성됩니다. 외화 가격은 과거 환율 스냅샷으로 원화 환산됩니다. 취득원가 기준 가격 확인률이 90% 미만인 평가 지점은 차트 공백으로 남기고, 90~95%는 부분 평가로 표시합니다. 취득원가 이력 자체에는 시장 가격이 필요하지 않습니다.',
    topHoldingsByCost: '취득원가 상위 보유종목',
    topHoldingsNote: '막대 값은 설정된 환율 스냅샷을 적용한 백만 원 단위입니다.',
    dividendTrend: '배당 추이',
    dividendTrendNote: '한국 막대는 천 원 단위, 미국 막대는 현지 USD 단위입니다.',
    dividendAxis: '천 원 / USD',
    accountAllocation: '계좌별 배분',
    noAccountData: '계좌 데이터가 없습니다.',
    holdingRows: (count: number) => `${count}개 보유`,
    largestPositions: '상위 보유종목',
    transactionTypes: '거래 유형',
    metricLabels: {
      market_value: '평가금액',
      cost_basis: '취득원가',
      unrealized_gl: '평가손익',
      return_pct: '수익률 %',
    },
    scopeLabels: {
      global: '전체',
      KR: '한국',
      US: '미국',
      CRYPTO: '가상자산',
    },
  },
} as const

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ trend?: string; metric?: string; scope?: string; view?: string }>
}) {
  const language = await getLanguage()
  const copy = COPY[language]
  const glossary = getGlossary(language)
  if (!dbAvailable()) {
    return (
      <>
        <PageHeader eyebrow={copy.appEyebrow} title={copy.title} emphasis={copy.emphasis} />
        <Card title={copy.dbMissingTitle}>
          <p className="text-[13px] text-ink-2">
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

  const totalTerm = (overview.totals.long_term_qty ?? 0) + (overview.totals.short_term_qty ?? 0)
  const longTermPct = totalTerm > 0 ? Math.round((overview.totals.long_term_qty / totalTerm) * 100) : 0
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
  const largestPositions = top.slice(0, 5)
  const topHoldingChartData = top.map((r) => ({
    name: positionAxisLabel(r.market, r.name, r.ticker),
    market: r.market,
    value: Math.round((r.base_cost ?? 0) / 1_000_000),
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
          : Number(snapshot[selectedField as TrendFieldKey]) / 1_000_000,
      coverage: snapshot[selectedCoverageField],
    }))
  const combinedTrendData = portfolioSnapshots
    .map((snapshot) => ({
      date: snapshot.snapshot_date,
      market_value: snapshot[TREND_FIELDS[selectedScope].market_value as TrendFieldKey] == null || Number(snapshot[selectedCoverageField]) < MIN_TREND_COST_COVERAGE ? null : Number(snapshot[TREND_FIELDS[selectedScope].market_value as TrendFieldKey]) / 1_000_000,
      cost_basis: snapshot[TREND_FIELDS[selectedScope].cost_basis as TrendFieldKey] == null ? null : Number(snapshot[TREND_FIELDS[selectedScope].cost_basis as TrendFieldKey]) / 1_000_000,
      unrealized_gl: snapshot[TREND_FIELDS[selectedScope].unrealized_gl as TrendFieldKey] == null || Number(snapshot[selectedCoverageField]) < MIN_TREND_COST_COVERAGE ? null : Number(snapshot[TREND_FIELDS[selectedScope].unrealized_gl as TrendFieldKey]) / 1_000_000,
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
  const trendValueLabel = (value: number) => selectedMetric.key === 'return_pct' ? `${fmtNumber(value, 1)}%` : fmtKrw(value * 1_000_000)
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
          value={fmtKrw(globalValue)}
          hint={copy.valueHint}
        >
          <div className="grid gap-4 border-t border-line-subtle pt-4 sm:grid-cols-3">
            <MetricField label={copy.totalCost} value={fmtKrw(globalBase)} info={glossary.costBasis.description} valueClassName="text-[18px]" />
            <MetricField
              label={copy.totalGain}
              value={fmtKrw(overview.totals.global_base_unrealized_gl)}
              info={glossary.unrealizedGl.description}
              tone={overview.totals.global_base_unrealized_gl >= 0 ? 'success' : 'danger'}
              valueClassName="text-[18px]"
            />
            <MetricField
              label={copy.returnOnPricedCost}
              value={`${fmtNumber(globalUnrealizedPct, 2)}%`}
              info={`${glossary.unrealizedGl.description} This percentage is measured against priced cost basis.`}
              tone={globalUnrealizedPct >= 0 ? 'success' : 'danger'}
              valueClassName="text-[18px]"
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
                valueClassName="text-[28px]"
              />
              <div className="h-px bg-line-subtle" />
              <MetricField
                label={copy.dividends}
                value={fmtKrw(overview.dividends.krw_amount)}
                hint={`${fmtMoney(overview.dividends.usd_amount, 'USD')} · ${copy.count(fmtNumber(overview.dividends.count))}`}
                tone="success"
                valueClassName="text-[18px]"
              />
            </div>
            <div className="rounded-md bg-surface px-3 py-2 text-[11px] leading-relaxed text-ink-3">
              {copy.fxNote(fxLabel)}
            </div>
          </div>
        </Card>
      </div>

      <Card title={copy.marketBreakdown} info={copy.marketBreakdownInfo} className="mb-5">
        <div className="grid gap-4 lg:grid-cols-3">
          {marketBreakdown.map((market) => (
            <div key={market.key} className="min-w-0">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge tone={market.tone}>{market.key}</Badge>
                  <span className="text-[13px] font-medium text-ink">{market.label}</span>
                </div>
                <span className="text-[12px] tabular-nums text-ink-3">{copy.share} {market.share}%</span>
              </div>
              <div className="mb-3 h-2 overflow-hidden rounded-pill bg-surface">
                <div
                  className="h-full rounded-pill"
                  style={{
                    width: `${Math.max(1, market.share)}%`,
                    backgroundImage: market.key === 'KR' ? 'linear-gradient(90deg, var(--accent-success), var(--brand-cyan))' : market.key === 'US' ? 'linear-gradient(90deg, var(--accent-info), var(--brand-blue))' : 'linear-gradient(90deg, var(--accent-warning), var(--brand-purple))',
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
                <MetricField label={copy.marketValue} value={fmtKrw(market.marketValue)} labelClassName="normal-case tracking-normal" />
                <MetricField label={copy.costBasis} value={fmtKrw(market.cost)} info={glossary.costBasis.description} labelClassName="normal-case tracking-normal" />
                <MetricField
                  label={copy.gain}
                  value={fmtKrw(market.gain)}
                  info={glossary.unrealizedGl.description}
                  tone={market.gain >= 0 ? 'success' : 'danger'}
                  labelClassName="normal-case tracking-normal"
                />
                <MetricField
                  label={copy.return}
                  value={`${fmtNumber(market.returnPct, 2)}%`}
                  tone={market.returnPct >= 0 ? 'success' : 'danger'}
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
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{item.label}</div>
              <FreshnessInline item={item} language={language} />
            </div>
          ))}
        </div>
      </Card>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title={copy.concentration} info={copy.concentrationInfo}>
          <div className="flex h-full min-h-[190px] flex-col justify-center">
            <div className="text-[44px] font-medium leading-none tabular-nums text-ink">{topFiveShare}%</div>
            <div className="mt-1 text-[12px] text-ink-3">{copy.concentrationHint}</div>
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

        <Card title={copy.termMix} info={copy.termMixInfo}>
          <div className="flex h-full min-h-[190px] flex-col justify-center">
            <div className="text-[44px] font-medium leading-none tabular-nums text-ink">{longTermPct}%</div>
            <div className="mt-1 text-[12px] text-ink-3">{copy.longTermShare}</div>
            <div className="mt-5 h-2 overflow-hidden rounded-pill bg-surface">
              <div className="h-full rounded-pill bg-success" style={{ width: `${longTermPct}%` }} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
              <div>
                <div className="text-ink-3">{copy.longTerm}</div>
                <div className="font-medium tabular-nums text-ink">{fmtNumber(overview.totals.long_term_qty)}</div>
              </div>
              <div>
                <div className="text-ink-3">{copy.shortTerm}</div>
                <div className="font-medium tabular-nums text-ink">{fmtNumber(overview.totals.short_term_qty)}</div>
              </div>
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
                <div className="text-[12px] text-ink-3">{copy.combinedTrendSummary(selectedScopeLabel)}</div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                  {combinedMetrics.map((metric) => {
                    const latest = combinedTrendData[combinedTrendData.length - 1]?.[metric.key]
                    return (
                      <div key={metric.key}>
                        <div className="flex items-center gap-1.5 text-[11px] text-ink-3"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: metric.color }} />{copy.metricLabels[metric.key]}</div>
                        <div className="mt-0.5 text-[18px] font-medium tabular-nums text-ink">{typeof latest === 'number' ? fmtKrw(latest * 1_000_000) : '—'}</div>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="text-[12px] text-ink-3">
                  {copy.trendUnit(`${selectedScopeLabel} · ${selectedMetricLabel}`, selectedMetric.key === 'return_pct' ? copy.percentagePoints : copy.krwMillions)}
                  {latestTrendCoverage != null && latestTrendCoverage < 1 ? ` · ${copy.costPriced(fmtNumber(latestTrendCoverage * 100, 2))}` : ''}
                  {latestPositionCoverage != null && latestPositionCoverage < 1 ? ` · ${copy.positionsPriced(fmtNumber(latestPositionCoverage * 100, 1))}` : ''}
                </div>
                <div className="mt-1 text-[22px] font-medium tabular-nums text-ink">{valuedTrendData.length ? trendValueLabel(latestTrendValue) : copy.noCoveredHistory}</div>
                {latestTrendCoverage != null && latestTrendCoverage >= MIN_TREND_COST_COVERAGE && latestTrendCoverage < HEALTHY_TREND_COST_COVERAGE && (
                  <div className="mt-1 text-[11px] text-warning">{copy.partialValuation}</div>
                )}
              </>
            )}
          </div>
          {selectedView === 'single' && <div className={`text-right text-[12px] tabular-nums ${trendChange >= 0 ? 'text-success' : 'text-danger'}`}>{valuedTrendData.length > 1 ? <>{trendChangeLabel}<div className="text-[10px] font-normal text-ink-3">{copy.since(firstTrendPoint.date)}</div></> : copy.needTwoSnapshots}</div>}
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-1">
          <Link
            href={`/?trend=${selectedRange.key}&scope=${selectedScope}&metric=${selectedMetric.key}&view=single`}
            scroll={false}
            className={`rounded-sm border px-2 py-1 text-[11px] ${selectedView === 'single' ? 'border-info bg-info/10 font-medium text-info' : 'border-line text-ink-3 hover:border-info hover:text-info'}`}
          >{copy.individual}</Link>
          <Link
            href={`/?trend=${selectedRange.key}&scope=${selectedScope}&metric=${selectedMetric.key}&view=combined`}
            scroll={false}
            className={`rounded-sm border px-2 py-1 text-[11px] ${selectedView === 'combined' ? 'border-info bg-info/10 font-medium text-info' : 'border-line text-ink-3 hover:border-info hover:text-info'}`}
          >{copy.combined}</Link>
          <span className="mx-1 h-4 w-px bg-line-subtle" />
          {TREND_SCOPES.map((scope) => (
            <Link
              key={scope.key}
              href={`/?trend=${selectedRange.key}&scope=${scope.key}&metric=${selectedMetric.key}&view=${selectedView}`}
              scroll={false}
              className={`rounded-sm border px-2 py-1 text-[11px] ${selectedScope === scope.key ? 'border-info bg-info/10 font-medium text-info' : 'border-line text-ink-3 hover:border-info hover:text-info'}`}
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
              className={`rounded-sm border px-2 py-1 text-[11px] ${selectedMetric.key === metric.key ? 'border-line bg-surface font-medium text-ink' : 'border-transparent text-ink-3 hover:border-line hover:text-ink'}`}
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
            valuePrefix={selectedMetric.key === 'return_pct' ? '' : '₩'}
            valueSuffix={selectedMetric.key === 'return_pct' ? '%' : 'M'}
            axisLabel={selectedMetric.key === 'return_pct' ? copy.chartAxisReturn : copy.chartAxisKrw}
          />
        )}
        <div className="mt-1 text-[11px] text-ink-3">
          {trendData.length ? copy.trendRangeSummary(trendData[0].date, trendData[trendData.length - 1].date, valuedTrendData.length, trendData.length, missingTrendPoints) : copy.snapshotsOnce}
        </div>
        <div className="mt-2 text-[11px] leading-relaxed text-ink-3">
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
            yAxisPrefix="₩"
            yAxisSuffix="M"
            yAxisLabel={copy.chartAxisKrw}
          />
          <p className="mt-2 text-[11px] text-ink-3">{copy.topHoldingsNote}</p>
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
          <p className="mt-2 text-[11px] text-ink-3">{copy.dividendTrendNote}</p>
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
                  <div className="min-w-0 flex-1 truncate text-[13px] text-ink">{a.account}</div>
                  <div className="text-[12px] tabular-nums text-ink-3">{copy.holdingRows(a.count)}</div>
                  <div className="w-36 text-right text-[12px] font-medium tabular-nums text-ink">{fmtMoney(a.value, a.currency)}</div>
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
                <Link href={positionHref(h.market, h.ticker)} className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink hover:underline">
                  {h.name}
                </Link>
                <span className="text-[12px] tabular-nums text-ink-3">{fmtKrw(h.base_cost ?? 0)}</span>
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
                <span className="text-[12px] tabular-nums text-ink-3">{copy.count(fmtNumber(t.count))}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}
