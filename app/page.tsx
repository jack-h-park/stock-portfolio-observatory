import Link from 'next/link'
import { FreshnessInline } from '@/components/Freshness'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, StatCard } from '@/components/ui'
import { AllocationPieChart, TrendBarChart } from '@/components/charts'
import {
  dbAvailable,
  getAccountAllocation,
  getDividendByYear,
  getMeta,
  getOperationalHealth,
  getOverview,
  getTopHoldings,
  getTransactionTypes,
} from '@/lib/adapters/portfolio-db'
import { config } from '@/config'
import { fmtDateTime, fmtKrw, fmtMoney, fmtNumber } from '@/lib/format'
import { positionHref } from '@/lib/position-url'

export const dynamic = 'force-dynamic'

export default function OverviewPage() {
  if (!dbAvailable()) {
    return (
      <>
        <PageHeader eyebrow="Stock Portfolio Observatory" title="Overview" emphasis="Overview" />
        <Card title="Portfolio DB not found">
          <p className="text-[13px] text-ink-2">
            Run <code className="font-mono text-[12px]">pnpm ingest</code> to generate{' '}
            <code className="font-mono text-[12px]">{config.stockDbPath}</code>.
          </p>
        </Card>
      </>
    )
  }

  const meta = getMeta()
  const overview = getOverview()
  const top = getTopHoldings(10)
  const accounts = getAccountAllocation()
  const dividendYears = getDividendByYear()
  const txTypes = getTransactionTypes()
  const operational = getOperationalHealth()
  const usdKrw = overview.fxRates.find((r: any) => r.from_currency === 'USD' && r.to_currency === 'KRW')
  const operationalIssues = operational.staleItems.length

  const totalTerm = (overview.totals.long_term_qty ?? 0) + (overview.totals.short_term_qty ?? 0)
  const longTermPct = totalTerm > 0 ? Math.round((overview.totals.long_term_qty / totalTerm) * 100) : 0
  const krBase = overview.totals.krw_cost
  const usBase = overview.totals.usd_cost * (usdKrw?.rate ?? 0)
  const globalBase = overview.totals.global_base_cost
  const usUnrealizedPct =
    overview.totals.usd_cost > 0 ? (overview.totals.usd_unrealized_gl / overview.totals.usd_cost) * 100 : 0
  const krUnrealizedPct =
    overview.totals.krw_cost > 0 ? (overview.totals.krw_unrealized_gl / overview.totals.krw_cost) * 100 : 0
  const globalUnrealizedPct =
    overview.totals.global_base_cost > 0 ? (overview.totals.global_base_unrealized_gl / overview.totals.global_base_cost) * 100 : 0
  const krShare = globalBase > 0 ? Math.round((krBase / globalBase) * 100) : 0
  const usShare = globalBase > 0 ? Math.round((usBase / globalBase) * 100) : 0
  const topFiveBase = top.slice(0, 5).reduce((sum, r) => sum + (r.base_cost ?? 0), 0)
  const topFiveShare = globalBase > 0 ? Math.round((topFiveBase / globalBase) * 100) : 0
  const largestPositions = top.slice(0, 5)
  const topHoldingChartData = top.map((r) => ({
    name: `${r.name} (${r.ticker})`,
    value: Math.round((r.base_cost ?? 0) / 1_000_000),
  }))
  const allocationData = [
    { name: 'Korea', value: krBase, label: `${fmtKrw(krBase)} · ${krShare}%` },
    { name: 'United States', value: usBase, label: `${fmtKrw(usBase)} · ${usShare}%` },
  ]

  return (
    <>
      <PageHeader
        eyebrow="Stock Portfolio Observatory"
        title="Portfolio Overview"
        emphasis="Overview"
        subtitle={`Read-only snapshot ingested ${fmtDateTime(meta.ingested_at)} from local stock-management files.${usdKrw ? ` FX: USD/KRW ${fmtNumber(usdKrw.rate, 2)} as of ${usdKrw.as_of_date}.` : ''}`}
        action={overview.failedChecks + operationalIssues > 0 ? <Badge tone="warning">{overview.failedChecks + operationalIssues} health issue(s)</Badge> : <Badge tone="success">Healthy</Badge>}
      />

      <Card title="Data freshness" className="mb-5">
        <div className="grid gap-2 lg:grid-cols-3">
          {operational.snapshots.map((item) => (
            <div key={item.key} className="rounded-md border border-line-subtle bg-surface px-3 py-2">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{item.label}</div>
              <FreshnessInline item={item} />
            </div>
          ))}
        </div>
      </Card>

      <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Global snapshot</div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard label="Global Cost Basis" value={fmtKrw(overview.totals.global_base_cost)} accent />
        <StatCard
          label="Global Unrealized G/L"
          value={fmtKrw(overview.totals.global_base_unrealized_gl)}
          hint={`${fmtNumber(globalUnrealizedPct, 2)}%`}
          tone={overview.totals.global_base_unrealized_gl >= 0 ? 'success' : 'danger'}
        />
        <StatCard
          label="KR Unrealized G/L"
          value={fmtKrw(overview.totals.krw_unrealized_gl)}
          hint={`${fmtKrw(overview.totals.krw_market_value)} market · ${fmtNumber(krUnrealizedPct, 2)}%`}
          tone={overview.totals.krw_unrealized_gl >= 0 ? 'success' : 'danger'}
        />
        <StatCard
          label="US Unrealized G/L"
          value={fmtMoney(overview.totals.usd_unrealized_gl, 'USD')}
          hint={`${fmtMoney(overview.totals.usd_market_value, 'USD')} market · ${fmtNumber(usUnrealizedPct, 2)}%`}
          tone={overview.totals.usd_unrealized_gl >= 0 ? 'success' : 'danger'}
        />
        <StatCard label="KR Cost Basis" value={fmtKrw(overview.totals.krw_cost)} />
        <StatCard label="US Cost Basis" value={fmtMoney(overview.totals.usd_cost, 'USD')} hint={`${fmtMoney(overview.totals.usd_market_value, 'USD')} market`} />
        <StatCard label="Holdings" value={fmtNumber(overview.totals.holding_count)} hint={`${fmtNumber(overview.totals.share_count, 2)} shares`} />
        <StatCard label="Dividends" value={`${fmtKrw(overview.dividends.krw_amount)} / ${fmtMoney(overview.dividends.usd_amount, 'USD')}`} hint={`${fmtNumber(overview.dividends.count)} rows`} tone="success" />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Market allocation">
          <div className="grid min-h-[190px] grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_150px] sm:items-center">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 text-[12px]">
                <span className="flex items-center gap-2 font-medium text-ink">
                  <span className="h-2.5 w-2.5 rounded-full bg-success" aria-hidden />
                  Korea
                </span>
                <span className="tabular-nums text-ink-3">{krShare}%</span>
              </div>
              <div className="text-[18px] font-medium tabular-nums text-ink">{fmtKrw(krBase)}</div>
              <div className="flex items-center justify-between gap-3 text-[12px]">
                <span className="flex items-center gap-2 font-medium text-ink">
                  <span className="h-2.5 w-2.5 rounded-full bg-info" aria-hidden />
                  United States
                </span>
                <span className="tabular-nums text-ink-3">{usShare}%</span>
              </div>
              <div className="text-[18px] font-medium tabular-nums text-ink">{fmtKrw(usBase)}</div>
              <div className="rounded-md bg-surface px-3 py-2 text-[11px] leading-relaxed text-ink-3">
                USD values use {usdKrw ? `USD/KRW ${fmtNumber(usdKrw.rate, 2)} (${usdKrw.as_of_date})` : 'the configured FX snapshot'}.
              </div>
            </div>
            <AllocationPieChart data={allocationData} height={170} />
          </div>
        </Card>

        <Card title="Concentration">
          <div className="flex h-full min-h-[190px] flex-col justify-center">
            <div className="text-[44px] font-medium leading-none tabular-nums text-ink">{topFiveShare}%</div>
            <div className="mt-1 text-[12px] text-ink-3">top 5 cost-basis concentration</div>
            <div className="mt-5 space-y-2">
              {largestPositions.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 text-[12px]">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge tone={p.market === 'US' ? 'info' : 'success'}>{p.market}</Badge>
                    <span className="min-w-0 truncate text-ink">{p.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-ink-3">{p.ticker}</span>
                  </div>
                  <span className="shrink-0 tabular-nums text-ink-3">{fmtKrw(p.base_cost ?? 0)}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Term mix">
          <div className="flex h-full min-h-[190px] flex-col justify-center">
            <div className="text-[44px] font-medium leading-none tabular-nums text-ink">{longTermPct}%</div>
            <div className="mt-1 text-[12px] text-ink-3">long-term quantity share</div>
            <div className="mt-5 h-2 overflow-hidden rounded-pill bg-surface">
              <div className="h-full rounded-pill bg-success" style={{ width: `${longTermPct}%` }} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
              <div>
                <div className="text-ink-3">Long-term</div>
                <div className="font-medium tabular-nums text-ink">{fmtNumber(overview.totals.long_term_qty)}</div>
              </div>
              <div>
                <div className="text-ink-3">Short-term</div>
                <div className="font-medium tabular-nums text-ink">{fmtNumber(overview.totals.short_term_qty)}</div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Top holdings by base cost">
          <TrendBarChart
            data={topHoldingChartData}
            xKey="name"
            yKey="value"
            height={240}
            multicolor
          />
          <p className="mt-2 text-[11px] text-ink-3">Bar values are KRW millions after applying the configured FX snapshot.</p>
        </Card>

        <Card title="Dividend trend">
          <TrendBarChart
            data={dividendYears.map((r) => ({ year: `${r.currency} ${r.year}`, amount: Math.round(r.currency === 'KRW' ? r.amount / 1000 : r.amount) }))}
            xKey="year"
            yKey="amount"
            height={240}
            color="var(--accent-success)"
          />
          <p className="mt-2 text-[11px] text-ink-3">KR bars are KRW thousands; US bars are native USD.</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Account allocation">
          {accounts.length === 0 ? (
            <EmptyState>No account data</EmptyState>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {accounts.map((a) => (
                <li key={a.account} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1 truncate text-[13px] text-ink">{a.account}</div>
                  <div className="text-[12px] tabular-nums text-ink-3">{a.count} holdings</div>
                  <div className="w-36 text-right text-[12px] font-medium tabular-nums text-ink">{fmtMoney(a.value, a.currency)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Largest positions">
          <ul className="divide-y divide-line-subtle">
            {largestPositions.map((h) => (
              <li key={h.id} className="flex items-center gap-3 py-2">
                <Badge tone={h.market === 'US' ? 'info' : 'success'}>{h.market}</Badge>
                <Badge tone="neutral">{h.ticker}</Badge>
                <Link href={positionHref(h.market, h.ticker)} className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink hover:underline">
                  {h.name}
                </Link>
                <span className="text-[12px] tabular-nums text-ink-3">{fmtKrw(h.base_cost ?? 0)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Transaction types">
          <ul className="divide-y divide-line-subtle">
            {txTypes.map((t) => (
              <li key={`${t.market}:${t.type}`} className="flex items-center justify-between gap-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge tone={t.market === 'US' ? 'info' : 'success'}>{t.market}</Badge>
                  <Badge tone={t.type === 'DIVIDEND' ? 'success' : t.type === 'SELL' ? 'warning' : 'info'}>
                    {t.type}
                  </Badge>
                </div>
                <span className="text-[12px] tabular-nums text-ink-3">{fmtNumber(t.count)} rows</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}
