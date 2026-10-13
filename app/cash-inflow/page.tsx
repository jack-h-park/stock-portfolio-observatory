import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { FilterBar } from '@/components/FilterBar'
import { PageHeader } from '@/components/PageHeader'
import { StackedBarChart } from '@/components/charts'
import { Badge, Button, Card, MetricField, MetricHeroCard } from '@/components/ui'
import {
  CASH_INFLOW_FILTERS,
  cashInflowCategories,
  getCashInflow,
  getCashInflowRows,
  type CashInflowCategory,
  type CashInflowFilter,
  type CashInflowPeriod,
  type CashInflowRow,
} from '@/lib/adapters/portfolio-db'
import { fmtNumber, fmtPct } from '@/lib/format'
import { salarySharePct } from '@/lib/cash-inflow-format'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { getLanguage } from '@/lib/i18n-server'
import { getPageCopy } from '@/lib/ui-copy'
import { routeMetadata, routeSection } from '@/lib/page-names'
import { CardRow, KpiBand } from '@/components/layout'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/cash-inflow')

const BASE = '/cash-inflow'
const DETAIL_PATTERN = /^\d{4}(-\d{2})?$/
const CATEGORY_COLOR: Record<CashInflowCategory, string> = {
  salary: 'var(--brand-blue)',
  dividend: 'var(--accent-success)',
  interest: 'var(--accent-warning)',
  other: 'var(--text-tertiary)',
  unclassified: 'var(--accent-danger)',
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function CashInflowPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const view = first(params.view) === 'year' ? 'year' : 'month'
  const filterParam = first(params.category)
  const filter: CashInflowFilter = CASH_INFLOW_FILTERS.includes(filterParam as CashInflowFilter) ? (filterParam as CashInflowFilter) : 'All'
  const detailParam = first(params.detail)
  // A month under the yearly view (or a year under the monthly one) matches no row.
  const detail = detailParam && DETAIL_PATTERN.test(detailParam) && detailParam.length === (view === 'month' ? 7 : 4) ? detailParam : null
  const detailCategoryParam = first(params.detailCategory)

  const language = await getLanguage()
  const currencyPreferences = await getCurrencyPreferences()
  const money = createMoneyFormatter(currencyPreferences)
  const usd = currencyPreferences.displayCurrency === 'USD'
  const chartDivisor = usd ? 1 : 1000
  const chartRound = (value: number) => (usd ? Math.round((value / chartDivisor) * 100) / 100 : Math.round(value / chartDivisor))
  const copy = getPageCopy('cashInflow', language)
  const data = getCashInflow(view, currencyPreferences.displayCurrency, undefined, filter)
  const categories = cashInflowCategories(filter)
  // Under All the unclassified column stays visible, muted, as a to-do.
  const tableCategories: CashInflowCategory[] = filter === 'All' ? [...categories, 'unclassified'] : categories
  const showTotal = categories.length > 1
  // A drill-down into a category the table does not show belongs to another filter.
  const detailCategory = tableCategories.includes(detailCategoryParam as CashInflowCategory) ? (detailCategoryParam as CashInflowCategory) : null
  const chartPeriods = view === 'month' ? data.periods.slice(-24) : data.periods

  // The drill-down for a whole period lists what the row's Total counts, so its
  // subtotal matches it; unclassified rows open from their own cell.
  const detailCategories = detailCategory ? [detailCategory] : categories
  const detailRows = detail ? getCashInflowRows(detail, currencyPreferences.displayCurrency, detailCategories) : []
  const detailLabel = detailCategory ? copy.categories[detailCategory] : copy.filter.options[filter]

  const href = (next: { view?: string; detail?: string | null; detailCategory?: CashInflowCategory | null }) => {
    const q = new URLSearchParams()
    q.set('view', next.view ?? view)
    if (filter !== 'All') q.set('category', filter)
    if (next.detail) q.set('detail', next.detail)
    if (next.detail && next.detailCategory) q.set('detailCategory', next.detailCategory)
    return `${BASE}?${q.toString()}`
  }
  // Changing the filter closes any open drill-down: its rows belonged to the old selection.
  const filterParams = { view }

  const reasonText = (r: CashInflowRow) => {
    if (r.reasonKind === 'rule') return copy.reasons.rule(r.reason ?? '')
    if (r.reasonKind === 'broker' && r.reason) return copy.reasons.broker(r.reason)
    if (r.reasonKind === 'default') return r.category === 'dividend' ? copy.reasons.defaultDividend : copy.reasons.defaultInterest
    return copy.reasons.none
  }

  const amountCell = (p: CashInflowPeriod, c: CashInflowCategory) => {
    const text = money(p[c], data.currency)
    const muted = c === 'unclassified' && filter === 'All'
    if (!p[c]) return <span className="text-ink-3">{text}</span>
    const current = detail === p.period && detailCategory === c
    return (
      <Link
        href={current ? href({}) : href({ detail: p.period, detailCategory: c })}
        scroll={false}
        aria-label={copy.cellLink(text, p.period, copy.categories[c])}
        aria-current={current ? 'true' : undefined}
        className={`rounded-sm hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-info/40 ${current ? 'font-semibold text-info' : muted ? 'text-ink-3' : 'text-info'}`}
      >
        {text}
      </Link>
    )
  }

  const detailPanel = () => {
    const subtotal = detailRows.reduce((s, r) => s + r.amount, 0)
    // The period table scrolls sideways on a phone; pinning the panel to the
    // visible width keeps its title, close link and own table on screen.
    return (
      <div className="sticky left-0 flex max-w-[calc(100vw-4rem)] flex-col gap-2 md:max-w-none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-body font-medium text-ink">{copy.detailTitle(detail!, detailLabel, fmtNumber(detailRows.length), money(subtotal, data.currency))}</p>
          <Link href={href({})} scroll={false} className="text-label font-medium text-info hover:underline">
            {copy.close}
          </Link>
        </div>
        <DataTable
          rows={detailRows}
          minWidth="40rem"
          getRowKey={(_r, i) => `${detail}:${i}`}
          columns={[
            { key: 'date', label: copy.columns.date, nowrap: true },
            ...(detailCategory ? [] : [{ key: 'category', label: copy.columns.category, render: (r: CashInflowRow) => copy.categories[r.category] }]),
            { key: 'label', label: copy.columns.label },
            { key: 'account', label: copy.columns.account, priority: 'tertiary' as const },
            { key: 'native', label: copy.columns.native, align: 'right' as const, priority: 'secondary' as const, render: (r: CashInflowRow) => `${fmtNumber(r.native, r.currency === 'KRW' ? 0 : 2)} ${r.currency}` },
            { key: 'amount', label: copy.columns.amount, align: 'right' as const, render: (r: CashInflowRow) => money(r.amount, data.currency) },
            { key: 'reason', label: copy.reasonColumn, render: (r: CashInflowRow) => <span className="text-ink-3">{reasonText(r)}</span> },
          ]}
        />
      </div>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow={routeSection('/cash-inflow', language)}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {data.unclassifiedCount > 0 ? (
              <span title={copy.unclassifiedHint}>
                <Badge tone="warning">{copy.unclassified(fmtNumber(data.unclassifiedCount))}</Badge>
              </span>
            ) : null}
            {data.undatedCount > 0 ? <Badge tone="warning">{copy.undated(fmtNumber(data.undatedCount))}</Badge> : null}
            <Button href={href({ view: 'month' })} variant={view === 'month' ? 'solid' : 'outline'}>{copy.monthly}</Button>
            <Button href={href({ view: 'year' })} variant={view === 'year' ? 'solid' : 'outline'}>{copy.yearly}</Button>
          </div>
        }
      />

      <FilterBar
        basePath={BASE}
        params={filterParams}
        groups={[{
          key: 'category',
          label: copy.filter.label,
          options: CASH_INFLOW_FILTERS.map((value) => ({ value, label: copy.filter.options[value] })),
          selected: filter,
        }]}
      />

      {!data.hasBankData ? (
        <div className="rounded-md bg-surface px-3 py-2 text-label leading-relaxed text-ink-3">{copy.noBankData}</div>
      ) : null}
      {filter === 'investment' ? <p className="text-label text-ink-3">{copy.investmentInfo}</p> : null}
      {filter === 'unclassified' ? <p className="text-label text-ink-3">{copy.unclassifiedFilterNote}</p> : null}

      <CardRow columns={1}>
        <MetricHeroCard
          title={copy.trailing12m}
          info={filter === 'All' ? copy.trailing12mInfo : copy.trailing12mFilteredInfo(copy.filter.options[filter])}
          eyebrow={filter === 'All' ? copy.headlineEyebrow : copy.filter.options[filter]}
          value={money(data.totals.trailing12m, data.currency)}
        >
          <KpiBand>
            {/* Unclassified money is a to-do, not income: no success tone, no average. */}
            <MetricField label={copy.ytd} value={money(data.totals.ytd, data.currency)} tone={filter === 'unclassified' ? undefined : 'success'} valueClassName="text-title" />
            {filter === 'unclassified' ? null : (
              <MetricField label={copy.monthlyAverage} value={money(data.totals.monthlyAverage12m, data.currency)} valueClassName="text-title" />
            )}
            {filter === 'All' ? (
              <MetricField label={copy.salaryShare} value={fmtPct(salarySharePct(data.totals.salaryShare12m), { nullText: copy.notAvailable })} valueClassName="text-title" />
            ) : null}
          </KpiBand>
        </MetricHeroCard>
      </CardRow>

      <CardRow columns={1}>
        <Card title={copy.trendCard}>
          <StackedBarChart
            data={chartPeriods.map((p) => ({
              period: view === 'month' ? p.period.slice(2) : p.period,
              ...Object.fromEntries(categories.map((c) => [c, chartRound(p[c])])),
            }))}
            xKey="period"
            series={categories.map((c) => ({ key: c, label: copy.categories[c], color: CATEGORY_COLOR[c] }))}
            height={300}
            yAxisPrefix={usd ? '$' : '₩'}
            yAxisSuffix={usd ? '' : 'K'}
            yAxisLabel={usd ? copy.axisUsd : copy.axisKrw}
            allowDecimals={usd}
          />
          <p className="mt-2 text-label text-ink-3">{copy.chartNote}</p>
        </Card>
      </CardRow>

      <CardRow columns={1}>
        <Card title={copy.tableCard}>
          <DataTable
            rows={[...data.periods].reverse()}
            getRowKey={(r) => r.period}
            expandedRowKey={detail}
            renderExpanded={detailPanel}
            columns={[
              {
                key: 'period',
                label: copy.columns.period,
                render: (r: CashInflowPeriod) => (
                  <Link
                    href={detail === r.period && !detailCategory ? href({}) : href({ detail: r.period })}
                    scroll={false}
                    className="font-mono text-caption font-medium text-info hover:underline"
                  >
                    {r.period}
                  </Link>
                ),
              },
              ...tableCategories.map((c) => ({
                key: c,
                label: copy.categories[c],
                align: 'right' as const,
                render: (r: CashInflowPeriod) => amountCell(r, c),
              })),
              ...(showTotal ? [{ key: 'total', label: copy.columns.total, align: 'right' as const, render: (r: CashInflowPeriod) => money(r.total, data.currency) }] : []),
            ]}
          />
        </Card>
      </CardRow>
    </>
  )
}
