import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, MetricField, MetricHeroCard, marketTone, type Tone } from '@/components/ui'
import { getReconciliationReview } from '@/lib/adapters/portfolio-db'
import { fmtNumber, fmtQuantity } from '@/lib/format'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { getGlossary } from '@/lib/glossary'
import { getLanguage } from '@/lib/i18n-server'
import { positionHref } from '@/lib/position-url'
import { getUiCopy } from '@/lib/ui-copy'
import { formatSort, parseSort, sortRows, type TableSort } from '@/lib/table-sort'
import { priorityTone } from '@/lib/tone'

export const dynamic = 'force-dynamic'

function statusTone(status: string): Tone {
  if (status.includes('only')) return 'warning'
  if (status === 'quantity_break') return 'danger'
  return 'info'
}

const COPY = {
  en: {
    eyebrow: 'System',
    title: 'Reconciliation',
    emphasis: 'Reconciliation',
    subtitle: 'Check holdings, tax lots, valuation coverage, and source readiness from the latest ingest.',
    reviewItems: (count: string) => `${count} confirmed discrepancy(ies)`,
    reconciled: 'Reconciled',
    reviewItemsTitle: 'Confirmed Discrepancies',
    reviewItemsInfo: 'Confirmed differences between holdings, tax lots, and valuation data. Informational income coverage is shown separately.',
    headline: 'Reconciliation headline',
    queuedHint: 'Items queued for review',
    noActionsHint: 'No reconciliation actions queued',
    positions: 'Positions',
    markets: (count: string) => `${count} markets`,
    tickerlessIncome: 'Informational Income Rows',
    tickerlessHint: 'Cash income that does not need a security ticker',
    sourceIssues: 'Source Issues',
    sourceIssuesHint: 'Freshness or validation issues',
    coverageScope: 'Coverage Scope',
    coverageScopeInfo: 'The source coverage represented in the reconciliation run.',
    brokerages: 'Brokerages',
    marketsCovered: (count: string) => `${count} markets covered`,
    lotPositions: 'Lot Positions',
    lotPositionsHint: 'Positions represented by tax lots',
    readOrder: 'Read order: queued findings first, then source coverage and detailed break tables.',
    actionQueue: 'Action queue',
    noQueuedActions: 'No reconciliation actions queued',
    marketCoverage: 'Market and brokerage coverage',
    positionBreaks: 'Holdings vs tax lots breaks',
    noPositionBreaks: 'No holdings-to-lots breaks above the current tolerance',
    incomeBreaks: 'Tickerless income coverage',
    allIncomeMapped: 'All income rows are linked to a ticker',
    valuationBreaks: 'Missing valuation breaks',
    allValued: 'All holdings have market valuation',
    view: 'View',
    columns: {
      priority: 'Priority',
      area: 'Area',
      count: 'Count',
      action: 'Action',
      open: 'Open',
      market: 'Market',
      brokerage: 'Brokerage',
      holdings: 'Holdings',
      lotPos: 'Lot Pos.',
      lotRows: 'Lot Rows',
      txRows: 'Tx Rows',
      incomeRows: 'Income Rows',
      holdingCost: 'Holding Cost',
      lotCost: 'Lot Cost',
      status: 'Status',
      position: 'Position',
      holdingQty: 'Holding Qty',
      lotQty: 'Lot Qty',
      qtyDiff: 'Qty Diff',
      costDiff: 'Cost Diff',
      category: 'Category',
      rows: 'Rows',
      baseIncome: 'Base Income',
      nativeCost: 'Native Cost',
      baseCost: 'Base Cost',
    },
  },
  ko: {
    eyebrow: '시스템',
    title: '데이터 일치 확인',
    emphasis: '일치 확인',
    subtitle: '마지막 ingest 기준 보유종목, 세금 단위, 평가금액, 원본 상태 사이의 실제 차이를 확인합니다.',
    reviewItems: (count: string) => `확정 불일치 ${count}건`,
    reconciled: '일치 확인 완료',
    reviewItemsTitle: '확정 불일치',
    reviewItemsInfo: '보유종목·세금 단위·평가금액 사이에서 실제로 확인된 차이입니다. 종목 연결이 불필요한 현금성 수익은 별도 현황으로 표시합니다.',
    headline: '일치 확인 핵심 지표',
    queuedHint: '검토 대기 항목',
    noActionsHint: '대기 중인 일치 확인 작업 없음',
    positions: '종목',
    markets: (count: string) => `${count}개 시장`,
    tickerlessIncome: '정보성 수익 행',
    tickerlessHint: '종목 연결이 필요하지 않은 현금성 수익 행',
    sourceIssues: '원본 이슈',
    sourceIssuesHint: '최신성 또는 검증 이슈',
    coverageScope: '범위',
    coverageScopeInfo: '일치 확인 실행에 포함된 원본 범위입니다.',
    brokerages: '증권사',
    marketsCovered: (count: string) => `${count}개 시장 포함`,
    lotPositions: '세금 단위 종목',
    lotPositionsHint: '세금 단위로 표현된 종목',
    readOrder: '읽는 순서: 확정 불일치, 원본 범위, 정보성 수익 현황 순으로 확인합니다.',
    actionQueue: '작업 대기열',
    noQueuedActions: '대기 중인 일치 확인 작업이 없습니다.',
    marketCoverage: '시장 및 증권사 범위',
    positionBreaks: '보유종목 vs 세금 단위 차이',
    noPositionBreaks: '현재 허용 범위를 넘는 보유종목-세금 단위 차이가 없습니다.',
    incomeBreaks: '종목 미연결 수익 차이',
    allIncomeMapped: '모든 수익 행이 종목에 연결되어 있습니다.',
    valuationBreaks: '평가금액 누락',
    allValued: '모든 보유종목에 평가금액이 있습니다.',
    view: '보기',
    columns: {
      priority: '우선순위',
      area: '영역',
      count: '건수',
      action: '조치',
      open: '열기',
      market: '시장',
      brokerage: '증권사',
      holdings: '보유',
      lotPos: '세금 단위 종목',
      lotRows: '세금 단위 행',
      txRows: '거래 행',
      incomeRows: '수익 행',
      holdingCost: '보유 원가',
      lotCost: '세금 단위 원가',
      status: '상태',
      position: '종목',
      holdingQty: '보유 수량',
      lotQty: '세금 단위 수량',
      qtyDiff: '수량 차이',
      costDiff: '원가 차이',
      category: '분류',
      rows: '행',
      baseIncome: '원화 수익',
      nativeCost: '현지 통화 원가',
      baseCost: '원화 원가',
    },
  },
} as const

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  // Largest cost break first: this table exists to be triaged from the top.
  const sort = parseSort(params.sort, { key: 'base_cost_diff', direction: 'desc' })
  const sortHref = (next: TableSort) => `/reconciliation?sort=${formatSort(next)}`
  const language = await getLanguage()
  const money = createMoneyFormatter(await getCurrencyPreferences())
  const copy = COPY[language]
  const glossary = getGlossary(language)
  const priorityLabels = getUiCopy(language).priority
  const review = getReconciliationReview()
  const hasIssues = review.totals.issue_count > 0
  const sourceIssueCount = review.totals.source_issue_count + review.totals.validation_issue_count

  return (
    <>
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle}
        action={hasIssues ? <Badge tone="warning">{copy.reviewItems(fmtNumber(review.totals.issue_count))}</Badge> : <Badge tone="success">{copy.reconciled}</Badge>}
      />

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.9fr)]">
        <MetricHeroCard
          title={copy.reviewItemsTitle}
          info={copy.reviewItemsInfo}
          eyebrow={copy.headline}
          value={fmtNumber(review.totals.issue_count)}
          hint={hasIssues ? copy.queuedHint : copy.noActionsHint}
        >
          <div className="grid gap-4 border-t border-line-subtle pt-4 sm:grid-cols-3">
            <MetricField
              label={copy.positions}
              value={fmtNumber(review.totals.position_count)}
              hint={copy.markets(fmtNumber(review.totals.market_count))}
              valueClassName="text-title"
            />
            <MetricField
              label={copy.tickerlessIncome}
              value={fmtNumber(review.totals.tickerless_income_count)}
              info={glossary.tickerless.description}
              hint={copy.tickerlessHint}
              tone={review.totals.tickerless_income_count ? 'warning' : 'success'}
              valueClassName="text-title"
            />
            <MetricField
              label={copy.sourceIssues}
              value={fmtNumber(sourceIssueCount)}
              info={glossary.inputIssues.description}
              hint={copy.sourceIssuesHint}
              tone={sourceIssueCount ? 'danger' : 'success'}
              valueClassName="text-title"
            />
          </div>
        </MetricHeroCard>

        <Card title={copy.coverageScope} info={copy.coverageScopeInfo}>
          <div className="flex min-h-[16rem] flex-col justify-between gap-4">
            <div className="space-y-4">
              <MetricField
                label={copy.brokerages}
                value={fmtNumber(review.totals.brokerage_count)}
                hint={copy.marketsCovered(fmtNumber(review.totals.market_count))}
                valueClassName="text-metric"
              />
              <div className="h-px bg-line-subtle" />
              <MetricField
                label={copy.lotPositions}
                value={fmtNumber(review.totals.lot_position_count)}
                hint={copy.lotPositionsHint}
                valueClassName="text-title"
              />
            </div>
            <div className="rounded-md bg-surface px-3 py-2 text-label leading-relaxed text-ink-3">
              {copy.readOrder}
            </div>
          </div>
        </Card>
      </div>

      <Card title={copy.actionQueue} accent={review.actionQueue.length > 0}>
        {review.actionQueue.length === 0 ? (
          <EmptyState ok>{copy.noQueuedActions}</EmptyState>
        ) : (
          <DataTable
            rows={review.actionQueue}
            columns={[
              { key: 'priority', label: copy.columns.priority, render: (r) => <Badge tone={priorityTone(r.priority)}>{priorityLabels[r.priority as keyof typeof priorityLabels] ?? r.priority}</Badge> },
              { key: 'area', label: copy.columns.area },
              { key: 'count', label: copy.columns.count, align: 'right', render: (r) => fmtNumber(r.count) },
              { key: 'action', label: copy.columns.action, render: (r) => <span className="text-caption text-ink-2">{r.action}</span> },
              {
                key: 'href',
                label: copy.columns.open,
                render: (r) => (
                  <Link href={r.href} className="text-caption font-medium text-info hover:underline">
                    {copy.view}
                  </Link>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Card title={copy.marketCoverage} className="mt-5">
        <DataTable
          rows={review.coverage}
          columns={[
            { key: 'market', label: copy.columns.market, render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
            { key: 'brokerage', label: copy.columns.brokerage },
            { key: 'holding_positions', label: copy.columns.holdings, align: 'right', render: (r) => fmtNumber(r.holding_positions) },
            { key: 'lot_positions', label: copy.columns.lotPos, align: 'right', render: (r) => fmtNumber(r.lot_positions) },
            { key: 'lot_rows', label: copy.columns.lotRows, align: 'right', render: (r) => fmtNumber(r.lot_rows) },
            { key: 'transaction_rows', label: copy.columns.txRows, align: 'right', render: (r) => fmtNumber(r.transaction_rows) },
            { key: 'dividend_rows', label: copy.columns.incomeRows, align: 'right', render: (r) => fmtNumber(r.dividend_rows) },
            { key: 'holding_base_cost', label: copy.columns.holdingCost, align: 'right', render: (r) => money(r.holding_base_cost) },
            { key: 'lot_base_cost', label: copy.columns.lotCost, align: 'right', render: (r) => money(r.lot_base_cost) },
          ]}
        />
      </Card>

      <Card title={copy.positionBreaks} className="mt-5" accent={review.positionBreaks.length > 0}>
        {review.positionBreaks.length === 0 ? (
          <EmptyState ok>{copy.noPositionBreaks}</EmptyState>
        ) : (
          <DataTable
            sort={sort}
            sortHref={sortHref}
            rows={sortRows(review.positionBreaks, sort, (row, key) => (row as Record<string, any>)[key])}
            columns={[
              { key: 'status', label: copy.columns.status, sortable: true, sortFirst: 'asc', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
              { key: 'market', label: copy.columns.market, sortable: true, sortFirst: 'asc', render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
              { key: 'brokerage', label: copy.columns.brokerage, sortable: true, sortFirst: 'asc' },
              {
                key: 'ticker',
                label: copy.columns.position,
                sortable: true,
                sortFirst: 'asc',
                sortValue: (r) => r.name ?? r.ticker,
                render: (r) => (
                  <Link href={positionHref(r.market, r.ticker)} className="font-mono text-caption font-medium text-info hover:underline">
                    {r.name} ({r.ticker})
                  </Link>
                ),
              },
              { key: 'holding_quantity', sortable: true, label: copy.columns.holdingQty, align: 'right', render: (r) => fmtQuantity(r.holding_quantity, 4) },
              { key: 'lot_quantity', sortable: true, label: copy.columns.lotQty, align: 'right', render: (r) => fmtQuantity(r.lot_quantity, 4) },
              { key: 'quantity_diff', sortable: true, label: copy.columns.qtyDiff, align: 'right', render: (r) => (r.quantity_diff == null ? 'n/a' : fmtQuantity(r.quantity_diff, 4)) },
              { key: 'base_cost_diff', sortable: true, label: copy.columns.costDiff, align: 'right', render: (r) => (r.base_cost_diff == null ? 'n/a' : money(r.base_cost_diff)) },
            ]}
          />
        )}
      </Card>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title={copy.incomeBreaks}>
          {review.incomeBreaks.length === 0 ? (
            <EmptyState ok>{copy.allIncomeMapped}</EmptyState>
          ) : (
            <DataTable
              rows={review.incomeBreaks}
              columns={[
                { key: 'market', label: copy.columns.market, render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
                { key: 'brokerage', label: copy.columns.brokerage },
                { key: 'income_category', label: copy.columns.category },
                { key: 'row_count', label: copy.columns.rows, align: 'right', render: (r) => fmtNumber(r.row_count) },
                { key: 'base_income', label: copy.columns.baseIncome, align: 'right', render: (r) => money(r.base_income) },
              ]}
            />
          )}
        </Card>

        <Card title={copy.valuationBreaks} accent={review.valuationBreaks.length > 0}>
          {review.valuationBreaks.length === 0 ? (
            <EmptyState ok>{copy.allValued}</EmptyState>
          ) : (
            <DataTable
              rows={review.valuationBreaks}
              columns={[
                { key: 'market', label: copy.columns.market, render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
                {
                  key: 'ticker',
                  label: copy.columns.position,
                  render: (r) => (
                    <Link href={positionHref(r.market, r.ticker)} className="font-mono text-caption font-medium text-info hover:underline">
                      {r.name} ({r.ticker})
                    </Link>
                  ),
                },
                { key: 'brokerage', label: copy.columns.brokerage },
                { key: 'native_cost', label: copy.columns.nativeCost, align: 'right', render: (r) => money(r.native_cost, r.currency) },
                { key: 'base_cost', label: copy.columns.baseCost, align: 'right', render: (r) => (r.base_cost == null ? 'n/a' : money(r.base_cost)) },
              ]}
            />
          )}
        </Card>
      </div>
    </>
  )
}
