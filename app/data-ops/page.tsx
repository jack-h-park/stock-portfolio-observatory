import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { FreshnessRows } from '@/components/Freshness'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, MetricField, MetricHeroCard, marketTone, type Tone } from '@/components/ui'
import { getDataOpsReview } from '@/lib/adapters/portfolio-db'
import { fmtKrw, fmtMoney, fmtNumber } from '@/lib/format'
import { positionHref } from '@/lib/position-url'
import { PRIORITY_LABELS } from '@/lib/ui-copy'

export const dynamic = 'force-dynamic'

function priorityTone(priority: string): Tone {
  if (priority === 'high') return 'danger'
  if (priority === 'medium') return 'warning'
  return 'info'
}

export default function DataOpsPage() {
  const ops = getDataOpsReview()
  const issueCount = ops.actionQueue.reduce((sum, item) => sum + item.count, 0)

  return (
    <>
      <PageHeader
        eyebrow="System & Advanced"
        title="Operations"
        emphasis="Operations"
        subtitle="Review ticker mapping, missing valuations, source freshness, and validation items that need attention."
        action={issueCount ? <Badge tone="warning">Needs review {fmtNumber(issueCount)}</Badge> : <Badge tone="success">No pending work</Badge>}
      />

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.9fr)]">
        <MetricHeroCard
          title="Needs Review"
          info="Total operations work queued from mapping suggestions, valuation fixes, source freshness, and validation checks."
          eyebrow="Operations headline"
          value={fmtNumber(issueCount)}
          hint={issueCount ? 'Items to triage before trusting downstream analysis' : 'No pending operations work'}
        >
          <div className="grid gap-4 border-t border-line-subtle pt-4 sm:grid-cols-3">
            <MetricField
              label="Mapping Suggestions"
              value={fmtNumber(ops.mappingSuggestions.length)}
              hint="Candidate manual rules"
              tone={ops.mappingSuggestions.length ? 'warning' : 'success'}
              valueClassName="text-[18px]"
            />
            <MetricField
              label="Valuation Fixes"
              value={fmtNumber(ops.valuationFixes.length)}
              hint="Holdings needing price handling"
              tone={ops.valuationFixes.length ? 'warning' : 'success'}
              valueClassName="text-[18px]"
            />
            <MetricField
              label="Source & Check Issues"
              value={fmtNumber(ops.sourceIssues.length + ops.validationIssues.length)}
              hint="Freshness or validation issues"
              tone={ops.sourceIssues.length + ops.validationIssues.length ? 'warning' : 'success'}
              valueClassName="text-[18px]"
            />
          </div>
        </MetricHeroCard>

        <Card title="Manual Mapping Coverage" info="Rules and overrides that fill gaps when income rows cannot be linked automatically.">
          <div className="flex min-h-[16rem] flex-col justify-between gap-4">
            <div className="space-y-4">
              <MetricField
                label="Income Rules"
                value={fmtNumber(ops.manualMappings.incomeRuleCount)}
                hint="Rules mapping dividends or interest to a ticker or category"
                valueClassName="text-[28px]"
              />
              <div className="h-px bg-line-subtle" />
              <MetricField
                label="Manual Overrides"
                value={fmtNumber(ops.manualMappings.overrideCount)}
                hint="Items assigned instead of automatic mapping"
                valueClassName="text-[18px]"
              />
            </div>
            <div className="rounded-md bg-surface px-3 py-2 text-[11px] leading-relaxed text-ink-3">
              Read order: queued work first, then mapping coverage, then detailed triage tables.
            </div>
          </div>
        </Card>
      </div>

      <Card title="Priority Work" info="Items to review first, based on impact and count." className="mb-5" accent={ops.actionQueue.length > 0}>
        {ops.actionQueue.length === 0 ? (
          <EmptyState ok>No operations work to review</EmptyState>
        ) : (
          <DataTable
            rows={ops.actionQueue}
            caption="Priority operations work"
            columns={[
              { key: 'priority', label: 'Priority', render: (r) => <Badge tone={priorityTone(r.priority)}>{PRIORITY_LABELS[r.priority as keyof typeof PRIORITY_LABELS] ?? r.priority}</Badge> },
              { key: 'area', label: 'Area' },
              { key: 'count', label: 'Count', align: 'right', render: (r) => fmtNumber(r.count) },
              { key: 'action', label: 'Needed action', render: (r) => <span className="text-[12px] text-ink-2">{r.action}</span> },
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

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Manual Mapping Settings" info="Advanced settings that fill gaps when income data cannot be linked automatically.">
          <div className="space-y-2 text-[12px] text-ink-2">
            <div className="flex items-center justify-between gap-3">
              <span>Version</span>
              <span className="font-medium tabular-nums text-ink">{ops.manualMappings.version ?? 'Not recorded'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Income mapping rules</span>
              <span className="font-medium tabular-nums text-ink">{fmtNumber(ops.manualMappings.incomeRuleCount)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Dividend overrides</span>
              <span className="font-medium tabular-nums text-ink">{fmtNumber(ops.manualMappings.overrideCount)}</span>
            </div>
            <code className="block break-words rounded-sm border border-line-subtle bg-surface px-2 py-1 font-mono text-[11px] text-ink-3">
              {ops.manualMappings.path}
            </code>
          </div>
        </Card>

        <Card title="Mapping Status">
          <DataTable
            rows={ops.mappingSummary}
            caption="Income data mapping status"
            columns={[
              { key: 'mapping_status', label: 'Status', render: (r) => <Badge tone={r.mapping_status.includes('tickerless') ? 'warning' : 'success'}>{r.mapping_status}</Badge> },
              { key: 'income_category', label: 'Category' },
              { key: 'row_count', label: 'Rows', align: 'right', render: (r) => fmtNumber(r.row_count) },
              { key: 'base_income', label: 'Base Income', align: 'right', render: (r) => fmtKrw(r.base_income) },
            ]}
          />
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Manual mapping suggestions" accent={ops.mappingSuggestions.length > 0}>
          {ops.mappingSuggestions.length === 0 ? (
            <EmptyState ok>No manual mapping suggestions</EmptyState>
          ) : (
            <DataTable
              rows={ops.mappingSuggestions}
              columns={[
                { key: 'market', label: 'Market', render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
                { key: 'brokerage', label: 'Broker' },
                { key: 'income_category', label: 'Category' },
                { key: 'row_count', label: 'Rows', align: 'right', render: (r) => fmtNumber(r.row_count) },
                { key: 'base_income', label: 'Base', align: 'right', render: (r) => fmtKrw(r.base_income) },
                { key: 'rule', label: 'Suggested rule', render: (r) => <code className="block max-w-[24rem] whitespace-pre-wrap font-mono text-[11px] text-ink-2">{r.rule}</code> },
              ]}
            />
          )}
        </Card>

        <Card title="Valuation fix suggestions" accent={ops.valuationFixes.length > 0}>
          {ops.valuationFixes.length === 0 ? (
            <EmptyState ok>No valuation fixes suggested</EmptyState>
          ) : (
            <DataTable
              rows={ops.valuationFixes}
              columns={[
                { key: 'market', label: 'Market', render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
                {
                  key: 'ticker',
                  label: 'Position',
                  render: (r) => (
                    <Link href={positionHref(r.market, r.ticker)} className="font-mono text-[12px] font-medium text-info hover:underline">
                      {r.ticker}
                    </Link>
                  ),
                },
                { key: 'reason', label: 'Reason' },
                { key: 'suggestion', label: 'Suggested handling', render: (r) => <span className="text-[12px] text-ink-2">{r.suggestion}</span> },
              ]}
            />
          )}
        </Card>
      </div>

      <Card title="Tickerless income triage" accent={ops.tickerlessIncome.length > 0}>
        {ops.tickerlessIncome.length === 0 ? (
          <EmptyState ok>All income rows are ticker-mapped</EmptyState>
        ) : (
          <DataTable
            rows={ops.tickerlessIncome}
            columns={[
              { key: 'market', label: 'Market', render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
              { key: 'income_category', label: 'Category' },
              { key: 'brokerage', label: 'Broker' },
              { key: 'name', label: 'Name' },
              { key: 'type', label: 'Type' },
              { key: 'row_count', label: 'Rows', align: 'right', render: (r) => fmtNumber(r.row_count) },
              { key: 'native_income', label: 'Native', align: 'right', render: (r) => fmtMoney(r.native_income, r.currency) },
              { key: 'base_income', label: 'Base', align: 'right', render: (r) => fmtKrw(r.base_income) },
              { key: 'suggestion', label: 'Suggested handling' },
              { key: 'suggestedRule', label: 'Rule', render: (r) => <code className="block max-w-[18rem] whitespace-pre-wrap font-mono text-[11px] text-ink-3">{r.suggestedRule}</code> },
            ]}
          />
        )}
      </Card>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Missing valuation">
          {ops.missingValuation.length === 0 ? (
            <EmptyState ok>No holdings missing market value</EmptyState>
          ) : (
            <DataTable
              rows={ops.missingValuation}
              columns={[
                { key: 'market', label: 'Market', render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
                {
                  key: 'ticker',
                  label: 'Position',
                  render: (r) => (
                    <Link href={positionHref(r.market, r.ticker)} className="font-mono text-[12px] font-medium text-info hover:underline">
                      {r.ticker}
                    </Link>
                  ),
                },
                { key: 'name', label: 'Name' },
                { key: 'account', label: 'Account' },
                { key: 'native_cost', label: 'Native Cost', align: 'right', render: (r) => fmtMoney(r.native_cost, r.currency) },
                { key: 'base_cost', label: 'Base Cost', align: 'right', render: (r) => (r.base_cost == null ? 'n/a' : fmtKrw(r.base_cost)) },
                { key: 'reason', label: 'Reason' },
                { key: 'suggestion', label: 'Suggested handling' },
              ]}
            />
          )}
        </Card>

        <Card title="Source and validation issues" accent={ops.sourceIssues.length + ops.validationIssues.length > 0}>
          {ops.sourceIssues.length === 0 && ops.validationIssues.length === 0 ? (
            <EmptyState ok>No stale, drifted, missing, or failing inputs</EmptyState>
          ) : (
            <div className="space-y-4">
              {ops.sourceIssues.length > 0 && <FreshnessRows items={ops.sourceIssues} />}
              {ops.validationIssues.length > 0 && (
                <ul className="divide-y divide-line-subtle">
                  {ops.validationIssues.map((issue) => (
                    <li key={issue.id} className="flex flex-col gap-1 py-2.5 lg:flex-row lg:items-center lg:gap-3">
                      <Badge tone={issue.severity === 'error' ? 'danger' : 'warning'}>{issue.status}</Badge>
                      <span className="min-w-0 flex-1 text-[13px] font-medium text-ink">{issue.name}</span>
                      <span className="text-[12px] text-ink-3">{issue.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
