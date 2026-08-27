import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { FreshnessRows } from '@/components/Freshness'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, MetricField, Signed, marketTone } from '@/components/ui'
import { getOperationalHealth, getPortfolioReview, type ReviewPosition } from '@/lib/adapters/portfolio-db'
import { fmtNumber, fmtPct, fmtQuantity } from '@/lib/format'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { getGlossary } from '@/lib/glossary'
import { getLanguage } from '@/lib/i18n-server'
import { positionHref } from '@/lib/position-url'
import { getPageCopy } from '@/lib/ui-copy'
import { signTone } from '@/lib/tone'

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


type ReviewCopy = ReturnType<typeof getPageCopy<'review'>>

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
  const copy = getPageCopy('review', language)
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

      {/* No hero. The market value that used to headline this page is the same
          number the overview leads with, so the reader met it twice and learned
          nothing the second time. What is left is what only this page frames:
          how many positions, how they split, and how much needs attention. */}
      <div className="mb-5 grid grid-cols-2 gap-4 rounded-md border border-line bg-card px-4 py-3 shadow-card sm:grid-cols-4">
        <MetricField
          label={copy.positions}
          value={fmtNumber(review.totals.position_count)}
          hint={copy.accounts(fmtNumber(review.totals.account_count))}
          valueClassName="text-title"
        />
        <MetricField
          label={copy.positiveNegative}
          value={`${fmtNumber(review.totals.positive_positions)} / ${fmtNumber(review.totals.negative_positions)}`}
          hint={copy.positionsByResult}
          valueClassName="text-title"
        />
        <MetricField
          label={copy.unrealizedGl}
          value={money(review.totals.base_unrealized_gl)}
          info={glossary.unrealizedGl.description}
          hint={fmtPct(totalReturnPct)}
          tone={signTone(review.totals.base_unrealized_gl)}
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

      <p className="mb-5 rounded-md bg-surface px-3 py-2 text-label leading-relaxed text-ink-3">{copy.readOrder}</p>

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
