import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { FilterBar } from '@/components/FilterBar'
import { PageHeader } from '@/components/PageHeader'
import { ScrollOnHash } from '@/components/ScrollOnHash'
import { StackedBarChart } from '@/components/charts'
import { Badge, Button, Card, MetricField, MetricHeroCard } from '@/components/ui'
import {
  CASH_INFLOW_CURRENCIES,
  CASH_INFLOW_FILTERS,
  CASH_INFLOW_RANGES,
  CASH_INFLOW_SOURCES,
  cashInflowCategories,
  getCashInflow,
  getCashInflowRows,
  getCashInflowUnclassified,
  type CashInflowCategory,
  type CashInflowCurrency,
  type CashInflowFilter,
  type CashInflowRange,
  type CashInflowSource,
  type CashInflowPeriod,
  type CashInflowRow,
} from '@/lib/adapters/portfolio-db'
import { fmtNumber, fmtPct } from '@/lib/format'
import { fractionPct, ruleSnippet } from '@/lib/cash-inflow-format'
import { signClass, signTone } from '@/lib/tone'
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

/** A query value from a fixed list, or the list's default. */
function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

export default async function CashInflowPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const view = first(params.view) === 'year' ? 'year' : 'month'
  const filter = pick<CashInflowFilter>(first(params.category), CASH_INFLOW_FILTERS, 'All')
  const source = pick<CashInflowSource>(first(params.source), CASH_INFLOW_SOURCES, 'All')
  const currency = pick<CashInflowCurrency>(first(params.currency), CASH_INFLOW_CURRENCIES, 'All')
  const range = pick<CashInflowRange>(first(params.range), CASH_INFLOW_RANGES, '12m')
  const scope = { source, currency, range }
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
  const data = getCashInflow(view, currencyPreferences.displayCurrency, undefined, filter, scope)
  const categories = cashInflowCategories(filter)
  // Under All the unclassified column stays visible, muted, as a to-do.
  const tableCategories: CashInflowCategory[] = filter === 'All' ? [...categories, 'unclassified'] : categories
  const showTotal = categories.length > 1
  // A drill-down into a category the table does not show belongs to another filter.
  const detailCategory = tableCategories.includes(detailCategoryParam as CashInflowCategory) ? (detailCategoryParam as CashInflowCategory) : null
  // Periods arrive limited to the range already.
  const chartPeriods = data.periods

  // The drill-down for a whole period lists what the row's Total counts, so its
  // subtotal matches it; unclassified rows open from their own cell.
  const detailCategories = detailCategory ? [detailCategory] : categories
  const detailRows = detail ? getCashInflowRows(detail, currencyPreferences.displayCurrency, detailCategories, scope) : []
  const hasBrokerRows = detailRows.some((r) => r.source === 'dividend')
  const unclassifiedGroups = filter === 'unclassified' ? getCashInflowUnclassified(currencyPreferences.displayCurrency, scope) : []
  const detailLabel = detailCategory ? copy.categories[detailCategory] : copy.filter.options[filter]

  // Only non-default values go in the URL, the way FilterBar's chips write them.
  const scopeParams: Record<string, string> = {
    view,
    ...(filter !== 'All' ? { category: filter } : {}),
    ...(source !== 'All' ? { source } : {}),
    ...(currency !== 'All' ? { currency } : {}),
    ...(range !== '12m' ? { range } : {}),
  }
  const href = (next: { view?: string; category?: CashInflowFilter; detail?: string | null; detailCategory?: CashInflowCategory | null; anchor?: boolean }) => {
    const q = new URLSearchParams({ ...scopeParams, view: next.view ?? view })
    if (next.category) {
      if (next.category === 'All') q.delete('category')
      else q.set('category', next.category)
    }
    if (next.detail) q.set('detail', next.detail)
    if (next.detail && next.detailCategory) q.set('detailCategory', next.detailCategory)
    return `${BASE}?${q.toString()}${next.anchor ? '#cash-inflow-detail' : ''}`
  }
  // Changing a filter closes any open drill-down: its rows belonged to the old selection.
  const filterParams = scopeParams

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
      <div id="cash-inflow-detail" key={`${detail}:${detailCategory ?? ''}`} className="sticky left-0 flex max-w-[calc(100vw-4rem)] scroll-mt-24 flex-col gap-2 md:max-w-none">
        <ScrollOnHash id="cash-inflow-detail" />
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
            // Broker rows only: what the dividend paid before withholding, and what was withheld.
            ...(hasBrokerRows
              ? [
                  { key: 'ticker', label: copy.dividendColumns.ticker, priority: 'secondary' as const, render: (r: CashInflowRow) => r.ticker ?? '' },
                  { key: 'gross', label: copy.dividendColumns.gross, align: 'right' as const, priority: 'secondary' as const, render: (r: CashInflowRow) => (r.gross == null ? '' : `${fmtNumber(r.gross, r.currency === 'KRW' ? 0 : 2)} ${r.currency}`) },
                  { key: 'withheld', label: copy.dividendColumns.withheld, align: 'right' as const, priority: 'secondary' as const, render: (r: CashInflowRow) => (r.withheld == null ? '' : `${fmtNumber(r.withheld, r.currency === 'KRW' ? 0 : 2)} ${r.currency}`) },
                ]
              : []),
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
              // Opens the triage card, keeping the source, currency and range.
              <Link href={`${href({ category: 'unclassified' })}#cash-inflow-unclassified`} title={copy.unclassifiedHint} className="rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-info/40">
                <Badge tone="warning">{copy.unclassified(fmtNumber(data.unclassifiedCount))}</Badge>
              </Link>
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
        groups={[
          { key: 'category', label: copy.filter.label, options: CASH_INFLOW_FILTERS.map((value) => ({ value, label: copy.filter.options[value] })), selected: filter },
          { key: 'source', label: copy.scope.source.label, options: CASH_INFLOW_SOURCES.map((value) => ({ value, label: copy.scope.source.options[value] })), selected: source },
          { key: 'currency', label: copy.scope.currency.label, options: CASH_INFLOW_CURRENCIES.map((value) => ({ value, label: copy.scope.currency.options[value] })), selected: currency },
          { key: 'range', label: copy.scope.range.label, options: CASH_INFLOW_RANGES.map((value) => ({ value, label: copy.scope.range.options[value] })), selected: range, defaultValue: '12m' },
        ]}
      />

      {!data.hasBankData ? (
        <div className="rounded-md bg-surface px-3 py-2 text-label leading-relaxed text-ink-3">{copy.noBankData}</div>
      ) : null}
      {filter === 'investment' ? <p className="text-label text-ink-3">{copy.investmentInfo}</p> : null}
      {filter === 'unclassified' ? <p className="text-label text-ink-3">{copy.unclassifiedFilterNote}</p> : null}

      <CardRow columns={1}>
        <MetricHeroCard
          title={copy.scope.range.options[range]}
          info={copy.rangeInfo(copy.scope.range.options[range], filter === 'All' ? copy.headlineEyebrow : copy.filter.options[filter])}
          eyebrow={filter === 'All' ? copy.headlineEyebrow : copy.filter.options[filter]}
          value={money(data.totals.rangeTotal, data.currency)}
        >
          {/* Unclassified money is a to-do, not income: no average and no comparison, only how much is left to sort. */}
          {filter === 'unclassified' ? (
            <KpiBand>
              <MetricField label={copy.triage.count} value={fmtNumber(data.unclassifiedCount)} valueClassName="text-title" />
              <MetricField label={copy.triage.groups} value={fmtNumber(unclassifiedGroups.length)} valueClassName="text-title" />
            </KpiBand>
          ) : (
            <KpiBand>
              <MetricField label={copy.monthlyAverage} value={money(data.totals.monthlyAverage, data.currency)} valueClassName="text-title" />
              {filter === 'All' ? (
                <>
                  <MetricField label={copy.kpi.salary} value={money(data.totals.salary, data.currency)} valueClassName="text-title" />
                  <MetricField label={copy.kpi.investment} value={money(data.totals.investment, data.currency)} valueClassName="text-title" />
                  <MetricField label={copy.kpi.investmentShare} value={fmtPct(fractionPct(data.totals.investmentShare), { nullText: copy.notAvailable })} valueClassName="text-title" />
                </>
              ) : null}
              <MetricField
                label={copy.kpi.change}
                info={copy.changeInfo}
                value={fmtPct(fractionPct(data.totals.change), { signed: true, nullText: copy.notAvailable })}
                tone={data.totals.change == null ? undefined : signTone(data.totals.change)}
                valueClassName="text-title"
              />
            </KpiBand>
          )}
        </MetricHeroCard>
      </CardRow>

      <CardRow columns={1}>
        <Card title={copy.trendCard}>
          <StackedBarChart
            data={chartPeriods.map((p) => ({
              period: view === 'month' ? p.period.slice(2) : p.period,
              ...Object.fromEntries(categories.map((c) => [c, chartRound(p[c])])),
              // A segment click filters to its category and opens its credits.
              links: Object.fromEntries(categories.map((c) => [c, href({ category: c, detail: p.period, detailCategory: c, anchor: true })])),
            }))}
            linkKey="links"
            toggleable
            xKey="period"
            series={categories.map((c) => ({ key: c, label: copy.categories[c], color: CATEGORY_COLOR[c] }))}
            height={300}
            yAxisPrefix={usd ? '$' : '₩'}
            yAxisSuffix={usd ? '' : 'K'}
            yAxisLabel={usd ? copy.axisUsd : copy.axisKrw}
            allowDecimals={usd}
          />
          <p className="mt-2 text-label text-ink-3">{copy.chartNote} {copy.chartHint} {copy.legendHint}</p>
        </Card>
      </CardRow>

      <CardRow columns={1}>
        <Card title={copy.tableCard}>
          <DataTable
            rows={[...data.periods].reverse()}
            // One or two amount columns need no 48rem floor; they would only scroll sideways.
            minWidth={tableCategories.length <= 2 ? '28rem' : undefined}
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
              // Yearly only: this year's total against the year before's, under the same filter and scope.
              ...(view === 'year' && filter !== 'unclassified'
                ? [{
                    key: 'yoy',
                    label: copy.yoyColumn,
                    align: 'right' as const,
                    render: (r: CashInflowPeriod) => {
                      const change = r.previousTotal != null && r.previousTotal > 0 ? (r.total - r.previousTotal) / r.previousTotal : null
                      return <span className={change == null ? 'text-ink-3' : signClass(change)}>{fmtPct(fractionPct(change), { signed: true, nullText: copy.notAvailable })}</span>
                    },
                  }]
                : []),
            ]}
          />
          {view === 'year' ? (
            <p className="mt-2 text-label text-ink-3">{copy.yearlyNote(data.periods.find((p) => p.previousThrough)?.previousThrough ?? null)}</p>
          ) : null}
        </Card>
      </CardRow>

      {filter === 'unclassified' ? (
        <CardRow columns={1}>
          <Card title={copy.triage.title}>
            <div id="cash-inflow-unclassified" className="flex scroll-mt-24 flex-col gap-3">
              <p className="text-label text-ink-3">{copy.triage.note}</p>
              {unclassifiedGroups.length === 0 ? (
                <p className="text-body text-ink-3">{copy.triage.none}</p>
              ) : (
                unclassifiedGroups.map((g) => (
                  <details key={`${g.institution}|${g.account}|${g.description}`} className="rounded-md border border-line px-3 py-2">
                    <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 text-body">
                      <span className="font-medium text-ink">{g.description || g.account}</span>
                      <span className="text-caption text-ink-3">{g.account} · {copy.triage.group(fmtNumber(g.count), money(g.total, data.currency), g.first, g.last)}</span>
                    </summary>
                    <ul className="mt-2 flex flex-col gap-1 text-caption text-ink-2">
                      {g.rows.map((r, i) => (
                        <li key={i} className="flex justify-between gap-3 tabular-nums">
                          <span>{r.date}</span>
                          <span>{`${fmtNumber(r.native, r.currency === 'KRW' ? 0 : 2)} ${r.currency}`} · {money(r.amount, data.currency)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-micro font-medium text-ink-3">{copy.triage.rule}</p>
                    <pre className="mt-1 overflow-x-auto rounded-sm bg-surface px-2 py-1 text-micro text-ink-2">{ruleSnippet(g)}</pre>
                  </details>
                ))
              )}
            </div>
          </Card>
        </CardRow>
      ) : null}
    </>
  )
}
