import { PageHeader } from '@/components/PageHeader'
import { DataTable, type DataTableColumn } from '@/components/DataTable'
import { FilterBar } from '@/components/FilterBar'
import { Badge, Card, marketTone } from '@/components/ui'
import { getRecentTransactions } from '@/lib/adapters/portfolio-db'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { EMPTY_VALUE, fmtNumber, fmtQuantity } from '@/lib/format'
import { getLanguage } from '@/lib/i18n-server'
import { getPageCopy, getUiCopy } from '@/lib/ui-copy'
import { labelFor } from '@/lib/ui-copy/label'
import { TickerFilterChip } from '@/components/TickerFilterChip'
import { applyFilters, applySearch, applyTicker, filterOptions, readFilters, readTicker, tickerWindowTruncated, withParam, type FilterGroup } from '@/lib/table-filter'
import { columnSortValue, formatSort, knownSort, parseSort, sortRows, sortableKeys, type TableSort } from '@/lib/table-sort'
import { TRANSACTION_TYPE_TONE, categoryTone } from '@/lib/tone'
import { routeMetadata, routeSection } from '@/lib/page-names'
import { AccountCell } from '@/components/PositionCell'
import { accountSortValue } from '@/lib/account-label'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/transactions')

const BASE = '/transactions'

/** How many of the newest ledger rows the page reads; a ticker link filters within them. */
const RECENT_TRANSACTION_LIMIT = 200

const GROUPS: FilterGroup<any>[] = [
  { key: 'market', label: 'market' },
  { key: 'brokerage', label: 'broker' },
  { key: 'type', label: 'type' },
]

const DEFAULT_SORT: TableSort = { key: 'date', direction: 'desc' }

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const language = await getLanguage()
  const copy = getPageCopy('transactions', language)
  const transactionTypes = getUiCopy(language).transactionTypes
  const money = createMoneyFormatter(await getCurrencyPreferences())
  const rows = getRecentTransactions(RECENT_TRANSACTION_LIMIT)
  // A position page links here with its exact ticker; the market is the ordinary filter.
  const ticker = readTicker(params)
  const scoped = applyTicker(rows, ticker)

  const selected = readFilters(params, GROUPS)
  const options = filterOptions(scoped, GROUPS, selected)
  const query = typeof params.q === 'string' ? params.q : ''
  const columns: DataTableColumn<(typeof rows)[number]>[] = [
    { key: 'market', label: copy.columns.market, priority: 'secondary', sortable: true, sortFirst: 'asc', render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
    { key: 'date', label: copy.columns.date, sortable: true, nowrap: true },
    { key: 'account', label: copy.columns.account, sortable: true, sortFirst: 'asc', sortValue: accountSortValue, priority: 'secondary', render: (r) => <AccountCell brokerage={r.brokerage} account={r.account} /> },
    { key: 'type', label: copy.columns.type, sortable: true, sortFirst: 'asc', render: (r) => <Badge tone={categoryTone(TRANSACTION_TYPE_TONE, r.type, 'info')}>{labelFor(transactionTypes, r.type)}</Badge> },
    { key: 'ticker', label: copy.columns.ticker, sortable: true, sortFirst: 'asc' },
    { key: 'name', label: copy.columns.name, priority: 'secondary', sortable: true, sortFirst: 'asc' },
    { key: 'quantity', label: copy.columns.quantity, priority: 'secondary', align: 'right', sortable: true, render: (r) => fmtQuantity(r.quantity, 2) },
    { key: 'native_amount', label: copy.columns.amount, align: 'right', sortable: true, render: (r) => money(r.native_amount, r.currency) },
    { key: 'amount_krw', label: copy.columns.baseAmount, priority: 'secondary', align: 'right', sortable: true, render: (r) => (r.amount_krw == null ? EMPTY_VALUE : money(r.amount_krw, 'KRW')) },
    { key: 'source', label: copy.columns.source, priority: 'tertiary' },
    { key: 'page', label: copy.columns.page, align: 'right', priority: 'tertiary' },
  ]
  const sort = knownSort(parseSort(params.sort, DEFAULT_SORT), sortableKeys(columns), DEFAULT_SORT)

  const filtered = sortRows(
    applySearch(applyFilters(scoped, GROUPS, selected), query, (r) => [r.ticker, r.name, r.account, r.brokerage, r.source]),
    sort,
    columnSortValue(columns)
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
            summary={copy.summary(fmtNumber(filtered.length), fmtNumber(scoped.length))}
            search={{ key: 'q', label: getUiCopy(language).common.search, placeholder: copy.searchPlaceholder, value: query }}
            groups={GROUPS.map((group) => ({
              key: group.key,
              label: copy.filters[group.label as keyof typeof copy.filters],
              // The type chips read the table's type column labels; the URL keeps the code.
              options: options[group.key].map((value: string) => ({ value, label: group.key === 'type' ? labelFor(transactionTypes, value) : value })),
              selected: selected[group.key],
            }))}
          />
          {ticker ? (
            <TickerFilterChip
              clearHref={withParam(BASE, params, 'ticker', null)}
              label={getUiCopy(language).common.tickerFilter(ticker)}
              removeLabel={getUiCopy(language).common.removeTickerFilter(ticker)}
              note={tickerWindowTruncated(rows.length, RECENT_TRANSACTION_LIMIT, ticker) ? copy.tickerWindow(fmtNumber(RECENT_TRANSACTION_LIMIT)) : undefined}
            />
          ) : null}
          <DataTable
            rows={filtered}
            sort={sort}
            sortHref={(next: TableSort) => withParam(BASE, params, 'sort', formatSort(next))}
            columns={columns}
          />
        </div>
      </Card>
    </>
  )
}
