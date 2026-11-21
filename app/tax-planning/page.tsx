import { PageHeader } from '@/components/PageHeader'
import { TaxPlanTimeline } from '@/components/TaxPlanTimeline'
import { Badge, Button, Card, FormError, HelpPopover, Label, Panel, SectionHeading, Signed, TextLink, marketTone } from '@/components/ui'
import { getOperationalHealth, getOverview, getTaxPlanningLots, getWashSaleReview, getWrapperReview } from '@/lib/adapters/portfolio-db'
import { WrapperEstimateNote } from '@/components/WrapperReviewCard'
import { WashSaleBanner } from '@/components/WashSaleBanner'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { fmtKrw, fmtMoney, fmtNumber, fmtPct, fmtSigned } from '@/lib/format'
import { getLanguage } from '@/lib/i18n-server'
import {
  buildMonthlySalePlanSet,
  buildMultiYearTaxPlan,
  buildTaxPlan,
  type MultiYearTaxScenario,
} from '@/lib/tax-planning'
import { planningInputs } from '@/lib/tax-planning-params'
import { listSavedTaxPlans } from '@/lib/tax-plan-store'
import { annualProfiles, getTaxPolicyState } from '@/lib/tax-policy'

import { CandidateTable, MasterPlanAnnualTax, MasterPlanOverview, MasterScenarioComparison, SavedPlansPanel } from './components'
import { DecisionSummary, PlanningMap, buildOpportunityRows, opportunitySummary, type OpportunityCoverage } from './opportunity-analysis'
import { multiYearScenarioDescription, multiYearScenarioName, sameKrw, taxPlanWarningText } from './view-utils'
import { Input, Select } from '@/components/form'
import { DataTable } from '@/components/DataTable'
import { getPageCopy, getUiCopy } from '@/lib/ui-copy'
import { routeMetadata, routeSection } from '@/lib/page-names'
import { CardRow, Split } from '@/components/layout'
import { taxPlanningLinkedIssues } from '@/lib/header-status'
import { TAX_DUE_SEVERITY, countTone } from '@/lib/tone'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/tax-planning')

function scenarioTaxTie(plan: ReturnType<typeof buildMultiYearTaxPlan>) {
  if (!plan.bestScenario) return false
  return plan.scenarios.every((item) => sameKrw(item.summary.taxKrw, plan.bestScenario?.summary.taxKrw))
}

export default async function TaxPlanningPage({
  searchParams,
}: {
  searchParams: Promise<{
    annualTarget?: string
    horizon?: string
    master?: string
    pace?: string
    month?: string
    page?: string
    error?: string
  }>
}) {
  const params = await searchParams
  const language = await getLanguage()
  const money = createMoneyFormatter(await getCurrencyPreferences())
  const copy = getPageCopy('taxPlanning', language)
  const taxPolicy = getTaxPolicyState()
  const {
    scenario: activeScenario,
    objective,
    targetCashKrw,
    annualTargetCashKrw,
    horizonYears,
    master: selectedMasterStrategy,
    executionMonths,
  } = planningInputs(params, taxPolicy.policy)
  const lots = getTaxPlanningLots(5000, taxPolicy.policy)
  const wrapperReview = getWrapperReview(taxPolicy.policy)
  const plan = buildTaxPlan({ lots, policy: taxPolicy.policy, scenario: activeScenario, objective, targetCashKrw })
  const multiYearPlan = buildMultiYearTaxPlan({
    lots,
    policy: taxPolicy.policy,
    horizonYears,
    annualTargetCashKrw,
    objective,
  })
  const operational = getOperationalHealth()
  const overview = getOverview()
  const filingProfiles = annualProfiles(taxPolicy.policy, horizonYears)
  const masterPlanSet = buildMonthlySalePlanSet({
    lots,
    policy: taxPolicy.policy,
    horizonYears,
    executionMonths,
    selectedStrategy: selectedMasterStrategy,
  })
  const savedPlans = listSavedTaxPlans()
  const selectedScheduleMonth = masterPlanSet.selectedPlan.months.some((month) => month.yearMonth === params.month)
    ? String(params.month)
    : masterPlanSet.selectedPlan.months[0]?.yearMonth ?? ''
  const schedulePage = Math.max(Number(params.page) || 1, 1)
  const opportunityRows = buildOpportunityRows({ lots, policy: taxPolicy.policy, profiles: filingProfiles })
  const firstYearOpportunityRows = opportunityRows.filter((row) => row.year === filingProfiles[0]?.year)
  const opportunityCoverage: OpportunityCoverage = {
    holdingsMarketValueKrw: Number(overview.totals.global_base_market_value ?? 0),
    holdingsUnrealizedGainKrw: Number(overview.totals.global_base_unrealized_gl ?? 0),
    modeledProceedsKrw: firstYearOpportunityRows.reduce((sum, row) => sum + row.totalProceedsKrw, 0),
    modeledGainKrw: firstYearOpportunityRows.reduce((sum, row) => sum + row.netGainKrw, 0),
    unallocatedMarketValueKrw:
      Number(overview.totals.global_base_market_value ?? 0) -
      firstYearOpportunityRows.reduce((sum, row) => sum + row.totalProceedsKrw, 0),
    unmodeledGainKrw:
      Number(overview.totals.global_base_unrealized_gl ?? 0) -
      firstYearOpportunityRows.reduce((sum, row) => sum + row.netGainKrw, 0),
  }
  const opportunities = opportunitySummary(opportunityRows)
  const hasPlanningTarget = annualTargetCashKrw > 0
  const warnings = taxPlanningLinkedIssues(copy, {
    warnings: plan.summary.warnings.length + operational.staleItems.length,
    example: taxPolicy.source === 'example',
  })
  const tiedTax = scenarioTaxTie(multiYearPlan)

  return (
    <>
      <PageHeader
        eyebrow={routeSection('/tax-planning', language)}
        title={copy.page.title}
        emphasis={copy.page.emphasis}
        subtitle={copy.page.subtitle}
        status={warnings.status}
        actions={
          <>
            <TextLink href="/tax-planning/annual">{getPageCopy('hypotheticalTax', language).title}</TextLink>
            <TextLink href="/tax-settings">{copy.page.editAssumptions}</TextLink>
          </>
        }
        autoRefresh={false}
      />

      {/* The only way to land here with error=name is a form posted without
          one, which the browser normally blocks. Saying so beats bouncing
          the reader back to an unchanged page with no explanation. */}
      {params.error === 'name' && <FormError messages={[getUiCopy(language).form.nameRequired]} />}

      <WashSaleBanner review={getWashSaleReview()} copy={getPageCopy('washSale', language)} />

      <MasterPlanOverview
        planSet={masterPlanSet}
        inputIssueCount={plan.summary.missingValuationCount + operational.staleItems.length}
        fullHoldingsValueKrw={opportunityCoverage.holdingsMarketValueKrw}
        copy={copy}
        money={money}
        language={language}
      />

      {/* Renders only when it lists something, the same condition that links the header pill here. */}
      {warnings.issues.count > 0 && (
        <Card id="tax-planning-warnings" title={copy.page.warnings} issues={warnings.issues} className="mb-5">
          <ul className="space-y-2 text-caption text-ink-2">
            {operational.staleItems.length > 0 && <li><Badge tone="warning">{copy.page.inputs}</Badge> {copy.page.resolveFreshness(fmtNumber(operational.staleItems.length))}</li>}
            {plan.summary.warnings.map((warning) => (
              <li key={warning.message}><Badge tone="warning">{copy.page.review}</Badge> {taxPlanWarningText(warning, copy)}</li>
            ))}
          </ul>
        </Card>
      )}

      <WrapperEstimateNote rows={wrapperReview} copy={copy.wrapperReview} />

      <form className="mb-5 flex flex-wrap items-end gap-x-4 gap-y-3">
        <label className="block">
          <Label as="span" size="micro" className="mb-1.5 flex items-center">
            {copy.settings.schedulingRule}
            <HelpPopover align="left">{copy.settings.schedulingRuleInfo} {copy.settings.schedulingHint}</HelpPopover>
          </Label>
          <Select name="master" defaultValue={selectedMasterStrategy}>
            <option value="STAGED">{copy.settings.staged}</option>
            <option value="EARLIEST_LT">{copy.settings.earliestLongTerm}</option>
            <option value="WAIT_US_ONLY">{copy.settings.waitUsOnly}</option>
            <option value="ACCELERATE_LOSSES">{copy.settings.accelerateLosses}</option>
          </Select>
        </label>
        <label className="block">
          <Label as="span" size="micro" className="mb-1.5 flex items-center">
            {copy.settings.executionWindow}
            <HelpPopover align="left">{copy.settings.executionWindowInfo} {copy.settings.executionHint}</HelpPopover>
          </Label>
          <Select name="pace" defaultValue={executionMonths}>
            {[12, 18, 24, 36, 48].map((months) => (
              <option key={months} value={months}>{months} {copy.settings.months}</option>
            ))}
          </Select>
        </label>
        <label className="block">
          <Label as="span" size="micro" className="mb-1.5 flex items-center">
            {copy.settings.taxHorizon}
            <HelpPopover align="left">{copy.settings.horizonHint}</HelpPopover>
          </Label>
          <Select name="horizon" defaultValue={horizonYears}>
            {[3, 4, 5, 7, 10].map((yearCount) => (
              <option key={yearCount} value={yearCount}>{yearCount} {copy.settings.years}</option>
            ))}
          </Select>
        </label>
        <label className="block">
          <Label as="span" size="micro" className="mb-1.5 flex items-center">
            {copy.settings.annualTarget}
            <HelpPopover align="left">{copy.settings.annualTargetInfo}</HelpPopover>
          </Label>
          <Input
            name="annualTarget"
            type="text"
            inputMode="numeric"
            placeholder={copy.settings.annualTargetPlaceholder}
            defaultValue={annualTargetCashKrw > 0 ? fmtNumber(annualTargetCashKrw) : ''}
          />
        </label>
        <Button type="submit" variant="solid" size="md">
          {copy.settings.rebuild}
        </Button>
      </form>

      <SectionHeading size="section" tracking layout="band" subtitle={copy.sections.monthlyPlanNote}>
        {copy.sections.monthlyPlan}
      </SectionHeading>

      <MasterScenarioComparison
        planSet={masterPlanSet}
        horizonYears={horizonYears}
        annualTargetCashKrw={annualTargetCashKrw}
        copy={copy}
        money={money}
        language={language}
      />

      <TaxPlanTimeline
        key={`${masterPlanSet.selectedPlan.strategy}:${selectedScheduleMonth}`}
        plan={masterPlanSet.selectedPlan}
        initialMonth={selectedScheduleMonth}
        initialPage={schedulePage}
        language={language}
      />

      <MasterPlanAnnualTax plan={masterPlanSet.selectedPlan} copy={copy} money={money} />

      <SavedPlansPanel
        plans={savedPlans}
        selectedStrategy={selectedMasterStrategy}
        executionMonths={executionMonths}
        horizonYears={horizonYears}
        copy={copy}
        money={money}
        language={language}
      />

      <SectionHeading size="section" tracking layout="band" subtitle={copy.sections.lotEstimateNote}>
        {copy.sections.lotEstimate}
      </SectionHeading>

      <Card title={copy.page.selectedSingleYearTaxSplit} info={copy.page.singleYearTaxSplitInfo} className="mb-5">
        <div className="space-y-2 text-caption text-ink-2">
          <div className="flex items-center justify-between gap-3"><span>{copy.page.federalShortTerm}</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.usFederalShortTermTaxKrw)}</span></div>
          <div className="flex items-center justify-between gap-3"><span>{copy.page.federalLongTerm}</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.usFederalLongTermTaxKrw)}</span></div>
          <div className="flex items-center justify-between gap-3"><span>{copy.page.niit}</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.usNiitTaxKrw)}</span></div>
          <div className="flex items-center justify-between gap-3"><span>{copy.page.californiaState}</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.usStateTaxKrw)}</span></div>
          <div className="flex items-center justify-between gap-3 border-t border-line-subtle pt-2"><span>{copy.page.usGrossEstimate}</span><span className="tabular-nums text-ink">{fmtMoney(plan.summary.usTaxUsd, 'USD')} / {fmtKrw(plan.summary.usTaxKrw)}</span></div>
          <div className="flex items-center justify-between gap-3"><span>{copy.page.krGrossTax}</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.krTaxKrw)}</span></div>
          <div className="flex items-center justify-between gap-3"><span>{copy.page.usFtcLimitUsed}</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.usForeignTaxCreditLimitKrw)} / <span className="text-success">{fmtSigned(-plan.summary.usForeignTaxCreditKrw, fmtKrw)}</span></span></div>
          <div className="flex items-center justify-between gap-3"><span>{copy.page.krCreditUsed}</span><span className="tabular-nums text-success">{fmtSigned(-plan.summary.krForeignTaxCreditKrw, fmtKrw)}</span></div>
          <div className="flex items-center justify-between gap-3"><span>{copy.page.combinedAfterCredit}</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.estimatedTaxKrw)}</span></div>
          <div className="flex items-center justify-between gap-3"><span>{copy.page.afterTaxProceeds}</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.estimatedAfterTaxKrw)}</span></div>
          <div className="text-label leading-relaxed text-ink-3">{copy.page.methodNote(copy.page.methodLabels[plan.summary.taxCalculationMethod] ?? plan.summary.taxCalculationMethod)}</div>
        </div>
      </Card>

      <Card title={copy.page.recommendedSaleLotSequence} className="mb-5">
        <CandidateTable rows={plan.recommended} copy={copy} money={money} />
        <details className="mt-4 border-t border-line-subtle pt-3">
          <summary className="min-h-6 cursor-pointer text-body font-medium leading-6 text-ink">{copy.page.allOpenLotCandidates}</summary>
          <div className="mt-3">
            <CandidateTable rows={plan.candidates.slice(0, 80)} copy={copy} money={money} />
          </div>
        </details>
      </Card>

      {hasPlanningTarget ? (
        <Card
          title={copy.page.annualTargetScenarioComparison}
          info={copy.page.annualTargetInfo}
          className="mb-5"
        >
          <Panel text="caption-note" spacing="mb-3">
            {copy.page.annualTargetNote}
          </Panel>
          <DataTable
            caption={copy.page.annualTargetScenarioComparison}
            rows={multiYearPlan.scenarios}
            getRowKey={(row: MultiYearTaxScenario) => row.key}
            columns={[
              {
                key: 'scenario',
                label: copy.page.scenario,
                render: (row: MultiYearTaxScenario) => (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink">{multiYearScenarioName(row, copy)}</span>
                      {multiYearPlan.bestScenario?.key === row.key && <Badge tone="success">{copy.page.lowestTax}</Badge>}
                      {multiYearPlan.bestScenario?.key !== row.key &&
                        sameKrw(row.summary.taxKrw, multiYearPlan.bestScenario?.summary.taxKrw) && (
                          <Badge tone="neutral">{copy.page.sameTax}</Badge>
                        )}
                    </div>
                    <div className="mt-1 max-w-[24rem] text-label text-ink-3">{multiYearScenarioDescription(row, copy)}</div>
                  </>
                ),
              },
              { key: 'proceeds', label: copy.page.totalSales, align: 'right', render: (row: MultiYearTaxScenario) => fmtKrw(row.summary.proceedsKrw) },
              { key: 'gain', label: copy.page.realizedGainLoss, align: 'right', render: (row: MultiYearTaxScenario) => <Signed value={row.summary.gainKrw} format={fmtKrw} /> },
              { key: 'tax', label: copy.page.estimatedTax, align: 'right', render: (row: MultiYearTaxScenario) => fmtKrw(row.summary.taxKrw) },
              { key: 'afterTax', label: copy.page.afterTaxCash, align: 'right', render: (row: MultiYearTaxScenario) => fmtKrw(row.summary.afterTaxKrw) },
              { key: 'peak', label: copy.page.peakYearTax, align: 'right', priority: 'secondary', render: (row: MultiYearTaxScenario) => fmtKrw(row.summary.peakYearTaxKrw) },
              { key: 'lots', label: copy.page.lotsUsed, align: 'right', priority: 'secondary', render: (row: MultiYearTaxScenario) => fmtNumber(row.summary.lotCount) },
            ]}
          />
          <CardRow spacing="above">
            {multiYearPlan.scenarios.slice(0, 4).map((scenarioRow) => (
              <ScenarioTimeline key={scenarioRow.key} scenario={scenarioRow} copy={copy} />
            ))}
          </CardRow>
        </Card>
      ) : (
        <Card title={copy.page.annualTargetScenarioComparison} className="mb-5">
          <Split side="18rem" at="md" gap={3}>
            <div className="text-body leading-relaxed text-ink-2">
              {copy.page.annualTargetHidden}
            </div>
            <Panel text="caption-3">
              {copy.page.annualTargetHiddenHint}
            </Panel>
          </Split>
        </Card>
      )}

      <details className="mb-5 rounded-md border border-line bg-card shadow-card">
        <summary className="cursor-pointer px-4 py-3 text-body font-medium text-ink">
          {copy.page.openStaticOpportunityAnalysis}
        </summary>
        <div className="border-t border-line-subtle p-4">
          <DecisionSummary
            hasPlanningTarget={hasPlanningTarget}
            tiedTax={tiedTax}
            bestScenario={multiYearPlan.bestScenario}
            opportunities={opportunities}
            inputIssueCount={plan.summary.missingValuationCount + operational.staleItems.length}
            openLotCount={plan.summary.candidateCount}
            copy={copy}
          />
          <PlanningMap
            scenario={multiYearPlan.bestScenario}
            hasPlanningTarget={hasPlanningTarget}
            annualTargetCashKrw={annualTargetCashKrw}
            opportunityRows={opportunityRows}
            coverage={opportunityCoverage}
            policy={taxPolicy.policy}
            assumptionsAreExample={taxPolicy.source === 'example'}
            copy={copy}
          />
        </div>
      </details>
    </>
  )
}

/** One scenario's years, as a panel inside the annual-target card. */
function ScenarioTimeline({ scenario, copy }: { scenario: MultiYearTaxScenario; copy: ReturnType<typeof getPageCopy<'taxPlanning'>> }) {
  return (
    <Panel pad="md">
      <SectionHeading level={3} size="sub" action={<Badge tone={countTone(TAX_DUE_SEVERITY, scenario.summary.taxKrw)}>{fmtKrw(scenario.summary.taxKrw)}</Badge>}>
        {multiYearScenarioName(scenario, copy)}
      </SectionHeading>
      <div className="mt-3 divide-y divide-line-subtle">
        {scenario.years.map((year) => (
          <div key={year.year} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-body text-ink">{year.year}</span>
                <Badge tone="info">{copy.enums.filingScenario[year.filingScenario] ?? year.filingScenario}</Badge>
              </div>
              <div className="text-right text-caption tabular-nums text-ink">
                {fmtKrw(year.taxKrw)}
                <div className="text-micro text-ink-3">{fmtPct(year.effectiveTaxRatePct)}</div>
              </div>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {year.markets.length === 0 ? (
                <div className="text-label text-ink-3">{copy.opportunity.noAllocatedSaleLots}</div>
              ) : (
                year.markets.map((market) => (
                  <div key={market.market} className="rounded-sm border border-line bg-card px-2.5 py-2 text-label">
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone={marketTone(market.market)}>{market.market}</Badge>
                      <span className="tabular-nums text-ink">{fmtKrw(market.proceedsKrw)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-ink-3">
                      <span>{copy.opportunity.tax}</span>
                      <span className="tabular-nums">{fmtKrw(market.taxKrw)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}
