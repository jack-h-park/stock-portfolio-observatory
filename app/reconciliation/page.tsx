import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, MetricField, MetricHeroCard, TextLink, marketTone, type Tone } from '@/components/ui'
import { getReconciliationReview } from '@/lib/adapters/portfolio-db'
import { fmtNumber, fmtQuantity } from '@/lib/format'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { getGlossary } from '@/lib/glossary'
import { getLanguage } from '@/lib/i18n-server'
import { positionHref } from '@/lib/position-url'
import { getPageCopy, getUiCopy } from '@/lib/ui-copy'
import { formatSort, parseSort, sortRows, type TableSort } from '@/lib/table-sort'
import { priorityTone } from '@/lib/tone'
import { routeMetadata, routeSection } from '@/lib/page-names'
import { CardRow, KpiBand } from '@/components/layout'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/reconciliation')

function statusTone(status: string): Tone {
  if (status.includes('only')) return 'warning'
  if (status === 'quantity_break') return 'danger'
  return 'info'
}


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
  const copy = getPageCopy('reconciliation', language)
  const glossary = getGlossary(language)
  const priorityLabels = getUiCopy(language).priority
  const review = getReconciliationReview()
  const hasIssues = review.totals.issue_count > 0
  const sourceIssueCount = review.totals.source_issue_count + review.totals.validation_issue_count

  return (
    <>
      <PageHeader
        eyebrow={routeSection('/reconciliation', language)}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle}
        action={hasIssues ? <Badge tone="warning">{copy.reviewItems(fmtNumber(review.totals.issue_count))}</Badge> : <Badge tone="success">{copy.reconciled}</Badge>}
      />

      <CardRow columns="hero">
        <MetricHeroCard
          title={copy.reviewItemsTitle}
          info={copy.reviewItemsInfo}
          eyebrow={copy.headline}
          value={fmtNumber(review.totals.issue_count)}
          hint={hasIssues ? copy.queuedHint : copy.noActionsHint}
        >
          <KpiBand>
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
          </KpiBand>
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
      </CardRow>

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
                  <TextLink href={r.href}>
                    {copy.view}
                  </TextLink>
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

      <CardRow spacing="above">
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
      </CardRow>
    </>
  )
}
