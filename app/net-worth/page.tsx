import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, MetricField } from '@/components/ui'
import { CardRow } from '@/components/layout'
import { getMeta, getNetWorth } from '@/lib/adapters/portfolio-db'
import { formatKrw, formatUsd } from '@/lib/currency'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { getLanguage } from '@/lib/i18n-server'
import { routeMetadata, routeSection } from '@/lib/page-names'
import type { NetWorth } from '@/lib/net-worth'
import { getPageCopy } from '@/lib/ui-copy'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/net-worth')

type CashRow = NetWorth['cash'][number]
type HistoryRow = NetWorth['history'][number]

export default async function NetWorthPage() {
  const language = await getLanguage()
  const copy = getPageCopy('netWorth', language)
  const meta = getMeta()
  const netWorth = getNetWorth()
  const classes = ['stocks', 'crypto', 'cash', 'pension', 'gold'] as const
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
          <MetricField label={copy.total} value={formatKrw(netWorth.totalKrw)} valueClassName="text-metric" />
        </Card>
        <Card title={copy.byClass} className="md:col-span-2">
          <div className="grid grid-cols-2 gap-4 p-4 md:grid-cols-5">
            {classes.map((name) => (
              <MetricField key={name} label={copy.classes[name]} value={formatKrw(netWorth.byClass[name])} valueClassName="text-title tabular-nums" />
            ))}
          </div>
        </Card>
      </CardRow>

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
              render: (row: CashRow) => <span className="tabular-nums">{row.krw == null ? copy.none : formatKrw(row.krw)}</span>,
            },
          ]}
        />
      </Card>

      {netWorth.history.length ? (
        <Card title={copy.history}>
          <div className="flex flex-col gap-1 border-b border-line-subtle bg-surface px-4 py-3 text-label leading-relaxed text-ink-3">
            <p>{copy.historyNote}</p>
            <p>{copy.historyFxNote}</p>
          </div>
          <DataTable
            caption={copy.history}
            rows={netWorth.history}
            getRowKey={(row: HistoryRow) => row.month}
            emptyMessage={copy.empty}
            columns={[
              { key: 'month', label: copy.historyColumns.month, render: (row: HistoryRow) => <span className="tabular-nums">{row.month}</span> },
              {
                key: 'stocks',
                label: copy.historyColumns.stocks,
                align: 'right',
                render: (row: HistoryRow) => <span className="tabular-nums">{row.stocks == null ? copy.none : formatKrw(row.stocks)}</span>,
              },
              { key: 'cash', label: copy.historyColumns.cash, align: 'right', render: (row: HistoryRow) => <span className="tabular-nums">{formatKrw(row.cash)}</span> },
            ]}
          />
        </Card>
      ) : null}
    </>
  )
}
