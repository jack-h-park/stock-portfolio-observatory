'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge, Button } from '@/components/ui'
import { DataTable } from '@/components/DataTable'
import { fmtMoney, fmtNumber } from '@/lib/format'
import { positionHref } from '@/lib/position-url'

type SortDirection = 'asc' | 'desc'
type SortConfig = { key: string; direction: SortDirection }

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter(Boolean) as string[])).sort()
}

function searchText(row: any) {
  return [row.market, row.brokerage, row.account, row.ticker, row.name, row.tax_term, row.source]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function includesSearch(row: any, query: string) {
  const trimmed = query.trim().toLowerCase()
  return !trimmed || searchText(row).includes(trimmed)
}

function toSortValue(row: any, key: string) {
  const value = row[key]
  if (typeof value === 'number') return value
  if (value == null) return ''
  return String(value).toLowerCase()
}

function sortRows(rows: any[], sort: SortConfig) {
  return [...rows].sort((a, b) => {
    const av = toSortValue(a, sort.key)
    const bv = toSortValue(b, sort.key)
    const result = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
    return sort.direction === 'asc' ? result : -result
  })
}

function positionKey(row: any) {
  return [row.market, row.brokerage, row.account, row.ticker].join('|')
}

function InstrumentLabel({ row }: { row: any }) {
  return (
    <div className="min-w-[13rem]">
      <div className="flex items-center gap-2">
        <Badge tone={row.market === 'US' ? 'info' : 'success'}>{row.market}</Badge>
        <span className="font-mono text-[12px] text-ink">{row.ticker}</span>
      </div>
      <div className="mt-1 max-w-[18rem] truncate text-[12px] font-medium text-ink">{row.name}</div>
    </div>
  )
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3 sm:max-w-xs">
      Search
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-8 rounded-sm border border-line bg-card px-2 text-[13px] font-normal normal-case tracking-normal text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
      />
    </label>
  )
}

function FilterBar({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{label}</span>
      {options.map((option) => (
        <Button
          key={option}
          variant={value === option ? 'solid' : 'outline'}
          size="sm"
          onClick={() => onChange(option)}
        >
          {option}
        </Button>
      ))}
    </div>
  )
}

function SortBar({
  value,
  options,
  onChange,
}: {
  value: SortConfig
  options: { key: string; label: string; direction?: SortDirection }[]
  onChange: (value: SortConfig) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Sort</span>
      {options.map((option) => {
        const direction = option.direction ?? 'desc'
        const active = value.key === option.key && value.direction === direction
        return (
          <Button
            key={`${option.key}:${direction}`}
            variant={active ? 'solid' : 'outline'}
            size="sm"
            onClick={() => onChange({ key: option.key, direction })}
          >
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}

function rowMatches(row: any, filters: Record<string, string>) {
  return Object.entries(filters).every(([key, value]) => value === 'All' || row[key] === value)
}

export function HoldingsTable({ rows }: { rows: any[] }) {
  const [market, setMarket] = useState('All')
  const [brokerage, setBrokerage] = useState('All')
  const [account, setAccount] = useState('All')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortConfig>({ key: 'base_market_value', direction: 'desc' })
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const scopedRows = useMemo(() => rows.filter((r) => market === 'All' || r.market === market), [rows, market])
  const brokerRows = useMemo(
    () => scopedRows.filter((r) => brokerage === 'All' || r.brokerage === brokerage),
    [scopedRows, brokerage]
  )
  const filtered = useMemo(
    () => sortRows(rows.filter((row) => rowMatches(row, { market, brokerage, account }) && includesSearch(row, query)), sort),
    [rows, market, brokerage, account, query, sort]
  )
  const selected = useMemo(() => filtered.find((row) => positionKey(row) === selectedKey) ?? filtered[0] ?? null, [filtered, selectedKey])
  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, row) => {
          acc.cost += Number(row.base_cost ?? row.total_cost_krw ?? 0)
          acc.marketValue += Number(row.base_market_value ?? 0)
          acc.unrealized += Number(row.base_unrealized_gl ?? 0)
          return acc
        },
        { cost: 0, marketValue: 0, unrealized: 0 }
      ),
    [filtered]
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <SearchBox value={query} onChange={setQuery} placeholder="ticker, name, account, broker" />
        <SortBar
          value={sort}
          onChange={setSort}
          options={[
            { key: 'base_market_value', label: 'Market value' },
            { key: 'base_unrealized_gl', label: 'G/L' },
            { key: 'native_unrealized_gl_pct', label: 'G/L %' },
            { key: 'name', label: 'Name A-Z', direction: 'asc' },
          ]}
        />
      </div>
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <FilterBar label="Market" value={market} options={['All', ...unique(rows.map((r) => r.market))]} onChange={setMarket} />
        <FilterBar
          label="Broker"
          value={brokerage}
          options={['All', ...unique(scopedRows.map((r) => r.brokerage))]}
          onChange={setBrokerage}
        />
        <FilterBar label="Account" value={account} options={['All', ...unique(brokerRows.map((r) => r.account))]} onChange={setAccount} />
      </div>
      <div className="grid gap-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-[12px] sm:grid-cols-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Filtered</div>
          <div className="font-medium tabular-nums text-ink">{fmtNumber(filtered.length)} / {fmtNumber(rows.length)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Base cost</div>
          <div className="font-medium tabular-nums text-ink">{fmtMoney(totals.cost, 'KRW')}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Market value</div>
          <div className="font-medium tabular-nums text-ink">{fmtMoney(totals.marketValue, 'KRW')}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Unrealized G/L</div>
          <div className={totals.unrealized >= 0 ? 'font-medium tabular-nums text-success' : 'font-medium tabular-nums text-danger'}>
            {fmtMoney(totals.unrealized, 'KRW')}
          </div>
        </div>
      </div>
      {selected && (
        <div className="flex flex-col gap-2 rounded-md border border-line-subtle bg-card px-3 py-2 text-[12px] lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge tone={selected.market === 'US' ? 'info' : 'success'}>{selected.market}</Badge>
              <span className="font-medium text-ink">{selected.name}</span>
              <span className="font-mono text-[11px] text-ink-3">{selected.ticker}</span>
            </div>
            <div className="mt-1 truncate text-[11px] text-ink-3">{selected.brokerage} · {selected.account}</div>
          </div>
          <div className="grid gap-x-5 gap-y-1 text-[11px] sm:grid-cols-5 lg:text-right">
            <div><span className="text-ink-3">Qty </span><span className="tabular-nums text-ink">{fmtNumber(selected.quantity, 2)}</span></div>
            <div><span className="text-ink-3">Cost </span><span className="tabular-nums text-ink">{fmtMoney(selected.native_cost, selected.currency)}</span></div>
            <div><span className="text-ink-3">Market </span><span className="tabular-nums text-ink">{selected.native_market_value == null ? 'n/a' : fmtMoney(selected.native_market_value, selected.currency)}</span></div>
            <div>
              <span className="text-ink-3">G/L </span>
              <span className={Number(selected.native_unrealized_gl ?? 0) >= 0 ? 'tabular-nums text-success' : 'tabular-nums text-danger'}>
                {selected.native_unrealized_gl == null ? 'n/a' : fmtMoney(selected.native_unrealized_gl, selected.currency)}
              </span>
            </div>
            <Link href={positionHref(selected.market, selected.ticker)} className="font-medium text-info hover:underline">
              Detail
            </Link>
          </div>
        </div>
      )}
      <DataTable
        rows={filtered}
        columns={[
          { key: 'market', label: 'Market', render: (r) => <Badge tone={r.market === 'US' ? 'info' : 'success'}>{r.market}</Badge> },
          { key: 'brokerage', label: 'Broker' },
          { key: 'account', label: 'Account' },
          {
            key: 'ticker',
            label: 'Instrument',
            render: (r) => (
              <div className="flex items-start gap-2">
                <button type="button" className="text-left" onClick={() => setSelectedKey(positionKey(r))}>
                  <InstrumentLabel row={r} />
                </button>
                <Link href={positionHref(r.market, r.ticker)} className="mt-0.5 text-[11px] font-medium text-info hover:underline">
                  Open
                </Link>
              </div>
            ),
          },
          { key: 'quantity', label: 'Qty', align: 'right', render: (r) => fmtNumber(r.quantity, 2) },
          { key: 'native_cost', label: 'Cost Basis', align: 'right', render: (r) => fmtMoney(r.native_cost, r.currency) },
          { key: 'base_cost', label: 'Base Cost', align: 'right', render: (r) => (r.base_cost == null ? 'n/a' : fmtMoney(r.base_cost, 'KRW')) },
          { key: 'native_market_value', label: 'Market Value', align: 'right', render: (r) => (r.native_market_value == null ? 'n/a' : fmtMoney(r.native_market_value, r.currency)) },
          {
            key: 'native_unrealized_gl',
            label: 'Unrealized G/L',
            align: 'right',
            render: (r) =>
              r.native_unrealized_gl == null ? (
                'n/a'
              ) : (
                <span className={r.native_unrealized_gl >= 0 ? 'text-success' : 'text-danger'}>
                  {fmtMoney(r.native_unrealized_gl, r.currency)}
                </span>
              ),
          },
          {
            key: 'base_unrealized_gl',
            label: 'Base G/L',
            align: 'right',
            render: (r) =>
              r.base_unrealized_gl == null ? (
                'n/a'
              ) : (
                <span className={r.base_unrealized_gl >= 0 ? 'text-success' : 'text-danger'}>
                  {fmtMoney(r.base_unrealized_gl, 'KRW')}
                </span>
              ),
          },
          { key: 'long_term_qty', label: 'Long', align: 'right', render: (r) => fmtNumber(r.long_term_qty, 2) },
          { key: 'short_term_qty', label: 'Short', align: 'right', render: (r) => fmtNumber(r.short_term_qty, 2) },
          { key: 'lot_count', label: 'Lots', align: 'right' },
        ]}
      />
    </div>
  )
}

export function LotsTable({ rows }: { rows: any[] }) {
  const [market, setMarket] = useState('All')
  const [brokerage, setBrokerage] = useState('All')
  const [account, setAccount] = useState('All')
  const [term, setTerm] = useState('All')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortConfig>({ key: 'holding_days', direction: 'desc' })
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const termOf = (row: any) => row.tax_term || 'Unknown'
  const scopedRows = useMemo(() => rows.filter((r) => market === 'All' || r.market === market), [rows, market])
  const brokerRows = useMemo(
    () => scopedRows.filter((r) => brokerage === 'All' || r.brokerage === brokerage),
    [scopedRows, brokerage]
  )
  const filtered = useMemo(
    () =>
      sortRows(
        rows.filter(
          (row) =>
            rowMatches(row, { market, brokerage, account }) &&
            (term === 'All' || termOf(row) === term) &&
            includesSearch(row, query)
        ),
        sort
      ),
    [rows, market, brokerage, account, term, query, sort]
  )
  const selectedLots = useMemo(
    () => (selectedKey ? filtered.filter((row) => positionKey(row) === selectedKey) : []),
    [filtered, selectedKey]
  )
  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, row) => {
          acc.cost += Number(row.cost_basis_krw ?? 0)
          acc.quantity += Number(row.open_quantity ?? 0)
          return acc
        },
        { cost: 0, quantity: 0 }
      ),
    [filtered]
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <SearchBox value={query} onChange={setQuery} placeholder="ticker, name, account, source" />
        <SortBar
          value={sort}
          onChange={setSort}
          options={[
            { key: 'holding_days', label: 'Holding days' },
            { key: 'cost_basis_krw', label: 'Base cost' },
            { key: 'open_quantity', label: 'Quantity' },
            { key: 'acquired_date', label: 'Acquired A-Z', direction: 'asc' },
          ]}
        />
      </div>
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <FilterBar label="Market" value={market} options={['All', ...unique(rows.map((r) => r.market))]} onChange={setMarket} />
        <FilterBar label="Broker" value={brokerage} options={['All', ...unique(scopedRows.map((r) => r.brokerage))]} onChange={setBrokerage} />
        <FilterBar label="Account" value={account} options={['All', ...unique(brokerRows.map((r) => r.account))]} onChange={setAccount} />
        <FilterBar label="Term" value={term} options={['All', ...unique(rows.map(termOf))]} onChange={setTerm} />
      </div>
      <div className="grid gap-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-[12px] sm:grid-cols-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Filtered</div>
          <div className="font-medium tabular-nums text-ink">{fmtNumber(filtered.length)} / {fmtNumber(rows.length)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Open quantity</div>
          <div className="font-medium tabular-nums text-ink">{fmtNumber(totals.quantity, 2)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Base cost</div>
          <div className="font-medium tabular-nums text-ink">{fmtMoney(totals.cost, 'KRW')}</div>
        </div>
      </div>
      {selectedLots.length > 0 && (
        <div className="rounded-md border border-line-subtle bg-card px-3 py-2 text-[12px]">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={selectedLots[0].market === 'US' ? 'info' : 'success'}>{selectedLots[0].market}</Badge>
            <span className="font-medium text-ink">{selectedLots[0].name}</span>
            <span className="font-mono text-[11px] text-ink-3">{selectedLots[0].ticker}</span>
            <span className="text-[11px] text-ink-3">{selectedLots.length} lot(s) selected</span>
          </div>
          <div className="mt-1 text-[11px] text-ink-3">
            {selectedLots[0].brokerage} · {selectedLots[0].account} · {fmtMoney(selectedLots.reduce((sum, row) => sum + Number(row.cost_basis_krw ?? 0), 0), 'KRW')} base cost
            <Link href={positionHref(selectedLots[0].market, selectedLots[0].ticker)} className="ml-3 font-medium text-info hover:underline">
              Detail
            </Link>
          </div>
        </div>
      )}
      <DataTable
        rows={filtered}
        columns={[
          { key: 'market', label: 'Market', render: (r) => <Badge tone={r.market === 'US' ? 'info' : 'success'}>{r.market}</Badge> },
          { key: 'brokerage', label: 'Broker' },
          { key: 'account', label: 'Account' },
          {
            key: 'ticker',
            label: 'Instrument',
            render: (r) => (
              <div className="flex items-start gap-2">
                <button type="button" className="text-left" onClick={() => setSelectedKey(positionKey(r))}>
                  <InstrumentLabel row={r} />
                </button>
                <Link href={positionHref(r.market, r.ticker)} className="mt-0.5 text-[11px] font-medium text-info hover:underline">
                  Open
                </Link>
              </div>
            ),
          },
          { key: 'acquired_date', label: 'Acquired' },
          { key: 'open_quantity', label: 'Qty', align: 'right', render: (r) => fmtNumber(r.open_quantity, 2) },
          { key: 'native_cost_basis', label: 'Cost Basis', align: 'right', render: (r) => fmtMoney(r.native_cost_basis, r.currency) },
          { key: 'cost_basis_krw', label: 'Base Cost', align: 'right', render: (r) => fmtMoney(r.cost_basis_krw, 'KRW') },
          { key: 'holding_days', label: 'Days', align: 'right' },
          { key: 'tax_term', label: 'Term' },
        ]}
      />
    </div>
  )
}

export function TransactionsTable({ rows }: { rows: any[] }) {
  const [market, setMarket] = useState('All')
  const [brokerage, setBrokerage] = useState('All')
  const [type, setType] = useState('All')
  const filtered = useMemo(
    () => rows.filter((row) => rowMatches(row, { market, brokerage, type })),
    [rows, market, brokerage, type]
  )

  const scopedRows = rows.filter((r) => market === 'All' || r.market === market)
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <FilterBar label="Market" value={market} options={['All', ...unique(rows.map((r) => r.market))]} onChange={setMarket} />
        <FilterBar label="Broker" value={brokerage} options={['All', ...unique(scopedRows.map((r) => r.brokerage))]} onChange={setBrokerage} />
        <FilterBar label="Type" value={type} options={['All', ...unique(scopedRows.map((r) => r.type))]} onChange={setType} />
      </div>
      <div className="text-[11px] text-ink-3">{fmtNumber(filtered.length)} of {fmtNumber(rows.length)} recent rows</div>
      <DataTable
        rows={filtered}
        columns={[
          { key: 'market', label: 'Market', render: (r) => <Badge tone={r.market === 'US' ? 'info' : 'success'}>{r.market}</Badge> },
          { key: 'date', label: 'Date' },
          { key: 'brokerage', label: 'Broker' },
          { key: 'account', label: 'Account' },
          { key: 'type', label: 'Type', render: (r) => <Badge tone={r.type === 'DIVIDEND' ? 'success' : r.type === 'SELL' ? 'warning' : 'info'}>{r.type}</Badge> },
          { key: 'ticker', label: 'Ticker' },
          { key: 'name', label: 'Name' },
          { key: 'quantity', label: 'Qty', align: 'right', render: (r) => fmtNumber(r.quantity, 2) },
          { key: 'native_amount', label: 'Amount', align: 'right', render: (r) => fmtMoney(r.native_amount, r.currency) },
          { key: 'amount_krw', label: 'Base Amount', align: 'right', render: (r) => (r.amount_krw == null ? 'n/a' : fmtMoney(r.amount_krw, 'KRW')) },
          { key: 'source', label: 'Source' },
          { key: 'page', label: 'Page', align: 'right' },
        ]}
      />
    </div>
  )
}
