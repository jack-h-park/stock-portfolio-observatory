import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { DataTable } from '@/components/DataTable'
import { FilterBar } from '@/components/FilterBar'
import { Badge, Card, Label, Signed, marketTone } from '@/components/ui'
import { getHoldings } from '@/lib/adapters/portfolio-db'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { fmtNumber, fmtPct, fmtQuantity } from '@/lib/format'
import { getLanguage } from '@/lib/i18n-server'
import { positionHref } from '@/lib/position-url'
import { getUiCopy } from '@/lib/ui-copy'
import { applyFilters, applySearch, filterOptions, readFilters, withParam, type FilterGroup } from '@/lib/table-filter'
import { formatSort, parseSort, sortRows, type TableSort } from '@/lib/table-sort'

export const dynamic = 'force-dynamic'

const BASE = '/holdings'

const COPY = {
  en: {
    searchPlaceholder: 'Ticker, name, account, or broker',
    sortLabel: 'Sort',
    sort: {
      value: 'Market value',
      gain: 'Unrealized G/L',
      return: 'Return',
      name: 'Name A-Z',
    },
    filtered: 'Displayed holdings',
    marketValue: 'Current market value',
    quantity: 'Qty',
    costBasis: 'Cost basis',
    noValue: 'No value',
    caption: 'Current holdings list',
    market: 'Market',
    broker: 'Broker',
    account: 'Account',
    instrument: 'Instrument',
    open: 'Open',
    baseCost: 'KRW cost basis',
    baseGain: 'KRW unrealized G/L',
    nativeCostDescription: 'Actual acquisition amount in the market currency.',
    baseCostDescription: 'Cost basis converted to KRW using the dashboard FX rate.',
    gainDescription: 'Unrealized gain or loss based on the current price.',
    baseGainDescription: 'Unrealized gain or loss converted to KRW using the base FX rate.',
    longTerm: 'Long',
    shortTerm: 'Short',
    taxLots: 'Tax lots',
    longTermDescription: 'Quantity that satisfies the long-term holding-period rule.',
    shortTermDescription: 'Quantity that has not yet satisfied the long-term holding-period rule.',
    lotDescription: 'Number of tax-calculation groups split by purchase date and price.',
  },
  ko: {
    searchPlaceholder: '종목코드, 종목명, 계좌 또는 증권사',
    sortLabel: '정렬',
    sort: {
      value: '평가금액',
      gain: '평가손익',
      return: '수익률',
      name: '이름순',
    },
    filtered: '표시 종목',
    marketValue: '현재 평가금액',
    quantity: '수량',
    costBasis: '취득원가',
    noValue: '값 없음',
    caption: '현재 보유종목 목록',
    market: '시장',
    broker: '증권사',
    account: '계좌',
    instrument: '종목',
    open: '열기',
    baseCost: '원화 취득원가',
    baseGain: '원화 평가손익',
    nativeCostDescription: '해당 시장 통화로 표시한 실제 취득 금액입니다.',
    baseCostDescription: '취득원가를 화면의 기준 환율로 원화 환산한 값입니다.',
    gainDescription: '현재 가격으로 계산한 미실현 손익입니다.',
    baseGainDescription: '평가손익을 기준 환율로 원화 환산한 값입니다.',
    longTerm: '장기',
    shortTerm: '단기',
    taxLots: '세금 단위',
    longTermDescription: '세금상 장기 보유 요건을 충족한 수량입니다.',
    shortTermDescription: '장기 보유 요건을 아직 충족하지 않은 수량입니다.',
    lotDescription: '매수 시점과 가격별로 나뉜 세금 계산용 묶음 수입니다.',
  },
} as const

const GROUPS: FilterGroup<any>[] = [
  { key: 'market', label: 'Market' },
  { key: 'brokerage', label: 'Broker' },
  { key: 'account', label: 'Account' },
]

export default async function HoldingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const language = await getLanguage()
  const copy = COPY[language]
  const labels = getUiCopy(language).common
  const money = createMoneyFormatter(await getCurrencyPreferences())
  const rows = getHoldings(1000)

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
      cost: acc.cost + Number(row.base_cost ?? row.total_cost_krw ?? 0),
      marketValue: acc.marketValue + Number(row.base_market_value ?? 0),
      unrealized: acc.unrealized + Number(row.base_unrealized_gl ?? 0),
    }),
    { cost: 0, marketValue: 0, unrealized: 0 }
  )

  const groupLabels: Record<string, string> = {
    market: copy.market,
    brokerage: copy.broker,
    account: copy.account,
  }

  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title={language === 'ko' ? '보유종목' : 'Holdings'}
        emphasis={language === 'ko' ? '보유종목' : 'Holdings'}
        subtitle={
          language === 'ko'
            ? `${fmtNumber(rows.length)}개 보유 포지션을 시장·증권사·계좌로 검색합니다.`
            : `Search ${fmtNumber(rows.length)} open positions by market, broker, or account.`
        }
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
              options: options[group.key].map((value: string) => ({ value, label: value })),
              selected: selected[group.key],
            }))}
          />
          <div className="grid gap-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-caption sm:grid-cols-4">
            <div>
              <Label>{copy.filtered}</Label>
              <div className="font-medium tabular-nums text-ink">{fmtNumber(filtered.length)} / {fmtNumber(rows.length)}</div>
            </div>
            <div>
              <Label>{copy.costBasis}</Label>
              <div className="font-medium tabular-nums text-ink">{money(totals.cost, 'KRW')}</div>
            </div>
            <div>
              <Label>{copy.marketValue}</Label>
              <div className="font-medium tabular-nums text-ink">{money(totals.marketValue, 'KRW')}</div>
            </div>
            <div>
              <Label>{copy.sort.gain}</Label>
              <div className="font-medium"><Signed value={totals.unrealized} format={(m) => money(m, 'KRW')} /></div>
            </div>
          </div>
          <DataTable
            rows={filtered}
            caption={copy.caption}
            sort={sort}
            sortHref={(next: TableSort) => withParam(BASE, params, 'sort', formatSort(next))}
            columns={[
              { key: 'market', label: copy.market, sortable: true, sortFirst: 'asc', nowrap: true, render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
              { key: 'brokerage', label: copy.broker, sortable: true, sortFirst: 'asc', priority: 'secondary' },
              { key: 'account', label: copy.account, sortable: true, sortFirst: 'asc', priority: 'secondary' },
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
              { key: 'quantity', label: copy.quantity, align: 'right', sortable: true, nowrap: true, render: (r) => fmtQuantity(r.quantity, 2) },
              { key: 'native_cost', label: copy.costBasis, description: copy.nativeCostDescription, align: 'right', sortable: true, priority: 'secondary', nowrap: true, render: (r) => money(r.native_cost, r.currency) },
              { key: 'base_cost', label: copy.baseCost, description: copy.baseCostDescription, align: 'right', sortable: true, priority: 'tertiary', nowrap: true, render: (r) => (r.base_cost == null ? copy.noValue : money(r.base_cost, 'KRW')) },
              { key: 'native_market_value', label: copy.marketValue, align: 'right', sortable: true, nowrap: true, render: (r) => (r.native_market_value == null ? copy.noValue : money(r.native_market_value, r.currency)) },
              { key: 'native_unrealized_gl', label: copy.sort.gain, description: copy.gainDescription, align: 'right', sortable: true, nowrap: true, render: (r) => <Signed value={r.native_unrealized_gl} format={(m) => money(m, r.currency)} /> },
              { key: 'base_unrealized_gl', label: copy.baseGain, description: copy.baseGainDescription, align: 'right', sortable: true, priority: 'tertiary', nowrap: true, render: (r) => <Signed value={r.base_unrealized_gl} format={(m) => money(m, 'KRW')} /> },
              { key: 'unrealized_gl_pct', label: copy.sort.return, align: 'right', sortable: true, nowrap: true, render: (r) => <Signed value={r.unrealized_gl_pct} format={(m) => fmtPct(m)} /> },
              { key: 'long_term_qty', label: copy.longTerm, description: copy.longTermDescription, align: 'right', sortable: true, priority: 'tertiary', render: (r) => fmtNumber(r.long_term_qty, 2) },
              { key: 'short_term_qty', label: copy.shortTerm, description: copy.shortTermDescription, align: 'right', sortable: true, priority: 'tertiary', render: (r) => fmtNumber(r.short_term_qty, 2) },
              { key: 'lot_count', label: copy.taxLots, description: copy.lotDescription, align: 'right', sortable: true, priority: 'tertiary' },
            ]}
          />
        </div>
      </Card>
    </>
  )
}
