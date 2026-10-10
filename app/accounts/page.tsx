import { AccountTimeline, TimelineLegend, TimelineScale, timelineAxis } from '@/components/AccountTimeline'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, MetricField, TextLink, marketTone } from '@/components/ui'
import { CardRow } from '@/components/layout'
import { getAccountDataRanges, getMeta } from '@/lib/adapters/portfolio-db'
import { summarizeAccountRanges, type AccountDataRange, type DateRange } from '@/lib/account-ranges'
import { fmtDate, fmtDateTime, fmtNumber } from '@/lib/format'
import { getLanguage } from '@/lib/i18n-server'
import { routeMetadata, routeSection } from '@/lib/page-names'
import { getPageCopy } from '@/lib/ui-copy'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/accounts')

export default async function AccountsPage() {
  const language = await getLanguage()
  const copy = getPageCopy('accounts', language)
  const meta = getMeta()
  const accounts = getAccountDataRanges()
  const summary = summarizeAccountRanges(accounts)
  const axis = timelineAxis(summary.firstDate, summary.lastDate)

  const span = (range: DateRange | undefined) =>
    range?.start && range.end ? (
      <>
        {/* Each date is kept whole and the line may break between them, so a
            narrow column shows the range on two lines instead of cutting it. */}
        <div className="tabular-nums text-ink">
          <span className="whitespace-nowrap">{fmtDate(range.start)}</span>
          {range.end !== range.start ? (
            <>
              {' '}
              <span className="whitespace-nowrap">{copy.rangeEnd(fmtDate(range.end))}</span>
            </>
          ) : null}
        </div>
        <div className="text-label tabular-nums text-ink-3">{copy.rows(range.count, fmtNumber(range.count))}</div>
      </>
    ) : (
      <span className="text-ink-3">{copy.none}</span>
    )

  return (
    <>
      <PageHeader
        eyebrow={routeSection('/accounts', language)}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle(fmtDateTime(meta.ingested_at, language))}
      />

      <CardRow columns={3}>
        <Card>
          <MetricField
            label={copy.accounts}
            value={fmtNumber(summary.total)}
            hint={copy.accountsHint(Object.entries(summary.byMarket).map(([market, count]) => copy.marketCount(market, fmtNumber(count))))}
            valueClassName="text-metric"
          />
        </Card>
        <Card>
          <MetricField label={copy.firstDate} value={fmtDate(summary.firstDate)} hint={copy.firstDateHint} valueClassName="text-title tabular-nums" />
        </Card>
        <Card>
          <MetricField label={copy.lastDate} value={fmtDate(summary.lastDate)} hint={copy.lastDateHint} valueClassName="text-title tabular-nums" />
        </Card>
      </CardRow>

      <Card
        title={copy.tableTitle}
        info={copy.tableInfo}
        accent
        action={<TextLink href="/data-ops#account-coverage">{copy.nextDownloads}</TextLink>}
      >
        {axis ? (
          <div className="flex flex-col gap-2 border-b border-line-subtle bg-surface px-4 py-3 text-label leading-relaxed text-ink-3">
            <TimelineLegend labels={copy.legend} />
          </div>
        ) : null}
        <DataTable
          caption={copy.tableTitle}
          rows={accounts}
          getRowKey={(row: AccountDataRange) => row.id}
          emptyMessage={copy.empty}
          columns={[
            {
              key: 'account',
              label: copy.columns.account,
              render: (row: AccountDataRange) => (
                <div className="min-w-[11rem]">
                  <div className="flex items-center gap-2">
                    <Badge tone={marketTone(row.market)}>{row.market}</Badge>
                    <span className="font-medium text-ink">{row.brokerage}</span>
                  </div>
                  <div className="mt-1 text-label text-ink-2">
                    {row.name}
                    {row.accountType && !row.name.includes(row.accountType) ? <span className="text-ink-3"> · {row.accountType}</span> : null}
                  </div>
                  {row.aliases.length ? <div className="text-label text-ink-3">{copy.alsoStoredAs(row.aliases.join(', '))}</div> : null}
                </div>
              ),
            },
            { key: 'assetType', label: copy.columns.assetType, nowrap: true, render: (row: AccountDataRange) => copy.assetTypes[row.assetType] },
            ...(axis
              ? [
                  {
                    key: 'timeline',
                    label: <TimelineScale axis={axis} label={copy.columns.timeline} />,
                    priority: 'secondary' as const,
                    render: (row: AccountDataRange) => (
                      <AccountTimeline
                        axis={axis}
                        transactions={row.ranges.transactions}
                        dividends={row.ranges.dividends}
                        holdings={row.ranges.holdings}
                        label={copy.timelineLabel(row.name, fmtDate(row.firstDate), fmtDate(row.lastDate))}
                      />
                    ),
                  },
                ]
              : []),
            { key: 'transactions', label: copy.columns.transactions, render: (row: AccountDataRange) => span(row.ranges.transactions) },
            { key: 'dividends', label: copy.columns.dividends, render: (row: AccountDataRange) => span(row.ranges.dividends) },
            { key: 'holdings', label: copy.columns.holdings, render: (row: AccountDataRange) => span(row.ranges.holdings) },
            {
              key: 'lots',
              label: copy.columns.lots,
              nowrap: true,
              priority: 'secondary',
              render: (row: AccountDataRange) =>
                row.ranges.lots?.start ? (
                  <>
                    <div className="tabular-nums text-ink">{copy.since(fmtDate(row.ranges.lots.start))}</div>
                    <div className="text-label tabular-nums text-ink-3">{copy.rows(row.ranges.lots.count, fmtNumber(row.ranges.lots.count))}</div>
                  </>
                ) : (
                  <span className="text-ink-3">{copy.none}</span>
                ),
            },
            { key: 'balances', label: copy.columns.balances, priority: 'secondary', render: (row: AccountDataRange) => span(row.ranges.balances) },
            { key: 'realized', label: copy.columns.realized, priority: 'tertiary', render: (row: AccountDataRange) => span(row.ranges.realized) },
          ]}
        />
      </Card>
    </>
  )
}
