import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, HeroAside, MetricField, MetricHeroCard, marketTone } from '@/components/ui'
import { getReconciliationReview, type ReconciliationReview } from '@/lib/adapters/portfolio-db'
import { EMPTY_VALUE, fmtNumber, fmtQuantity } from '@/lib/format'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { getGlossary } from '@/lib/glossary'
import { getLanguage } from '@/lib/i18n-server'
import { positionHref } from '@/lib/position-url'
import { getPageCopy, getUiCopy } from '@/lib/ui-copy'
import { labelFor } from '@/lib/ui-copy/label'
import { formatSort, parseSort, sortRows, type TableSort } from '@/lib/table-sort'
import { FAULT_SEVERITY, RECONCILIATION_STATUS_TONE, TO_REVIEW_SEVERITY, categoryTone, countTone, reconciliationStatusKey } from '@/lib/tone'
import { routeMetadata, routeSection } from '@/lib/page-names'
import { fmtCount, reconciliationLinkedIssues } from '@/lib/header-status'
import { CardRow, KpiBand } from '@/components/layout'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/reconciliation')

type BreakRow = ReconciliationReview['positionBreaks'][number]


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
  const incomeCategoryLabels = getUiCopy(language).incomeCategories
  const glossary = getGlossary(language)
  const review = getReconciliationReview()
  const breaks = reconciliationLinkedIssues(copy, review.positionBreaks.length, language)
  const sourceIssueCount = review.totals.source_issue_count + review.totals.validation_issue_count

  return (
    <>
      <PageHeader
        eyebrow={routeSection('/reconciliation', language)}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle}
        status={breaks.status}
      />

      <CardRow columns="hero">
        <MetricHeroCard
          title={copy.reviewItemsTitle}
          info={copy.reviewItemsInfo}
          eyebrow={copy.headline}
          value={fmtCount(breaks.issues.count, breaks.issues.capped, language)}
          hint={breaks.issues.count > 0 ? copy.breaksHint : copy.noBreaksHint}
        >
          <KpiBand>
            <MetricField
              label={copy.positions}
              value={fmtNumber(review.totals.position_count)}
              hint={copy.markets(fmtNumber(review.totals.market_count))}
            />
            <MetricField
              label={copy.tickerlessIncome}
              value={fmtNumber(review.totals.tickerless_income_count)}
              info={glossary.tickerless.description}
              hint={copy.tickerlessHint}
              tone={countTone(TO_REVIEW_SEVERITY, review.totals.tickerless_income_count)}
            />
            <MetricField
              label={copy.sourceIssues}
              value={fmtNumber(sourceIssueCount)}
              info={glossary.inputIssues.description}
              hint={copy.sourceIssuesHint}
              tone={countTone(FAULT_SEVERITY, sourceIssueCount)}
            />
          </KpiBand>
        </MetricHeroCard>

        <HeroAside title={copy.coverageScope} info={copy.coverageScopeInfo} note={copy.readOrder}>
          <MetricField
            label={copy.brokerages}
            value={fmtNumber(review.totals.brokerage_count)}
            hint={copy.marketsCovered(fmtNumber(review.totals.market_count))}
            size="metric"
          />
          <MetricField
            label={copy.lotPositions}
            value={fmtNumber(review.totals.lot_position_count)}
            hint={copy.lotPositionsHint}
          />
        </HeroAside>
      </CardRow>

      <Card title={copy.marketCoverage}>
        <DataTable
          rows={review.coverage}
          columns={[
            { key: 'market', label: copy.columns.market, render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
            { key: 'brokerage', label: copy.columns.brokerage },
            { key: 'holding_positions', priority: 'secondary', label: copy.columns.holdings, align: 'right', render: (r) => fmtNumber(r.holding_positions) },
            { key: 'lot_positions', priority: 'secondary', label: copy.columns.lotPos, align: 'right', render: (r) => fmtNumber(r.lot_positions) },
            { key: 'lot_rows', priority: 'secondary', label: copy.columns.lotRows, align: 'right', render: (r) => fmtNumber(r.lot_rows) },
            { key: 'transaction_rows', priority: 'secondary', label: copy.columns.txRows, align: 'right', render: (r) => fmtNumber(r.transaction_rows) },
            { key: 'dividend_rows', priority: 'secondary', label: copy.columns.incomeRows, align: 'right', render: (r) => fmtNumber(r.dividend_rows) },
            { key: 'holding_base_cost', label: copy.columns.holdingCost, align: 'right', render: (r) => money(r.holding_base_cost) },
            { key: 'lot_base_cost', label: copy.columns.lotCost, align: 'right', render: (r) => money(r.lot_base_cost) },
          ]}
        />
      </Card>

      <Card id="reconciliation-breaks" title={copy.positionBreaks} className="mt-5" issues={breaks.issues}>
        {review.positionBreaks.length === 0 ? (
          <EmptyState ok>{copy.noPositionBreaks}</EmptyState>
        ) : (
          <DataTable
            sort={sort}
            sortHref={sortHref}
            rows={sortRows(review.positionBreaks, sort, (row, key) => (row as Record<string, any>)[key])}
            columns={[
              { key: 'status', label: copy.columns.status, sortable: true, sortFirst: 'asc', render: (r: BreakRow) => <Badge tone={categoryTone(RECONCILIATION_STATUS_TONE, reconciliationStatusKey(r.status), 'info')}>{copy.breakStatus[r.status] ?? r.status}</Badge> },
              { key: 'market', priority: 'secondary', label: copy.columns.market, sortable: true, sortFirst: 'asc', render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
              { key: 'brokerage', priority: 'secondary', label: copy.columns.brokerage, sortable: true, sortFirst: 'asc' },
              {
                key: 'ticker',
                label: copy.columns.position,
                sortable: true,
                sortFirst: 'asc',
                sortValue: (r) => r.name ?? r.ticker,
                render: (r) => (
                  <>
                    <Link href={positionHref(r.market, r.ticker)} className="font-mono text-caption font-medium text-info hover:underline">
                      {r.name} ({r.ticker})
                    </Link>
                    {/* Market and brokerage columns hide below md; this line keeps two breaks for one ticker apart on a phone. */}
                    <div className="mt-1 flex items-center gap-2 md:hidden">
                      <Badge tone={marketTone(r.market)}>{r.market}</Badge>
                      {r.brokerage ? <span className="truncate text-caption text-ink-3">{r.brokerage}</span> : null}
                    </div>
                  </>
                ),
              },
              { key: 'holding_quantity', priority: 'secondary', sortable: true, label: copy.columns.holdingQty, align: 'right', render: (r) => fmtQuantity(r.holding_quantity, 4) },
              { key: 'lot_quantity', priority: 'secondary', sortable: true, label: copy.columns.lotQty, align: 'right', render: (r) => fmtQuantity(r.lot_quantity, 4) },
              { key: 'quantity_diff', sortable: true, label: copy.columns.qtyDiff, align: 'right', render: (r) => (r.quantity_diff == null ? EMPTY_VALUE : fmtQuantity(r.quantity_diff, 4)) },
              { key: 'base_cost_diff', sortable: true, label: copy.columns.costDiff, align: 'right', render: (r) => (r.base_cost_diff == null ? EMPTY_VALUE : money(r.base_cost_diff)) },
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
                { key: 'income_category', label: copy.columns.category, render: (r) => labelFor(incomeCategoryLabels, r.income_category) },
                { key: 'row_count', label: copy.columns.rows, align: 'right', render: (r) => fmtNumber(r.row_count) },
                { key: 'base_income', label: copy.columns.baseIncome, align: 'right', render: (r) => money(r.base_income) },
              ]}
            />
          )}
        </Card>

        <Card title={copy.valuationBreaks} issues={{ count: review.valuationBreaks.length, severity: 'problem' }}>
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
                { key: 'base_cost', label: copy.columns.baseCost, align: 'right', render: (r) => (r.base_cost == null ? EMPTY_VALUE : money(r.base_cost)) },
              ]}
            />
          )}
        </Card>
      </CardRow>
    </>
  )
}
