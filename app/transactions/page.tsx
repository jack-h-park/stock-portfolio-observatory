import { PageHeader } from '@/components/PageHeader'
import { DataTable } from '@/components/DataTable'
import { FilterBar } from '@/components/FilterBar'
import { Badge, Card, marketTone } from '@/components/ui'
import { getRecentTransactions } from '@/lib/adapters/portfolio-db'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { fmtNumber, fmtQuantity } from '@/lib/format'
import { applyFilters, applySearch, filterOptions, readFilters, withParam, type FilterGroup } from '@/lib/table-filter'
import { formatSort, parseSort, sortRows, type TableSort } from '@/lib/table-sort'
import type { Tone } from '@/lib/tone'

export const dynamic = 'force-dynamic'

const BASE = '/transactions'

const GROUPS: FilterGroup<any>[] = [
  { key: 'market', label: 'Market' },
  { key: 'brokerage', label: 'Broker' },
  { key: 'type', label: 'Type' },
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
        eyebrow="Portfolio"
        title="Transactions"
        emphasis="Transactions"
        subtitle="Most recent ledger rows from the normalized transaction TSV."
      />
      <Card title="Recent transactions">
        <div className="space-y-3">
          <FilterBar
            basePath={BASE}
            params={params}
            summary={`${fmtNumber(filtered.length)} of ${fmtNumber(rows.length)} recent rows`}
            search={{ key: 'q', label: 'Search', placeholder: 'Ticker, name, account, or broker', value: query }}
            groups={GROUPS.map((group) => ({
              key: group.key,
              label: group.label,
              options: options[group.key].map((value: string) => ({ value, label: value })),
              selected: selected[group.key],
            }))}
          />
          <DataTable
            rows={filtered}
            sort={sort}
            sortHref={(next: TableSort) => withParam(BASE, params, 'sort', formatSort(next))}
            columns={[
              { key: 'market', label: 'Market', sortable: true, sortFirst: 'asc', render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
              { key: 'date', label: 'Date', sortable: true, nowrap: true },
              { key: 'brokerage', label: 'Broker', sortable: true, sortFirst: 'asc' },
              { key: 'account', label: 'Account', sortable: true, sortFirst: 'asc', priority: 'secondary' },
              { key: 'type', label: 'Type', sortable: true, sortFirst: 'asc', render: (r) => <Badge tone={typeTone(r.type)}>{r.type}</Badge> },
              { key: 'ticker', label: 'Ticker', sortable: true, sortFirst: 'asc' },
              { key: 'name', label: 'Name', sortable: true, sortFirst: 'asc' },
              { key: 'quantity', label: 'Qty', align: 'right', sortable: true, render: (r) => fmtQuantity(r.quantity, 2) },
              { key: 'native_amount', label: 'Amount', align: 'right', sortable: true, render: (r) => money(r.native_amount, r.currency) },
              { key: 'amount_krw', label: 'Base Amount', align: 'right', sortable: true, render: (r) => (r.amount_krw == null ? 'n/a' : money(r.amount_krw, 'KRW')) },
              { key: 'source', label: 'Source', priority: 'tertiary' },
              { key: 'page', label: 'Page', align: 'right', priority: 'tertiary' },
            ]}
          />
        </div>
      </Card>
    </>
  )
}
