import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { WrapperReviewCard } from '@/components/WrapperReviewCard'
import { Badge, Card, EmptyState, MetricField, Signed } from '@/components/ui'
import { CardRow } from '@/components/layout'
import { dbAvailable, getMeta, getPensionAccounts, getWrapperReview, type PensionAccount, type PensionHolding } from '@/lib/adapters/portfolio-db'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { fmtDate, fmtDateTime, fmtPct } from '@/lib/format'
import { getLanguage } from '@/lib/i18n-server'
import { routeMetadata, routeSection } from '@/lib/page-names'
import { contributionsAgainstLimits, type ContributionLimitRow } from '@/lib/pension'
import { getTaxPolicyState } from '@/lib/tax-policy'
import { getPageCopy } from '@/lib/ui-copy'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/pension')

export default async function PensionPage() {
  const language = await getLanguage()
  const copy = getPageCopy('pension', language)
  const wrapperReviewCopy = getPageCopy('taxPlanning', language).wrapperReview
  const { policy } = getTaxPolicyState()
  const available = dbAvailable()
  const meta = available ? getMeta() : {}
  const accounts = available ? getPensionAccounts() : []
  const wrapperReview = available ? getWrapperReview(policy) : []
  const years = contributionsAgainstLimits(accounts, policy)
  // Money in the display currency, as the Overview shows it.
  const money = createMoneyFormatter(await getCurrencyPreferences())
  const krw = (value: number | null) => (value == null ? copy.none : money(value))

  return (
    <>
      <PageHeader
        eyebrow={routeSection('/pension', language)}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle(fmtDateTime(meta.ingested_at, language))}
      />

      {accounts.length === 0 ? (
        <Card className="mb-5">
          <EmptyState>{copy.empty}</EmptyState>
        </Card>
      ) : (
        <>
          <CardRow columns={2}>
            {accounts.map((account: PensionAccount) => (
              <Card key={`${account.wrapper}:${account.account}`} title={account.account} action={<Badge tone="info">{copy.wrappers[account.wrapper] ?? account.wrapper}</Badge>}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <MetricField
                    label={copy.value}
                    value={money(account.valueKrw)}
                    hint={account.snapshotDate ? copy.snapshotAsOf(fmtDate(account.snapshotDate)) : undefined}
                    valueClassName="text-title"
                  />
                  <MetricField label={copy.cost} value={money(account.costKrw)} valueClassName="text-title" />
                  <MetricField
                    label={copy.return}
                    value={<Signed value={account.returnPct} format={(n) => fmtPct(n)} nullText={copy.none} />}
                    valueClassName="text-title"
                  />
                </div>
              </Card>
            ))}
          </CardRow>

          <Card title={copy.holdings} className="mb-5">
            <p className="mb-3 text-label leading-relaxed text-ink-3">{copy.snapshotNote}</p>
            <DataTable
              caption={copy.holdings}
              rows={accounts.flatMap((account) => account.holdings.map((holding, index) => ({ ...holding, account: account.account, key: `${account.account}:${index}` })))}
              getRowKey={(row: PensionHolding & { account: string; key: string }) => row.key}
              columns={[
                { key: 'account', label: wrapperReviewCopy.account, priority: 'secondary', render: (row: PensionHolding & { account: string }) => row.account },
                { key: 'name', label: copy.columns.name, render: (row: PensionHolding) => <span className="text-ink">{row.name}</span> },
                { key: 'kind', label: copy.columns.kind, nowrap: true, render: (row: PensionHolding) => <Badge tone="neutral">{copy.kinds[row.kind] ?? row.kind}</Badge> },
                {
                  key: 'value',
                  label: copy.columns.value,
                  align: 'right',
                  nowrap: true,
                  render: (row: PensionHolding) => <span className="font-mono">{money(row.valueKrw)}</span>,
                },
                {
                  key: 'asOf',
                  label: copy.columns.asOf,
                  nowrap: true,
                  render: (row: PensionHolding) => (
                    <span className="tabular-nums">
                      {row.valuationSource === 'price'
                        ? copy.priced
                        : row.valuationSource === 'cost'
                          ? copy.atCost(fmtDate(row.asOf))
                          : fmtDate(row.asOf)}
                    </span>
                  ),
                },
                { key: 'cost', label: copy.columns.cost, align: 'right', nowrap: true, render: (row: PensionHolding) => <span className="font-mono">{money(row.costKrw)}</span> },
              ]}
            />
          </Card>
        </>
      )}

      <Card title={copy.contributions} info={copy.contributionsInfo} className="mb-5">
        {years.length === 0 ? (
          <EmptyState>{copy.noContributions}</EmptyState>
        ) : (
          <DataTable
            caption={copy.contributions}
            rows={years}
            getRowKey={(row: ContributionLimitRow) => String(row.year)}
            columns={[
              { key: 'year', label: copy.contributionColumns.year, render: (row: ContributionLimitRow) => <span className="tabular-nums text-ink">{row.year}</span> },
              { key: 'irp', label: copy.contributionColumns.irp, align: 'right', nowrap: true, render: (row: ContributionLimitRow) => <span className="font-mono">{money(row.irpOwnKrw)}</span> },
              {
                key: 'pensionSavings',
                label: copy.contributionColumns.pensionSavings,
                align: 'right',
                nowrap: true,
                render: (row: ContributionLimitRow) => (
                  <span className="font-mono">
                    {money(row.pensionSavingsOwnKrw)}
                    {row.limit && row.pensionSavingsOwnKrw > row.limit.pensionSavingsLimitKrw ? (
                      <>
                        {' '}
                        <Badge tone="warning">{copy.over}</Badge>
                      </>
                    ) : null}
                  </span>
                ),
              },
              {
                key: 'pensionSavingsLimit',
                label: copy.contributionColumns.pensionSavingsLimit,
                align: 'right',
                nowrap: true,
                priority: 'secondary',
                render: (row: ContributionLimitRow) => <span className="font-mono text-ink-3">{krw(row.limit?.pensionSavingsLimitKrw ?? null)}</span>,
              },
              {
                key: 'combined',
                label: copy.contributionColumns.combined,
                align: 'right',
                nowrap: true,
                render: (row: ContributionLimitRow) => (
                  <span className="font-mono">
                    {money(row.combinedOwnKrw)}
                    {row.limit && row.combinedOwnKrw > row.limit.combinedLimitKrw ? (
                      <>
                        {' '}
                        <Badge tone="warning">{copy.over}</Badge>
                      </>
                    ) : null}
                  </span>
                ),
              },
              {
                key: 'combinedLimit',
                label: copy.contributionColumns.combinedLimit,
                align: 'right',
                nowrap: true,
                priority: 'secondary',
                render: (row: ContributionLimitRow) =>
                  row.limit ? <span className="font-mono text-ink-3">{money(row.limit.combinedLimitKrw)}</span> : <span className="text-ink-3">{copy.noLimit}</span>,
              },
              { key: 'eligible', label: copy.contributionColumns.eligible, align: 'right', nowrap: true, render: (row: ContributionLimitRow) => <span className="font-mono">{krw(row.creditEligibleKrw)}</span> },
              {
                key: 'employer',
                label: copy.contributionColumns.employer,
                align: 'right',
                nowrap: true,
                priority: 'secondary',
                render: (row: ContributionLimitRow) =>
                  row.employerKrw == null ? <span className="text-ink-3">{copy.employerUnknown}</span> : <span className="font-mono">{money(row.employerKrw)}</span>,
              },
            ]}
          />
        )}
      </Card>

      <WrapperReviewCard rows={wrapperReview} copy={wrapperReviewCopy} />
    </>
  )
}
