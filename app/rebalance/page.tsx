import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, StatCard } from '@/components/ui'
import { getOperationalHealth, getRebalanceReview, type ReviewPosition } from '@/lib/adapters/portfolio-db'
import { fmtKrw, fmtMoney, fmtNumber } from '@/lib/format'
import { positionHref } from '@/lib/position-url'

export const dynamic = 'force-dynamic'

function pct(value: number | null | undefined) {
  return value == null ? 'n/a' : `${fmtNumber(value, 2)}%`
}

function PositionLink({ row }: { row: ReviewPosition }) {
  return (
    <div className="min-w-[14rem]">
      <div className="flex items-center gap-2">
        <Badge tone={row.market === 'US' ? 'info' : 'success'}>{row.market}</Badge>
        <Link href={positionHref(row.market, row.ticker)} className="font-mono text-[12px] font-medium text-info hover:underline">
          {row.ticker}
        </Link>
      </div>
      <div className="mt-1 max-w-[20rem] truncate text-[12px] font-medium text-ink">{row.name}</div>
    </div>
  )
}

function signedKrw(value: number) {
  return <span className={value >= 0 ? 'text-success' : 'text-danger'}>{fmtKrw(value)}</span>
}

export default function RebalancePage() {
  const rebalance = getRebalanceReview()
  const operational = getOperationalHealth()
  const freshnessIssues = operational.staleItems.length
  const largestGap = rebalance.marketGaps.reduce((max, row) => Math.max(max, Math.abs(row.gapPct)), 0)

  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="Rebalance"
        emphasis="Rebalance"
        subtitle={`Policy baseline: ${rebalance.policy.marketTargets.map((row) => `${row.market} ${fmtNumber(row.targetPct)}%`).join(' / ')} with ${fmtNumber(rebalance.policy.positionCapPct)}% single-position cap.`}
        action={freshnessIssues ? <Badge tone="warning">{freshnessIssues} freshness issue(s)</Badge> : <Badge tone="success">Inputs ready</Badge>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Base Market Value" value={fmtKrw(rebalance.totals.base_market_value)} accent />
        <StatCard label="Largest Market Gap" value={pct(largestGap)} tone={largestGap >= 5 ? 'warning' : 'success'} />
        <StatCard label="Reduce Candidates" value={fmtNumber(rebalance.reduceCandidates.length)} tone={rebalance.reduceCandidates.length ? 'warning' : 'success'} />
        <StatCard label="Tax-Sensitive" value={fmtNumber(rebalance.taxSensitive.length)} tone={rebalance.taxSensitive.length ? 'warning' : 'success'} />
        <StatCard label="Watch Before Action" value={fmtNumber(rebalance.watchCandidates.length + freshnessIssues)} tone={rebalance.watchCandidates.length + freshnessIssues ? 'warning' : 'success'} />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Market target gaps">
          <DataTable
            rows={rebalance.marketGaps}
            columns={[
              { key: 'market', label: 'Market', render: (r) => <Badge tone={r.market === 'US' ? 'info' : 'success'}>{r.market}</Badge> },
              { key: 'currentPct', label: 'Current', align: 'right', render: (r) => pct(r.currentPct) },
              { key: 'targetPct', label: 'Target', align: 'right', render: (r) => pct(r.targetPct) },
              { key: 'gapValue', label: 'Gap', align: 'right', render: (r) => signedKrw(r.gapValue) },
              { key: 'action', label: 'Action', render: (r) => <Badge tone={r.action === 'Hold' ? 'success' : 'warning'}>{r.action}</Badge> },
            ]}
          />
        </Card>

        <Card title="Add context">
          {rebalance.addContext.length === 0 ? (
            <EmptyState ok>No market-level add gap</EmptyState>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {rebalance.addContext.map((row) => (
                <li key={row.market} className="flex items-center gap-3 py-2 text-[12px]">
                  <Badge tone={row.market === 'US' ? 'info' : 'success'}>{row.market}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium tabular-nums text-ink">{fmtKrw(row.gapValue)} under target</div>
                    <div className="text-[11px] text-ink-3">{pct(row.gapPct)} gap · {fmtNumber(row.candidateCount)} existing positions</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Execution guardrails">
          <div className="space-y-2 text-[12px] text-ink-2">
            <div className="flex items-center justify-between gap-3">
              <span>Market gap tolerance</span>
              <Badge tone="neutral">2%</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Single-position cap</span>
              <Badge tone="neutral">{fmtNumber(rebalance.policy.positionCapPct)}%</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Short-term warning</span>
              <Badge tone="warning">50%+</Badge>
            </div>
            <div className="text-[11px] leading-relaxed text-ink-3">
              This page surfaces sizing gaps and risk flags only. Check lots, source lineage, and freshness before making any trade decision.
            </div>
          </div>
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Reduce candidates">
          {rebalance.reduceCandidates.length === 0 ? (
            <EmptyState ok>No position exceeds the cap</EmptyState>
          ) : (
            <DataTable
              rows={rebalance.reduceCandidates}
              columns={[
                { key: 'ticker', label: 'Position', render: (r) => <PositionLink row={r} /> },
                { key: 'currentPct', label: 'Current %', align: 'right', render: (r) => pct(r.currentPct) },
                { key: 'capGapPct', label: 'Over Cap', align: 'right', render: (r) => pct(r.capGapPct) },
                { key: 'capGapValue', label: 'Gap Value', align: 'right', render: (r) => fmtKrw(r.capGapValue) },
                { key: 'base_unrealized_gl', label: 'Base G/L', align: 'right', render: (r) => (r.base_unrealized_gl == null ? 'n/a' : fmtKrw(r.base_unrealized_gl)) },
                { key: 'short_term_ratio', label: 'Short %', align: 'right', render: (r) => pct(r.short_term_ratio) },
              ]}
            />
          )}
        </Card>

        <Card title="Tax-sensitive watchlist">
          {rebalance.taxSensitive.length === 0 ? (
            <EmptyState ok>No high short-term exposure rows</EmptyState>
          ) : (
            <DataTable
              rows={rebalance.taxSensitive}
              columns={[
                { key: 'ticker', label: 'Position', render: (r) => <PositionLink row={r} /> },
                { key: 'base_market_value', label: 'Base Market', align: 'right', render: (r) => (r.base_market_value == null ? 'n/a' : fmtKrw(r.base_market_value)) },
                { key: 'short_term_ratio', label: 'Short %', align: 'right', render: (r) => pct(r.short_term_ratio) },
                { key: 'short_term_qty', label: 'Short Qty', align: 'right', render: (r) => fmtNumber(r.short_term_qty, 4) },
                { key: 'reason', label: 'Reason' },
              ]}
            />
          )}
        </Card>
      </div>

      <Card title="Hold / watch before action" accent={rebalance.watchCandidates.length + freshnessIssues > 0}>
        {rebalance.watchCandidates.length === 0 && freshnessIssues === 0 ? (
          <EmptyState ok>No valuation or freshness blockers</EmptyState>
        ) : (
          <div className="space-y-4">
            {freshnessIssues > 0 && (
              <div className="rounded-md border border-line-subtle bg-surface px-3 py-2 text-[12px] text-ink-2">
                <div className="font-medium text-warning">{freshnessIssues} stale, drifted, or missing operational input(s)</div>
                <Link href="/health" className="mt-1 inline-block text-[11px] font-medium text-info hover:underline">
                  Open Health
                </Link>
              </div>
            )}
            {rebalance.watchCandidates.length > 0 && (
              <DataTable
                rows={rebalance.watchCandidates}
                columns={[
                  { key: 'ticker', label: 'Position', render: (r) => <PositionLink row={r} /> },
                  { key: 'base_cost', label: 'Base Cost', align: 'right', render: (r) => fmtKrw(r.base_cost) },
                  { key: 'native_cost', label: 'Native Cost', align: 'right', render: (r) => fmtMoney(r.native_cost, r.currency) },
                  { key: 'reason', label: 'Reason' },
                ]}
              />
            )}
          </div>
        )}
      </Card>
    </>
  )
}
