import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { TrendBarChart } from '@/components/charts'
import { Badge, Card, EmptyState, MetricField, MetricHeroCard, marketTone } from '@/components/ui'
import { getIncomeReview } from '@/lib/adapters/portfolio-db'
import { fmtKrw, fmtMoney, fmtNumber } from '@/lib/format'
import { positionHref } from '@/lib/position-url'

export const dynamic = 'force-dynamic'

function pct(value: number | null | undefined) {
  return value == null ? 'n/a' : `${fmtNumber(value, 2)}%`
}

export default function IncomePage() {
  const income = getIncomeReview()
  const latestMonth = income.byMonth[income.byMonth.length - 1]

  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="Income Review"
        emphasis="Income"
        subtitle={`${fmtNumber(income.totals.row_count)} income rows across KR and US sources. Latest month: ${latestMonth?.month ?? 'n/a'}.`}
        action={income.totals.tickerless_count ? <Badge tone="warning">{fmtNumber(income.totals.tickerless_count)} tickerless row(s)</Badge> : <Badge tone="success">Ticker-mapped</Badge>}
      />

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.9fr)]">
        <MetricHeroCard
          title="Trailing 12M Income"
          info="Income received over the last twelve months, converted to KRW. Use this as the headline income run-rate."
          eyebrow="Income run-rate"
          value={fmtKrw(income.totals.trailing_12m_base_income)}
          hint="KRW base income after applying FX"
        >
          <div className="grid gap-4 border-t border-line-subtle pt-4 sm:grid-cols-3">
            <MetricField
              label="YTD Income"
              value={fmtKrw(income.totals.ytd_base_income)}
              hint={`Latest month ${latestMonth?.month ?? 'n/a'}`}
              tone="success"
              valueClassName="text-[18px]"
            />
            <MetricField
              label="Yield on Market"
              value={pct(income.totals.yield_on_market)}
              hint="Income divided by market value"
              valueClassName="text-[18px]"
            />
            <MetricField
              label="Yield on Cost"
              value={pct(income.totals.yield_on_cost)}
              hint="Income divided by cost basis"
              valueClassName="text-[18px]"
            />
          </div>
        </MetricHeroCard>

        <Card title="Income Coverage" info="Native-currency source totals and unmapped rows that can affect position-level income analysis.">
          <div className="flex min-h-[16rem] flex-col justify-between gap-4">
            <div className="space-y-4">
              <MetricField
                label="KRW / USD Native"
                value={`${fmtMoney(income.totals.krw_income, 'KRW')} / ${fmtMoney(income.totals.usd_income, 'USD')}`}
                hint={`${fmtNumber(income.totals.row_count)} source rows`}
                valueClassName="text-[18px]"
              />
              <div className="h-px bg-line-subtle" />
              <MetricField
                label="Tickerless Rows"
                value={fmtNumber(income.totals.tickerless_count)}
                hint="Included in totals, excluded from position yield rankings"
                tone={income.totals.tickerless_count ? 'warning' : 'success'}
                valueClassName="text-[28px]"
              />
            </div>
            <div className="rounded-md bg-surface px-3 py-2 text-[11px] leading-relaxed text-ink-3">
              Read order: run-rate first, then yield, then mapping coverage.
            </div>
          </div>
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Income mix">
          <div className="grid gap-3 text-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-ink-3">Dividend / distribution</span>
              <span className="font-medium tabular-nums text-ink">{fmtKrw(income.totals.dividend_base_income)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-3">Interest</span>
              <span className="font-medium tabular-nums text-ink">{fmtKrw(income.totals.interest_base_income)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-3">Other income</span>
              <span className="font-medium tabular-nums text-ink">{fmtKrw(income.totals.other_base_income)}</span>
            </div>
          </div>
        </Card>

        <Card title="Market income">
          <ul className="divide-y divide-line-subtle">
            {income.byMarket.map((row) => (
              <li key={`${row.market}:${row.currency}`} className="flex items-center gap-3 py-2 text-[12px]">
                <Badge tone={marketTone(row.market)}>{row.market}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="font-medium tabular-nums text-ink">{fmtKrw(row.base_income)}</div>
                  <div className="text-[11px] text-ink-3">{fmtMoney(row.native_income, row.currency)} native · {fmtNumber(row.row_count)} rows</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Data quality">
          <div className="grid gap-3 text-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-ink-3">Ticker-mapped rows</span>
              <span className="font-medium tabular-nums text-success">{fmtNumber(income.totals.row_count - income.totals.tickerless_count)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-3">Tickerless rows</span>
              <span className={income.totals.tickerless_count ? 'font-medium tabular-nums text-warning' : 'font-medium tabular-nums text-success'}>
                {fmtNumber(income.totals.tickerless_count)}
              </span>
            </div>
            <div className="text-[11px] leading-relaxed text-ink-3">
              Tickerless rows are kept in income totals but excluded from position yield rankings until mapped.
            </div>
          </div>
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Monthly income trend">
          <TrendBarChart
            data={income.byMonth.map((row) => ({ month: row.month.slice(2), income: Math.round(row.base_income / 1000) }))}
            xKey="month"
            yKey="income"
            height={300}
            color="var(--accent-success)"
            yAxisPrefix="₩"
            yAxisSuffix="K"
            yAxisLabel="KRW thousand"
          />
          <p className="mt-2 text-[11px] text-ink-3">Values are KRW thousands after applying the configured FX snapshot.</p>
        </Card>

        <Card title="Yearly native totals">
          <DataTable
            rows={income.byYear}
            columns={[
              { key: 'year', label: 'Year' },
              { key: 'currency', label: 'Currency' },
              { key: 'row_count', label: 'Rows', align: 'right', render: (r) => fmtNumber(r.row_count) },
              { key: 'native_income', label: 'Native', align: 'right', render: (r) => fmtMoney(r.native_income, r.currency) },
              { key: 'base_income', label: 'Base', align: 'right', render: (r) => fmtKrw(r.base_income) },
            ]}
          />
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5">
        <Card title="Top income positions">
          <DataTable
            rows={income.byPosition}
            columns={[
              {
                key: 'ticker',
                label: 'Position',
                render: (r) => (
                  <div className="min-w-[14rem]">
                    <div className="flex items-center gap-2">
                      <Badge tone={marketTone(r.market)}>{r.market}</Badge>
                      <Link href={positionHref(r.market, r.ticker)} className="font-mono text-[12px] font-medium text-info hover:underline">
                        {r.ticker}
                      </Link>
                    </div>
                    <div className="mt-1 max-w-[20rem] truncate text-[12px] font-medium text-ink">{r.name}</div>
                  </div>
                ),
              },
              { key: 'row_count', label: 'Rows', align: 'right', render: (r) => fmtNumber(r.row_count) },
              { key: 'native_income', label: 'Native Income', align: 'right', render: (r) => fmtMoney(r.native_income, r.currency) },
              { key: 'base_income', label: 'Base Income', align: 'right', render: (r) => fmtKrw(r.base_income) },
              { key: 'market_value', label: 'Market Value', align: 'right', render: (r) => (r.market_value == null ? 'n/a' : fmtKrw(r.market_value)) },
              { key: 'trailing_yield', label: 'Yield', align: 'right', render: (r) => pct(r.trailing_yield) },
              { key: 'yield_on_cost', label: 'Yield on Cost', align: 'right', render: (r) => pct(r.yield_on_cost) },
            ]}
          />
        </Card>

        <Card title="Tickerless income rows" accent={income.tickerless.length > 0}>
          {income.tickerless.length === 0 ? (
            <EmptyState ok>All income rows are ticker-mapped</EmptyState>
          ) : (
            <DataTable
              rows={income.tickerless}
              columns={[
                { key: 'market', label: 'Market', render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
                { key: 'type', label: 'Type' },
                { key: 'name', label: 'Name' },
                { key: 'row_count', label: 'Rows', align: 'right', render: (r) => fmtNumber(r.row_count) },
                { key: 'native_income', label: 'Native', align: 'right', render: (r) => fmtMoney(r.native_income, r.currency) },
                { key: 'base_income', label: 'Base', align: 'right', render: (r) => fmtKrw(r.base_income) },
              ]}
            />
          )}
        </Card>
      </div>
    </>
  )
}
