import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { TaxPlanTimeline } from '@/components/TaxPlanTimeline'
import { Badge, Button, Card, EmptyState, InfoTooltip, Label, Signed, marketTone } from '@/components/ui'
import { getOperationalHealth, getOverview, getTaxPlanningLots } from '@/lib/adapters/portfolio-db'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { fmtKrw, fmtMoney, fmtNumber, fmtPct } from '@/lib/format'
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
  type TaxYearProfile,
} from '@/lib/tax-policy'

import { CandidateTable, MasterPlanAnnualTax, MasterPlanOverview, MasterScenarioComparison, SavedPlansPanel } from './components'
import { DecisionSummary, PlanningMap, buildOpportunityRows, opportunitySummary, type OpportunityCoverage } from './opportunity-analysis'
import { sameKrw } from './view-utils'
import { Select } from '@/components/form'
import { DataTable } from '@/components/DataTable'
import { getPageCopy } from '@/lib/ui-copy'
import { routeMetadata } from '@/lib/page-names'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/tax-planning')

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
  const money = createMoneyFormatter(await getCurrencyPreferences())
  const copy = getPageCopy('taxPlanning', language)
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
            <Link href="/tax-settings" className="text-caption font-medium text-info hover:underline">
              {copy.page.editAssumptions}
            </Link>
          </div>
        }
      />

      <section className="mb-5 rounded-md border border-line bg-card shadow-card">
        <div className="flex flex-col gap-1 border-b border-line-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-body-lg font-medium text-ink">{copy.settings.title}</h2>
            <p className="mt-0.5 text-label text-ink-3">
              {copy.settings.subtitle}
            </p>
          </div>
          <Badge>{copy.settings.badge}</Badge>
        </div>
        <form className="grid gap-4 p-4 lg:grid-cols-[minmax(14rem,1.4fr)_minmax(11rem,0.8fr)_minmax(10rem,0.7fr)_auto] lg:items-end">
          <label className="block">
            <Label as="span" size="micro" className="mb-1.5 flex items-center">
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface text-micro text-ink">1</span>
              {copy.settings.schedulingRule}
              <InfoTooltip align="left">{copy.settings.schedulingRuleInfo}</InfoTooltip>
            </Label>
            <Select name="master" defaultValue={selectedMasterStrategy} className="w-full">
              <option value="STAGED">{copy.settings.staged}</option>
              <option value="EARLIEST_LT">{copy.settings.earliestLongTerm}</option>
              <option value="WAIT_US_ONLY">{copy.settings.waitUsOnly}</option>
              <option value="ACCELERATE_LOSSES">{copy.settings.accelerateLosses}</option>
            </Select>
            <span className="mt-1 block text-micro text-ink-3">{copy.settings.schedulingHint}</span>
          </label>
          <label className="block">
            <Label as="span" size="micro" className="mb-1.5 flex items-center">
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface text-micro text-ink">2</span>
              {copy.settings.executionWindow}
              <InfoTooltip align="left">{copy.settings.executionWindowInfo}</InfoTooltip>
            </Label>
            <Select name="pace" defaultValue={executionMonths} className="w-full">
              {[12, 18, 24, 36, 48].map((months) => (
                <option key={months} value={months}>{months} {copy.settings.months}</option>
              ))}
            </Select>
            <span className="mt-1 block text-micro text-ink-3">{copy.settings.executionHint}</span>
          </label>
          <label className="block">
            <Label as="span" size="micro" className="mb-1.5 flex items-center">
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface text-micro text-ink">3</span>
              {copy.settings.taxHorizon}
            </Label>
            <Select name="horizon" defaultValue={horizonYears} className="w-full">
              {[3, 4, 5, 7, 10].map((yearCount) => (
                <option key={yearCount} value={yearCount}>{yearCount} {copy.settings.years}</option>
              ))}
            </Select>
            <span className="mt-1 block text-micro text-ink-3">{copy.settings.horizonHint}</span>
          </label>
          <Button type="submit" variant="solid" size="md">
            {copy.settings.rebuild}
          </Button>
        </form>
      </section>

      <MasterPlanOverview
        planSet={masterPlanSet}
        inputIssueCount={plan.summary.missingValuationCount + operational.staleItems.length}
        fullHoldingsValueKrw={opportunityCoverage.holdingsMarketValueKrw}
        copy={copy}
        money={money}
      />

      <SavedPlansPanel
        plans={savedPlans}
        selectedStrategy={selectedMasterStrategy}
        executionMonths={executionMonths}
        horizonYears={horizonYears}
        copy={copy}
        money={money}
      />

      <MasterScenarioComparison
        planSet={masterPlanSet}
        horizonYears={horizonYears}
        copy={copy}
        money={money}
      />

      <TaxPlanTimeline
        key={`${masterPlanSet.selectedPlan.strategy}:${selectedScheduleMonth}`}
        plan={masterPlanSet.selectedPlan}
        initialMonth={selectedScheduleMonth}
        initialPage={schedulePage}
        language={language}
      />

      <MasterPlanAnnualTax plan={masterPlanSet.selectedPlan} copy={copy} money={money} />

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

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card
          title={copy.page.annualFilingProfile}
          info={copy.page.annualFilingProfileInfo}
          accent
        >
          <DataTable
            caption={copy.page.annualFilingProfile}
            rows={filingProfiles}
            getRowKey={(profile: TaxYearProfile) => profile.year}
            columns={[
              { key: 'year', label: copy.page.year, render: (p: TaxYearProfile) => <span className="font-mono text-ink">{p.year}</span> },
              { key: 'scenario', label: copy.page.taxCalc, render: (p: TaxYearProfile) => <Badge tone="info">{scenarioFromTaxYearProfile(p)}</Badge> },
              {
                key: 'wages',
                label: copy.page.projectedWages,
                description: copy.page.projectedWagesInfo,
                align: 'right',
                render: (p: TaxYearProfile) => fmtMoney(projectedWagesUsd(taxPolicy.policy, p.year), 'USD'),
              },
              {
                key: 'us',
                label: copy.page.usFiling,
                description: copy.page.usFilingInfo,
                render: (p: TaxYearProfile) =>
                  p.jurisdictions.find((item) => item.code === 'US')?.filingRequired ? (
                    <Badge tone="success">{copy.page.required}</Badge>
                  ) : (
                    <Badge>{copy.page.off}</Badge>
                  ),
              },
              {
                key: 'kr',
                label: copy.page.krFiling,
                description: copy.page.krFilingInfo,
                render: (p: TaxYearProfile) =>
                  p.jurisdictions.find((item) => item.code === 'KR')?.filingRequired ? (
                    <Badge tone="success">{copy.page.required}</Badge>
                  ) : (
                    <Badge>{copy.page.off}</Badge>
                  ),
              },
              { key: 'status', label: copy.page.status, render: (p: TaxYearProfile) => <Badge tone={p.status === 'confirmed' ? 'success' : 'warning'}>{p.status}</Badge> },
            ]}
          />
        </Card>

        <Card title={copy.page.baseAssumptions}>
          <div className="space-y-2 text-caption text-ink-2">
            <div className="flex items-center justify-between gap-3"><span>{copy.page.scenario}</span><Badge tone="info">{plan.assumptions.scenario}</Badge></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.filingState}</span><span className="text-ink">{assumptionString(taxPolicy.policy, 'US', 'filingStatus', 'n/a')} / {assumptionString(taxPolicy.policy, 'US', 'stateCode', 'n/a')}</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.w2WageBase}</span><span className="tabular-nums text-ink">{assumptionNumber(taxPolicy.policy, 'US', 'wageBaseYear', 0)} · {fmtMoney(assumptionNumber(taxPolicy.policy, 'US', 'wageBaseUsd', 0), 'USD')}</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.annualIncomeGrowth}</span><span className="tabular-nums text-ink">{fmtPct(assumptionNumber(taxPolicy.policy, 'US', 'annualIncomeGrowthPct', 0))}</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.federalMethod}</span><Badge tone="success">{copy.page.federalMethodValue}</Badge></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.fallbackShortLong}</span><span className="tabular-nums text-ink">{fmtPct(plan.assumptions.usShortRatePct)} / {fmtPct(plan.assumptions.usLongRatePct)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.fallbackStateNiit}</span><span className="tabular-nums text-ink">{fmtPct(plan.assumptions.usStateRatePct)} / {fmtPct(plan.assumptions.usNiitRatePct)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.ytdCarryovers}</span><span className="tabular-nums text-ink">$0 / $0</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.krStockDeduction}</span><span className="tabular-nums text-ink">{fmtKrw(plan.assumptions.krBasicDeductionKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>{copy.page.krForeignStockRate}</span><span className="tabular-nums text-ink">{fmtPct(plan.assumptions.krForeignStockRatePct)}</span></div>
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
          <div className="mb-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-caption leading-relaxed text-ink-3">
            {copy.page.annualTargetNote}
          </div>
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
                      <span className="font-medium text-ink">{row.label}</span>
                      {multiYearPlan.bestScenario?.key === row.key && <Badge tone="success">{copy.page.lowestTax}</Badge>}
                      {multiYearPlan.bestScenario?.key !== row.key &&
                        sameKrw(row.summary.taxKrw, multiYearPlan.bestScenario?.summary.taxKrw) && (
                          <Badge tone="neutral">{copy.page.sameTax}</Badge>
                        )}
                    </div>
                    <div className="mt-1 max-w-[24rem] text-label text-ink-3">{row.description}</div>
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
        </Card>
      ) : (
        <Card title={copy.page.annualTargetScenarioComparison} className="mb-5">
          <div className="grid gap-3 md:grid-cols-[1fr_18rem]">
            <div className="text-body leading-relaxed text-ink-2">
              {copy.page.annualTargetHidden}
            </div>
            <div className="rounded-md border border-line-subtle bg-surface px-3 py-2 text-caption text-ink-3">
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
          <div className="space-y-2 text-caption text-ink-2">
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
            <div className="text-label leading-relaxed text-ink-3">{copy.page.methodNote(plan.summary.taxCalculationMethod)}</div>
          </div>
        </Card>

        <Card title={copy.page.warnings} accent={plan.summary.warnings.length + operational.staleItems.length > 0}>
          {plan.summary.warnings.length === 0 && operational.staleItems.length === 0 ? (
            <EmptyState ok>{copy.page.noPlannerWarnings}</EmptyState>
          ) : (
            <ul className="space-y-2 text-caption text-ink-2">
              {operational.staleItems.length > 0 && <li><Badge tone="warning">{copy.page.inputs}</Badge> {copy.page.resolveFreshness(fmtNumber(operational.staleItems.length))}</li>}
              {plan.summary.warnings.map((warning) => (
                <li key={warning}><Badge tone="warning">{copy.page.review}</Badge> {warning}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={copy.page.recommendedSaleLotSequence} className="mb-5" accent>
        <CandidateTable rows={plan.recommended} copy={copy} money={money} />
      </Card>

      <Card title={copy.page.allOpenLotCandidates}>
        <CandidateTable rows={plan.candidates.slice(0, 80)} copy={copy} money={money} />
      </Card>
    </>
  )
}

function ScenarioTimeline({ scenario, copy }: { scenario: MultiYearTaxScenario; copy: ReturnType<typeof getPageCopy<'taxPlanning'>> }) {
  return (
    <Card title={scenario.label} action={<Badge tone={scenario.summary.taxKrw > 0 ? 'warning' : 'success'}>{fmtKrw(scenario.summary.taxKrw)}</Badge>}>
      <div className="space-y-3">
        {scenario.years.map((year) => (
          <div key={year.year} className="rounded-md border border-line-subtle bg-surface p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-body text-ink">{year.year}</span>
                <Badge tone="info">{year.filingScenario}</Badge>
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
    </Card>
  )
}
