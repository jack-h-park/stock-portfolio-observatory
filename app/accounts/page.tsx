import { AccountInventoryReview } from '@/components/AccountInventoryReview'
import { getAccountInventoryReview } from '@/lib/adapters/account-inventory'
import { AccountTimeline, TimelineLegend, TimelineScale, timelineAxis } from '@/components/AccountTimeline'
import { SupplementaryCoverageTable } from '@/components/SupplementaryCoverageTable'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, MetricField, TextLink, marketTone } from '@/components/ui'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { CardRow } from '@/components/layout'
import { getAccountAllocation, getAccountDataRanges, getMeta, getSupplementaryCoverage, getBrokerageAccountHints } from '@/lib/adapters/portfolio-db'
import { maskAccountLabel } from '@/lib/account-label'
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
  const inventoryReview = getAccountInventoryReview()
  const accounts = getAccountDataRanges()
  const hints = getBrokerageAccountHints()
  const supplementary = getSupplementaryCoverage()
  const holdingsByAccount = getAccountAllocation()
  const money = createMoneyFormatter(await getCurrencyPreferences())
  const bankAccounts = accounts.filter(account => account.assetType === 'cash')
  const investments = accounts.filter(account => account.assetType !== 'cash')
  const summary = summarizeAccountRanges(accounts)
  const axis = timelineAxis(summary.firstDate, summary.lastDate)

  const span = (range: DateRange | undefined) =>
    range?.start && range.end ? (
      <>
        {/* Each date is kept whole and the line may break between them, so a
            narrow column shows the range on two lines instead of cutting it. */}
        <div className="tabular-nums text-ink">
          <span className="whitespace-nowrap">{fmtDate(range.start, language)}</span>
          {range.end !== range.start ? (
            <>
              {' '}
              <span className="whitespace-nowrap">{copy.rangeEnd(fmtDate(range.end, language))}</span>
            </>
          ) : null}
        </div>
        <div className="text-label tabular-nums text-ink-3">{range.count === 0 ? copy.noHoldings : copy.rows(range.count, fmtNumber(range.count))}</div>
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

      <AccountInventoryReview review={inventoryReview} language={language} />

      <CardRow columns={3}>
        <Card accent>
          <MetricField
            label={copy.accounts}
            value={fmtNumber(summary.total)}
            hint={copy.accountsHint(Object.entries(summary.byMarket).map(([market, count]) => copy.marketCount(market, fmtNumber(count))))}
            size="metric"
          />
        </Card>
        <Card>
          <MetricField label={copy.firstDate} value={fmtDate(summary.firstDate, language)} hint={copy.firstDateHint} />
        </Card>
        <Card>
          <MetricField label={copy.lastDate} value={fmtDate(summary.lastDate, language)} hint={copy.lastDateHint} />
        </Card>
      </CardRow>

      <Card
        title={copy.investmentsTitle}
        info={copy.tableInfo}
        action={<TextLink href="/data-ops#account-coverage">{copy.nextDownloads}</TextLink>}
      >
        {axis ? (
          <div className="flex flex-col gap-2 border-b border-line-subtle bg-surface px-4 py-3 text-label leading-relaxed text-ink-3">
            <TimelineLegend labels={copy.legend} />
          </div>
        ) : null}
        <DataTable
          caption={copy.investmentsTitle}
          rows={investments}
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
                    {maskAccountLabel(row.name)}{hints.get(row.name)?.suffix ? ` · ${hints.get(row.name)!.suffix}` : null}
                    {hints.get(row.name)?.retired ? <span className="ml-2 text-ink-3">{copy.closed}</span> : null}
                    {row.accountType && !row.name.includes(row.accountType) ? <span className="text-ink-3"> · {row.accountType}</span> : null}
                  </div>
                  {row.aliases.length ? <div className="text-label text-ink-3">{copy.alsoStoredAs(row.aliases.map(maskAccountLabel).join(', '))}</div> : null}
                </div>
              ),
            },
            { key: 'assetType', label: copy.columns.assetType, nowrap: true, render: (row: AccountDataRange) => row.market === 'CRYPTO' ? copy.crypto : copy.assetTypes[row.assetType] },
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
                        label={copy.timelineLabel(maskAccountLabel(row.name), fmtDate(row.firstDate, language), fmtDate(row.lastDate, language))}
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
                    <div className="tabular-nums text-ink">{copy.since(fmtDate(row.ranges.lots.start, language))}</div>
                    <div className="text-label tabular-nums text-ink-3">{copy.rows(row.ranges.lots.count, fmtNumber(row.ranges.lots.count))}</div>
                  </>
                ) : (
                  <span className="text-ink-3">{copy.none}</span>
                ),
            },
            { key: 'realized', label: copy.columns.realized, priority: 'tertiary', render: (row: AccountDataRange) => span(row.ranges.realized) },
          ]}
        />
      </Card>
      <Card className="mt-5" title={copy.banksTitle} info={copy.banksInfo} action={<TextLink href="/data-ops#supplementary-coverage">{copy.nextDownloads}</TextLink>}>
        <SupplementaryCoverageTable language={language} accounts={bankAccounts} rows={supplementary.rows.filter(row => row.kind === 'deposit' || row.kind === 'cma')} />
      </Card>
      <Card className="mt-5" id="accounts-holdings" title={copy.accountAllocation} info={copy.accountAllocationInfo}>
        {holdingsByAccount.length === 0 ? (
          <EmptyState>{copy.noAccountData}</EmptyState>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {holdingsByAccount.map((a) => (
              <li key={`${a.market}:${a.currency}:${a.account}`} className="flex items-center gap-3 py-2">
                <Badge tone={marketTone(a.market)}>{a.market}</Badge>
                <div className="min-w-0 flex-1 truncate text-body text-ink">{maskAccountLabel(a.account)}</div>
                <div className="text-caption tabular-nums text-ink-3">{copy.holdingRows(a.count)}</div>
                <div className="w-36 text-right text-caption font-medium tabular-nums text-ink">{money(a.value, a.currency)}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
