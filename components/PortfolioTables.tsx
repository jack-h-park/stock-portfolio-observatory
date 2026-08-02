'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge, Button , marketTone } from '@/components/ui'
import { DataTable } from '@/components/DataTable'
import { GlossaryTerm } from '@/components/GlossaryTerm'
import { fmtMoney, fmtNumber, fmtQuantity } from '@/lib/format'
import { positionHref } from '@/lib/position-url'
import { COMMON_LABELS } from '@/lib/ui-copy'
import type { CostBasisHolding, CostBasisStatus } from '@/lib/adapters/portfolio-db'

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
        <Badge tone={marketTone(row.market)}>{row.market}</Badge>
        <span className="font-mono text-[12px] text-ink">{row.ticker}</span>
      </div>
      <div className="mt-1 max-w-[18rem] truncate text-[12px] font-medium text-ink">{row.name}</div>
    </div>
  )
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] font-medium text-ink-2 sm:max-w-sm">
      {COMMON_LABELS.search}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-h-11 rounded-sm border border-line bg-card px-3 text-[14px] font-normal text-ink outline-none placeholder:text-ink-3 focus:border-info focus:ring-2 focus:ring-info/20"
      />
    </label>
  )
}

function easyFilterLabel(label: string) {
  return ({ Market: '시장', Broker: '증권사', Account: '계좌', Status: '상태' } as Record<string, string>)[label] ?? label
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
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${easyFilterLabel(label)} 필터`}>
      <span className="mr-1 text-[12px] font-medium text-ink-2">{easyFilterLabel(label)}</span>
      {options.map((option) => (
        <Button
          key={option}
          variant={value === option ? 'solid' : 'outline'}
          size="sm"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {option === 'All' ? COMMON_LABELS.all : option}
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
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="정렬 기준">
      <span className="mr-1 text-[12px] font-medium text-ink-2">{COMMON_LABELS.sort}</span>
      {options.map((option) => {
        const direction = option.direction ?? 'desc'
        const active = value.key === option.key && value.direction === direction
        return (
          <Button
            key={`${option.key}:${direction}`}
            variant={active ? 'solid' : 'outline'}
            size="sm"
            aria-pressed={active}
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

function fmtPct(value: number | null | undefined, digits = 2) {
  return value == null ? 'n/a' : `${fmtNumber(value, digits)}%`
}

const COST_BASIS_STATUS_LABEL: Record<CostBasisStatus, string> = {
  ready: 'Ready',
  missing_cost: 'Missing cost',
  estimated: 'Estimated',
  unpriced: 'Unpriced',
}

const COST_BASIS_STATUS_TONE: Record<CostBasisStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ready: 'success',
  missing_cost: 'danger',
  estimated: 'warning',
  unpriced: 'neutral',
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
  const hasActiveFilters = market !== 'All' || brokerage !== 'All' || account !== 'All' || query.trim() !== ''

  const clearFilters = () => {
    setMarket('All')
    setBrokerage('All')
    setAccount('All')
    setQuery('')
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <SearchBox value={query} onChange={setQuery} placeholder="종목코드, 종목명, 계좌 또는 증권사" />
        <SortBar
          value={sort}
          onChange={setSort}
          options={[
            { key: 'base_market_value', label: '평가금액' },
            { key: 'base_unrealized_gl', label: '평가손익' },
            { key: 'native_unrealized_gl_pct', label: '수익률' },
            { key: 'name', label: '이름순', direction: 'asc' },
          ]}
        />
      </div>
      <div className="flex flex-col gap-2 rounded-md border border-line-subtle bg-surface/60 p-3 xl:flex-row xl:items-center xl:justify-between">
        <FilterBar label="Market" value={market} options={['All', ...unique(rows.map((r) => r.market))]} onChange={setMarket} />
        <FilterBar
          label="Broker"
          value={brokerage}
          options={['All', ...unique(scopedRows.map((r) => r.brokerage))]}
          onChange={setBrokerage}
        />
        <FilterBar label="Account" value={account} options={['All', ...unique(brokerRows.map((r) => r.account))]} onChange={setAccount} />
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="self-start xl:self-auto">
            {COMMON_LABELS.clearFilters}
          </Button>
        )}
      </div>
      <div className="grid gap-3 rounded-md border border-line-subtle bg-surface px-3 py-3 text-[13px] sm:grid-cols-4" aria-live="polite">
        <div>
          <div className="text-[12px] text-ink-3">표시 종목</div>
          <div className="font-medium tabular-nums text-ink">{fmtNumber(filtered.length)} / {fmtNumber(rows.length)}</div>
        </div>
        <div>
          <div className="text-[12px] text-ink-3"><GlossaryTerm term="costBasis" compact /></div>
          <div className="font-medium tabular-nums text-ink">{fmtMoney(totals.cost, 'KRW')}</div>
        </div>
        <div>
          <div className="text-[12px] text-ink-3">현재 평가금액</div>
          <div className="font-medium tabular-nums text-ink">{fmtMoney(totals.marketValue, 'KRW')}</div>
        </div>
        <div>
          <div className="text-[12px] text-ink-3"><GlossaryTerm term="unrealizedGl" compact /></div>
          <div className={totals.unrealized >= 0 ? 'font-medium tabular-nums text-success' : 'font-medium tabular-nums text-danger'}>
            {fmtMoney(totals.unrealized, 'KRW')}
          </div>
        </div>
      </div>
      {selected && (
        <div className="flex flex-col gap-2 rounded-md border border-line-subtle bg-card px-3 py-2 text-[12px] lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge tone={marketTone(selected.market)}>{selected.market}</Badge>
              <span className="font-medium text-ink">{selected.name}</span>
              <span className="font-mono text-[11px] text-ink-3">{selected.ticker}</span>
            </div>
            <div className="mt-1 truncate text-[11px] text-ink-3">{selected.brokerage} · {selected.account}</div>
          </div>
          <div className="grid gap-x-5 gap-y-1 text-[11px] sm:grid-cols-5 lg:text-right">
            <div><span className="text-ink-3">수량 </span><span className="tabular-nums text-ink">{fmtQuantity(selected.quantity, 2)}</span></div>
            <div><span className="text-ink-3">취득원가 </span><span className="tabular-nums text-ink">{fmtMoney(selected.native_cost, selected.currency)}</span></div>
            <div><span className="text-ink-3">평가금액 </span><span className="tabular-nums text-ink">{selected.native_market_value == null ? '값 없음' : fmtMoney(selected.native_market_value, selected.currency)}</span></div>
            <div>
              <span className="text-ink-3">평가손익 </span>
              <span className={Number(selected.native_unrealized_gl ?? 0) >= 0 ? 'tabular-nums text-success' : 'tabular-nums text-danger'}>
                {selected.native_unrealized_gl == null ? '값 없음' : fmtMoney(selected.native_unrealized_gl, selected.currency)}
              </span>
            </div>
            <Link href={positionHref(selected.market, selected.ticker)} className="font-medium text-info hover:underline">
              {COMMON_LABELS.details}
            </Link>
          </div>
        </div>
      )}
      <DataTable
        caption="현재 보유종목 목록"
        rows={filtered}
        columns={[
          { key: 'market', label: '시장', render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge>, nowrap: true },
          { key: 'brokerage', label: '증권사', priority: 'secondary' },
          { key: 'account', label: '계좌', priority: 'secondary' },
          {
            key: 'ticker',
            label: '종목',
            render: (r) => (
              <div className="flex items-start gap-2">
                <button type="button" className="text-left" onClick={() => setSelectedKey(positionKey(r))}>
                  <InstrumentLabel row={r} />
                </button>
                <Link href={positionHref(r.market, r.ticker)} className="mt-0.5 text-[11px] font-medium text-info hover:underline">
                  열기
                </Link>
              </div>
            ),
          },
          { key: 'quantity', label: '수량', align: 'right', render: (r) => fmtQuantity(r.quantity, 2), nowrap: true },
          { key: 'native_cost', label: '취득원가', description: '해당 시장 통화로 표시한 실제 취득 금액입니다.', align: 'right', render: (r) => fmtMoney(r.native_cost, r.currency), priority: 'secondary', nowrap: true },
          { key: 'base_cost', label: '원화 취득원가', description: '취득원가를 화면의 기준 환율로 원화 환산한 값입니다.', align: 'right', render: (r) => (r.base_cost == null ? '값 없음' : fmtMoney(r.base_cost, 'KRW')), priority: 'tertiary', nowrap: true },
          { key: 'native_market_value', label: '평가금액', align: 'right', render: (r) => (r.native_market_value == null ? '값 없음' : fmtMoney(r.native_market_value, r.currency)), nowrap: true },
          {
            key: 'native_unrealized_gl',
            label: '평가손익',
            description: '현재 가격으로 계산한 미실현 손익입니다.',
            align: 'right',
            render: (r) =>
              r.native_unrealized_gl == null ? (
                '값 없음'
              ) : (
                <span className={r.native_unrealized_gl >= 0 ? 'text-success' : 'text-danger'}>
                  {fmtMoney(r.native_unrealized_gl, r.currency)}
                </span>
              ),
          },
          {
            key: 'base_unrealized_gl',
            label: '원화 평가손익',
            description: '평가손익을 기준 환율로 원화 환산한 값입니다.',
            align: 'right',
            priority: 'tertiary',
            render: (r) =>
              r.base_unrealized_gl == null ? (
                '값 없음'
              ) : (
                <span className={r.base_unrealized_gl >= 0 ? 'text-success' : 'text-danger'}>
                  {fmtMoney(r.base_unrealized_gl, 'KRW')}
                </span>
              ),
          },
          { key: 'long_term_qty', label: '장기', description: '세금상 장기 보유 요건을 충족한 수량입니다.', align: 'right', render: (r) => fmtNumber(r.long_term_qty, 2), priority: 'tertiary' },
          { key: 'short_term_qty', label: '단기', description: '장기 보유 요건을 아직 충족하지 않은 수량입니다.', align: 'right', render: (r) => fmtNumber(r.short_term_qty, 2), priority: 'tertiary' },
          { key: 'lot_count', label: '세금 단위', description: '매수 시점과 가격별로 나뉜 세금 계산용 묶음 수입니다.', align: 'right', priority: 'tertiary' },
        ]}
      />
    </div>
  )
}

export function CostBasisHoldingsTable({ rows }: { rows: CostBasisHolding[] }) {
  const [market, setMarket] = useState('All')
  const [brokerage, setBrokerage] = useState('All')
  const [account, setAccount] = useState('All')
  const [status, setStatus] = useState('All')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortConfig>({ key: 'base_market_value', direction: 'desc' })
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
            (status === 'All' || row.cost_status === status) &&
            includesSearch(row, query)
        ),
        sort
      ),
    [rows, market, brokerage, account, status, query, sort]
  )
  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, row) => {
          acc.value += Number(row.native_market_value ?? 0)
          acc.cost += Number(row.native_cost ?? 0)
          acc.baseValue += Number(row.base_market_value ?? 0)
          if (row.cost_status === 'missing_cost') acc.missing += 1
          if (row.cost_status === 'estimated') acc.estimated += 1
          return acc
        },
        { value: 0, cost: 0, baseValue: 0, missing: 0, estimated: 0 }
      ),
    [filtered]
  )
  const currencies = unique(filtered.map((r) => r.currency))
  const singleCurrency = currencies.length === 1 ? currencies[0] : null

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <SearchBox value={query} onChange={setQuery} placeholder="symbol, name, account, broker" />
        <SortBar
          value={sort}
          onChange={setSort}
          options={[
            { key: 'base_market_value', label: 'Value' },
            { key: 'native_cost', label: 'Total cost' },
            { key: 'native_unrealized_gl', label: 'Gain $' },
            { key: 'percent_of_total', label: '% total' },
            { key: 'ticker', label: 'Symbol A-Z', direction: 'asc' },
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
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Status</span>
          {(['All', ...Object.keys(COST_BASIS_STATUS_LABEL)] as string[]).map((option) => (
            <Button
              key={option}
              variant={status === option ? 'solid' : 'outline'}
              size="sm"
              onClick={() => setStatus(option)}
            >
              {option === 'All' ? 'All' : COST_BASIS_STATUS_LABEL[option as CostBasisStatus]}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-[12px] sm:grid-cols-5">
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Filtered</div>
          <div className="font-medium tabular-nums text-ink">{fmtNumber(filtered.length)} / {fmtNumber(rows.length)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Total value</div>
          <div className="font-medium tabular-nums text-ink">
            {singleCurrency ? fmtMoney(totals.value, singleCurrency) : fmtMoney(totals.baseValue, 'KRW')}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Total cost</div>
          <div className="font-medium tabular-nums text-ink">
            {singleCurrency ? fmtMoney(totals.cost, singleCurrency) : 'Mixed currencies'}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Missing cost</div>
          <div className={totals.missing > 0 ? 'font-medium tabular-nums text-danger' : 'font-medium tabular-nums text-success'}>
            {fmtNumber(totals.missing)}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Estimated</div>
          <div className={totals.estimated > 0 ? 'font-medium tabular-nums text-warning' : 'font-medium tabular-nums text-ink'}>
            {fmtNumber(totals.estimated)}
          </div>
        </div>
      </div>
      <DataTable
        rows={filtered}
        columns={[
          {
            key: 'ticker',
            label: 'Symbol',
            render: (r) => (
              <Link href={positionHref(r.market, r.ticker)} className="font-mono text-[12px] font-medium text-info hover:underline">
                {r.ticker}
              </Link>
            ),
          },
          { key: 'name', label: 'Name', render: (r) => <div className="min-w-[14rem] max-w-[20rem] truncate text-ink">{r.name}</div> },
          { key: 'brokerage', label: 'Broker' },
          { key: 'account', label: 'Account', render: (r) => <span className="whitespace-nowrap">{r.account}</span> },
          { key: 'quantity', label: 'Shares', align: 'right', render: (r) => fmtQuantity(r.quantity, 6) },
          { key: 'native_price', label: 'Price', align: 'right', render: (r) => (r.native_price == null ? 'n/a' : fmtMoney(r.native_price, r.currency)) },
          {
            key: 'native_market_value',
            label: 'Value',
            align: 'right',
            render: (r) => (r.native_market_value == null ? 'n/a' : fmtMoney(r.native_market_value, r.currency)),
          },
          {
            key: 'native_cost',
            label: 'Total Cost',
            align: 'right',
            render: (r) => (r.native_cost == null ? 'n/a' : fmtMoney(r.native_cost, r.currency)),
          },
          {
            key: 'native_unrealized_gl',
            label: 'Gain $',
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
            key: 'native_unrealized_gl_pct',
            label: 'Gain %',
            align: 'right',
            render: (r) => (
              <span className={Number(r.native_unrealized_gl_pct ?? 0) >= 0 ? 'text-success' : 'text-danger'}>
                {fmtPct(r.native_unrealized_gl_pct)}
              </span>
            ),
          },
          {
            key: 'day_change',
            label: 'Day $',
            align: 'right',
            render: (r) =>
              r.day_change == null ? (
                'n/a'
              ) : (
                <span className={r.day_change >= 0 ? 'text-success' : 'text-danger'}>{fmtMoney(r.day_change, r.currency)}</span>
              ),
          },
          {
            key: 'day_change_pct',
            label: 'Day %',
            align: 'right',
            render: (r) => (
              <span className={Number(r.day_change_pct ?? 0) >= 0 ? 'text-success' : 'text-danger'}>{fmtPct(r.day_change_pct)}</span>
            ),
          },
          { key: 'percent_of_total', label: '% of Total', align: 'right', render: (r) => fmtPct(r.percent_of_total) },
          {
            key: 'cost_status',
            label: 'Sync Status',
            render: (r) => {
              const costStatus = r.cost_status as CostBasisStatus
              return <Badge tone={COST_BASIS_STATUS_TONE[costStatus]}>{COST_BASIS_STATUS_LABEL[costStatus]}</Badge>
            },
          },
          { key: 'cost_note', label: 'Why', render: (r) => <div className="max-w-[20rem] text-[11px] text-ink-3">{r.cost_note}</div> },
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
          <div className="font-medium tabular-nums text-ink">{fmtQuantity(totals.quantity, 2)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Base cost</div>
          <div className="font-medium tabular-nums text-ink">{fmtMoney(totals.cost, 'KRW')}</div>
        </div>
      </div>
      {selectedLots.length > 0 && (
        <div className="rounded-md border border-line-subtle bg-card px-3 py-2 text-[12px]">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={selectedLots[0].marketTone(market)}>{selectedLots[0].market}</Badge>
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
          { key: 'market', label: 'Market', render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
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
          { key: 'market', label: 'Market', render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
          { key: 'date', label: 'Date' },
          { key: 'brokerage', label: 'Broker' },
          { key: 'account', label: 'Account' },
          { key: 'type', label: 'Type', render: (r) => <Badge tone={r.type === 'DIVIDEND' ? 'success' : r.type === 'SELL' ? 'warning' : 'info'}>{r.type}</Badge> },
          { key: 'ticker', label: 'Ticker' },
          { key: 'name', label: 'Name' },
          { key: 'quantity', label: 'Qty', align: 'right', render: (r) => fmtQuantity(r.quantity, 2) },
          { key: 'native_amount', label: 'Amount', align: 'right', render: (r) => fmtMoney(r.native_amount, r.currency) },
          { key: 'amount_krw', label: 'Base Amount', align: 'right', render: (r) => (r.amount_krw == null ? 'n/a' : fmtMoney(r.amount_krw, 'KRW')) },
          { key: 'source', label: 'Source' },
          { key: 'page', label: 'Page', align: 'right' },
        ]}
      />
    </div>
  )
}
