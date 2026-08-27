import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { DataTable } from '@/components/DataTable'
import { FilterBar } from '@/components/FilterBar'
import { Badge, Card, Label, marketTone } from '@/components/ui'
import { getTaxLots } from '@/lib/adapters/portfolio-db'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { fmtNumber, fmtQuantity } from '@/lib/format'
import { positionHref } from '@/lib/position-url'
import { applyFilters, applySearch, filterOptions, readFilters, withParam, type FilterGroup } from '@/lib/table-filter'
import { formatSort, parseSort, sortRows, type TableSort } from '@/lib/table-sort'
import { bucketTone } from '@/lib/tone'

export const dynamic = 'force-dynamic'

const BASE = '/lots'

const GROUPS: FilterGroup<any>[] = [
  { key: 'market', label: 'Market' },
  { key: 'brokerage', label: 'Broker' },
  { key: 'account', label: 'Account' },
  { key: 'term', label: 'Term', valueFor: (row) => row.tax_term || 'Unknown' },
]

export default async function LotsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const money = createMoneyFormatter(await getCurrencyPreferences())
  const rows = getTaxLots(1000)

  const selected = readFilters(params, GROUPS)
  const options = filterOptions(rows, GROUPS, selected)
  const query = typeof params.q === 'string' ? params.q : ''
  // Longest-held first: the question this page answers is what has crossed, or
  // is about to cross, the long-term boundary.
  const sort = parseSort(params.sort, { key: 'holding_days', direction: 'desc' })

  const filtered = sortRows(
    applySearch(applyFilters(rows, GROUPS, selected), query, (r) => [r.ticker, r.name, r.account, r.brokerage, r.source]),
    sort,
    (row, key) => (row as Record<string, any>)[key]
  )

  const totals = filtered.reduce(
    (acc, row) => ({
      cost: acc.cost + Number(row.cost_basis_krw ?? 0),
      quantity: acc.quantity + Number(row.open_quantity ?? 0),
    }),
    { cost: 0, quantity: 0 }
  )

  return (
    <>
      <PageHeader
        eyebrow="Tax"
        title="Tax Lots"
        emphasis="Lots"
        subtitle="Open tax lots with search, account filters, sorting, and ticker drilldown."
      />
      <Card title="Open tax lots">
        <div className="space-y-3">
          <FilterBar
            basePath={BASE}
            params={params}
            search={{ key: 'q', label: 'Search', placeholder: 'ticker, name, account, source', value: query }}
            groups={GROUPS.map((group) => ({
              key: group.key,
              label: group.label,
              options: options[group.key].map((value: string) => ({ value, label: value })),
              selected: selected[group.key],
            }))}
          />
          <div className="grid gap-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-caption sm:grid-cols-3">
            <div>
              <Label>Filtered</Label>
              <div className="font-medium tabular-nums text-ink">
                {fmtNumber(filtered.length)} / {fmtNumber(rows.length)}
              </div>
            </div>
            <div>
              <Label>Open quantity</Label>
              <div className="font-medium tabular-nums text-ink">{fmtQuantity(totals.quantity, 2)}</div>
            </div>
            <div>
              <Label>Base cost</Label>
              <div className="font-medium tabular-nums text-ink">{money(totals.cost, 'KRW')}</div>
            </div>
          </div>
          <DataTable
            rows={filtered}
            sort={sort}
            sortHref={(next: TableSort) => withParam(BASE, params, 'sort', formatSort(next))}
            columns={[
              { key: 'market', label: 'Market', sortable: true, sortFirst: 'asc', render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
              { key: 'brokerage', label: 'Broker', sortable: true, sortFirst: 'asc' },
              { key: 'account', label: 'Account', sortable: true, sortFirst: 'asc', priority: 'secondary' },
              {
                key: 'ticker',
                label: 'Instrument',
                sortable: true,
                sortFirst: 'asc',
                sortValue: (r) => r.name ?? r.ticker,
                // The row used to open a summary panel above the table showing
                // what the position detail page already shows in full. One link,
                // to the page that answers the question.
                render: (r) => (
                  <Link href={positionHref(r.market, r.ticker)} className="block min-w-[13rem] hover:underline">
                    <span className="font-mono text-caption text-info">{r.ticker}</span>
                    <span className="mt-1 block max-w-[18rem] truncate text-caption font-medium text-ink">{r.name}</span>
                  </Link>
                ),
              },
              { key: 'acquired_date', label: 'Acquired', sortable: true, nowrap: true },
              { key: 'open_quantity', label: 'Qty', align: 'right', sortable: true, render: (r) => fmtNumber(r.open_quantity, 2) },
              { key: 'native_cost_basis', label: 'Cost Basis', align: 'right', sortable: true, render: (r) => money(r.native_cost_basis, r.currency) },
              { key: 'cost_basis_krw', label: 'Base Cost', align: 'right', sortable: true, render: (r) => money(r.cost_basis_krw, 'KRW') },
              { key: 'holding_days', label: 'Days', align: 'right', sortable: true },
              { key: 'tax_term', label: 'Term', sortable: true, sortFirst: 'asc', render: (r) => <Badge tone={bucketTone(r.tax_term)}>{r.tax_term ?? 'Unknown'}</Badge> },
            ]}
          />
        </div>
      </Card>
    </>
  )
}
