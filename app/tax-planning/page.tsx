import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { TaxPlanTimeline } from '@/components/TaxPlanTimeline'
import { Badge, Card, EmptyState, InfoTooltip, marketTone } from '@/components/ui'
import { getOperationalHealth, getOverview, getTaxPlanningLots } from '@/lib/adapters/portfolio-db'
import { fmtKrw, fmtMoney, fmtNumber } from '@/lib/format'
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
        eyebrow="Tax"
        title="Tax Planning"
        emphasis="Planning"
        subtitle="Compare Korea and US stock sale timing across multiple years. Results are review estimates, not tax filing advice."
        action={
          <div className="flex items-center gap-2">
            {taxPolicy.source === 'example' && <Badge tone="warning">Using example assumptions</Badge>}
            <Link href="/tax-settings" className="text-[12px] font-medium text-info hover:underline">
              Edit assumptions
            </Link>
          </div>
        }
      />

      <section className="mb-5 rounded-md border border-line bg-card shadow-card">
        <div className="flex flex-col gap-1 border-b border-line-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[14px] font-medium text-ink">Plan Settings</h2>
            <p className="mt-0.5 text-[11px] text-ink-3">
              Choose sale-timing rules and date ranges, then recalculate the plan.
            </p>
          </div>
          <Badge>Calculated with current prices and FX</Badge>
        </div>
        <form className="grid gap-4 p-4 lg:grid-cols-[minmax(14rem,1.4fr)_minmax(11rem,0.8fr)_minmax(10rem,0.7fr)_auto] lg:items-end">
          <label className="block">
            <span className="mb-1.5 flex items-center text-[10px] font-medium uppercase text-ink-3">
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface text-[10px] text-ink">1</span>
              Scheduling rule
              <InfoTooltip align="left">Choose the deterministic scheduling rule. Tax calculations remain rule-based; no market forecast or LLM judgment is applied here.</InfoTooltip>
            </span>
            <select name="master" defaultValue={selectedMasterStrategy} className="w-full rounded-md border border-line bg-card px-3 py-2.5 text-[13px] text-ink outline-none focus:border-info">
              <option value="STAGED">Stage sales after long-term eligibility</option>
              <option value="EARLIEST_LT">Sell at earliest long-term eligibility</option>
              <option value="WAIT_US_ONLY">Wait for US-only filing</option>
              <option value="ACCELERATE_LOSSES">Accelerate loss harvesting</option>
            </select>
            <span className="mt-1 block text-[10px] text-ink-3">Controls when each tax lot first enters the schedule.</span>
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-center text-[10px] font-medium uppercase text-ink-3">
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface text-[10px] text-ink">2</span>
              Execution window
              <InfoTooltip align="left">For the staged plan, divide current priced lot value across this many months. Other plans use their earliest permitted dates.</InfoTooltip>
            </span>
            <select name="pace" defaultValue={executionMonths} className="w-full rounded-md border border-line bg-card px-3 py-2.5 text-[13px] text-ink outline-none focus:border-info">
              {[12, 18, 24, 36, 48].map((months) => (
                <option key={months} value={months}>{months} months</option>
              ))}
            </select>
            <span className="mt-1 block text-[10px] text-ink-3">Applies to staged plans.</span>
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-center text-[10px] font-medium uppercase text-ink-3">
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface text-[10px] text-ink">3</span>
              Tax horizon
            </span>
            <select name="horizon" defaultValue={horizonYears} className="w-full rounded-md border border-line bg-card px-3 py-2.5 text-[13px] text-ink outline-none focus:border-info">
              {[3, 4, 5, 7, 10].map((yearCount) => (
                <option key={yearCount} value={yearCount}>{yearCount} years</option>
              ))}
            </select>
            <span className="mt-1 block text-[10px] text-ink-3">Includes annual filing-profile changes.</span>
          </label>
          <button type="submit" className="rounded-md border border-ink bg-ink px-5 py-2.5 text-[13px] font-medium text-card transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-info">
            Rebuild plan
          </button>
        </form>
      </section>

      <MasterPlanOverview
        planSet={masterPlanSet}
        inputIssueCount={plan.summary.missingValuationCount + operational.staleItems.length}
        fullHoldingsValueKrw={opportunityCoverage.holdingsMarketValueKrw}
      />

      <SavedPlansPanel
        plans={savedPlans}
        selectedStrategy={selectedMasterStrategy}
        executionMonths={executionMonths}
        horizonYears={horizonYears}
      />

      <MasterScenarioComparison
        planSet={masterPlanSet}
        horizonYears={horizonYears}
      />

      <TaxPlanTimeline
        key={`${masterPlanSet.selectedPlan.strategy}:${selectedScheduleMonth}`}
        plan={masterPlanSet.selectedPlan}
        initialMonth={selectedScheduleMonth}
        initialPage={schedulePage}
      />

      <MasterPlanAnnualTax plan={masterPlanSet.selectedPlan} />

      <details className="mb-5 rounded-md border border-line bg-card shadow-card">
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-ink">
          Open static opportunity analysis
        </summary>
        <div className="border-t border-line-subtle p-4">
          <DecisionSummary
            hasPlanningTarget={hasPlanningTarget}
            tiedTax={tiedTax}
            bestScenario={multiYearPlan.bestScenario}
            opportunities={opportunities}
            inputIssueCount={plan.summary.missingValuationCount + operational.staleItems.length}
            openLotCount={plan.summary.candidateCount}
          />
          <PlanningMap
            scenario={multiYearPlan.bestScenario}
            hasPlanningTarget={hasPlanningTarget}
            annualTargetCashKrw={annualTargetCashKrw}
            opportunityRows={opportunityRows}
            coverage={opportunityCoverage}
            policy={taxPolicy.policy}
            assumptionsAreExample={taxPolicy.source === 'example'}
          />
        </div>
      </details>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card
          title="Annual filing profile"
          info="Filing flags track whether that country needs reporting work in a year. Tax calc flags decide whether that country's tax estimate is included in planning math."
          accent
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[12px]">
              <thead className="text-[10px] uppercase tracking-[0.08em] text-ink-3">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Year</th>
                  <th className="pb-2 pr-4 font-medium">Tax calc</th>
                  <th className="pb-2 pr-4 text-right font-medium">
                    Projected wages
                    <InfoTooltip align="right">W-2 base wages grown by the annual income-growth assumption. This is not projected taxable income.</InfoTooltip>
                  </th>
                  <th className="pb-2 pr-4 font-medium">
                    US filing
                    <InfoTooltip align="left">Whether this year needs US tax reporting workflow and evidence review. This does not by itself change the planner&apos;s tax math.</InfoTooltip>
                  </th>
                  <th className="pb-2 pr-4 font-medium">
                    KR filing
                    <InfoTooltip align="left">Whether this year needs Korea tax reporting workflow and evidence review. This does not by itself change the planner&apos;s tax math.</InfoTooltip>
                  </th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
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
                      <td className="py-2 pr-4">{us?.filingRequired ? <Badge tone="success">Required</Badge> : <Badge>Off</Badge>}</td>
                      <td className="py-2 pr-4">{kr?.filingRequired ? <Badge tone="success">Required</Badge> : <Badge>Off</Badge>}</td>
                      <td className="py-2 pr-4"><Badge tone={profile.status === 'confirmed' ? 'success' : 'warning'}>{profile.status}</Badge></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Base assumptions">
          <div className="space-y-2 text-[12px] text-ink-2">
            <div className="flex items-center justify-between gap-3"><span>Scenario</span><Badge tone="info">{plan.assumptions.scenario}</Badge></div>
            <div className="flex items-center justify-between gap-3"><span>Filing / state</span><span className="text-ink">{assumptionString(taxPolicy.policy, 'US', 'filingStatus', 'n/a')} / {assumptionString(taxPolicy.policy, 'US', 'stateCode', 'n/a')}</span></div>
            <div className="flex items-center justify-between gap-3"><span>W-2 wage base</span><span className="tabular-nums text-ink">{assumptionNumber(taxPolicy.policy, 'US', 'wageBaseYear', 0)} · {fmtMoney(assumptionNumber(taxPolicy.policy, 'US', 'wageBaseUsd', 0), 'USD')}</span></div>
            <div className="flex items-center justify-between gap-3"><span>Annual income growth</span><span className="tabular-nums text-ink">{pct(assumptionNumber(taxPolicy.policy, 'US', 'annualIncomeGrowthPct', 0))}</span></div>
            <div className="flex items-center justify-between gap-3"><span>Federal method</span><Badge tone="success">2026 MFJ progressive</Badge></div>
            <div className="flex items-center justify-between gap-3"><span>Fallback ST / LT</span><span className="tabular-nums text-ink">{pct(plan.assumptions.usShortRatePct)} / {pct(plan.assumptions.usLongRatePct)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>Fallback state / NIIT</span><span className="tabular-nums text-ink">{pct(plan.assumptions.usStateRatePct)} / {pct(plan.assumptions.usNiitRatePct)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>YTD realized / carryovers</span><span className="tabular-nums text-ink">$0 / $0</span></div>
            <div className="flex items-center justify-between gap-3"><span>KR stock deduction</span><span className="tabular-nums text-ink">{fmtKrw(plan.assumptions.krBasicDeductionKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>KR foreign stock rate</span><span className="tabular-nums text-ink">{pct(plan.assumptions.krForeignStockRatePct)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>Credit model</span><span className="text-right text-ink">{plan.assumptions.krForeignTaxCreditMode}</span></div>
          </div>
        </Card>
      </div>

      {hasPlanningTarget ? (
        <Card
          title="Annual target scenario comparison"
          info="These rows compare how to satisfy the same annual KRW sale target across the planning horizon. They do not model whether Korea or the US return is filed first within the same year."
          className="mb-5"
          accent
        >
          <div className="mb-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-[12px] leading-relaxed text-ink-3">
            Each row uses the same annual test amount, then changes which market is sold first. Read this only after choosing a rough yearly sale range from the Opportunity map.
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[12px]">
              <thead className="text-[10px] uppercase tracking-[0.08em] text-ink-3">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Scenario</th>
                  <th className="pb-2 pr-4 text-right font-medium">Total sales</th>
                  <th className="pb-2 pr-4 text-right font-medium">Realized G/L</th>
                  <th className="pb-2 pr-4 text-right font-medium">Est. tax</th>
                  <th className="pb-2 pr-4 text-right font-medium">After tax cash</th>
                  <th className="pb-2 pr-4 text-right font-medium">Peak year tax</th>
                  <th className="pb-2 pr-4 text-right font-medium">Lots used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {multiYearPlan.scenarios.map((scenarioRow) => (
                  <tr key={scenarioRow.key} className={multiYearPlan.bestScenario?.key === scenarioRow.key ? 'bg-surface/60' : undefined}>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink">{scenarioRow.label}</span>
                        {multiYearPlan.bestScenario?.key === scenarioRow.key && <Badge tone="success">Lowest tax</Badge>}
                        {multiYearPlan.bestScenario?.key !== scenarioRow.key && sameKrw(scenarioRow.summary.taxKrw, multiYearPlan.bestScenario?.summary.taxKrw) && <Badge tone="neutral">Same tax</Badge>}
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
        <Card title="Annual target scenario comparison" className="mb-5">
          <div className="grid gap-3 md:grid-cols-[1fr_18rem]">
            <div className="text-[13px] leading-relaxed text-ink-2">
              This comparison is hidden until an annual test amount is entered. Without a repeated yearly sale amount, labels like lowest tax or same tax are not decision-grade because the planner has not been asked to satisfy a concrete sale range.
            </div>
            <div className="rounded-md border border-line-subtle bg-surface px-3 py-2 text-[12px] text-ink-3">
              Use the Opportunity map first to find promising years and markets, then enter a KRW amount above to compare execution scenarios.
            </div>
          </div>
        </Card>
      )}

      {hasPlanningTarget && (
        <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        {multiYearPlan.scenarios.slice(0, 4).map((scenarioRow) => (
          <ScenarioTimeline key={scenarioRow.key} scenario={scenarioRow} />
        ))}
        </div>
      )}

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Selected single-year tax split" info="This is the tax estimate for the currently selected lot sequence, not the full portfolio. Federal and California amounts are incremental tax above projected wage income.">
          <div className="space-y-2 text-[12px] text-ink-2">
            <div className="flex items-center justify-between gap-3"><span>Federal short-term</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.usFederalShortTermTaxKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>Federal long-term</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.usFederalLongTermTaxKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>NIIT</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.usNiitTaxKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>California / state</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.usStateTaxKrw)}</span></div>
            <div className="flex items-center justify-between gap-3 border-t border-line-subtle pt-2"><span>US gross estimate</span><span className="tabular-nums text-ink">{fmtMoney(plan.summary.usTaxUsd, 'USD')} / {fmtKrw(plan.summary.usTaxKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>KR gross tax</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.krTaxKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>US FTC limit / used</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.usForeignTaxCreditLimitKrw)} / <span className="text-success">-{fmtKrw(plan.summary.usForeignTaxCreditKrw)}</span></span></div>
            <div className="flex items-center justify-between gap-3"><span>KR credit used</span><span className="tabular-nums text-success">-{fmtKrw(plan.summary.krForeignTaxCreditKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>Combined after credit</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.estimatedTaxKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>After-tax proceeds</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.estimatedAfterTaxKrw)}</span></div>
            <div className="text-[11px] leading-relaxed text-ink-3">Method: {plan.summary.taxCalculationMethod}. FTC is applied only in the selected credit mode; source and treaty percentages remain manual inputs.</div>
          </div>
        </Card>

        <Card title="Warnings" accent={plan.summary.warnings.length + operational.staleItems.length > 0}>
          {plan.summary.warnings.length === 0 && operational.staleItems.length === 0 ? (
            <EmptyState ok>No planner warnings</EmptyState>
          ) : (
            <ul className="space-y-2 text-[12px] text-ink-2">
              {operational.staleItems.length > 0 && <li><Badge tone="warning">Inputs</Badge> Resolve {fmtNumber(operational.staleItems.length)} freshness issue(s) before trading.</li>}
              {plan.summary.warnings.map((warning) => (
                <li key={warning}><Badge tone="warning">Review</Badge> {warning}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Recommended sale-lot sequence" className="mb-5" accent>
        <CandidateTable rows={plan.recommended} />
      </Card>

      <Card title="All open lot candidates">
        <CandidateTable rows={plan.candidates.slice(0, 80)} />
      </Card>
    </>
  )
}

function ScenarioTimeline({ scenario }: { scenario: MultiYearTaxScenario }) {
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
                <div className="text-[11px] text-ink-3">No allocated sale lots</div>
              ) : (
                year.markets.map((market) => (
                  <div key={market.market} className="rounded-sm border border-line bg-card px-2.5 py-2 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone={marketTone(market.market)}>{market.market}</Badge>
                      <span className="tabular-nums text-ink">{fmtKrw(market.proceedsKrw)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-ink-3">
                      <span>Tax</span>
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
