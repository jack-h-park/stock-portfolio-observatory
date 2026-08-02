import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, MetricField, MetricHeroCard, marketTone, type Tone } from '@/components/ui'
import { getReconciliationReview } from '@/lib/adapters/portfolio-db'
import { fmtKrw, fmtMoney, fmtNumber, fmtQuantity } from '@/lib/format'
import { GLOSSARY } from '@/lib/glossary'
import { positionHref } from '@/lib/position-url'

export const dynamic = 'force-dynamic'

function priorityTone(priority: string): Tone {
  if (priority === 'high') return 'danger'
  if (priority === 'medium') return 'warning'
  return 'info'
}

function statusTone(status: string): Tone {
  if (status.includes('only')) return 'warning'
  if (status === 'quantity_break') return 'danger'
  return 'info'
}

export default function ReconciliationPage() {
  const review = getReconciliationReview()
  const hasIssues = review.totals.issue_count > 0
  const sourceIssueCount = review.totals.source_issue_count + review.totals.validation_issue_count

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Reconciliation"
        emphasis="Reconciliation"
        subtitle="Cross-check holdings, tax lots, income mapping, valuation coverage, and operational inputs from the latest ingest."
        action={hasIssues ? <Badge tone="warning">{fmtNumber(review.totals.issue_count)} review item(s)</Badge> : <Badge tone="success">Reconciled</Badge>}
      />

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.9fr)]">
        <MetricHeroCard
          title="Review Items"
          info="Total reconciliation findings that need review across holdings, tax lots, income mapping, valuation, and source checks."
          eyebrow="Reconciliation headline"
          value={fmtNumber(review.totals.issue_count)}
          hint={hasIssues ? 'Items queued for review' : 'No reconciliation actions queued'}
        >
          <div className="grid gap-4 border-t border-line-subtle pt-4 sm:grid-cols-3">
            <MetricField
              label="Positions"
              value={fmtNumber(review.totals.position_count)}
              hint={`${fmtNumber(review.totals.market_count)} markets`}
              valueClassName="text-[18px]"
            />
            <MetricField
              label="Tickerless Income"
              value={fmtNumber(review.totals.tickerless_income_count)}
              info={GLOSSARY.tickerless.description}
              hint="Income rows without ticker mapping"
              tone={review.totals.tickerless_income_count ? 'warning' : 'success'}
              valueClassName="text-[18px]"
            />
            <MetricField
              label="Source Issues"
              value={fmtNumber(sourceIssueCount)}
              info={GLOSSARY.inputIssues.description}
              hint="Freshness or validation issues"
              tone={sourceIssueCount ? 'danger' : 'success'}
              valueClassName="text-[18px]"
            />
          </div>
        </MetricHeroCard>

        <Card title="Coverage Scope" info="The source coverage represented in the reconciliation run.">
          <div className="flex min-h-[16rem] flex-col justify-between gap-4">
            <div className="space-y-4">
              <MetricField
                label="Brokerages"
                value={fmtNumber(review.totals.brokerage_count)}
                hint={`${fmtNumber(review.totals.market_count)} markets covered`}
                valueClassName="text-[28px]"
              />
              <div className="h-px bg-line-subtle" />
              <MetricField
                label="Lot Positions"
                value={fmtNumber(review.totals.lot_position_count)}
                hint="Positions represented by tax lots"
                valueClassName="text-[18px]"
              />
            </div>
            <div className="rounded-md bg-surface px-3 py-2 text-[11px] leading-relaxed text-ink-3">
              Read order: queued findings first, then source coverage and detailed break tables.
            </div>
          </div>
        </Card>
      </div>

      <Card title="Action queue" accent={review.actionQueue.length > 0}>
        {review.actionQueue.length === 0 ? (
          <EmptyState ok>No reconciliation actions queued</EmptyState>
        ) : (
          <DataTable
            rows={review.actionQueue}
            columns={[
              { key: 'priority', label: 'Priority', render: (r) => <Badge tone={priorityTone(r.priority)}>{r.priority}</Badge> },
              { key: 'area', label: 'Area' },
              { key: 'count', label: 'Count', align: 'right', render: (r) => fmtNumber(r.count) },
              { key: 'action', label: 'Action', render: (r) => <span className="text-[12px] text-ink-2">{r.action}</span> },
              {
                key: 'href',
                label: 'Open',
                render: (r) => (
                  <Link href={r.href} className="text-[12px] font-medium text-info hover:underline">
                    View
                  </Link>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Card title="Market and brokerage coverage" className="mt-5">
        <DataTable
          rows={review.coverage}
          columns={[
            { key: 'market', label: 'Market', render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
            { key: 'brokerage', label: 'Brokerage' },
            { key: 'holding_positions', label: 'Holdings', align: 'right', render: (r) => fmtNumber(r.holding_positions) },
            { key: 'lot_positions', label: 'Lot Pos.', align: 'right', render: (r) => fmtNumber(r.lot_positions) },
            { key: 'lot_rows', label: 'Lot Rows', align: 'right', render: (r) => fmtNumber(r.lot_rows) },
            { key: 'transaction_rows', label: 'Tx Rows', align: 'right', render: (r) => fmtNumber(r.transaction_rows) },
            { key: 'dividend_rows', label: 'Income Rows', align: 'right', render: (r) => fmtNumber(r.dividend_rows) },
            { key: 'holding_base_cost', label: 'Holding Cost', align: 'right', render: (r) => fmtKrw(r.holding_base_cost) },
            { key: 'lot_base_cost', label: 'Lot Cost', align: 'right', render: (r) => fmtKrw(r.lot_base_cost) },
          ]}
        />
      </Card>

      <Card title="Holdings vs tax lots breaks" className="mt-5" accent={review.positionBreaks.length > 0}>
        {review.positionBreaks.length === 0 ? (
          <EmptyState ok>No holdings-to-lots breaks above the current tolerance</EmptyState>
        ) : (
          <DataTable
            rows={review.positionBreaks}
            columns={[
              { key: 'status', label: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
              { key: 'market', label: 'Market', render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
              { key: 'brokerage', label: 'Brokerage' },
              {
                key: 'ticker',
                label: 'Position',
                render: (r) => (
                  <Link href={positionHref(r.market, r.ticker)} className="font-mono text-[12px] font-medium text-info hover:underline">
                    {r.name} ({r.ticker})
                  </Link>
                ),
              },
              { key: 'holding_quantity', label: 'Holding Qty', align: 'right', render: (r) => fmtQuantity(r.holding_quantity, 4) },
              { key: 'lot_quantity', label: 'Lot Qty', align: 'right', render: (r) => fmtQuantity(r.lot_quantity, 4) },
              { key: 'quantity_diff', label: 'Qty Diff', align: 'right', render: (r) => (r.quantity_diff == null ? 'n/a' : fmtQuantity(r.quantity_diff, 4)) },
              { key: 'base_cost_diff', label: 'Cost Diff', align: 'right', render: (r) => (r.base_cost_diff == null ? 'n/a' : fmtKrw(r.base_cost_diff)) },
            ]}
          />
        )}
      </Card>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Tickerless income breaks" accent={review.incomeBreaks.length > 0}>
          {review.incomeBreaks.length === 0 ? (
            <EmptyState ok>All income rows are ticker-mapped</EmptyState>
          ) : (
            <DataTable
              rows={review.incomeBreaks}
              columns={[
                { key: 'market', label: 'Market', render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
                { key: 'brokerage', label: 'Brokerage' },
                { key: 'income_category', label: 'Category' },
                { key: 'row_count', label: 'Rows', align: 'right', render: (r) => fmtNumber(r.row_count) },
                { key: 'base_income', label: 'Base Income', align: 'right', render: (r) => fmtKrw(r.base_income) },
              ]}
            />
          )}
        </Card>

        <Card title="Missing valuation breaks" accent={review.valuationBreaks.length > 0}>
          {review.valuationBreaks.length === 0 ? (
            <EmptyState ok>All holdings have market valuation</EmptyState>
          ) : (
            <DataTable
              rows={review.valuationBreaks}
              columns={[
                { key: 'market', label: 'Market', render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
                {
                  key: 'ticker',
                  label: 'Position',
                  render: (r) => (
                    <Link href={positionHref(r.market, r.ticker)} className="font-mono text-[12px] font-medium text-info hover:underline">
                      {r.name} ({r.ticker})
                    </Link>
                  ),
                },
                { key: 'brokerage', label: 'Brokerage' },
                { key: 'native_cost', label: 'Native Cost', align: 'right', render: (r) => fmtMoney(r.native_cost, r.currency) },
                { key: 'base_cost', label: 'Base Cost', align: 'right', render: (r) => (r.base_cost == null ? 'n/a' : fmtKrw(r.base_cost)) },
              ]}
            />
          )}
        </Card>
      </div>
    </>
  )
}
