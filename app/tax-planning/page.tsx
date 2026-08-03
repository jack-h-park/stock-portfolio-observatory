import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { TaxPlanTimeline } from '@/components/TaxPlanTimeline'
import { Badge, Card, EmptyState, InfoTooltip, marketTone } from '@/components/ui'
import { getOperationalHealth, getOverview, getTaxPlanningLots } from '@/lib/adapters/portfolio-db'
import { fmtKrw, fmtMoney, fmtNumber } from '@/lib/format'
import { getLanguage } from '@/lib/i18n-server'
import {
  buildMonthlySalePlanSet,
  buildMultiYearTaxPlan,
  buildTaxPlan,
  type MasterPlanStrategyKey,
  type MultiYearTaxScenario,
} from '@/lib/tax-planning'
import { listSavedTaxPlans } from '@/lib/tax-plan-store'
import {
  annualProfiles,
  assumptionNumber,
  assumptionString,
  getTaxPolicyState,
  projectedWagesUsd,
  scenarioFromTaxYearProfile,
  type FilingScenario,
} from '@/lib/tax-policy'

import { CandidateTable, MasterPlanAnnualTax, MasterPlanOverview, MasterScenarioComparison, SavedPlansPanel } from './components'
import { getTaxPlanningCopy } from './copy'
import { DecisionSummary, PlanningMap, buildOpportunityRows, opportunitySummary, type OpportunityCoverage } from './opportunity-analysis'
import { pct, sameKrw, signedKrw } from './view-utils'

export const dynamic = 'force-dynamic'

function scenario(value: string | undefined, fallback: FilingScenario): FilingScenario {
  return value === 'US_ONLY' || value === 'KR_ONLY' || value === 'US_AND_KR' ? value : fallback
}

function amountParam(value: string | undefined) {
  if (!value) return 0
  const normalized = value.replace(/[^\d.-]/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function masterStrategy(value: string | undefined): MasterPlanStrategyKey {
  if (
    value === 'EARLIEST_LT' ||
    value === 'STAGED' ||
    value === 'WAIT_US_ONLY' ||
    value === 'ACCELERATE_LOSSES'
  ) {
    return value
  }
  return 'STAGED'
}

function scenarioTaxTie(plan: ReturnType<typeof buildMultiYearTaxPlan>) {
  if (!plan.bestScenario) return false
  return plan.scenarios.every((item) => sameKrw(item.summary.taxKrw, plan.bestScenario?.summary.taxKrw))
}

export default async function TaxPlanningPage({
  searchParams,
}: {
  searchParams: Promise<{
    scenario?: string
    objective?: string
    target?: string
    annualTarget?: string
    horizon?: string
    master?: string
    pace?: string
    month?: string
    page?: string
  }>
}) {
  const params = await searchParams
  const language = await getLanguage()
  const copy = getTaxPlanningCopy(language)
  const taxPolicy = getTaxPolicyState()
  const activeScenario = scenario(params.scenario, taxPolicy.policy.activeScenario)
  const objective = params.objective || 'minimize-tax'
  const targetCashKrw = amountParam(params.target)
  const annualTargetCashKrw = amountParam(params.annualTarget ?? params.target)
  const horizonYears = Math.min(Math.max(Number(params.horizon ?? taxPolicy.policy.planningHorizonYears ?? 5) || 5, 1), 10)
  const selectedMasterStrategy = masterStrategy(params.master)
  const executionMonths = [12, 18, 24, 36, 48].includes(Number(params.pace)) ? Number(params.pace) : 24
  const lots = getTaxPlanningLots(5000)
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
  const tiedTax = scenarioTaxTie(multiYearPlan)

  return (
    <>
      <PageHeader
        eyebrow={copy.page.eyebrow}
        title={copy.page.title}
        emphasis={copy.page.emphasis}
        subtitle={copy.page.subtitle}
        action={
          <div className="flex items-center gap-2">
            {taxPolicy.source === 'example' && <Badge tone="warning">{copy.page.usingExampleAssumptions}</Badge>}
            <Link href="/tax-settings" className="text-[12px] font-medium text-info hover:underline">
              {copy.page.editAssumptions}
            </Link>
          </div>
        }
      />

      <section className="mb-5 rounded-md border border-line bg-card shadow-card">
        <div className="flex flex-col gap-1 border-b border-line-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[14px] font-medium text-ink">{copy.settings.title}</h2>
            <p className="mt-0.5 text-[11px] text-ink-3">
              {copy.settings.subtitle}
            </p>
          </div>
          <Badge>{copy.settings.badge}</Badge>
        </div>
        <form className="grid gap-4 p-4 lg:grid-cols-[minmax(14rem,1.4fr)_minmax(11rem,0.8fr)_minmax(10rem,0.7fr)_auto] lg:items-end">
          <label className="block">
            <span className="mb-1.5 flex items-center text-[10px] font-medium uppercase text-ink-3">
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface text-[10px] text-ink">1</span>
              {copy.settings.schedulingRule}
              <InfoTooltip align="left">{copy.settings.schedulingRuleInfo}</InfoTooltip>
            </span>
            <select name="master" defaultValue={selectedMasterStrategy} className="w-full rounded-md border border-line bg-card px-3 py-2.5 text-[13px] text-ink outline-none focus:border-info">
              <option value="STAGED">{copy.settings.staged}</option>
              <option value="EARLIEST_LT">{copy.settings.earliestLongTerm}</option>
              <option value="WAIT_US_ONLY">{copy.settings.waitUsOnly}</option>
              <option value="ACCELERATE_LOSSES">{copy.settings.accelerateLosses}</option>
            </select>
            <span className="mt-1 block text-[10px] text-ink-3">{copy.settings.schedulingHint}</span>
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-center text-[10px] font-medium uppercase text-ink-3">
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface text-[10px] text-ink">2</span>
              {copy.settings.executionWindow}
              <InfoTooltip align="left">{copy.settings.executionWindowInfo}</InfoTooltip>
            </span>
            <select name="pace" defaultValue={executionMonths} className="w-full rounded-md border border-line bg-card px-3 py-2.5 text-[13px] text-ink outline-none focus:border-info">
              {[12, 18, 24, 36, 48].map((months) => (
                <option key={months} value={months}>{months} {copy.settings.months}</option>
              ))}
            </select>
            <span className="mt-1 block text-[10px] text-ink-3">{copy.settings.executionHint}</span>
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-center text-[10px] font-medium uppercase text-ink-3">
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface text-[10px] text-ink">3</span>
              {copy.settings.taxHorizon}
            </span>
            <select name="horizon" defaultValue={horizonYears} className="w-full rounded-md border border-line bg-card px-3 py-2.5 text-[13px] text-ink outline-none focus:border-info">
              {[3, 4, 5, 7, 10].map((yearCount) => (
                <option key={yearCount} value={yearCount}>{yearCount} {copy.settings.years}</option>
              ))}
            </select>
            <span className="mt-1 block text-[10px] text-ink-3">{copy.settings.horizonHint}</span>
          </label>
          <button type="submit" className="rounded-md border border-ink bg-ink px-5 py-2.5 text-[13px] font-medium text-card transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-info">
            {copy.settings.rebuild}
          </button>
        </form>
      </section>

      <MasterPlanOverview
        planSet={masterPlanSet}
        inputIssueCount={plan.summary.missingValuationCount + operational.staleItems.length}
        fullHoldingsValueKrw={opportunityCoverage.holdingsMarketValueKrw}
        copy={copy}
      />

      <SavedPlansPanel
        plans={savedPlans}
        selectedStrategy={selectedMasterStrategy}
        executionMonths={executionMonths}
        horizonYears={horizonYears}
        copy={copy}
      />

      <MasterScenarioComparison
        planSet={masterPlanSet}
        horizonYears={horizonYears}
        copy={copy}
      />

      <TaxPlanTimeline
        key={`${masterPlanSet.selectedPlan.strategy}:${selectedScheduleMonth}`}
        plan={masterPlanSet.selectedPlan}
        initialMonth={selectedScheduleMonth}
        initialPage={schedulePage}
        language={language}
      />

      <MasterPlanAnnualTax plan={masterPlanSet.selectedPlan} copy={copy} />

      <details className="mb-5 rounded-md border border-line bg-card shadow-card">
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-ink">
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

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card
          title={copy.page.annualFilingProfile}
          info={copy.page.annualFilingProfileInfo}
          accent
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[12px]">
              <thead className="text-[10px] uppercase tracking-[0.08em] text-ink-3">
                <tr>
                  <th className="pb-2 pr-4 font-medium">{copy.page.year}</th>
                  <th className="pb-2 pr-4 font-medium">{copy.page.taxCalc}</th>
                  <th className="pb-2 pr-4 text-right font-medium">
                    {copy.page.projectedWages}
                    <InfoTooltip align="right">{copy.page.projectedWagesInfo}</InfoTooltip>
                  </th>
                  <th className="pb-2 pr-4 font-medium">
                    {copy.page.usFiling}
                    <InfoTooltip align="left">{copy.page.usFilingInfo}</InfoTooltip>
                  </th>
                  <th className="pb-2 pr-4 font-medium">
                    {copy.page.krFiling}
                    <InfoTooltip align="left">{copy.page.krFilingInfo}</InfoTooltip>
                  </th>
                  <th className="pb-2 pr-4 font-medium">{copy.page.status}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {filingProfiles.map((profile) => {
                  const us = profile.jurisdictions.find((item) => item.code === 'US')
                  const kr = profile.jurisdictions.find((item) => item.code === 'KR')
                  return (
                    <tr key={profile.year}>
                      <td className="py-2 pr-4 font-mono text-ink">{profile.year}</td>
                      <td className="py-2 pr-4"><Badge tone="info">{scenarioFromTaxYearProfile(profile)}</Badge></td>
                      <td className="py-2 pr-4 text-right tabular-nums text-ink">{fmtMoney(projectedWagesUsd(taxPolicy.policy, profile.year), 'USD')}</td>
                      <td className="py-2 pr-4">{us?.filingRequired ? <Badge tone="success">{copy.page.required}</Badge> : <Badge>{copy.page.off}</Badge>}</td>
                      <td className="py-2 pr-4">{kr?.filingRequired ? <Badge tone="success">{copy.page.required}</Badge> : <Badge>{copy.page.off}</Badge>}</td>
                      <td className="py-2 pr-4"><Badge tone={profile.status === 'confirmed' ? 'success' : 'warning'}>{profile.status}</Badge></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title={copy.page.baseAssumptions}>
          <div className="space-y-2 text-[12px] text-ink-2">
            <div className="flex items-center justify-between gap-3"><span>{copy.page.scenario}</span><Badge tone="info">{plan.assumptions.scenario}</Badge></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.filingState}</span><span className="text-ink">{assumptionString(taxPolicy.policy, 'US', 'filingStatus', 'n/a')} / {assumptionString(taxPolicy.policy, 'US', 'stateCode', 'n/a')}</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.w2WageBase}</span><span className="tabular-nums text-ink">{assumptionNumber(taxPolicy.policy, 'US', 'wageBaseYear', 0)} · {fmtMoney(assumptionNumber(taxPolicy.policy, 'US', 'wageBaseUsd', 0), 'USD')}</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.annualIncomeGrowth}</span><span className="tabular-nums text-ink">{pct(assumptionNumber(taxPolicy.policy, 'US', 'annualIncomeGrowthPct', 0))}</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.federalMethod}</span><Badge tone="success">{copy.page.federalMethodValue}</Badge></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.fallbackShortLong}</span><span className="tabular-nums text-ink">{pct(plan.assumptions.usShortRatePct)} / {pct(plan.assumptions.usLongRatePct)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.fallbackStateNiit}</span><span className="tabular-nums text-ink">{pct(plan.assumptions.usStateRatePct)} / {pct(plan.assumptions.usNiitRatePct)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.ytdCarryovers}</span><span className="tabular-nums text-ink">$0 / $0</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.krStockDeduction}</span><span className="tabular-nums text-ink">{fmtKrw(plan.assumptions.krBasicDeductionKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.krForeignStockRate}</span><span className="tabular-nums text-ink">{pct(plan.assumptions.krForeignStockRatePct)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.creditModel}</span><span className="text-right text-ink">{plan.assumptions.krForeignTaxCreditMode}</span></div>
          </div>
        </Card>
      </div>

      {hasPlanningTarget ? (
        <Card
          title={copy.page.annualTargetScenarioComparison}
          info={copy.page.annualTargetInfo}
          className="mb-5"
          accent
        >
          <div className="mb-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-[12px] leading-relaxed text-ink-3">
            {copy.page.annualTargetNote}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[12px]">
              <thead className="text-[10px] uppercase tracking-[0.08em] text-ink-3">
                <tr>
                  <th className="pb-2 pr-4 font-medium">{copy.page.scenario}</th>
                  <th className="pb-2 pr-4 text-right font-medium">{copy.page.totalSales}</th>
                  <th className="pb-2 pr-4 text-right font-medium">{copy.page.realizedGainLoss}</th>
                  <th className="pb-2 pr-4 text-right font-medium">{copy.page.estimatedTax}</th>
                  <th className="pb-2 pr-4 text-right font-medium">{copy.page.afterTaxCash}</th>
                  <th className="pb-2 pr-4 text-right font-medium">{copy.page.peakYearTax}</th>
                  <th className="pb-2 pr-4 text-right font-medium">{copy.page.lotsUsed}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {multiYearPlan.scenarios.map((scenarioRow) => (
                  <tr key={scenarioRow.key} className={multiYearPlan.bestScenario?.key === scenarioRow.key ? 'bg-surface/60' : undefined}>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink">{scenarioRow.label}</span>
                        {multiYearPlan.bestScenario?.key === scenarioRow.key && <Badge tone="success">{copy.page.lowestTax}</Badge>}
                        {multiYearPlan.bestScenario?.key !== scenarioRow.key && sameKrw(scenarioRow.summary.taxKrw, multiYearPlan.bestScenario?.summary.taxKrw) && <Badge tone="neutral">{copy.page.sameTax}</Badge>}
                      </div>
                      <div className="mt-1 max-w-[24rem] text-[11px] text-ink-3">{scenarioRow.description}</div>
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(scenarioRow.summary.proceedsKrw)}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">{signedKrw(scenarioRow.summary.gainKrw)}</td>
                    <td className="py-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(scenarioRow.summary.taxKrw)}</td>
                    <td className="py-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(scenarioRow.summary.afterTaxKrw)}</td>
                    <td className="py-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(scenarioRow.summary.peakYearTaxKrw)}</td>
                    <td className="py-3 pr-4 text-right tabular-nums text-ink">{fmtNumber(scenarioRow.summary.lotCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card title={copy.page.annualTargetScenarioComparison} className="mb-5">
          <div className="grid gap-3 md:grid-cols-[1fr_18rem]">
            <div className="text-[13px] leading-relaxed text-ink-2">
              {copy.page.annualTargetHidden}
            </div>
            <div className="rounded-md border border-line-subtle bg-surface px-3 py-2 text-[12px] text-ink-3">
              {copy.page.annualTargetHiddenHint}
            </div>
          </div>
        </Card>
      )}

      {hasPlanningTarget && (
        <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        {multiYearPlan.scenarios.slice(0, 4).map((scenarioRow) => (
          <ScenarioTimeline key={scenarioRow.key} scenario={scenarioRow} copy={copy} />
        ))}
        </div>
      )}

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title={copy.page.selectedSingleYearTaxSplit} info={copy.page.singleYearTaxSplitInfo}>
          <div className="space-y-2 text-[12px] text-ink-2">
            <div className="flex items-center justify-between gap-3"><span>{copy.page.federalShortTerm}</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.usFederalShortTermTaxKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.federalLongTerm}</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.usFederalLongTermTaxKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.niit}</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.usNiitTaxKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.californiaState}</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.usStateTaxKrw)}</span></div>
            <div className="flex items-center justify-between gap-3 border-t border-line-subtle pt-2"><span>{copy.page.usGrossEstimate}</span><span className="tabular-nums text-ink">{fmtMoney(plan.summary.usTaxUsd, 'USD')} / {fmtKrw(plan.summary.usTaxKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.krGrossTax}</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.krTaxKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.usFtcLimitUsed}</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.usForeignTaxCreditLimitKrw)} / <span className="text-success">-{fmtKrw(plan.summary.usForeignTaxCreditKrw)}</span></span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.krCreditUsed}</span><span className="tabular-nums text-success">-{fmtKrw(plan.summary.krForeignTaxCreditKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.combinedAfterCredit}</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.estimatedTaxKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.afterTaxProceeds}</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.estimatedAfterTaxKrw)}</span></div>
            <div className="text-[11px] leading-relaxed text-ink-3">{copy.page.methodNote(plan.summary.taxCalculationMethod)}</div>
          </div>
        </Card>

        <Card title={copy.page.warnings} accent={plan.summary.warnings.length + operational.staleItems.length > 0}>
          {plan.summary.warnings.length === 0 && operational.staleItems.length === 0 ? (
            <EmptyState ok>{copy.page.noPlannerWarnings}</EmptyState>
          ) : (
            <ul className="space-y-2 text-[12px] text-ink-2">
              {operational.staleItems.length > 0 && <li><Badge tone="warning">{copy.page.inputs}</Badge> {copy.page.resolveFreshness(fmtNumber(operational.staleItems.length))}</li>}
              {plan.summary.warnings.map((warning) => (
                <li key={warning}><Badge tone="warning">{copy.page.review}</Badge> {warning}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={copy.page.recommendedSaleLotSequence} className="mb-5" accent>
        <CandidateTable rows={plan.recommended} copy={copy} />
      </Card>

      <Card title={copy.page.allOpenLotCandidates}>
        <CandidateTable rows={plan.candidates.slice(0, 80)} copy={copy} />
      </Card>
    </>
  )
}

function ScenarioTimeline({ scenario, copy }: { scenario: MultiYearTaxScenario; copy: ReturnType<typeof getTaxPlanningCopy> }) {
  return (
    <Card title={scenario.label} action={<Badge tone={scenario.summary.taxKrw > 0 ? 'warning' : 'success'}>{fmtKrw(scenario.summary.taxKrw)}</Badge>}>
      <div className="space-y-3">
        {scenario.years.map((year) => (
          <div key={year.year} className="rounded-md border border-line-subtle bg-surface p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[13px] text-ink">{year.year}</span>
                <Badge tone="info">{year.filingScenario}</Badge>
              </div>
              <div className="text-right text-[12px] tabular-nums text-ink">
                {fmtKrw(year.taxKrw)}
                <div className="text-[10px] text-ink-3">{pct(year.effectiveTaxRatePct)}</div>
              </div>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {year.markets.length === 0 ? (
                <div className="text-[11px] text-ink-3">{copy.opportunity.noAllocatedSaleLots}</div>
              ) : (
                year.markets.map((market) => (
                  <div key={market.market} className="rounded-sm border border-line bg-card px-2.5 py-2 text-[11px]">
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
    </Card>
  )
}
