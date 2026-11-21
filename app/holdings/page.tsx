import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type DataTableColumn } from '@/components/DataTable'
import { FilterBar } from '@/components/FilterBar'
import { Badge, Card, Signed, marketTone } from '@/components/ui'
import { Total, TotalsStrip } from '@/components/layout'
import { getHoldings } from '@/lib/adapters/portfolio-db'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { fmtNumber, fmtPct, fmtQuantity } from '@/lib/format'
import { getLanguage } from '@/lib/i18n-server'
import { holdingsTotals } from '@/lib/holdings-totals'
import { positionHref } from '@/lib/position-url'
import { getPageCopy, getUiCopy } from '@/lib/ui-copy'
import { applyFilters, applySearch, filterOptions, readFilters, withParam, type FilterGroup } from '@/lib/table-filter'
import { columnSortValue, formatSort, knownSort, parseSort, sortRows, sortableKeys, type TableSort } from '@/lib/table-sort'
import { COST_BASIS_STATUS_TONE } from '@/lib/tone'
import { routeMetadata, routeSection } from '@/lib/page-names'
import { AccountCell } from '@/components/PositionCell'
import { accountSortValue } from '@/lib/account-label'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/holdings')

const BASE = '/holdings'

// `status` keeps the parameter name /cost-basis used, so its old links land on
// the same filter here.
const GROUPS: FilterGroup<any>[] = [
  { key: 'market', label: 'Market' },
  { key: 'brokerage', label: 'Broker' },
  { key: 'account', label: 'Account' },
  { key: 'status', label: 'Status', valueFor: (row) => row.cost_status },
]

const DEFAULT_SORT: TableSort = { key: 'base_market_value', direction: 'desc' }

export default async function HoldingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const language = await getLanguage()
  const copy = getPageCopy('holdings', language)
  const labels = getUiCopy(language).common
  const money = createMoneyFormatter(await getCurrencyPreferences())
  const rows = getHoldings(1000)

  const selected = readFilters(params, GROUPS)
  const options = filterOptions(rows, GROUPS, selected)
  const query = typeof params.q === 'string' ? params.q : ''
  const columns: DataTableColumn<(typeof rows)[number]>[] = [
    { key: 'market', label: copy.market, sortable: true, sortFirst: 'asc', nowrap: true, render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
    { key: 'account', label: copy.account, sortable: true, sortFirst: 'asc', sortValue: accountSortValue, priority: 'secondary', render: (r) => <AccountCell brokerage={r.brokerage} account={r.account} /> },
    {
      key: 'ticker',
      label: copy.instrument,
      sortable: true,
      sortFirst: 'asc',
      sortValue: (r) => r.name ?? r.ticker,
      // One link to the position, replacing the badge-plus-panel that
      // showed the same row twice — once in the table, once in a
      // summary above it that the detail page already covers.
      render: (r) => (
        <Link href={positionHref(r.market, r.ticker)} className="block min-w-[13rem] hover:underline">
          <span className="font-mono text-caption text-info">{r.ticker}</span>
          <span className="mt-1 block max-w-[18rem] truncate text-caption font-medium text-ink">{r.name}</span>
        </Link>
      ),
    },
    { key: 'quantity', label: copy.quantity, priority: 'secondary', align: 'right', sortable: true, nowrap: true, render: (r) => fmtQuantity(r.quantity, 2) },
    { key: 'native_cost', label: copy.costBasis, description: copy.nativeCostDescription, align: 'right', sortable: true, priority: 'secondary', nowrap: true, render: (r) => money(r.native_cost, r.currency) },
    { key: 'base_cost', label: copy.baseCost, description: copy.baseCostDescription, align: 'right', sortable: true, priority: 'tertiary', nowrap: true, render: (r) => (r.base_cost == null ? labels.noValue : money(r.base_cost, 'KRW')) },
    { key: 'native_market_value', label: copy.marketValue, align: 'right', sortable: true, nowrap: true, render: (r) => (r.native_market_value == null ? labels.noValue : money(r.native_market_value, r.currency)) },
    { key: 'native_unrealized_gl', label: copy.sort.gain, priority: 'secondary', description: copy.gainDescription, align: 'right', sortable: true, nowrap: true, render: (r) => <Signed value={r.native_unrealized_gl} format={(m) => money(m, r.currency)} /> },
    { key: 'base_unrealized_gl', label: copy.baseGain, description: copy.baseGainDescription, align: 'right', sortable: true, priority: 'tertiary', nowrap: true, render: (r) => <Signed value={r.base_unrealized_gl} format={(m) => money(m, 'KRW')} /> },
    { key: 'native_unrealized_gl_pct', label: copy.sort.return, align: 'right', sortable: true, nowrap: true, render: (r) => <Signed value={r.native_unrealized_gl_pct} format={(m) => fmtPct(m)} /> },
    { key: 'long_term_qty', label: copy.longTerm, description: copy.longTermDescription, align: 'right', sortable: true, priority: 'tertiary', render: (r) => fmtNumber(r.long_term_qty, 2) },
    { key: 'short_term_qty', label: copy.shortTerm, description: copy.shortTermDescription, align: 'right', sortable: true, priority: 'tertiary', render: (r) => fmtNumber(r.short_term_qty, 2) },
    { key: 'lot_count', label: copy.taxLots, description: copy.lotDescription, align: 'right', sortable: true, priority: 'tertiary' },
    {
      key: 'cost_status',
      label: copy.costStatusColumn,
      priority: 'secondary',
      sortable: true,
      sortFirst: 'asc',
      nowrap: true,
      render: (r) => <Badge tone={COST_BASIS_STATUS_TONE[r.cost_status] ?? 'neutral'}>{copy.costStatus[r.cost_status] ?? r.cost_status}</Badge>,
    },
    { key: 'cost_note', label: copy.costNote, priority: 'tertiary', render: (r) => <div className="max-w-[20rem] text-label text-ink-3">{copy.costNotes[r.cost_status] ?? r.cost_note}</div> },
  ]
  const sort = knownSort(parseSort(params.sort, DEFAULT_SORT), sortableKeys(columns), DEFAULT_SORT)
  const filtered = sortRows(
    applySearch(applyFilters(rows, GROUPS, selected), query, (r) => [r.ticker, r.name, r.account, r.brokerage]),
    sort,
    columnSortValue(columns)
  )
  const totals = holdingsTotals(filtered)
  const incompleteTotals = filtered.length > 0 && Object.values(totals).includes(null)

  const groupLabels: Record<string, string> = {
    market: copy.market,
    brokerage: copy.broker,
    account: copy.account,
    status: copy.costStatusFilter,
  }

  return (
    <>
      <PageHeader
        eyebrow={routeSection('/holdings', language)}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle(fmtNumber(rows.length))}
      />
      <Card title={copy.caption}>
        <div className="space-y-3">
          <FilterBar
            basePath={BASE}
            params={params}
            search={{ key: 'q', label: labels.search, placeholder: copy.searchPlaceholder, value: query }}
            groups={GROUPS.map((group) => ({
              key: group.key,
              label: groupLabels[group.key] ?? group.label,
              // The status column stores a machine value; the chip shows the
              // wording, and the URL keeps the value.
              options: options[group.key].map((value: string) => ({
                value,
                label: group.key === 'status' ? (copy.costStatus[value] ?? value) : value,
              })),
              selected: selected[group.key],
            }))}
          />
          <TotalsStrip columns="sm-4">
            <Total label={copy.filtered} value={<>{fmtNumber(filtered.length)} / {fmtNumber(rows.length)}</>} />
            <Total label={copy.costBasis} value={totals.cost == null ? labels.noValue : money(totals.cost, 'KRW')} />
            <Total label={copy.marketValue} value={totals.marketValue == null ? labels.noValue : money(totals.marketValue, 'KRW')} />
            <Total label={copy.sort.gain} value={<Signed value={totals.unrealized} format={(m) => money(m, 'KRW')} />} />
          </TotalsStrip>
          {incompleteTotals && <p className="text-caption text-ink-2">{copy.incompleteTotals}</p>}
          <DataTable
            rows={filtered}
            caption={copy.caption}
            emptyMessage={rows.length ? copy.noMatchingHoldings : copy.noHoldings}
            sort={sort}
            sortHref={(next: TableSort) => withParam(BASE, params, 'sort', formatSort(next))}
            columns={columns}
          />
        </div>
      </Card>
    </>
  )
}
