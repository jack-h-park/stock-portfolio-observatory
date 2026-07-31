import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { FreshnessRows } from '@/components/Freshness'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, StatCard , marketTone } from '@/components/ui'
import { getOperationalHealth, getPortfolioReview, type ReviewPosition } from '@/lib/adapters/portfolio-db'
import { fmtKrw, fmtMoney, fmtNumber, fmtQuantity } from '@/lib/format'
import { positionHref } from '@/lib/position-url'

export const dynamic = 'force-dynamic'

function pct(value: number | null | undefined) {
  return value == null ? 'n/a' : `${fmtNumber(value, 2)}%`
}

function signedMoney(value: number | null | undefined, currency: string) {
  const numeric = Number(value ?? 0)
  return <span className={numeric >= 0 ? 'text-success' : 'text-danger'}>{value == null ? 'n/a' : fmtMoney(value, currency)}</span>
}

function PositionLink({ row }: { row: ReviewPosition }) {
  return (
    <div className="min-w-[14rem]">
      <div className="flex items-center gap-2">
        <Badge tone={marketTone(row.market)}>{row.market}</Badge>
        <Link href={positionHref(row.market, row.ticker)} className="font-mono text-[12px] font-medium text-info hover:underline">
          {row.ticker}
        </Link>
      </div>
      <div className="mt-1 max-w-[20rem] truncate text-[12px] font-medium text-ink">{row.name}</div>
    </div>
  )
}

function PositionTable({ rows, mode }: { rows: ReviewPosition[]; mode: 'gain' | 'loss' | 'size' | 'term' | 'missing' }) {
  if (rows.length === 0) return <EmptyState ok>No rows</EmptyState>
  return (
    <DataTable
      rows={rows}
      columns={[
        { key: 'ticker', label: 'Position', render: (r) => <PositionLink row={r} /> },
        { key: 'account_count', label: 'Accts', align: 'right', render: (r) => fmtNumber(r.account_count) },
        { key: 'quantity', label: 'Qty', align: 'right', render: (r) => fmtQuantity(r.quantity, 4) },
        { key: 'native_market_value', label: 'Market', align: 'right', render: (r) => (r.native_market_value == null ? 'n/a' : fmtMoney(r.native_market_value, r.currency)) },
        { key: 'base_market_value', label: 'Base Market', align: 'right', render: (r) => (r.base_market_value == null ? 'n/a' : fmtKrw(r.base_market_value)) },
        {
          key: 'base_unrealized_gl',
          label: mode === 'term' ? 'Short %' : 'Base G/L',
          align: 'right',
          render: (r) => (mode === 'term' ? pct(r.short_term_ratio) : signedMoney(r.base_unrealized_gl, 'KRW')),
        },
        {
          key: 'base_unrealized_gl_pct',
          label: mode === 'missing' ? 'Lots' : 'G/L %',
          align: 'right',
          render: (r) => (mode === 'missing' ? fmtNumber(r.lot_count) : pct(r.base_unrealized_gl_pct)),
        },
      ]}
    />
  )
}

export default function ReviewPage() {
  const review = getPortfolioReview()
  const operational = getOperationalHealth()
  const totalReturnPct =
    review.totals.base_cost > 0 ? (review.totals.base_unrealized_gl / review.totals.base_cost) * 100 : 0
  const issueCount = operational.staleItems.length

  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="Portfolio Review"
        emphasis="Review"
        subtitle="A global review surface for concentration, winners, losers, short-term exposure, and operational readiness."
        action={issueCount ? <Badge tone="warning">{issueCount} freshness issue(s)</Badge> : <Badge tone="success">Ready</Badge>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard label="Base Market Value" value={fmtKrw(review.totals.base_market_value)} accent />
        <StatCard
          label="Unrealized G/L"
          value={fmtKrw(review.totals.base_unrealized_gl)}
          hint={pct(totalReturnPct)}
          tone={review.totals.base_unrealized_gl >= 0 ? 'success' : 'danger'}
        />
        <StatCard label="Positions" value={fmtNumber(review.totals.position_count)} hint={`${fmtNumber(review.totals.account_count)} accounts`} />
        <StatCard label="Positive / Negative" value={`${fmtNumber(review.totals.positive_positions)} / ${fmtNumber(review.totals.negative_positions)}`} />
        <StatCard label="Top 5 Concentration" value={pct(review.concentration.top5Share)} tone={review.concentration.top5Share >= 50 ? 'warning' : 'neutral'} />
        <StatCard label="Freshness Issues" value={fmtNumber(issueCount)} tone={issueCount > 0 ? 'warning' : 'success'} />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Market-aware summary">
          <ul className="divide-y divide-line-subtle">
            {review.byMarket.map((row) => (
              <li key={row.market} className="grid grid-cols-[4rem_1fr_auto] items-center gap-3 py-2 text-[12px]">
                <Badge tone={marketTone(row.market)}>{row.market}</Badge>
                <div className="min-w-0">
                  <div className="font-medium tabular-nums text-ink">{fmtKrw(row.base_market_value)}</div>
                  <div className="text-[11px] text-ink-3">{fmtNumber(row.position_count)} positions</div>
                </div>
                <div className="text-right">{signedMoney(row.base_unrealized_gl, 'KRW')}</div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Concentration">
          <div className="grid gap-3 text-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-ink-3">Top 1</span>
              <span className="font-medium tabular-nums text-ink">{pct(review.concentration.top1Share)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-3">Top 5</span>
              <span className="font-medium tabular-nums text-ink">{pct(review.concentration.top5Share)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-3">Top 10</span>
              <span className="font-medium tabular-nums text-ink">{pct(review.concentration.top10Share)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-pill bg-surface">
              <div className="h-full rounded-pill bg-info" style={{ width: `${Math.min(review.concentration.top5Share, 100)}%` }} />
            </div>
          </div>
        </Card>

        <Card title="Operational readiness" accent={issueCount > 0}>
          {operational.staleItems.length === 0 ? (
            <EmptyState ok>No stale, drifted, or missing inputs</EmptyState>
          ) : (
            <FreshnessRows items={operational.staleItems.slice(0, 5)} />
          )}
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Largest positions">
          <PositionTable rows={review.largestPositions} mode="size" />
        </Card>
        <Card title="Top unrealized gains">
          <PositionTable rows={review.topGainers} mode="gain" />
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Top unrealized losses">
          <PositionTable rows={review.topLosers} mode="loss" />
        </Card>
        <Card title="Short-term-heavy positions">
          <PositionTable rows={review.shortTermHeavy} mode="term" />
        </Card>
      </div>

      <Card title="Positions missing market value" accent={review.noMarketValue.length > 0}>
        <PositionTable rows={review.noMarketValue} mode="missing" />
      </Card>
    </>
  )
}
