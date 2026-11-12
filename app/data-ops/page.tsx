import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { FreshnessRows } from '@/components/Freshness'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, MetricField, MetricHeroCard, TextLink, marketTone, type Tone } from '@/components/ui'
import {
  getAccountCoverage,
  getDataOpsReview,
  type AccountCoverage,
  type CoverageAction,
  type CoverageArtifact,
  type DataOpsReview,
  type TickerlessSuggestion,
  type ValuationReason,
} from '@/lib/adapters/portfolio-db'
import { EMPTY_VALUE, fmtDate, fmtNumber } from '@/lib/format'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { getGlossary } from '@/lib/glossary'
import { getLanguage } from '@/lib/i18n-server'
import type { Language } from '@/lib/i18n'
import { positionHref } from '@/lib/position-url'
import { getPageCopy, getUiCopy } from '@/lib/ui-copy'
import { priorityTone } from '@/lib/tone'
import { routeMetadata, routeSection } from '@/lib/page-names'
import { CardRow, KpiBand } from '@/components/layout'
import { maskAccountLabel } from '@/lib/account-label'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/data-ops')

function coverageTone(status: AccountCoverage['status']): Tone {
  if (status === 'action_needed' || status === 'missing') return 'danger'
  if (status === 'due_soon') return 'warning'
  return 'success'
}

type CoverageCopy = ReturnType<typeof getPageCopy<'dataOps'>>['coverage']

function coverageDateLabel(row: AccountCoverage, c: CoverageCopy, language: Language): string {
  const date = (value: string | null) => value ? fmtDate(value, language) : EMPTY_VALUE
  if (row.sources.length > 1) return row.sources.map((source) => `${source.label} ${date(source.coveredThrough)}`).join(' · ')
  if (row.method === 'mixed') return c.mixed(date(row.apiCoveredThrough), date(row.statementCoveredThrough))
  return date(row.coveredThrough)
}

type QueueRow = DataOpsReview['actionQueue'][number]

function coverageLagLabel(row: AccountCoverage, c: CoverageCopy): string {
  const days = (value: number | null) => value == null ? c.noCutoff : c.daysAgo(fmtNumber(value))
  if (row.sources.length > 1) return row.sources.map((source) => `${source.label} ${days(source.lagDays)}`).join(' · ')
  if (row.method === 'mixed') return c.mixed(days(row.apiLagDays), days(row.statementLagDays))
  return days(row.lagDays)
}

function coverageDownloadLabel(row: AccountCoverage, c: CoverageCopy, language: Language): string {
  if (!row.downloadFrom) return c.noExistingCutoff
  return c.downloadFrom(fmtDate(row.downloadFrom, language))
}

function coverageArtifactLabel(artifact: CoverageArtifact, c: CoverageCopy): string {
  switch (artifact.code) {
    case 'KR_CERTIFICATE':
      return c.artifact.KR_CERTIFICATE(artifact.brokerage, maskAccountLabel(artifact.account))
    case 'US_HOLDINGS_AND_TRANSACTIONS_CSV':
      return c.artifact.US_HOLDINGS_AND_TRANSACTIONS_CSV(artifact.brokerage)
    default:
      return c.artifact[artifact.code] ?? artifact.code
  }
}

function coverageActionLabel(action: CoverageAction, c: CoverageCopy): string {
  switch (action.code) {
    case 'KR_CERTIFICATE':
      return c.action.KR_CERTIFICATE(action.brokerage, maskAccountLabel(action.account))
    case 'US_HOLDINGS_AND_TRANSACTIONS':
      return c.action.US_HOLDINGS_AND_TRANSACTIONS(action.brokerage)
    default:
      return c.action[action.code] ?? action.code
  }
}

export default async function DataOpsPage() {
  const language = await getLanguage()
  const money = createMoneyFormatter(await getCurrencyPreferences())
  const copy = getPageCopy('dataOps', language)
  const glossary = getGlossary(language)
  const priorityLabels = getUiCopy(language).priority
  const ops = getDataOpsReview()
  const coverage = getAccountCoverage()
  const issueCount = ops.actionQueue.reduce((sum, item) => sum + item.count, 0)
  const coverageCopy = copy.coverage

  return (
    <>
      <PageHeader
        eyebrow={routeSection('/data-ops', language)}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle}
        action={issueCount ? <Badge tone="warning">{copy.needsReview(fmtNumber(issueCount))}</Badge> : <Badge tone="success">{copy.noPending}</Badge>}
      />

      <Card title={coverageCopy.title} info={coverageCopy.info} accent={coverage.actionNeeded > 0} className="mb-5" action={<TextLink href="#account-coverage">{coverageCopy.viewAll}</TextLink>}>
        <div className="mb-4 grid grid-cols-3 gap-3">
          <MetricField label={coverageCopy.actionNeeded} value={fmtNumber(coverage.actionNeeded)} tone={coverage.actionNeeded ? 'danger' : 'success'} valueClassName="text-title" />
          <MetricField label={coverageCopy.dueSoon} value={fmtNumber(coverage.dueSoon)} tone={coverage.dueSoon ? 'warning' : 'success'} valueClassName="text-title" />
          <MetricField label={coverageCopy.current} value={fmtNumber(coverage.current)} tone="success" valueClassName="text-title" />
        </div>
        <div id="account-coverage">
          <DataTable
            caption={coverageCopy.title}
            rows={coverage.rows}
            getRowKey={(row: AccountCoverage) => row.id}
            emptyMessage={<span className="text-success">{coverageCopy.none} ✓</span>}
            columns={[
              {
                key: 'account',
                label: coverageCopy.columns.account,
                render: (row: AccountCoverage) => (
                  <>
                    <div className="flex items-center gap-2">
                      <Badge tone={coverageTone(row.status)}>{coverageCopy.status[row.status]}</Badge>
                      <span className="font-medium text-ink">{row.brokerage}</span>
                    </div>
                    <div className="mt-1 text-label text-ink-3">{maskAccountLabel(row.account)}</div>
                  </>
                ),
              },
              { key: 'coverage', label: coverageCopy.columns.coverage, nowrap: true, render: (row: AccountCoverage) => <span className="tabular-nums">{coverageDateLabel(row, coverageCopy, language)}</span> },
              {
                key: 'lag',
                label: coverageCopy.columns.lag,
                nowrap: true,
                render: (row: AccountCoverage) => (
                  <span className="tabular-nums">
                    {coverageLagLabel(row, coverageCopy)}
                    {row.method !== 'mixed' && row.sources.length <= 1 && row.overdueDays ? <span className="ml-1 text-danger">(+{row.overdueDays})</span> : null}
                  </span>
                ),
              },
              {
                key: 'artifact',
                label: coverageCopy.columns.artifact,
                render: (row: AccountCoverage) => (
                  <div className="max-w-[24rem]">
                    <div className="font-medium text-ink">{row.artifacts.map((artifact) => coverageArtifactLabel(artifact, coverageCopy)).join(' + ')}</div>
                    <div className="mt-1 text-label text-ink-3">{row.format}</div>
                    <div className="mt-1 text-label font-medium leading-relaxed text-info">
                      {coverageCopy.downloadRange}: {coverageDownloadLabel(row, coverageCopy, language)}
                    </div>
                    <div className="mt-1 text-label leading-relaxed text-ink-3">
                      {row.missingDisposals.length ? `${coverageCopy.missingDisposals(row.missingDisposals.length, row.missingDisposals)} ` : null}
                      {coverageActionLabel(row.action, coverageCopy)}
                    </div>
                    {row.lastFile ? (
                      <code className="mt-1 block truncate text-micro text-ink-3" title={row.lastFile}>
                        {coverageCopy.last} {row.lastFile}
                      </code>
                    ) : null}
                  </div>
                ),
              },
              { key: 'method', label: coverageCopy.columns.method, nowrap: true, priority: 'secondary', render: (row: AccountCoverage) => coverageCopy.methodLabel[row.method] },
              {
                key: 'destination',
                label: coverageCopy.columns.destination,
                priority: 'tertiary',
                render: (row: AccountCoverage) => (
                  <>
                    <code className="text-label text-ink-3">{row.destination}</code>
                    <div
                      className="mt-1 max-w-[15rem] text-label leading-relaxed text-ink-3"
                      title={'checkDetail' in row.detail ? row.detail.checkDetail : undefined}
                    >
                      {coverageCopy.detail[row.detail.code] ?? row.detail.code}
                    </div>
                  </>
                ),
              },
            ]}
          />
        </div>
      </Card>

      <CardRow columns="hero">
        <MetricHeroCard
          title={copy.needsReviewTitle}
          info={copy.needsReviewInfo}
          eyebrow={copy.headline}
          value={fmtNumber(issueCount)}
          hint={issueCount ? copy.triageHint : copy.noPendingHint}
        >
          <KpiBand>
            <MetricField
              label={copy.mappingSuggestions}
              value={fmtNumber(ops.mappingSuggestions.length)}
              hint={copy.mappingSuggestionsHint}
              tone={ops.mappingSuggestions.length ? 'warning' : 'success'}
              valueClassName="text-title"
            />
            <MetricField
              label={copy.valuationFixes}
              value={fmtNumber(ops.valuationFixes.length)}
              hint={copy.valuationFixesHint}
              tone={ops.valuationFixes.length ? 'warning' : 'success'}
              valueClassName="text-title"
            />
            <MetricField
              label={copy.sourceCheckIssues}
              value={fmtNumber(ops.sourceIssues.length + ops.validationIssues.length)}
              info={glossary.inputIssues.description}
              hint={copy.sourceCheckIssuesHint}
              tone={ops.sourceIssues.length + ops.validationIssues.length ? 'warning' : 'success'}
              valueClassName="text-title"
            />
          </KpiBand>
        </MetricHeroCard>

        <Card title={copy.manualCoverage} info={copy.manualCoverageInfo}>
          <div className="flex min-h-[16rem] flex-col justify-between gap-4">
            <div className="space-y-4">
              <MetricField
                label={copy.incomeRules}
                value={fmtNumber(ops.manualMappings.incomeRuleCount)}
                hint={copy.incomeRulesHint}
                valueClassName="text-metric"
              />
              <div className="h-px bg-line-subtle" />
              <MetricField
                label={copy.manualOverrides}
                value={fmtNumber(ops.manualMappings.overrideCount)}
                hint={copy.manualOverridesHint}
                valueClassName="text-title"
              />
            </div>
            <div className="rounded-md bg-surface px-3 py-2 text-label leading-relaxed text-ink-3">
              {copy.readOrder}
            </div>
          </div>
        </Card>
      </CardRow>

      <Card title={copy.priorityWork} info={copy.priorityWorkInfo} className="mb-5" accent={ops.actionQueue.length > 0}>
        {ops.actionQueue.length === 0 ? (
          <EmptyState ok>{copy.noPriorityWork}</EmptyState>
        ) : (
          <DataTable
            rows={ops.actionQueue}
            caption={copy.priorityCaption}
            columns={[
              { key: 'priority', label: copy.columns.priority, render: (r: QueueRow) => <Badge tone={priorityTone(r.priority)}>{priorityLabels[r.priority] ?? r.priority}</Badge> },
              { key: 'area', label: copy.columns.area, render: (r: QueueRow) => copy.queue[r.kind]?.area ?? r.kind },
              { key: 'count', label: copy.columns.count, align: 'right', render: (r) => fmtNumber(r.count) },
              { key: 'action', label: copy.columns.action, render: (r: QueueRow) => <span className="text-caption text-ink-2">{copy.queue[r.kind]?.action ?? r.kind}</span> },
              {
                key: 'href',
                label: copy.columns.open,
                render: (r) => (
                  <TextLink href={r.href}>
                    {copy.view}
                  </TextLink>
                ),
              },
            ]}
          />
        )}
      </Card>

      <CardRow>
        <Card title={copy.manualSettings} info={copy.manualSettingsInfo}>
          <div className="space-y-2 text-caption text-ink-2">
            <div className="flex items-center justify-between gap-3">
              <span>{copy.version}</span>
              <span className="font-medium tabular-nums text-ink">{ops.manualMappings.version ?? copy.notRecorded}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>{copy.incomeMappingRules}</span>
              <span className="font-medium tabular-nums text-ink">{fmtNumber(ops.manualMappings.incomeRuleCount)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>{copy.dividendOverrides}</span>
              <span className="font-medium tabular-nums text-ink">{fmtNumber(ops.manualMappings.overrideCount)}</span>
            </div>
            <code className="block break-words rounded-sm border border-line-subtle bg-surface px-2 py-1 font-mono text-label text-ink-3">
              {ops.manualMappings.path}
            </code>
          </div>
        </Card>

        <Card title={copy.mappingStatus}>
          <DataTable
            rows={ops.mappingSummary}
            caption={copy.mappingStatusCaption}
            columns={[
              { key: 'mapping_status', label: copy.columns.status, render: (r) => <Badge tone={r.mapping_status.includes('tickerless') ? 'warning' : 'success'}>{r.mapping_status}</Badge> },
              { key: 'income_category', label: copy.columns.category },
              { key: 'row_count', label: copy.columns.rows, align: 'right', render: (r) => fmtNumber(r.row_count) },
              { key: 'base_income', label: copy.columns.baseIncome, align: 'right', render: (r) => money(r.base_income) },
            ]}
          />
        </Card>
      </CardRow>

      <CardRow>
        <Card title={copy.manualSuggestions} accent={ops.mappingSuggestions.length > 0}>
          {ops.mappingSuggestions.length === 0 ? (
            <EmptyState ok>{copy.noManualSuggestions}</EmptyState>
          ) : (
            <DataTable
              rows={ops.mappingSuggestions}
              columns={[
                { key: 'market', label: copy.columns.market, render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
                { key: 'brokerage', label: copy.columns.broker },
                { key: 'income_category', label: copy.columns.category },
                { key: 'row_count', label: copy.columns.rows, align: 'right', render: (r) => fmtNumber(r.row_count) },
                { key: 'base_income', label: copy.columns.base, align: 'right', render: (r) => money(r.base_income) },
                { key: 'rule', label: copy.columns.suggestedRule, render: (r) => <code className="block max-w-[24rem] whitespace-pre-wrap font-mono text-label text-ink-2">{r.rule}</code> },
              ]}
            />
          )}
        </Card>

        <Card title={copy.valuationFixSuggestions} accent={ops.valuationFixes.length > 0}>
          {ops.valuationFixes.length === 0 ? (
            <EmptyState ok>{copy.noValuationFixes}</EmptyState>
          ) : (
            <DataTable
              rows={ops.valuationFixes}
              columns={[
                { key: 'market', label: copy.columns.market, render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
                {
                  key: 'ticker',
                  label: copy.columns.position,
                  render: (r) => (
                    <Link href={positionHref(r.market, r.ticker)} className="font-mono text-caption font-medium text-info hover:underline">
                      {r.ticker}
                    </Link>
                  ),
                },
                { key: 'reason', label: copy.columns.reason, render: (r: { reason: ValuationReason }) => copy.valuationReason[r.reason] ?? r.reason },
                { key: 'suggestion', label: copy.columns.suggestion, render: (r: { reason: ValuationReason }) => <span className="text-caption text-ink-2">{copy.valuationSuggestion[r.reason] ?? r.reason}</span> },
              ]}
            />
          )}
        </Card>
      </CardRow>

      <Card title={copy.tickerlessTriage} accent={ops.tickerlessIncome.length > 0}>
        {ops.tickerlessIncome.length === 0 ? (
          <EmptyState ok>{copy.allIncomeMapped}</EmptyState>
        ) : (
          <DataTable
            rows={ops.tickerlessIncome}
            columns={[
              { key: 'market', label: copy.columns.market, render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
              { key: 'income_category', label: copy.columns.category },
              { key: 'brokerage', label: copy.columns.broker },
              { key: 'name', label: copy.columns.name },
              { key: 'type', label: copy.columns.type },
              { key: 'row_count', label: copy.columns.rows, align: 'right', render: (r) => fmtNumber(r.row_count) },
              { key: 'native_income', label: copy.columns.native, align: 'right', render: (r) => money(r.native_income, r.currency) },
              { key: 'base_income', label: copy.columns.base, align: 'right', render: (r) => money(r.base_income) },
              { key: 'suggestion', label: copy.columns.suggestion, render: (r: { suggestion: TickerlessSuggestion }) => copy.tickerlessSuggestion[r.suggestion] ?? r.suggestion },
              { key: 'suggestedRule', label: copy.columns.rule, render: (r) => <code className="block max-w-[18rem] whitespace-pre-wrap font-mono text-label text-ink-3">{r.suggestedRule}</code> },
            ]}
          />
        )}
      </Card>

      <CardRow spacing="above">
        <Card title={copy.missingValuation}>
          {ops.missingValuation.length === 0 ? (
            <EmptyState ok>{copy.noMissingValuation}</EmptyState>
          ) : (
            <DataTable
              rows={ops.missingValuation}
              columns={[
                { key: 'market', label: copy.columns.market, render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
                {
                  key: 'ticker',
                  label: copy.columns.position,
                  render: (r) => (
                    <Link href={positionHref(r.market, r.ticker)} className="font-mono text-caption font-medium text-info hover:underline">
                      {r.ticker}
                    </Link>
                  ),
                },
                { key: 'name', label: copy.columns.name },
                { key: 'account', label: copy.columns.account, render: (r) => maskAccountLabel(r.account) },
                { key: 'native_cost', label: copy.columns.nativeCost, align: 'right', render: (r) => money(r.native_cost, r.currency) },
                { key: 'base_cost', label: copy.columns.baseCost, align: 'right', render: (r) => (r.base_cost == null ? EMPTY_VALUE : money(r.base_cost)) },
                { key: 'reason', label: copy.columns.reason, render: (r: { reason: ValuationReason }) => copy.valuationReason[r.reason] ?? r.reason },
                { key: 'suggestion', label: copy.columns.suggestion, render: (r: { reason: ValuationReason }) => copy.valuationSuggestion[r.reason] ?? r.reason },
              ]}
            />
          )}
        </Card>

        <Card title={copy.sourceValidationIssues} accent={ops.sourceIssues.length + ops.validationIssues.length > 0}>
          {ops.sourceIssues.length === 0 && ops.validationIssues.length === 0 ? (
            <EmptyState ok>{copy.noSourceValidationIssues}</EmptyState>
          ) : (
            <div className="space-y-4">
              {ops.sourceIssues.length > 0 && <FreshnessRows items={ops.sourceIssues} language={language} />}
              {ops.validationIssues.length > 0 && (
                <ul className="divide-y divide-line-subtle">
                  {ops.validationIssues.map((issue) => (
                    <li key={issue.id} className="flex flex-col gap-1 py-2.5 lg:flex-row lg:items-center lg:gap-3">
                      <Badge tone={issue.severity === 'error' ? 'danger' : 'warning'}>{issue.status}</Badge>
                      <span className="min-w-0 flex-1 text-body font-medium text-ink">{issue.name}</span>
                      <span className="text-caption text-ink-3">{issue.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      </CardRow>
    </>
  )
}
