import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, MetricField } from '@/components/ui'
import { CardRow } from '@/components/layout'
import { StackedAssetChart } from '@/components/charts'
import { getMeta, getNetWorth, getSnapshotDates, getTotalAssetsSeries } from '@/lib/adapters/portfolio-db'
import { convertMoney, createMoneyFormatter, formatKrw, formatUsd } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { getLanguage } from '@/lib/i18n-server'
import { routeMetadata, routeSection } from '@/lib/page-names'
import { ASSET_CLASSES, type NetWorth, type TotalAssetsPoint } from '@/lib/net-worth'
import { getPageCopy } from '@/lib/ui-copy'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/net-worth')

type CashRow = NetWorth['cash'][number]
type HistoryRow = TotalAssetsPoint & { month: string }

export default async function NetWorthPage() {
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
  const classes = ASSET_CLASSES
  // Every snapshot date, plus today. The month-end table keeps the last point of
  // each month: the month's last snapshot, and today for the current month.
  const totalAssets = getTotalAssetsSeries(getSnapshotDates(100 * 365), netWorth)
  const monthEnds = new Map<string, HistoryRow>()
  for (const point of totalAssets.points) monthEnds.set(point.date.slice(0, 7), { ...point, month: point.date.slice(0, 7) })
  const history = [...monthEnds.values()]
  const notesFor = (key: (typeof ASSET_CLASSES)[number]) =>
    netWorth.asOfNotes.filter((note) => note.assetClass === key).map((note) => copy.asOfNote(note.label, fmtDate(note.asOf))).join(' · ')
  const amount = (value: number | null) => <span className="tabular-nums">{value == null ? copy.none : money(value)}</span>
  const kindLabel = (kind: string) => (kind in copy.kinds ? copy.kinds[kind as keyof typeof copy.kinds] : kind)

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

      <Card title={copy.trend} className="mb-5">
        <StackedAssetChart
          points={totalAssets.points.map((point) => ({
            date: point.date,
            stocks: point.stocks == null ? null : toDisplayMillions(point.stocks),
            crypto: point.crypto == null ? null : toDisplayMillions(point.crypto),
            cash: point.cash == null ? null : toDisplayMillions(point.cash),
            pensions: point.pensions == null ? null : toDisplayMillions(point.pensions),
            gold: point.gold == null ? null : toDisplayMillions(point.gold),
            total: toDisplayMillions(point.total),
          }))}
          startsOn={totalAssets.startsOn}
          currency={currencyPreferences.displayCurrency}
          labels={{ ...copy.classes, total: copy.historyColumns.total }}
          axisLabel={currencyPreferences.displayCurrency === 'USD' ? copy.chartAxisUsd : copy.chartAxisKrw}
        />
        <div className="mt-1 text-label text-ink-3">
          {copy.trendStarts(classes.filter((key) => totalAssets.startsOn[key]).map((key) => copy.classSince(copy.classes[key], fmtDate(totalAssets.startsOn[key]!))))}
        </div>
        <div className="mt-2 text-label leading-relaxed text-ink-3">{copy.trendNote}</div>
      </Card>

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
            ]}
          />
        </Card>
      ) : null}
    </>
  )
}
