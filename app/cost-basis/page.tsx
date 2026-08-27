import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { DataTable } from '@/components/DataTable'
import { FilterBar } from '@/components/FilterBar'
import { Badge, Card, Label, Signed } from '@/components/ui'
import { getCostBasisHoldings, type CostBasisStatus } from '@/lib/adapters/portfolio-db'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { fmtNumber, fmtPct, fmtQuantity } from '@/lib/format'
import { positionHref } from '@/lib/position-url'
import { applyFilters, applySearch, filterOptions, readFilters, withParam, type FilterGroup } from '@/lib/table-filter'
import { formatSort, parseSort, sortRows, type TableSort } from '@/lib/table-sort'
import { COST_BASIS_STATUS_TONE } from '@/lib/tone'

export const dynamic = 'force-dynamic'

const BASE = '/cost-basis'

const STATUS_LABEL: Record<string, string> = {
  ready: 'Ready',
  missing_cost: 'Missing cost',
  estimated: 'Estimated',
  unpriced: 'Unpriced',
}

const GROUPS: FilterGroup<any>[] = [
  { key: 'market', label: 'Market' },
  { key: 'brokerage', label: 'Broker' },
  { key: 'account', label: 'Account' },
  { key: 'status', label: 'Status', valueFor: (row) => row.cost_status },
]

export default async function CostBasisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const money = createMoneyFormatter(await getCurrencyPreferences())
  const rows = getCostBasisHoldings(1000)

  const selected = readFilters(params, GROUPS)
  const options = filterOptions(rows, GROUPS, selected)
  const query = typeof params.q === 'string' ? params.q : ''
  const sort = parseSort(params.sort, { key: 'base_market_value', direction: 'desc' })
  const filtered = sortRows(
    applySearch(applyFilters(rows, GROUPS, selected), query, (r) => [r.ticker, r.name, r.account, r.brokerage]),
    sort,
    (row, key) => (row as Record<string, any>)[key]
  )
  const totals = filtered.reduce(
    (acc, row) => ({
      value: acc.value + Number(row.native_market_value ?? 0),
      cost: acc.cost + Number(row.native_cost ?? 0),
      baseValue: acc.baseValue + Number(row.base_market_value ?? 0),
      missing: acc.missing + (row.cost_status === 'missing_cost' ? 1 : 0),
      estimated: acc.estimated + (row.cost_status === 'estimated' ? 1 : 0),
    }),
    { value: 0, cost: 0, baseValue: 0, missing: 0, estimated: 0 }
  )
  const currencies = Array.from(new Set(filtered.map((r) => r.currency).filter(Boolean)))
  const singleCurrency = currencies.length === 1 ? currencies[0] : null
  const missingCost = rows.filter((row) => row.cost_status === 'missing_cost').length
  const estimated = rows.filter((row) => row.cost_status === 'estimated').length
  const priceDate = rows.find((row) => row.price_date)?.price_date ?? null

  return (
    <>
      <PageHeader
        eyebrow="Records"
        title="Cost Basis"
        emphasis="Basis"
        subtitle={`${rows.length} holdings with current value and total cost review. ${missingCost} missing cost, ${estimated} estimated.`}
      />
      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
        <Card title="Cost basis method">
          <div className="space-y-2 text-body leading-relaxed text-ink-2">
            <p>
              Use this table as the read-only source for holdings that need a current shares, value, and Total Cost check.
              Match by Symbol, Name, Account/Broker, and Shares, then use the Total Cost value in the holding currency.
            </p>
            <p>
              Cost values come from the observatory holdings snapshot. Rows marked Estimated are usable for review but
              should be checked against statements; for crypto-style activity, reconcile source cost as purchases minus
              the cost removed by sales and rewards/disposals.
            </p>
          </div>
        </Card>
        <Card title="Price basis">
          <div className="grid gap-2 text-caption text-ink-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-3">Latest price date</span>
              <span className="font-medium tabular-nums text-ink">{priceDate ?? 'n/a'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-3">Missing cost rows</span>
              <span className={missingCost > 0 ? 'font-medium tabular-nums text-danger' : 'font-medium tabular-nums text-success'}>
                {missingCost}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-3">Estimated rows</span>
              <span className={estimated > 0 ? 'font-medium tabular-nums text-warning' : 'font-medium tabular-nums text-ink'}>
                {estimated}
              </span>
            </div>
          </div>
        </Card>
      </div>
      <Card title="Holdings cost basis">
        <div className="space-y-3">
          <FilterBar
            basePath={BASE}
            params={params}
            search={{ key: 'q', label: 'Search', placeholder: 'symbol, name, account, broker', value: query }}
            groups={GROUPS.map((group) => ({
              key: group.key,
              label: group.label,
              // The status column stores a machine value; the chip shows the
              // wording, and the URL keeps the value.
              options: options[group.key].map((value: string) => ({ value, label: STATUS_LABEL[value] ?? value })),
              selected: selected[group.key],
            }))}
          />
          <div className="grid gap-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-caption sm:grid-cols-5">
            <div>
              <Label>Filtered</Label>
              <div className="font-medium tabular-nums text-ink">{fmtNumber(filtered.length)} / {fmtNumber(rows.length)}</div>
            </div>
            <div>
              <Label>Total value</Label>
              <div className="font-medium tabular-nums text-ink">
                {singleCurrency ? money(totals.value, singleCurrency) : money(totals.baseValue, 'KRW')}
              </div>
            </div>
            <div>
              <Label>Total cost</Label>
              <div className="font-medium tabular-nums text-ink">
                {singleCurrency ? money(totals.cost, singleCurrency) : 'Mixed currencies'}
              </div>
            </div>
            <div>
              <Label>Missing cost</Label>
              <div className={`font-medium tabular-nums ${totals.missing > 0 ? 'text-danger' : 'text-success'}`}>{fmtNumber(totals.missing)}</div>
            </div>
            <div>
              <Label>Estimated</Label>
              <div className={`font-medium tabular-nums ${totals.estimated > 0 ? 'text-warning' : 'text-ink'}`}>{fmtNumber(totals.estimated)}</div>
            </div>
          </div>
          <DataTable
            rows={filtered}
            sort={sort}
            sortHref={(next: TableSort) => withParam(BASE, params, 'sort', formatSort(next))}
            columns={[
              {
                key: 'ticker',
                label: 'Symbol',
                sortable: true,
                sortFirst: 'asc',
                render: (r) => (
                  <Link href={positionHref(r.market, r.ticker)} className="font-mono text-caption font-medium text-info hover:underline">
                    {r.ticker}
                  </Link>
                ),
              },
              { key: 'name', label: 'Name', sortable: true, sortFirst: 'asc', render: (r) => <div className="min-w-[14rem] max-w-[20rem] truncate text-ink">{r.name}</div> },
              { key: 'brokerage', label: 'Broker', sortable: true, sortFirst: 'asc', priority: 'secondary' },
              { key: 'account', label: 'Account', sortable: true, sortFirst: 'asc', nowrap: true, priority: 'secondary' },
              { key: 'quantity', label: 'Shares', align: 'right', sortable: true, render: (r) => fmtQuantity(r.quantity, 6) },
              { key: 'native_price', label: 'Price', align: 'right', sortable: true, render: (r) => (r.native_price == null ? 'n/a' : money(r.native_price, r.currency)) },
              { key: 'native_market_value', label: 'Value', align: 'right', sortable: true, render: (r) => (r.native_market_value == null ? 'n/a' : money(r.native_market_value, r.currency)) },
              { key: 'native_cost', label: 'Total Cost', align: 'right', sortable: true, render: (r) => (r.native_cost == null ? 'n/a' : money(r.native_cost, r.currency)) },
              { key: 'native_unrealized_gl', label: 'Gain', align: 'right', sortable: true, render: (r) => <Signed value={r.native_unrealized_gl} format={(m) => money(m, r.currency)} /> },
              { key: 'native_unrealized_gl_pct', label: 'Gain %', align: 'right', sortable: true, render: (r) => <Signed value={r.native_unrealized_gl_pct} format={(m) => fmtPct(m)} /> },
              { key: 'day_change', label: 'Day', align: 'right', sortable: true, priority: 'tertiary', render: (r) => <Signed value={r.day_change} format={(m) => money(m, r.currency)} /> },
              { key: 'day_change_pct', label: 'Day %', align: 'right', sortable: true, priority: 'tertiary', render: (r) => <Signed value={r.day_change_pct} format={(m) => fmtPct(m)} /> },
              { key: 'percent_of_total', label: '% of Total', align: 'right', sortable: true, render: (r) => fmtPct(r.percent_of_total) },
              {
                key: 'cost_status',
                label: 'Sync Status',
                sortable: true,
                sortFirst: 'asc',
                render: (r) => (
                  <Badge tone={COST_BASIS_STATUS_TONE[r.cost_status as CostBasisStatus] ?? 'neutral'}>
                    {STATUS_LABEL[r.cost_status] ?? r.cost_status}
                  </Badge>
                ),
              },
              { key: 'cost_note', label: 'Why', priority: 'tertiary', render: (r) => <div className="max-w-[20rem] text-label text-ink-3">{r.cost_note}</div> },
            ]}
          />
        </div>
      </Card>
    </>
  )
}
