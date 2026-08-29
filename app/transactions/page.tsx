import { PageHeader } from '@/components/PageHeader'
import { DataTable } from '@/components/DataTable'
import { FilterBar } from '@/components/FilterBar'
import { Badge, Card, marketTone } from '@/components/ui'
import { getRecentTransactions } from '@/lib/adapters/portfolio-db'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { fmtNumber, fmtQuantity } from '@/lib/format'
import { getLanguage } from '@/lib/i18n-server'
import { getPageCopy, getUiCopy } from '@/lib/ui-copy'
import { applyFilters, applySearch, filterOptions, readFilters, withParam, type FilterGroup } from '@/lib/table-filter'
import { formatSort, parseSort, sortRows, type TableSort } from '@/lib/table-sort'
import type { Tone } from '@/lib/tone'
import { routeMetadata, routeSection } from '@/lib/page-names'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/transactions')

const BASE = '/transactions'

const GROUPS: FilterGroup<any>[] = [
  { key: 'market', label: 'market' },
  { key: 'brokerage', label: 'broker' },
  { key: 'type', label: 'type' },
]

/** A ledger row's kind: money in, money out, everything else. */
function typeTone(type: string): Tone {
  if (type === 'DIVIDEND') return 'success'
  if (type === 'SELL') return 'warning'
  return 'info'
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const language = await getLanguage()
  const copy = getPageCopy('transactions', language)
  const money = createMoneyFormatter(await getCurrencyPreferences())
  const rows = getRecentTransactions(200)

  const selected = readFilters(params, GROUPS)
  const options = filterOptions(rows, GROUPS, selected)
  const query = typeof params.q === 'string' ? params.q : ''
  const sort = parseSort(params.sort, { key: 'date', direction: 'desc' })

  const filtered = sortRows(
    applySearch(applyFilters(rows, GROUPS, selected), query, (r) => [r.ticker, r.name, r.account, r.brokerage, r.source]),
    sort,
    (row, key) => (row as Record<string, any>)[key]
  )

  return (
    <>
      <PageHeader
        eyebrow={routeSection('/transactions', language)}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle}
      />
      <Card title={copy.card}>
        <div className="space-y-3">
          <FilterBar
            basePath={BASE}
            params={params}
            summary={copy.summary(fmtNumber(filtered.length), fmtNumber(rows.length))}
            search={{ key: 'q', label: getUiCopy(language).common.search, placeholder: copy.searchPlaceholder, value: query }}
            groups={GROUPS.map((group) => ({
              key: group.key,
              label: copy.filters[group.label as keyof typeof copy.filters],
              options: options[group.key].map((value: string) => ({ value, label: value })),
              selected: selected[group.key],
            }))}
          />
          <DataTable
            rows={filtered}
            sort={sort}
            sortHref={(next: TableSort) => withParam(BASE, params, 'sort', formatSort(next))}
            columns={[
              { key: 'market', label: copy.columns.market, sortable: true, sortFirst: 'asc', render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
              { key: 'date', label: copy.columns.date, sortable: true, nowrap: true },
              { key: 'brokerage', label: copy.columns.broker, sortable: true, sortFirst: 'asc' },
              { key: 'account', label: copy.columns.account, sortable: true, sortFirst: 'asc', priority: 'secondary' },
              { key: 'type', label: copy.columns.type, sortable: true, sortFirst: 'asc', render: (r) => <Badge tone={typeTone(r.type)}>{r.type}</Badge> },
              { key: 'ticker', label: copy.columns.ticker, sortable: true, sortFirst: 'asc' },
              { key: 'name', label: copy.columns.name, sortable: true, sortFirst: 'asc' },
              { key: 'quantity', label: copy.columns.quantity, align: 'right', sortable: true, render: (r) => fmtQuantity(r.quantity, 2) },
              { key: 'native_amount', label: copy.columns.amount, align: 'right', sortable: true, render: (r) => money(r.native_amount, r.currency) },
              { key: 'amount_krw', label: copy.columns.baseAmount, align: 'right', sortable: true, render: (r) => (r.amount_krw == null ? 'n/a' : money(r.amount_krw, 'KRW')) },
              { key: 'source', label: copy.columns.source, priority: 'tertiary' },
              { key: 'page', label: copy.columns.page, align: 'right', priority: 'tertiary' },
            ]}
          />
        </div>
      </Card>
    </>
  )
}
