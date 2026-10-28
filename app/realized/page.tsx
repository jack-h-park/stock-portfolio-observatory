import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { DataTable } from '@/components/DataTable'
import { FilterBar } from '@/components/FilterBar'
import { Badge, Card, Label, Signed, marketTone } from '@/components/ui'
import { getRealizedLots } from '@/lib/adapters/portfolio-db'
import { formatKrw, formatUsd } from '@/lib/currency'
import { fmtNumber, fmtQuantity } from '@/lib/format'
import { getLanguage } from '@/lib/i18n-server'
import { positionHref } from '@/lib/position-url'
import { ALL_YEARS, sumRealized, type RealizedLotView } from '@/lib/realized-lots'
import { queryRealized, REALIZED_GROUPS } from '@/lib/realized-lots-query'
import { getPageCopy, getUiCopy } from '@/lib/ui-copy'
import { formatSort, parseSort, sortRows, type TableSort } from '@/lib/table-sort'
import { withParam } from '@/lib/table-filter'
import { bucketTone } from '@/lib/tone'
import { routeMetadata, routeSection } from '@/lib/page-names'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/realized')

const BASE = '/realized'

export default async function RealizedLotsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const language = await getLanguage()
  const copy = getPageCopy('realized', language)
  const rows = getRealizedLots()

  const { years, defaultYear, year, selected, options, query, inYear, filtered } = queryRealized(
    rows,
    params,
    String(new Date().getFullYear())
  )
  const rawCurrency = Array.isArray(params.ccy) ? params.ccy[0] : params.ccy
  const currency: 'krw' | 'usd' = rawCurrency === 'usd' ? 'usd' : 'krw'
  const usd = currency === 'usd'
  // Newest sale first: the question this page answers is what closed lately.
  const sort = parseSort(params.sort, { key: 'sold_date', direction: 'desc' })
  const sorted = sortRows(filtered, sort, (row, key) => (row as Record<string, any>)[key])
  const totals = sumRealized(filtered)

  const money = (krw: number | null, dollars: number | null) => (usd ? (dollars == null ? null : formatUsd(dollars)) : formatKrw(krw))
  const exportParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    const single = Array.isArray(value) ? value[0] : value
    if (single != null && key !== 'sort' && key !== 'ccy') exportParams.set(key, single)
  }
  // Pin the year the table is showing, so the file matches it even when that year was a default.
  exportParams.set('year', year)
  const exportHref = `${BASE}/export?${exportParams.toString()}`

  const yearOptions = [
    ...years.map((value) => ({ value, label: value })),
    { value: ALL_YEARS, label: copy.allYears },
  ]
  const termLabel = (value: string) => copy.terms[value] ?? value

  return (
    <>
      <PageHeader
        eyebrow={routeSection('/realized', language)}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle}
      />
      <Card title={copy.card}>
        <div className="space-y-3">
          <FilterBar
            basePath={BASE}
            params={params}
            search={{ key: 'q', label: getUiCopy(language).common.search, placeholder: copy.searchPlaceholder, value: query }}
            groups={[
              {
                key: 'year',
                label: copy.filters.year,
                options: yearOptions,
                selected: year,
                defaultValue: defaultYear,
              },
              ...REALIZED_GROUPS.map((group) => ({
                key: group.key,
                label: copy.filters[group.label as 'market' | 'broker' | 'term'],
                options: options[group.key].map((value: string) => ({ value, label: group.key === 'term' ? termLabel(value) : value })),
                selected: selected[group.key],
              })),
              {
                key: 'ccy',
                label: copy.filters.currency,
                options: [
                  { value: 'krw', label: copy.currency.krw },
                  { value: 'usd', label: copy.currency.usd },
                ],
                selected: currency,
                defaultValue: 'krw',
              },
            ]}
          />
          <div className="grid gap-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-caption sm:grid-cols-4">
            <div>
              <Label>{copy.filtered}</Label>
              <div className="font-medium tabular-nums text-ink">
                {fmtNumber(filtered.length)} / {fmtNumber(inYear.length)}
              </div>
            </div>
            <div>
              <Label>{copy.totals.cost}</Label>
              <div className="font-medium tabular-nums text-ink">{usd ? formatUsd(totals.cost_usd) : formatKrw(totals.cost_krw)}</div>
            </div>
            <div>
              <Label>{copy.totals.proceeds}</Label>
              <div className="font-medium tabular-nums text-ink">{usd ? formatUsd(totals.proceeds_usd) : formatKrw(totals.proceeds_krw)}</div>
            </div>
            <div>
              <Label>{copy.totals.gain}</Label>
              <div className="font-medium">
                <Signed value={usd ? totals.gain_usd : totals.gain_krw} format={(m) => (usd ? formatUsd(m) : formatKrw(m))} />
              </div>
            </div>
          </div>
          {usd && totals.missing_usd > 0 ? (
            <p className="text-caption text-ink-3">{copy.totals.missing(fmtNumber(totals.missing_usd))}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={exportHref}
              prefetch={false}
              className="inline-flex min-h-8 items-center rounded-sm border border-line bg-card px-2.5 text-label font-medium text-ink-2 hover:border-ink-3 hover:bg-surface hover:text-ink"
            >
              {copy.export}
            </Link>
            <span className="max-w-3xl text-caption text-ink-3">{copy.exportNote}</span>
          </div>
          <DataTable
            rows={sorted}
            sort={sort}
            sortHref={(next: TableSort) => withParam(BASE, params, 'sort', formatSort(next))}
            columns={[
              { key: 'market', label: copy.columns.market, sortable: true, sortFirst: 'asc', render: (r: RealizedLotView) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
              { key: 'brokerage', label: copy.columns.broker, sortable: true, sortFirst: 'asc' },
              { key: 'account', label: copy.columns.account, sortable: true, sortFirst: 'asc', priority: 'secondary' },
              {
                key: 'ticker',
                label: copy.columns.instrument,
                sortable: true,
                sortFirst: 'asc',
                sortValue: (r: RealizedLotView) => r.name ?? r.ticker,
                render: (r: RealizedLotView) => (
                  <Link href={positionHref(r.market, r.ticker)} className="block min-w-[10rem] hover:underline">
                    <span className="font-mono text-caption text-info">{r.ticker}</span>
                    <span className="mt-1 block max-w-[16rem] truncate text-caption font-medium text-ink">{r.name}</span>
                  </Link>
                ),
              },
              { key: 'acquired_date', label: copy.columns.acquired, sortable: true, nowrap: true },
              { key: 'sold_date', label: copy.columns.sold, sortable: true, nowrap: true },
              { key: 'quantity_sold', label: copy.columns.quantity, align: 'right', sortable: true, render: (r: RealizedLotView) => fmtQuantity(r.quantity_sold, 2) },
              {
                key: usd ? 'cost_usd' : 'cost_basis_krw',
                label: copy.columns.cost,
                align: 'right',
                sortable: true,
                render: (r: RealizedLotView) => money(r.cost_basis_krw, r.cost_usd) ?? '—',
              },
              {
                key: usd ? 'proceeds_usd' : 'proceeds_krw',
                label: copy.columns.proceeds,
                align: 'right',
                sortable: true,
                render: (r: RealizedLotView) => (
                  <span title={usd && r.rate_approximate ? copy.approximateRate : undefined}>
                    {money(r.proceeds_krw, r.proceeds_usd) ?? '—'}
                    {usd && r.rate_approximate ? '*' : ''}
                  </span>
                ),
              },
              {
                key: usd ? 'gain_usd' : 'realized_gl_krw',
                label: copy.columns.gain,
                align: 'right',
                sortable: true,
                render: (r: RealizedLotView) => (
                  <Signed value={usd ? r.gain_usd : r.realized_gl_krw} format={(m) => (usd ? formatUsd(m) : formatKrw(m))} />
                ),
              },
              { key: 'holding_days', label: copy.columns.days, align: 'right', sortable: true, priority: 'secondary' },
              {
                key: 'tax_term',
                label: copy.columns.term,
                sortable: true,
                sortFirst: 'asc',
                render: (r: RealizedLotView) => <Badge tone={bucketTone(r.tax_term)}>{termLabel(r.tax_term ?? '') || copy.unknownTerm}</Badge>,
              },
              {
                key: 'basis',
                label: copy.columns.basis,
                sortable: true,
                sortFirst: 'asc',
                priority: 'tertiary',
                render: (r: RealizedLotView) => copy.bases[r.basis ?? ''] ?? r.basis ?? '',
              },
            ]}
          />
        </div>
      </Card>
    </>
  )
}
