import Link from 'next/link'
import { DataTable, type DataTableColumn } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, MetricField } from '@/components/ui'
import { CardRow } from '@/components/layout'
import { StackedAssetChart } from '@/components/charts'
import { getAssetAllocation, getAssetEvents, getChildAssets, getForeignAccountMaxima, getMeta, getNetWorth, getSnapshotDates, getTotalAssetsSeries, portfolioToday } from '@/lib/adapters/portfolio-db'
import { convertMoney, createMoneyFormatter, formatKrw, formatUsd } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { getLanguage } from '@/lib/i18n-server'
import { routeMetadata, routeSection } from '@/lib/page-names'
import { lastCompleteYear, type ForeignAccountRow } from '@/lib/fbar'
import { ASSET_CLASSES, type NetWorth, type TotalAssetsPoint } from '@/lib/net-worth'
import { chartMarkers, snapEventDates } from '@/lib/asset-events'
import { AssetEventList } from '@/components/AssetEventList'
import { AllocationShares } from '@/components/AllocationShares'
import { TrendRangeLinks } from '@/components/TrendRangeLinks'
import { DEFAULT_TREND_RANGE, resolveTrendRange, trendRangeDays, type TrendRange } from '@/lib/trend-ranges'
import type { AllocationClass, AllocationWrapper } from '@/lib/asset-allocation'
import { getPageCopy } from '@/lib/ui-copy'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/net-worth')

type CashRow = NetWorth['cash'][number]
type HistoryRow = TotalAssetsPoint & { month: string; children?: number | null }
type ChildRow = { key: string; owner: string; account: string; asOf: string | null; valueKrw: number; subtotal?: boolean }

/** The first year the FBAR table offers: the Treasury rates file starts here. */
const FBAR_FIRST_YEAR = 2020

/**
 * Gold, crypto, pension and cash keep the colours the total-assets chart gives them
 * (crypto is marketColor('CRYPTO'), written out: charts.tsx is a client module).
 */
const CLASS_COLORS: Record<AllocationClass, string> = {
  kr_equity: 'var(--brand-cyan)',
  us_equity: 'var(--brand-blue)',
  bonds: 'var(--accent-info)',
  gold: 'var(--brand-pink)',
  crypto: 'var(--accent-warning)',
  pension: 'var(--brand-purple)',
  cash: 'var(--accent-success)',
  unclassified: 'var(--text-tertiary)',
}
const WRAPPER_COLORS: Record<AllocationWrapper, string> = {
  taxable: 'var(--brand-blue)',
  isa: 'var(--brand-cyan)',
  pension: 'var(--brand-purple)',
}

export default async function NetWorthPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const language = await getLanguage()
  const copy = getPageCopy('netWorth', language)
  // Every KRW figure in the display currency, as the Overview shows it. The
  // Balance column stays in each account's own currency.
  const currencyPreferences = await getCurrencyPreferences()
  const money = createMoneyFormatter(currencyPreferences)
  const toDisplayMillions = (krw: number) =>
    convertMoney(krw, 'KRW', currencyPreferences.displayCurrency, currencyPreferences.usdKrwRate).value / 1_000_000
  const meta = getMeta()
  const netWorth = getNetWorth()
  const allocation = getAssetAllocation(netWorth)
  const allocationCopy = copy.allocation
  const classes = ASSET_CLASSES
  // Every snapshot date, plus today. The month-end table keeps the last point of
  // each month: the month's last snapshot, and today for the current month.
  const totalAssets = getTotalAssetsSeries(getSnapshotDates(100 * 365), netWorth)
  // The chart and its events cover the selected period only (?trend=, 2Y by
  // default, as on the overview); the month-end table keeps every month.
  const selectedRange = resolveTrendRange(params.trend)
  const trendAssets = getTotalAssetsSeries(getSnapshotDates(trendRangeDays(selectedRange.days)), netWorth)
  const eventMarkers = snapEventDates(getAssetEvents(), trendAssets.points.map((point) => point.date))
  const eventsCopy = getPageCopy('assetEvents', language)
  // Self only unless ?children=1. Even then the children are their own band,
  // column and table: never inside a total on this page.
  const includeChildren = (Array.isArray(params.children) ? params.children[0] : params.children) === '1'
  const childAssets = includeChildren ? getChildAssets(totalAssets.points.map((point) => point.date)) : null
  const childrenOn = new Map((childAssets?.points ?? []).map((point) => [point.date, point.total]))
  const childCopy = copy.children
  const hrefWith = (next: { fbarYear?: number; children?: boolean; trend?: TrendRange['key'] }) => {
    const query = new URLSearchParams()
    const trend = next.trend ?? selectedRange.key
    if (trend !== DEFAULT_TREND_RANGE.key) query.set('trend', trend)
    const year = next.fbarYear ?? (params.fbarYear ? Number(Array.isArray(params.fbarYear) ? params.fbarYear[0] : params.fbarYear) : null)
    if (year) query.set('fbarYear', String(year))
    if (next.children ?? includeChildren) query.set('children', '1')
    const text = query.toString()
    return text ? `/net-worth?${text}` : '/net-worth'
  }
  const childRows: ChildRow[] = (childAssets?.owners ?? []).flatMap((owner) => [
    ...owner.accounts.map((account) => ({ key: `${owner.owner}|${account.account}`, owner: owner.label, account: account.account, asOf: account.asOf, valueKrw: account.valueKrw })),
    { key: `${owner.owner}|total`, owner: owner.label, account: childCopy.subtotal(owner.label), asOf: null, valueKrw: owner.totalKrw, subtotal: true },
  ])
  const monthEnds = new Map<string, HistoryRow>()
  for (const point of totalAssets.points)
    monthEnds.set(point.date.slice(0, 7), { ...point, month: point.date.slice(0, 7), ...(includeChildren ? { children: childrenOn.get(point.date) ?? null } : {}) })
  const history = [...monthEnds.values()]
  const notesFor = (key: (typeof ASSET_CLASSES)[number]) =>
    netWorth.asOfNotes.filter((note) => note.assetClass === key).map((note) => copy.asOfNote(note.label, fmtDate(note.asOf))).join(' · ')
  const amount = (value: number | null) => <span className="tabular-nums">{value == null ? copy.none : money(value)}</span>
  const kindLabel = (kind: string) => (kind in copy.kinds ? copy.kinds[kind as keyof typeof copy.kinds] : kind)
  // FBAR: the last complete year unless ?fbarYear= names another offered year.
  const currentYear = Number(portfolioToday().slice(0, 4))
  const fbarYears = Array.from({ length: currentYear - FBAR_FIRST_YEAR + 1 }, (_, i) => FBAR_FIRST_YEAR + i)
  const requestedYear = Number(Array.isArray(params.fbarYear) ? params.fbarYear[0] : params.fbarYear)
  const fbarYear = fbarYears.includes(requestedYear) ? requestedYear : lastCompleteYear(portfolioToday())
  const fbar = getForeignAccountMaxima(fbarYear)
  const fbarCopy = copy.fbar
  const fbarColumns: DataTableColumn<ForeignAccountRow>[] = [
    { key: 'institution', label: fbarCopy.columns.institution, render: (row: ForeignAccountRow) => <span className="font-medium text-ink">{row.institution}</span> },
    { key: 'account', label: fbarCopy.columns.account, render: (row: ForeignAccountRow) => row.account },
    { key: 'kind', label: fbarCopy.columns.kind, priority: 'secondary', render: (row: ForeignAccountRow) => fbarCopy.kinds[row.kind] },
    {
      key: 'coverage',
      label: fbarCopy.columns.coverage,
      render: (row: ForeignAccountRow) => (
        <span>
          {fbarCopy.coverage[row.coverage]}
          {row.understated ? (
            <>
              {' '}
              <Badge tone="warning">{fbarCopy.understated}</Badge>
            </>
          ) : null}
          {row.cashIncluded === false ? <span className="block text-label text-ink-3">{fbarCopy.cashNotIncluded}</span> : null}
        </span>
      ),
    },
    { key: 'maxDate', label: fbarCopy.columns.maxDate, nowrap: true, render: (row: ForeignAccountRow) => <span className="tabular-nums">{fmtDate(row.maxDate)}</span> },
    {
      key: 'maxKrw',
      label: fbarCopy.columns.maxKrw,
      align: 'right',
      nowrap: true,
      render: (row: ForeignAccountRow) => <span className="tabular-nums">{row.maxKrw == null ? copy.none : formatKrw(row.maxKrw)}</span>,
    },
    ...(fbar.rate
      ? [
          {
            key: 'maxUsd',
            label: fbarCopy.columns.maxUsd,
            align: 'right' as const,
            nowrap: true,
            render: (row: ForeignAccountRow) => <span className="tabular-nums">{row.maxUsd == null ? copy.none : formatUsd(row.maxUsd)}</span>,
          },
        ]
      : []),
  ]

  return (
    <>
      <PageHeader
        eyebrow={routeSection('/net-worth', language)}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle(fmtDateTime(meta.ingested_at, language))}
      />

      <CardRow columns={3}>
        <Card>
          <MetricField label={copy.total} value={money(netWorth.totalKrw)} valueClassName="text-metric" />
        </Card>
        <Card title={copy.byClass} className="md:col-span-2">
          <div className="grid grid-cols-2 gap-4 p-4 md:grid-cols-5">
            {classes.map((name) => (
              <MetricField
                key={name}
                label={copy.classes[name]}
                value={money(netWorth.byClass[name])}
                hint={notesFor(name) || undefined}
                valueClassName="text-title tabular-nums"
              />
            ))}
          </div>
          {netWorth.asOfNotes.length ? (
            <p className="border-t border-line-subtle px-4 py-3 text-label leading-relaxed text-ink-3">{copy.asOfNotesHint}</p>
          ) : null}
        </Card>
      </CardRow>

      <Card title={allocationCopy.title} className="mb-5">
        <div className="grid grid-cols-1 divide-y divide-line-subtle md:grid-cols-2 md:divide-x md:divide-y-0">
          <AllocationShares
            title={allocationCopy.byClass}
            shares={allocation.classes}
            labels={allocationCopy.classes}
            colors={CLASS_COLORS}
            money={money}
            columns={allocationCopy.columns}
          />
          <AllocationShares
            title={allocationCopy.byWrapper}
            shares={allocation.wrappers}
            labels={allocationCopy.wrappers}
            colors={WRAPPER_COLORS}
            money={money}
            columns={allocationCopy.columns}
            note={allocationCopy.wrapperNote}
          />
        </div>
        <div className="flex flex-col gap-1 border-t border-line-subtle bg-surface px-4 py-3 text-label leading-relaxed text-ink-3">
          <p>{allocationCopy.note}</p>
          {allocation.marketDefaults.length ? (
            <details>
              <summary className="cursor-pointer">
                {allocationCopy.marketDefaults(allocation.marketDefaults.length)} {allocationCopy.showDefaults}
              </summary>
              <p className="mt-1">
                {allocation.marketDefaults.map((row) => `${row.market}:${row.ticker} ${row.name} (${allocationCopy.classes[row.market === 'US' ? 'us_equity' : 'kr_equity']})`).join(' · ')}
              </p>
            </details>
          ) : null}
          {allocation.unclassified.length ? <p>{allocationCopy.unclassified(allocation.unclassified.map((row) => row.name).join(', '))}</p> : null}
        </div>
      </Card>

      <Card
        title={copy.trend}
        className="mb-5"
        action={
          <div className="flex flex-wrap items-center justify-end gap-1">
            <TrendRangeLinks selected={selectedRange} hrefFor={(trend) => hrefWith({ trend })} />
            <Link
              href={hrefWith({ children: !includeChildren })}
              scroll={false}
              aria-pressed={includeChildren}
              title={childCopy.toggleHint}
              className={`rounded-sm border px-2 py-1 text-label font-medium ${includeChildren ? 'border-info bg-info/10 text-info' : 'border-line text-ink-3 hover:border-info hover:text-info'}`}
            >
              {childCopy.toggle}
            </Link>
          </div>
        }
      >
        <StackedAssetChart
          points={trendAssets.points.map((point) => ({
            date: point.date,
            stocks: point.stocks == null ? null : toDisplayMillions(point.stocks),
            crypto: point.crypto == null ? null : toDisplayMillions(point.crypto),
            cash: point.cash == null ? null : toDisplayMillions(point.cash),
            pensions: point.pensions == null ? null : toDisplayMillions(point.pensions),
            gold: point.gold == null ? null : toDisplayMillions(point.gold),
            total: toDisplayMillions(point.total),
            ...(includeChildren ? { children: childrenOn.get(point.date) == null ? null : toDisplayMillions(childrenOn.get(point.date)!) } : {}),
          }))}
          childrenBand={includeChildren ? { label: childCopy.band, combinedLabel: childCopy.combined } : undefined}
          startsOn={trendAssets.startsOn}
          currency={currencyPreferences.displayCurrency}
          labels={{ ...copy.classes, total: copy.historyColumns.total }}
          axisLabel={currencyPreferences.displayCurrency === 'USD' ? copy.chartAxisUsd : copy.chartAxisKrw}
          markers={chartMarkers(eventMarkers, trendAssets.points[0]?.date)}
        />
        <div className="mt-1 text-label text-ink-3">
          {copy.trendStarts(classes.filter((key) => totalAssets.startsOn[key]).map((key) => copy.classSince(copy.classes[key], fmtDate(totalAssets.startsOn[key]!))))}
        </div>
        <div className="mt-2 text-label leading-relaxed text-ink-3">{copy.trendNote}</div>
        <div className="mt-4">
          <AssetEventList markers={eventMarkers} copy={eventsCopy} money={(krw) => money(krw)} />
        </div>
      </Card>

      {includeChildren ? (
        <Card title={childCopy.title} className="mb-5">
          <p className="border-b border-line-subtle bg-surface px-4 py-3 text-label leading-relaxed text-ink-3">
            {childCopy.note}
            {(childAssets?.owners ?? [])
              .filter((owner) => owner.derivation && owner.derivedFrom && owner.derivedUntil)
              .map((owner) => (
                <span key={owner.owner} className="mt-1 block">
                  {childCopy.derivedNote(owner.label, fmtDate(owner.derivedFrom!), fmtDate(owner.derivedUntil!), owner.derivation!)}
                </span>
              ))}
          </p>
          <DataTable
            caption={childCopy.title}
            rows={childRows}
            getRowKey={(row: ChildRow) => row.key}
            emptyMessage={childCopy.empty}
            columns={[
              { key: 'owner', label: childCopy.columns.owner, render: (row: ChildRow) => <span className="font-medium text-ink">{row.owner}</span> },
              { key: 'account', label: childCopy.columns.account, render: (row: ChildRow) => (row.subtotal ? <span className="font-medium text-ink">{row.account}</span> : row.account) },
              { key: 'asOf', label: childCopy.columns.asOf, nowrap: true, render: (row: ChildRow) => <span className="tabular-nums">{row.asOf ? fmtDate(row.asOf) : ''}</span> },
              {
                key: 'value',
                label: childCopy.columns.value,
                align: 'right',
                nowrap: true,
                render: (row: ChildRow) => <span className={`tabular-nums ${row.subtotal ? 'font-medium text-ink' : ''}`}>{money(row.valueKrw)}</span>,
              },
            ]}
          />
        </Card>
      ) : null}

      <Card title={copy.balances}>
        {netWorth.unpricedCash.length ? (
          <div className="border-b border-line-subtle bg-surface px-4 py-3 text-label leading-relaxed text-ink-3">
            <p>{copy.unpriced(netWorth.unpricedCash.join(', '))}</p>
          </div>
        ) : null}
        <DataTable
          caption={copy.balances}
          rows={netWorth.cash}
          getRowKey={(row: CashRow) => `${row.institution}|${row.account}`}
          emptyMessage={copy.empty}
          columns={[
            { key: 'institution', label: copy.columns.institution, render: (row: CashRow) => <span className="font-medium text-ink">{row.institution}</span> },
            { key: 'account', label: copy.columns.account, render: (row: CashRow) => row.account },
            { key: 'kind', label: copy.columns.kind, priority: 'secondary', render: (row: CashRow) => kindLabel(row.kind) },
            {
              key: 'asOf',
              label: copy.columns.asOf,
              nowrap: true,
              render: (row: CashRow) => (
                <span className="tabular-nums">
                  {fmtDate(row.asOfDate)}
                  {row.derived ? (
                    <>
                      {' '}
                      <Badge tone="info">{copy.derived}</Badge>
                    </>
                  ) : null}
                </span>
              ),
            },
            {
              key: 'balance',
              label: copy.columns.balance,
              align: 'right',
              nowrap: true,
              render: (row: CashRow) => <span className="tabular-nums">{row.currency === 'USD' ? formatUsd(row.balance) : formatKrw(row.balance)}</span>,
            },
            {
              key: 'krw',
              label: copy.columns.krw,
              align: 'right',
              nowrap: true,
              render: (row: CashRow) => <span className="tabular-nums">{row.krw == null ? copy.none : money(row.krw)}</span>,
            },
          ]}
        />
      </Card>

      {history.length ? (
        <Card title={copy.history}>
          <div className="flex flex-col gap-1 border-b border-line-subtle bg-surface px-4 py-3 text-label leading-relaxed text-ink-3">
            <p>{copy.historyNote}</p>
            <p>{copy.historyFxNote}</p>
          </div>
          <DataTable
            caption={copy.history}
            rows={history}
            getRowKey={(row: HistoryRow) => row.month}
            emptyMessage={copy.empty}
            columns={[
              { key: 'month', label: copy.historyColumns.month, render: (row: HistoryRow) => <span className="tabular-nums">{row.month}</span> },
              ...classes.map((key) => ({
                key,
                label: copy.historyColumns[key],
                align: 'right' as const,
                render: (row: HistoryRow) => amount(row[key]),
              })),
              {
                key: 'total',
                label: copy.historyColumns.total,
                align: 'right' as const,
                render: (row: HistoryRow) => <span className="font-medium tabular-nums text-ink">{money(row.total)}</span>,
              },
              ...(includeChildren
                ? [
                    {
                      key: 'children',
                      label: childCopy.historyColumn,
                      align: 'right' as const,
                      render: (row: HistoryRow) => amount(row.children ?? null),
                    },
                  ]
                : []),
            ]}
          />
        </Card>
      ) : null}

      <Card
        title={fbarCopy.title}
        className="mt-5"
        action={
          <nav aria-label={fbarCopy.yearLabel} className="flex flex-wrap items-center justify-end gap-1">
            {fbarYears.map((year) => (
              <Link
                key={year}
                href={hrefWith({ fbarYear: year })}
                scroll={false}
                aria-current={year === fbarYear ? 'page' : undefined}
                className={`rounded-sm border px-2 py-1 text-label font-medium ${year === fbarYear ? 'border-info bg-info/10 text-info' : 'border-line text-ink-3 hover:border-info hover:text-info'}`}
              >
                {year}
              </Link>
            ))}
          </nav>
        }
      >
        <div className="mb-3 flex flex-col gap-1 text-label leading-relaxed text-ink-3">
          <p className="font-medium text-ink-2">{fbarCopy.note}</p>
          <p>{fbarCopy.method}</p>
          <p>
            {fbar.rate
              ? fbarCopy.rate(fbar.rate.krwPerUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), fmtDate(fbar.rate.date))
              : fbarCopy.noRate(fbarYear)}
          </p>
          <p>{fbarCopy.understatedNote}</p>
          <p>{fbarCopy.cashNote}</p>
          {fbar.rows.some((row) => row.maxKrw == null) ? (
            <p>{fbarCopy.unpriced(fbar.rows.filter((row) => row.maxKrw == null).map((row) => `${row.institution} ${row.account}`).join(', '))}</p>
          ) : null}
        </div>
        <DataTable caption={fbarCopy.title} rows={fbar.rows} getRowKey={(row: ForeignAccountRow) => row.id} emptyMessage={fbarCopy.empty(fbarYear)} columns={fbarColumns} />
        {fbar.rows.length ? (
          <div className="mt-3 flex flex-wrap justify-end gap-x-6 gap-y-1 text-body">
            <span className="text-ink-3">{fbarCopy.aggregate}</span>
            <span className="font-medium tabular-nums text-ink">{formatKrw(fbar.rows.reduce((sum, row) => sum + (row.maxKrw ?? 0), 0))}</span>
            {fbar.aggregateMaxUsd != null ? <span className="font-medium tabular-nums text-ink">{formatUsd(fbar.aggregateMaxUsd)}</span> : null}
          </div>
        ) : null}
        {fbar.cryptoRows.length ? (
          <section className="mt-5 border-t border-line-subtle pt-4">
            <h3 className="mb-2 text-body font-medium text-ink-2">{fbarCopy.cryptoTitle}</h3>
            <DataTable caption={fbarCopy.cryptoTitle} rows={fbar.cryptoRows} getRowKey={(row: ForeignAccountRow) => row.id} emptyMessage={fbarCopy.empty(fbarYear)} columns={fbarColumns} />
            <div className="mt-3 flex flex-wrap justify-end gap-x-6 gap-y-1 text-body">
              <span className="text-ink-3">{fbarCopy.cryptoSubtotal}</span>
              <span className="font-medium tabular-nums text-ink">{formatKrw(fbar.cryptoRows.reduce((sum, row) => sum + (row.maxKrw ?? 0), 0))}</span>
              {fbar.cryptoSubtotalMaxUsd != null ? <span className="font-medium tabular-nums text-ink">{formatUsd(fbar.cryptoSubtotalMaxUsd)}</span> : null}
            </div>
          </section>
        ) : null}
      </Card>
    </>
  )
}
