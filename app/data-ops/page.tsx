import { summarizeSupplementaryFreshness } from '@/lib/application/coverage-freshness-summary'
import { AccountCoverageSummary } from '@/components/AccountCoverageSummary'
import { summarizeAccountCoverage } from '@/lib/application/account-coverage-summary'
import { InvestmentUpdateAction, coverageDetailLabel, type CoverageCopy } from '@/components/AccountUpdateAction'
import { SupplementaryCoverageTable } from '@/components/SupplementaryCoverageTable'
import { DataTable } from '@/components/DataTable'
import { FreshnessRows } from '@/components/Freshness'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, HeroAside, MetricField, MetricHeroCard, TextLink, marketTone } from '@/components/ui'
import {
  getAccountCoverage,
  getDataOpsReview,
  getSupplementaryCoverage,
  type AccountCoverage,
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
import { getPageCopy, getUiCopy } from '@/lib/ui-copy'
import { labelFor } from '@/lib/ui-copy/label'
import { CHECK_RESULT_SEVERITY, COVERAGE_SEVERITY, FAULT_SEVERITY, MAPPING_STATUS_SEVERITY, POSITION_BREAK_SEVERITY, TO_REVIEW_SEVERITY, countTone, mappingStatusKey, priorityTone, statusTone } from '@/lib/tone'
import { routeMetadata, routeSection } from '@/lib/page-names'
import { CardRow, KpiBand } from '@/components/layout'
import { PositionCell } from '@/components/PositionCell'
import { maskAccountLabel } from '@/lib/account-label'
import { dataOpsLinkedIssues, dataOpsQueueTiles, fmtCount, mappingSuggestionRows, positionBreaksCapped, queueRowCapped } from '@/lib/header-status'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/data-ops')

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

export default async function DataOpsPage() {
  const language = await getLanguage()
  const money = createMoneyFormatter(await getCurrencyPreferences())
  const copy = getPageCopy('dataOps', language)
  const updatesCopy = getPageCopy('accountUpdates', language)
  const glossary = getGlossary(language)
  const priorityLabels = getUiCopy(language).priority
  const incomeCategoryLabels = getUiCopy(language).incomeCategories
  const transactionTypes = getUiCopy(language).transactionTypes
  const ops = getDataOpsReview()
  const coverage = getAccountCoverage()
  const supplementary = getSupplementaryCoverage()
  const priorityWork = dataOpsLinkedIssues(copy, ops.actionQueue, language)
  const issueCount = priorityWork.issues.count
  const tiles = dataOpsQueueTiles(ops.actionQueue)
  const coverageCopy = copy.coverage

  return (
    <>
      <PageHeader
        eyebrow={routeSection('/data-ops', language)}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle}
        status={priorityWork.status}
      />

      <AccountCoverageSummary freshness={summarizeSupplementaryFreshness(supplementary.rows)} language={language} summary={summarizeAccountCoverage({ investmentRows: coverage.rows, supplementaryRows: supplementary.rows })} />

      <Card title={coverageCopy.title} info={coverageCopy.info} issues={{ count: coverage.actionNeeded, severity: 'problem' }} className="mb-5" action={<TextLink href="#account-coverage">{coverageCopy.viewAll}</TextLink>}>
        <div className="mb-4 grid grid-cols-3 gap-3">
          <MetricField label={coverageCopy.actionNeeded} value={fmtNumber(coverage.actionNeeded)} tone={countTone(FAULT_SEVERITY, coverage.actionNeeded)} />
          <MetricField label={coverageCopy.dueSoon} value={fmtNumber(coverage.dueSoon)} tone={countTone(TO_REVIEW_SEVERITY, coverage.dueSoon)} />
          <MetricField label={coverageCopy.current} value={fmtNumber(coverage.current)} tone="success" />
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
                      <Badge tone={statusTone(COVERAGE_SEVERITY, row.status)}>{coverageCopy.status[row.status]}</Badge>
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
                label: updatesCopy.next,
                render: (row: AccountCoverage) => (
                  <div className="max-w-[24rem]"><InvestmentUpdateAction row={row} language={language} /></div>
                ),
              },
              { key: 'method', label: coverageCopy.columns.method, nowrap: true, priority: 'secondary', render: (row: AccountCoverage) => ['current','due_soon','unconfirmed'].includes(row.status) ? updatesCopy.none : coverageCopy.methodLabel[row.method] },
              {
                key: 'destination',
                label: coverageCopy.columns.destination,
                priority: 'tertiary',
                render: (row: AccountCoverage) => ['current','due_soon','unconfirmed'].includes(row.status) ? updatesCopy.none : (
                  <>
                    <code className="text-label text-ink-3">{row.sources.length > 1 ? row.sources.filter(source => ['action_needed','missing'].includes(source.status)).map(source => source.destination).join(' · ') : row.destination}</code>
                    {row.sources.length <= 1 ? (
                      <div
                        className="mt-1 max-w-[15rem] text-label leading-relaxed text-ink-3"
                        title={'checkDetail' in row.detail ? row.detail.checkDetail : undefined}
                      >
                        {coverageDetailLabel(row.detail, coverageCopy, language)}
                      </div>
                    ) : null}
                  </>
                ),
              },
            ]}
          />
        </div>
      </Card>

      <div id="supplementary-coverage" className="mb-5">
        <Card title={updatesCopy.title}
          info={updatesCopy.info}>
          <SupplementaryCoverageTable language={language} rows={supplementary.rows} />
        </Card>
      </div>

      <CardRow columns="hero">
        <MetricHeroCard
          title={copy.needsReviewTitle}
          info={copy.needsReviewInfo}
          eyebrow={copy.headline}
          value={fmtCount(issueCount, priorityWork.issues.capped, language)}
          hint={issueCount ? copy.triageHint : copy.noPendingHint}
        >
          <KpiBand columns={4}>
            <MetricField
              label={copy.mappingSuggestions}
              value={fmtNumber(tiles.mapping)}
              hint={copy.mappingSuggestionsHint}
              tone={countTone(TO_REVIEW_SEVERITY, tiles.mapping)}
            />
            <MetricField
              label={copy.valuationFixes}
              value={fmtNumber(tiles.valuation)}
              hint={copy.valuationFixesHint}
              tone={countTone(TO_REVIEW_SEVERITY, tiles.valuation)}
            />
            <MetricField
              label={copy.sourceCheckIssues}
              value={fmtNumber(tiles.sourceCheck)}
              info={glossary.inputIssues.description}
              hint={copy.sourceCheckIssuesHint}
              tone={countTone(TO_REVIEW_SEVERITY, tiles.sourceCheck)}
            />
            <MetricField
              label={copy.positionBreaks}
              value={fmtCount(tiles.breaks, positionBreaksCapped(tiles.breaks), language)}
              hint={copy.positionBreaksHint}
              tone={countTone(POSITION_BREAK_SEVERITY, tiles.breaks)}
            />
          </KpiBand>
        </MetricHeroCard>

        <HeroAside title={copy.manualCoverage} info={copy.manualCoverageInfo} note={copy.readOrder}>
          <MetricField
            label={copy.incomeRules}
            value={fmtNumber(ops.manualMappings.incomeRuleCount)}
            hint={copy.incomeRulesHint}
            size="metric"
          />
          <MetricField
            label={copy.manualOverrides}
            value={fmtNumber(ops.manualMappings.overrideCount)}
            hint={copy.manualOverridesHint}
          />
        </HeroAside>
      </CardRow>

      <Card id="data-ops-priority-work" title={copy.priorityWork} info={copy.priorityWorkInfo} className="mb-5" issues={priorityWork.issues}>
        {ops.actionQueue.length === 0 ? (
          <EmptyState ok>{copy.noPriorityWork}</EmptyState>
        ) : (
          <DataTable
            rows={ops.actionQueue}
            caption={copy.priorityCaption}
            columns={[
              { key: 'priority', label: copy.columns.priority, render: (r: QueueRow) => <Badge tone={priorityTone(r.priority)}>{priorityLabels[r.priority] ?? r.priority}</Badge> },
              { key: 'area', label: copy.columns.area, render: (r: QueueRow) => copy.queue[r.kind]?.area ?? r.kind },
              { key: 'count', label: copy.columns.count, align: 'right', render: (r: QueueRow) => fmtCount(r.count, queueRowCapped(r), language) },
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
              { key: 'mapping_status', label: copy.columns.status, render: (r) => <Badge tone={statusTone(MAPPING_STATUS_SEVERITY, mappingStatusKey(r.mapping_status))}>{copy.mappingStatuses[r.mapping_status] ?? r.mapping_status}</Badge> },
              { key: 'income_category', label: copy.columns.category, render: (r) => labelFor(incomeCategoryLabels, r.income_category) },
              { key: 'row_count', label: copy.columns.rows, align: 'right', render: (r) => fmtNumber(r.row_count) },
              { key: 'base_income', label: copy.columns.baseIncome, align: 'right', render: (r) => money(r.base_income) },
            ]}
          />
        </Card>
      </CardRow>

      <CardRow>
        <Card id="data-ops-manual-mappings" title={copy.manualSuggestions} issues={{ count: mappingSuggestionRows(ops.mappingSuggestions) }}>
          {ops.mappingSuggestions.length === 0 ? (
            <EmptyState ok>{copy.noManualSuggestions}</EmptyState>
          ) : (
            <DataTable
              rows={ops.mappingSuggestions}
              columns={[
                { key: 'market', label: copy.columns.market, render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
                { key: 'brokerage', label: copy.columns.broker },
                { key: 'income_category', label: copy.columns.category, render: (r) => labelFor(incomeCategoryLabels, r.income_category) },
                { key: 'row_count', label: copy.columns.rows, align: 'right', render: (r) => fmtNumber(r.row_count) },
                { key: 'base_income', label: copy.columns.base, align: 'right', render: (r) => money(r.base_income) },
                { key: 'rule', label: copy.columns.suggestedRule, render: (r) => <code className="block max-w-[24rem] whitespace-pre-wrap font-mono text-label text-ink-2">{r.rule}</code> },
              ]}
            />
          )}
        </Card>

        <Card id="data-ops-valuation" title={copy.valuationFixSuggestions} issues={{ count: ops.valuationFixes.length }}>
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
                  render: (r) => <PositionCell market={r.market} ticker={r.ticker} layout="ticker" />,
                },
                { key: 'reason', label: copy.columns.reason, render: (r: { reason: ValuationReason }) => copy.valuationReason[r.reason] ?? r.reason },
                { key: 'suggestion', label: copy.columns.suggestion, render: (r: { reason: ValuationReason }) => <span className="text-caption text-ink-2">{copy.valuationSuggestion[r.reason] ?? r.reason}</span> },
              ]}
            />
          )}
        </Card>
      </CardRow>

      <Card title={copy.tickerlessTriage} issues={{ count: ops.tickerlessIncome.length }}>
        {ops.tickerlessIncome.length === 0 ? (
          <EmptyState ok>{copy.allIncomeMapped}</EmptyState>
        ) : (
          <DataTable
            rows={ops.tickerlessIncome}
            columns={[
              { key: 'market', label: copy.columns.market, render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
              { key: 'income_category', label: copy.columns.category, render: (r) => labelFor(incomeCategoryLabels, r.income_category) },
              { key: 'brokerage', label: copy.columns.broker },
              { key: 'name', label: copy.columns.name },
              { key: 'type', label: copy.columns.type, render: (r) => labelFor(transactionTypes, r.type) },
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
                  render: (r) => <PositionCell market={r.market} ticker={r.ticker} layout="ticker" />,
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

        <Card title={copy.sourceValidationIssues} issues={{ count: ops.sourceIssues.length + ops.validationIssues.length, severity: 'problem' }}>
          {ops.sourceIssues.length === 0 && ops.validationIssues.length === 0 ? (
            <EmptyState ok>{copy.noSourceValidationIssues}</EmptyState>
          ) : (
            <div className="space-y-4">
              {ops.sourceIssues.length > 0 && <FreshnessRows items={ops.sourceIssues} language={language} />}
              {ops.validationIssues.length > 0 && (
                <ul className="divide-y divide-line-subtle">
                  {ops.validationIssues.map((issue) => (
                    <li key={issue.id} className="flex flex-col gap-1 py-2.5 lg:flex-row lg:items-center lg:gap-3">
                      <Badge tone={statusTone(CHECK_RESULT_SEVERITY, issue.severity)}>{copy.sourceIssueStatuses[issue.status] ?? issue.status}</Badge>
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
