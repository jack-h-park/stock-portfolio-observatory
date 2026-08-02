import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { FreshnessRows } from '@/components/Freshness'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, StatCard, marketTone, type Tone } from '@/components/ui'
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
        eyebrow="시스템 · 고급"
        title="운영 작업"
        emphasis="작업"
        subtitle="종목 연결, 평가금액 누락, 원본 최신 상태와 검사 결과 중 확인할 작업을 모아 보여줍니다."
        action={issueCount ? <Badge tone="warning">확인 필요 {fmtNumber(issueCount)}건</Badge> : <Badge tone="success">처리할 작업 없음</Badge>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="수익 연결 규칙" value={fmtNumber(ops.manualMappings.incomeRuleCount)} info="배당·이자 수익을 종목이나 분류에 연결하는 규칙 수입니다." accent />
        <StatCard label="수동 지정" value={fmtNumber(ops.manualMappings.overrideCount)} info="자동 결과 대신 사용자가 직접 지정한 항목 수입니다." />
        <StatCard label="연결 제안" value={fmtNumber(ops.mappingSuggestions.length)} tone={ops.mappingSuggestions.length ? 'warning' : 'success'} />
        <StatCard label="평가금액 보완" value={fmtNumber(ops.valuationFixes.length)} tone={ops.valuationFixes.length ? 'warning' : 'success'} />
        <StatCard label="원본·검사 문제" value={fmtNumber(ops.sourceIssues.length + ops.validationIssues.length)} tone={ops.sourceIssues.length + ops.validationIssues.length ? 'warning' : 'success'} />
      </div>

      <Card title="우선 확인할 작업" info="문제의 영향도와 건수를 기준으로 먼저 살펴볼 항목입니다." className="mb-5" accent={ops.actionQueue.length > 0}>
        {ops.actionQueue.length === 0 ? (
          <EmptyState ok>확인할 운영 작업이 없습니다</EmptyState>
        ) : (
          <DataTable
            rows={ops.actionQueue}
            caption="우선 확인할 운영 작업 목록"
            columns={[
              { key: 'priority', label: '우선순위', render: (r) => <Badge tone={priorityTone(r.priority)}>{PRIORITY_LABELS[r.priority as keyof typeof PRIORITY_LABELS] ?? r.priority}</Badge> },
              { key: 'area', label: '영역' },
              { key: 'count', label: '건수', align: 'right', render: (r) => fmtNumber(r.count) },
              { key: 'action', label: '필요한 작업', render: (r) => <span className="text-[12px] text-ink-2">{r.action}</span> },
              {
                key: 'href',
                label: '열기',
                render: (r) => (
                  <Link href={r.href} className="text-[12px] font-medium text-info hover:underline">
                    보기
                  </Link>
                ),
              },
            ]}
          />
        )}
      </Card>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="수동 연결 설정" info="자동으로 연결되지 않는 수익 데이터를 보완하는 고급 설정입니다.">
          <div className="space-y-2 text-[12px] text-ink-2">
            <div className="flex items-center justify-between gap-3">
              <span>버전</span>
              <span className="font-medium tabular-nums text-ink">{ops.manualMappings.version ?? '기록 없음'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>수익 연결 규칙</span>
              <span className="font-medium tabular-nums text-ink">{fmtNumber(ops.manualMappings.incomeRuleCount)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>배당 수동 지정</span>
              <span className="font-medium tabular-nums text-ink">{fmtNumber(ops.manualMappings.overrideCount)}</span>
            </div>
            <code className="block break-words rounded-sm border border-line-subtle bg-surface px-2 py-1 font-mono text-[11px] text-ink-3">
              {ops.manualMappings.path}
            </code>
          </div>
        </Card>

        <Card title="연결 현황">
          <DataTable
            rows={ops.mappingSummary}
            caption="수익 데이터 연결 현황"
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
