import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { FreshnessRows } from '@/components/Freshness'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, MetricField, MetricHeroCard, Signed, marketTone } from '@/components/ui'
import { getOperationalHealth, getPortfolioReview, type ReviewPosition } from '@/lib/adapters/portfolio-db'
import { fmtNumber, fmtPct, fmtQuantity } from '@/lib/format'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { getGlossary } from '@/lib/glossary'
import { getLanguage } from '@/lib/i18n-server'
import { positionHref } from '@/lib/position-url'

export const dynamic = 'force-dynamic'

function PositionLink({ row }: { row: ReviewPosition }) {
  return (
    <div className="min-w-[14rem]">
      <div className="flex items-center gap-2">
        <Badge tone={marketTone(row.market)}>{row.market}</Badge>
        <Link href={positionHref(row.market, row.ticker)} className="font-mono text-caption font-medium text-info hover:underline">
          {row.ticker}
        </Link>
      </div>
      <div className="mt-1 max-w-[20rem] truncate text-caption font-medium text-ink">{row.name}</div>
    </div>
  )
}

const COPY = {
  en: {
    eyebrow: 'Portfolio',
    title: 'Portfolio Review',
    emphasis: 'Review',
    subtitle: 'A global review surface for concentration, winners, losers, short-term exposure, and operational readiness.',
    freshnessIssues: (count: number) => `${count} freshness issue(s)`,
    ready: 'Ready',
    baseMarketValue: 'Base Market Value',
    baseMarketValueInfo: 'Current portfolio value converted to KRW. Use this as the review page headline before checking concentration or data readiness.',
    reviewHeadline: 'Review headline',
    globalValueHint: 'Global value across priced positions',
    unrealizedGl: 'Unrealized G/L',
    top5Concentration: 'Top 5 Concentration',
    concentrationHint: 'Cost-basis concentration',
    freshnessIssuesLabel: 'Freshness Issues',
    inputsNeedingReview: 'Inputs needing review',
    reviewScope: 'Review Scope',
    reviewScopeInfo: 'The size of the review universe and the split between positions with positive and negative unrealized gain/loss.',
    positions: 'Positions',
    accounts: (count: string) => `${count} accounts`,
    positiveNegative: 'Positive / Negative',
    positionsByResult: 'Positions by unrealized result',
    readOrder: 'Review order: value first, then concentration, freshness, and outliers.',
    marketSummary: 'Market-aware summary',
    positionCount: (count: string) => `${count} positions`,
    concentration: 'Concentration',
    operationalReadiness: 'Operational readiness',
    noOperationalInputs: 'No stale, drifted, or missing inputs',
    largestPositions: 'Largest positions',
    topGains: 'Top unrealized gains',
    topLosses: 'Top unrealized losses',
    shortTermHeavy: 'Short-term-heavy positions',
    missingMarketValue: 'Positions missing market value',
    noRows: 'No rows',
    columns: {
      position: 'Position',
      accounts: 'Accts',
      quantity: 'Qty',
      market: 'Market',
      baseMarket: 'Base Market',
      shortPct: 'Short %',
      baseGl: 'Base G/L',
      lots: 'Lots',
      glPct: 'G/L %',
    },
  },
  ko: {
    eyebrow: '포트폴리오',
    title: '포트폴리오 검토',
    emphasis: '검토',
    subtitle: '집중도, 수익/손실 종목, 단기 보유 비중, 운영 준비 상태를 한 화면에서 확인합니다.',
    freshnessIssues: (count: number) => `최신성 이슈 ${count}건`,
    ready: '준비 완료',
    baseMarketValue: '원화 기준 평가금액',
    baseMarketValueInfo: '현재 포트폴리오 평가금액을 원화로 환산한 값입니다. 집중도나 데이터 준비 상태를 보기 전 먼저 확인합니다.',
    reviewHeadline: '검토 핵심 지표',
    globalValueHint: '가격이 확인된 종목의 전체 평가금액',
    unrealizedGl: '평가손익',
    top5Concentration: '상위 5개 집중도',
    concentrationHint: '취득원가 기준 집중도',
    freshnessIssuesLabel: '최신성 이슈',
    inputsNeedingReview: '확인이 필요한 입력값',
    reviewScope: '검토 범위',
    reviewScopeInfo: '검토 대상 규모와 평가손익이 양수/음수인 종목 분포입니다.',
    positions: '종목',
    accounts: (count: string) => `${count}개 계좌`,
    positiveNegative: '수익 / 손실',
    positionsByResult: '평가손익 기준 종목 수',
    readOrder: '읽는 순서: 평가금액, 집중도, 최신성, 이상치 순으로 확인합니다.',
    marketSummary: '시장별 요약',
    positionCount: (count: string) => `${count}개 종목`,
    concentration: '집중도',
    operationalReadiness: '운영 준비 상태',
    noOperationalInputs: '오래되었거나 변경되었거나 누락된 입력값이 없습니다.',
    largestPositions: '평가금액 상위 종목',
    topGains: '평가이익 상위 종목',
    topLosses: '평가손실 상위 종목',
    shortTermHeavy: '단기 보유 비중 높은 종목',
    missingMarketValue: '평가금액 누락 종목',
    noRows: '표시할 행이 없습니다.',
    columns: {
      position: '종목',
      accounts: '계좌',
      quantity: '수량',
      market: '시장',
      baseMarket: '원화 평가금액',
      shortPct: '단기 %',
      baseGl: '원화 손익',
      lots: '세금 단위',
      glPct: '손익 %',
    },
  },
} as const

type ReviewCopy = (typeof COPY)[keyof typeof COPY]

function PositionTable({
  rows,
  mode,
  copy,
  money,
}: {
  rows: ReviewPosition[]
  mode: 'gain' | 'loss' | 'size' | 'term' | 'missing'
  copy: ReviewCopy
  money: (value: number | null | undefined, currency?: string | null | undefined) => string
}) {
  if (rows.length === 0) return <EmptyState ok>{copy.noRows}</EmptyState>
  return (
    <DataTable
      rows={rows}
      columns={[
        { key: 'ticker', label: copy.columns.position, render: (r) => <PositionLink row={r} /> },
        { key: 'account_count', label: copy.columns.accounts, align: 'right', render: (r) => fmtNumber(r.account_count) },
        { key: 'quantity', label: copy.columns.quantity, align: 'right', render: (r) => fmtQuantity(r.quantity, 4) },
        { key: 'native_market_value', label: copy.columns.market, align: 'right', render: (r) => (r.native_market_value == null ? 'n/a' : money(r.native_market_value, r.currency)) },
        { key: 'base_market_value', label: copy.columns.baseMarket, align: 'right', render: (r) => (r.base_market_value == null ? 'n/a' : money(r.base_market_value)) },
        {
          key: 'base_unrealized_gl',
          label: mode === 'term' ? copy.columns.shortPct : copy.columns.baseGl,
          align: 'right',
          render: (r) => (mode === 'term' ? fmtPct(r.short_term_ratio) : <Signed value={r.base_unrealized_gl} format={(m) => money(m, 'KRW')} />),
        },
        {
          key: 'base_unrealized_gl_pct',
          label: mode === 'missing' ? copy.columns.lots : copy.columns.glPct,
          align: 'right',
          render: (r) => (mode === 'missing' ? fmtNumber(r.lot_count) : fmtPct(r.base_unrealized_gl_pct)),
        },
      ]}
    />
  )
}

export default async function ReviewPage() {
  const language = await getLanguage()
  const money = createMoneyFormatter(await getCurrencyPreferences())
  const copy = COPY[language]
  const glossary = getGlossary(language)
  const review = getPortfolioReview()
  const operational = getOperationalHealth()
  const totalReturnPct =
    review.totals.base_cost > 0 ? (review.totals.base_unrealized_gl / review.totals.base_cost) * 100 : 0
  const issueCount = operational.staleItems.length

  return (
    <>
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle}
        action={issueCount ? <Badge tone="warning">{copy.freshnessIssues(issueCount)}</Badge> : <Badge tone="success">{copy.ready}</Badge>}
      />

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.9fr)]">
        <MetricHeroCard
          title={copy.baseMarketValue}
          info={copy.baseMarketValueInfo}
          eyebrow={copy.reviewHeadline}
          value={money(review.totals.base_market_value)}
          hint={copy.globalValueHint}
        >
          <div className="grid gap-4 border-t border-line-subtle pt-4 sm:grid-cols-3">
            <MetricField
              label={copy.unrealizedGl}
              value={money(review.totals.base_unrealized_gl)}
              info={glossary.unrealizedGl.description}
              hint={fmtPct(totalReturnPct)}
              tone={review.totals.base_unrealized_gl >= 0 ? 'success' : 'danger'}
              valueClassName="text-title"
            />
            <MetricField
              label={copy.top5Concentration}
              value={fmtPct(review.concentration.top5Share)}
              info={glossary.concentration.description}
              hint={copy.concentrationHint}
              tone={review.concentration.top5Share >= 50 ? 'warning' : 'neutral'}
              valueClassName="text-title"
            />
            <MetricField
              label={copy.freshnessIssuesLabel}
              value={fmtNumber(issueCount)}
              info={glossary.freshness.description}
              hint={copy.inputsNeedingReview}
              tone={issueCount > 0 ? 'warning' : 'success'}
              valueClassName="text-title"
            />
          </div>
        </MetricHeroCard>

        <Card title={copy.reviewScope} info={copy.reviewScopeInfo}>
          <div className="flex min-h-[16rem] flex-col justify-between gap-4">
            <div className="space-y-4">
              <MetricField
                label={copy.positions}
                value={fmtNumber(review.totals.position_count)}
                hint={copy.accounts(fmtNumber(review.totals.account_count))}
                valueClassName="text-metric"
              />
              <div className="h-px bg-line-subtle" />
              <MetricField
                label={copy.positiveNegative}
                value={`${fmtNumber(review.totals.positive_positions)} / ${fmtNumber(review.totals.negative_positions)}`}
                hint={copy.positionsByResult}
                valueClassName="text-title"
              />
            </div>
            <div className="rounded-md bg-surface px-3 py-2 text-label leading-relaxed text-ink-3">
              {copy.readOrder}
            </div>
          </div>
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title={copy.marketSummary}>
          <ul className="divide-y divide-line-subtle">
            {review.byMarket.map((row) => (
              <li key={row.market} className="grid grid-cols-[4rem_1fr_auto] items-center gap-3 py-2 text-caption">
                <Badge tone={marketTone(row.market)}>{row.market}</Badge>
                <div className="min-w-0">
                  <div className="font-medium tabular-nums text-ink">{money(row.base_market_value)}</div>
                  <div className="text-label text-ink-3">{copy.positionCount(fmtNumber(row.position_count))}</div>
                </div>
                <div className="text-right"><Signed value={row.base_unrealized_gl} format={(m) => money(m, 'KRW')} /></div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={copy.concentration}>
          <div className="grid gap-3 text-caption">
            <div className="flex items-center justify-between">
              <span className="text-ink-3">Top 1</span>
              <span className="font-medium tabular-nums text-ink">{fmtPct(review.concentration.top1Share)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-3">Top 5</span>
              <span className="font-medium tabular-nums text-ink">{fmtPct(review.concentration.top5Share)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-3">Top 10</span>
              <span className="font-medium tabular-nums text-ink">{fmtPct(review.concentration.top10Share)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-pill bg-surface">
              <div className="h-full rounded-pill bg-info" style={{ width: `${Math.min(review.concentration.top5Share, 100)}%` }} />
            </div>
          </div>
        </Card>

        <Card title={copy.operationalReadiness} accent={issueCount > 0}>
          {operational.staleItems.length === 0 ? (
            <EmptyState ok>{copy.noOperationalInputs}</EmptyState>
          ) : (
            <FreshnessRows items={operational.staleItems.slice(0, 5)} language={language} />
          )}
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title={copy.largestPositions}>
          <PositionTable rows={review.largestPositions} mode="size" copy={copy} money={money} />
        </Card>
        <Card title={copy.topGains}>
          <PositionTable rows={review.topGainers} mode="gain" copy={copy} money={money} />
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title={copy.topLosses}>
          <PositionTable rows={review.topLosers} mode="loss" copy={copy} money={money} />
        </Card>
        <Card title={copy.shortTermHeavy}>
          <PositionTable rows={review.shortTermHeavy} mode="term" copy={copy} money={money} />
        </Card>
      </div>

      <Card title={copy.missingMarketValue} accent={review.noMarketValue.length > 0}>
        <PositionTable rows={review.noMarketValue} mode="missing" copy={copy} money={money} />
      </Card>
    </>
  )
}
