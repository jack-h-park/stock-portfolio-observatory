import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { StackedBarChart } from '@/components/charts'
import { Badge, Button, Card, MetricField, MetricHeroCard } from '@/components/ui'
import { getCashInflow, getCashInflowRows } from '@/lib/adapters/portfolio-db'
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

const DETAIL_PATTERN = /^\d{4}(-\d{2})?$/
const CHART_CATEGORIES = [
  { key: 'salary', color: 'var(--brand-blue)' },
  { key: 'dividend', color: 'var(--accent-success)' },
  { key: 'interest', color: 'var(--accent-warning)' },
  { key: 'other', color: 'var(--text-tertiary)' },
] as const

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
  const detailParam = first(params.detail)
  const detail = detailParam && DETAIL_PATTERN.test(detailParam) ? detailParam : null

  const language = await getLanguage()
  const currencyPreferences = await getCurrencyPreferences()
  const money = createMoneyFormatter(currencyPreferences)
  const usd = currencyPreferences.displayCurrency === 'USD'
  const chartDivisor = usd ? 1 : 1000
  const chartRound = (value: number) => (usd ? Math.round((value / chartDivisor) * 100) / 100 : Math.round(value / chartDivisor))
  const copy = getPageCopy('cashInflow', language)
  const data = getCashInflow(view, currencyPreferences.displayCurrency)
  const detailRows = detail ? getCashInflowRows(detail, currencyPreferences.displayCurrency) : []
  const chartPeriods = view === 'month' ? data.periods.slice(-24) : data.periods
  const periodHref = (period: string) => `/cash-inflow?view=${view}&detail=${period}`

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
            <Button href="/cash-inflow?view=month" variant={view === 'month' ? 'solid' : 'outline'}>{copy.monthly}</Button>
            <Button href="/cash-inflow?view=year" variant={view === 'year' ? 'solid' : 'outline'}>{copy.yearly}</Button>
          </div>
        }
      />

      {!data.hasBankData ? (
        <div className="rounded-md bg-surface px-3 py-2 text-label leading-relaxed text-ink-3">{copy.noBankData}</div>
      ) : null}

      <CardRow columns={1}>
        <MetricHeroCard
          title={copy.trailing12m}
          info={copy.trailing12mInfo}
          eyebrow={copy.headlineEyebrow}
          value={money(data.totals.trailing12m, data.currency)}
        >
          <KpiBand>
            <MetricField label={copy.ytd} value={money(data.totals.ytd, data.currency)} tone="success" valueClassName="text-title" />
            <MetricField label={copy.monthlyAverage} value={money(data.totals.monthlyAverage12m, data.currency)} valueClassName="text-title" />
            <MetricField label={copy.salaryShare} value={fmtPct(salarySharePct(data.totals.salaryShare12m), { nullText: copy.notAvailable })} valueClassName="text-title" />
          </KpiBand>
        </MetricHeroCard>
      </CardRow>

      <CardRow columns={1}>
        <Card title={copy.trendCard}>
          <StackedBarChart
            data={chartPeriods.map((p) => ({
              period: view === 'month' ? p.period.slice(2) : p.period,
              salary: chartRound(p.salary),
              dividend: chartRound(p.dividend),
              interest: chartRound(p.interest),
              other: chartRound(p.other),
            }))}
            xKey="period"
            series={CHART_CATEGORIES.map((c) => ({ key: c.key, label: copy.categories[c.key], color: c.color }))}
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
            columns={[
              {
                key: 'period',
                label: copy.columns.period,
                render: (r) => (
                  <Link href={periodHref(r.period)} className="font-mono text-caption font-medium text-info hover:underline">
                    {r.period}
                  </Link>
                ),
              },
              ...CHART_CATEGORIES.map((c) => ({
                key: c.key,
                label: copy.categories[c.key],
                align: 'right' as const,
                render: (r: (typeof data.periods)[number]) => money(r[c.key], data.currency),
              })),
              {
                // Not in the total: shown muted so it reads as a to-do, not income.
                key: 'unclassified',
                label: copy.categories.unclassified,
                align: 'right' as const,
                render: (r: (typeof data.periods)[number]) => <span className="text-ink-3">{money(r.unclassified, data.currency)}</span>,
              },
              { key: 'total', label: copy.columns.total, align: 'right' as const, render: (r) => money(r.total, data.currency) },
            ]}
          />
        </Card>
      </CardRow>

      {detail ? (
        <CardRow columns={1}>
          <Card title={copy.detailCard(detail)}>
            <DataTable
              rows={detailRows}
              getRowKey={(_r, i) => `${detail}:${i}`}
              columns={[
                { key: 'date', label: copy.columns.date },
                { key: 'category', label: copy.columns.category, render: (r) => copy.categories[r.category as keyof typeof copy.categories] },
                { key: 'label', label: copy.columns.label },
                { key: 'account', label: copy.columns.account },
                { key: 'native', label: copy.columns.native, align: 'right', render: (r) => `${fmtNumber(r.native, r.currency === 'KRW' ? 0 : 2)} ${r.currency}` },
                { key: 'amount', label: copy.columns.amount, align: 'right', render: (r) => money(r.amount, data.currency) },
              ]}
            />
          </Card>
        </CardRow>
      ) : null}
    </>
  )
}
