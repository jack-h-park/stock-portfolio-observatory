import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, InfoTooltip, StatCard } from '@/components/ui'
import { getOperationalHealth, getTaxPlanningLots } from '@/lib/adapters/portfolio-db'
import { fmtKrw, fmtMoney, fmtNumber } from '@/lib/format'
import { positionHref } from '@/lib/position-url'
import {
  buildMultiYearTaxPlan,
  buildTaxPlan,
  type MultiYearTaxScenario,
  type TaxPlanCandidate,
  type TaxPlanningLot,
} from '@/lib/tax-planning'
import { annualProfiles, getTaxPolicyState, scenarioFromTaxYearProfile, type FilingScenario, type TaxPolicy, type TaxYearProfile } from '@/lib/tax-policy'

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

function signedKrw(value: number | null | undefined) {
  if (value == null) return 'n/a'
  return <span className={value >= 0 ? 'text-success' : 'text-danger'}>{fmtKrw(value)}</span>
}

function pct(value: number | null | undefined) {
  return value == null ? 'n/a' : `${fmtNumber(value, 2)}%`
}

function sameKrw(a: number | null | undefined, b: number | null | undefined) {
  return Math.round(Number(a ?? 0)) === Math.round(Number(b ?? 0))
}

function marketAmount(row: MultiYearTaxScenario['years'][number], market: string) {
  return row.markets.find((item) => item.market === market)?.proceedsKrw ?? 0
}

function scenarioTaxTie(plan: ReturnType<typeof buildMultiYearTaxPlan>) {
  if (!plan.bestScenario) return false
  return plan.scenarios.every((item) => sameKrw(item.summary.taxKrw, plan.bestScenario?.summary.taxKrw))
}

type OpportunityRow = {
  year: number
  filingScenario: FilingScenario
  market: string
  candidateCount: number
  taxLightProceedsKrw: number
  lossHarvestKrw: number
  totalProceedsKrw: number
  totalGainKrw: number
  estimatedTaxIfAllSoldKrw: number
}

function sumKrw(rows: TaxPlanCandidate[], key: 'proceedsKrw' | 'gainKrw' | 'estimatedTaxKrw') {
  return rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0)
}

function buildOpportunityRows({
  lots,
  policy,
  profiles,
}: {
  lots: TaxPlanningLot[]
  policy: TaxPolicy
  profiles: TaxYearProfile[]
}): OpportunityRow[] {
  return profiles.flatMap((profile) => {
    const yearScenario = scenarioFromTaxYearProfile(profile)
    return ['KR', 'US'].map((market) => {
      const marketPlan = buildTaxPlan({
        lots: lots.filter((lot) => lot.market === market),
        policy,
        scenario: yearScenario,
        objective: 'minimize-tax',
        targetCashKrw: 0,
      })
      const candidates = marketPlan.candidates.filter((row) => row.proceedsKrw != null)
      const taxLight = candidates.filter((row) => row.estimatedTaxKrw <= 0)
      const lossRows = candidates.filter((row) => Number(row.gainKrw ?? 0) < 0)
      return {
        year: profile.year,
        filingScenario: yearScenario,
        market,
        candidateCount: candidates.length,
        taxLightProceedsKrw: sumKrw(taxLight, 'proceedsKrw'),
        lossHarvestKrw: Math.abs(Math.min(sumKrw(lossRows, 'gainKrw'), 0)),
        totalProceedsKrw: sumKrw(candidates, 'proceedsKrw'),
        totalGainKrw: sumKrw(candidates, 'gainKrw'),
        estimatedTaxIfAllSoldKrw: sumKrw(candidates, 'estimatedTaxKrw'),
      }
    })
  })
}

function opportunitySummary(rows: OpportunityRow[]) {
  const bestTaxLight = [...rows].sort((a, b) => b.taxLightProceedsKrw - a.taxLightProceedsKrw)[0] ?? null
  const bestLoss = [...rows].sort((a, b) => b.lossHarvestKrw - a.lossHarvestKrw)[0] ?? null
  return {
    bestTaxLight,
    bestLoss,
    taxLightProceedsKrw: bestTaxLight?.taxLightProceedsKrw ?? 0,
    lossHarvestKrw: bestLoss?.lossHarvestKrw ?? 0,
  }
}

function PositionCell({ row }: { row: TaxPlanCandidate }) {
  return (
    <div className="min-w-[14rem]">
      <div className="flex items-center gap-2">
        <Badge tone={row.market === 'US' ? 'info' : 'success'}>{row.market}</Badge>
        <Link href={positionHref(row.market, row.ticker)} className="font-mono text-[12px] font-medium text-info hover:underline">
          {row.ticker}
        </Link>
      </div>
      <div className="mt-1 max-w-[20rem] truncate text-[12px] font-medium text-ink">{row.name}</div>
    </div>
  )
}

function CandidateTable({ rows }: { rows: TaxPlanCandidate[] }) {
  if (rows.length === 0) return <EmptyState>No sale candidates with open tax lots</EmptyState>
  return (
    <DataTable
      rows={rows}
      columns={[
        { key: 'ticker', label: 'Position', render: (r) => <PositionCell row={r} /> },
        { key: 'account', label: 'Account', render: (r) => <span className="max-w-[12rem] truncate">{r.brokerage} · {r.account}</span> },
        { key: 'acquired_date', label: 'Acquired' },
        { key: 'holdingBucket', label: 'Term', render: (r) => <Badge tone={r.holdingBucket === 'long' ? 'success' : 'warning'}>{r.holdingBucket}</Badge> },
        { key: 'open_quantity', label: 'Qty', align: 'right', render: (r) => fmtNumber(r.open_quantity, 4) },
        { key: 'proceedsNative', label: 'Proceeds', align: 'right', render: (r) => (r.proceedsNative == null ? 'n/a' : fmtMoney(r.proceedsNative, r.currency)) },
        { key: 'gainKrw', label: 'Base G/L', align: 'right', render: (r) => signedKrw(r.gainKrw) },
        { key: 'estimatedTaxKrw', label: 'Est. Tax', align: 'right', render: (r) => fmtKrw(r.estimatedTaxKrw) },
        { key: 'estimatedAfterTaxKrw', label: 'After Tax', align: 'right', render: (r) => (r.estimatedAfterTaxKrw == null ? 'n/a' : fmtKrw(r.estimatedAfterTaxKrw)) },
      ]}
    />
  )
}

export default async function TaxPlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string; objective?: string; target?: string; annualTarget?: string; horizon?: string }>
}) {
  const params = await searchParams
  const taxPolicy = getTaxPolicyState()
  const activeScenario = scenario(params.scenario, taxPolicy.policy.activeScenario)
  const objective = params.objective || 'minimize-tax'
  const targetCashKrw = amountParam(params.target)
  const annualTargetCashKrw = amountParam(params.annualTarget ?? params.target)
  const horizonYears = Math.min(Math.max(Number(params.horizon ?? taxPolicy.policy.planningHorizonYears ?? 5) || 5, 1), 10)
  const lots = getTaxPlanningLots()
  const plan = buildTaxPlan({ lots, policy: taxPolicy.policy, scenario: activeScenario, objective, targetCashKrw })
  const multiYearPlan = buildMultiYearTaxPlan({
    lots,
    policy: taxPolicy.policy,
    horizonYears,
    annualTargetCashKrw,
    objective,
  })
  const operational = getOperationalHealth()
  const filingProfiles = annualProfiles(taxPolicy.policy, horizonYears)
  const opportunityRows = buildOpportunityRows({ lots, policy: taxPolicy.policy, profiles: filingProfiles })
  const opportunities = opportunitySummary(opportunityRows)
  const hasPlanningTarget = annualTargetCashKrw > 0
  const tiedTax = scenarioTaxTie(multiYearPlan)

  return (
    <>
      <PageHeader
        eyebrow="Tax"
        title="Tax Planning"
        emphasis="Planning"
        subtitle="Multi-year market timing planner for US/Korea stock realization. Treat outputs as review estimates, not filing advice."
        action={
          <div className="flex items-center gap-2">
            {taxPolicy.source === 'example' && <Badge tone="warning">Example assumptions</Badge>}
            <Link href="/tax-settings" className="text-[12px] font-medium text-info hover:underline">
              Adjust assumptions
            </Link>
          </div>
        }
      />

      <form className="mb-5 grid gap-3 rounded-md border border-line bg-card p-3 shadow-card lg:grid-cols-[10rem_13rem_1fr_11rem_auto]">
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-[0.08em] text-ink-3">Horizon</span>
          <select name="horizon" defaultValue={horizonYears} className="w-full rounded-md border border-line bg-card px-3 py-2 text-[13px] text-ink outline-none">
            {[3, 4, 5, 7, 10].map((yearCount) => (
              <option key={yearCount} value={yearCount}>{yearCount} years</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-[0.08em] text-ink-3">Scenario</span>
          <select name="scenario" defaultValue={activeScenario} className="w-full rounded-md border border-line bg-card px-3 py-2 text-[13px] text-ink outline-none">
            <option value="US_ONLY">US only</option>
            <option value="KR_ONLY">Korea only</option>
            <option value="US_AND_KR">US + Korea</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-[0.08em] text-ink-3">Objective</span>
          <select name="objective" defaultValue={objective} className="w-full rounded-md border border-line bg-card px-3 py-2 text-[13px] text-ink outline-none">
            <option value="minimize-tax">Minimize tax</option>
            <option value="harvest-loss">Harvest losses</option>
            <option value="use-deduction">Use deduction room</option>
            <option value="raise-cash">Raise target cash</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-[0.08em] text-ink-3">
            Annual test amount
            <InfoTooltip align="right">Optional KRW amount to test as a repeated sale target for each year in the horizon. Leave it blank to stay in opportunity exploration mode.</InfoTooltip>
          </span>
          <input
            name="annualTarget"
            type="text"
            inputMode="numeric"
            placeholder="₩30,000,000"
            defaultValue={annualTargetCashKrw ? fmtKrw(annualTargetCashKrw) : ''}
            className="w-full rounded-md border border-line bg-card px-3 py-2 text-[13px] text-ink outline-none"
          />
          <span className="mt-1 block text-[11px] leading-tight text-ink-3">
            Optional. When filled, the same KRW amount is tested for every year.
          </span>
        </label>
        <button type="submit" className="self-end rounded-md border border-line bg-ink px-4 py-2 text-[13px] font-medium text-card transition-opacity hover:opacity-90">
          Test
        </button>
      </form>

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
      />

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
                  <th className="pb-2 pr-4 font-medium">
                    US filing
                    <InfoTooltip align="left">Whether this year needs US tax reporting workflow and evidence review. This does not by itself change the planner's tax math.</InfoTooltip>
                  </th>
                  <th className="pb-2 pr-4 font-medium">
                    KR filing
                    <InfoTooltip align="left">Whether this year needs Korea tax reporting workflow and evidence review. This does not by itself change the planner's tax math.</InfoTooltip>
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
            <div className="flex items-center justify-between gap-3"><span>US ST / LT</span><span className="tabular-nums text-ink">{pct(plan.assumptions.usShortRatePct)} / {pct(plan.assumptions.usLongRatePct)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>US state + NIIT</span><span className="tabular-nums text-ink">{pct(plan.assumptions.usStateRatePct + plan.assumptions.usNiitRatePct)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>KR stock deduction</span><span className="tabular-nums text-ink">{fmtKrw(plan.assumptions.krBasicDeductionKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>KR foreign stock rate</span><span className="tabular-nums text-ink">{pct(plan.assumptions.krForeignStockRatePct)}</span></div>
          </div>
        </Card>
      </div>

      <Card
        title="Detailed scenario comparison"
        info="These scenarios compare which market exposure to realize earlier in the multi-year plan. They do not model whether Korea or the US return is filed first within the same year."
        className="mb-5"
      >
        {!hasPlanningTarget && (
          <div className="mb-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-[12px] leading-relaxed text-ink-3">
            This table is in preview mode because no annual sale target is set. Enter a KRW amount above to turn it into a real timing comparison.
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-[12px]">
            <thead className="text-[10px] uppercase tracking-[0.08em] text-ink-3">
              <tr>
                <th className="pb-2 pr-4 font-medium">Scenario</th>
                <th className="pb-2 pr-4 text-right font-medium">Proceeds</th>
                <th className="pb-2 pr-4 text-right font-medium">Gain/Loss</th>
                <th className="pb-2 pr-4 text-right font-medium">Tax</th>
                <th className="pb-2 pr-4 text-right font-medium">After Tax</th>
                <th className="pb-2 pr-4 text-right font-medium">Peak Year</th>
                <th className="pb-2 pr-4 text-right font-medium">Lots</th>
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

      {hasPlanningTarget && (
        <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        {multiYearPlan.scenarios.slice(0, 4).map((scenarioRow) => (
          <ScenarioTimeline key={scenarioRow.key} scenario={scenarioRow} />
        ))}
        </div>
      )}

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Selected single-year tax split">
          <div className="space-y-2 text-[12px] text-ink-2">
            <div className="flex items-center justify-between gap-3"><span>US estimated tax</span><span className="tabular-nums text-ink">{fmtMoney(plan.summary.usTaxUsd, 'USD')} / {fmtKrw(plan.summary.usTaxKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>KR estimated tax</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.krTaxKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>After-tax proceeds</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.estimatedAfterTaxKrw)}</span></div>
            <div className="text-[11px] leading-relaxed text-ink-3">Foreign tax credit, residency, treaty position, and prior-year carryforward remain manual planning inputs.</div>
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

function DecisionSummary({
  hasPlanningTarget,
  tiedTax,
  bestScenario,
  opportunities,
  inputIssueCount,
  openLotCount,
}: {
  hasPlanningTarget: boolean
  tiedTax: boolean
  bestScenario: MultiYearTaxScenario | null
  opportunities: ReturnType<typeof opportunitySummary>
  inputIssueCount: number
  openLotCount: number
}) {
  const title = !hasPlanningTarget
    ? 'Start with the best tax windows'
    : tiedTax
      ? 'No tax difference across timing choices'
      : `Current lowest-tax path: ${bestScenario?.label ?? 'n/a'}`
  const body = !hasPlanningTarget
    ? 'Use the opportunity map below to decide when Korea-listed or US-listed holdings look easiest to realize. Add a test amount only after a plausible annual range emerges.'
    : tiedTax
      ? 'Under the current assumptions, changing the market order does not change estimated tax. Focus on cash needs, exposure, and data issues before reading the lot table.'
      : 'Use the yearly action plan first. The lot table below is only the execution detail behind the selected market timing path.'

  return (
    <Card title="Current decision" className="mb-5" accent>
      <div className="grid gap-4 xl:grid-cols-[1fr_26rem]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={!hasPlanningTarget ? 'warning' : tiedTax ? 'neutral' : 'success'}>
              {!hasPlanningTarget ? 'Explore' : tiedTax ? 'Tie' : 'Recommendation'}
            </Badge>
            <h2 className="text-[22px] font-medium leading-tight tracking-tight text-ink">{title}</h2>
          </div>
          <p className="mt-2 max-w-[56rem] text-[13px] leading-relaxed text-ink-2">{body}</p>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            <div className="rounded-md border border-line-subtle bg-surface px-3 py-2">
              <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-3">Step 1</div>
              <div className="mt-1 text-[12px] text-ink">Find low-tax years and markets</div>
            </div>
            <div className="rounded-md border border-line-subtle bg-surface px-3 py-2">
              <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-3">Step 2</div>
              <div className="mt-1 text-[12px] text-ink">Pick a tentative annual range</div>
            </div>
            <div className="rounded-md border border-line-subtle bg-surface px-3 py-2">
              <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-3">Step 3</div>
              <div className="mt-1 text-[12px] text-ink">Test that range against scenarios</div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Open Lots" value={fmtNumber(openLotCount)} />
          <StatCard label="Input Issues" value={fmtNumber(inputIssueCount)} tone={inputIssueCount ? 'warning' : 'success'} />
          <StatCard
            label={hasPlanningTarget ? 'Annual Test' : 'Low-Tax Window'}
            value={hasPlanningTarget ? fmtKrw(bestScenario?.years[0]?.targetCashKrw ?? 0) : fmtKrw(opportunities.taxLightProceedsKrw)}
            hint={!hasPlanningTarget && opportunities.bestTaxLight ? `${opportunities.bestTaxLight.year} ${opportunities.bestTaxLight.market}` : undefined}
            tone={hasPlanningTarget ? 'neutral' : 'success'}
          />
          <StatCard
            label={hasPlanningTarget ? 'Est. Tax' : 'Loss Harvest'}
            value={hasPlanningTarget ? fmtKrw(bestScenario?.summary.taxKrw ?? 0) : fmtKrw(opportunities.lossHarvestKrw)}
            hint={hasPlanningTarget ? pct(bestScenario?.summary.effectiveTaxRatePct) : opportunities.bestLoss ? `${opportunities.bestLoss.year} ${opportunities.bestLoss.market}` : undefined}
            tone={!hasPlanningTarget ? 'info' : (bestScenario?.summary.taxKrw ?? 0) > 0 ? 'warning' : 'success'}
          />
        </div>
      </div>
    </Card>
  )
}

function PlanningMap({
  scenario,
  hasPlanningTarget,
  annualTargetCashKrw,
  opportunityRows,
}: {
  scenario: MultiYearTaxScenario | null
  hasPlanningTarget: boolean
  annualTargetCashKrw: number
  opportunityRows: OpportunityRow[]
}) {
  return (
    <Card
      title={hasPlanningTarget ? 'Year-by-year action plan' : 'Opportunity map'}
      info={hasPlanningTarget ? 'This is the decision layer: which market to realize in each tax year. Specific lots are shown later as execution detail.' : 'This is the exploration layer: it estimates which year and market have the most low-tax sale room or loss-harvesting room before you commit to a target amount.'}
      className="mb-5"
      accent
      action={hasPlanningTarget && scenario ? <Badge tone="info">{scenario.label}</Badge> : undefined}
    >
      {!hasPlanningTarget || !scenario ? (
        <OpportunityTable rows={opportunityRows} />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-[12px]">
            <thead className="text-[10px] uppercase tracking-[0.08em] text-ink-3">
              <tr>
                <th className="pb-2 pr-4 font-medium">Year</th>
                <th className="pb-2 pr-4 font-medium">Filing profile</th>
                <th className="pb-2 pr-4 text-right font-medium">Sell KR market</th>
                <th className="pb-2 pr-4 text-right font-medium">Sell US market</th>
                <th className="pb-2 pr-4 text-right font-medium">Target</th>
                <th className="pb-2 pr-4 text-right font-medium">Est. tax</th>
                <th className="pb-2 pr-4 font-medium">Readout</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {scenario.years.map((year) => {
                const krAmount = marketAmount(year, 'KR')
                const usAmount = marketAmount(year, 'US')
                const readout = krAmount > usAmount
                  ? 'Mostly Korea-listed sales'
                  : usAmount > krAmount
                    ? 'Mostly US-listed sales'
                    : krAmount + usAmount > 0
                      ? 'Mixed market sales'
                      : 'No planned sale'
                return (
                  <tr key={year.year}>
                    <td className="py-3 pr-4 font-mono text-ink">{year.year}</td>
                    <td className="py-3 pr-4"><Badge tone="info">{year.filingScenario}</Badge></td>
                    <td className="py-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(krAmount)}</td>
                    <td className="py-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(usAmount)}</td>
                    <td className="py-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(annualTargetCashKrw)}</td>
                    <td className="py-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(year.taxKrw)}</td>
                    <td className="py-3 pr-4 text-ink-2">{readout}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function OpportunityTable({ rows }: { rows: OpportunityRow[] }) {
  if (rows.length === 0) return <EmptyState>No planning opportunities from current tax lots</EmptyState>
  return (
    <>
      <div className="mb-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-[12px] leading-relaxed text-ink-3">
        This view does not require a pre-made sale plan. Amounts apply each year&apos;s tax profile to today&apos;s open lots, so they can repeat across years until future price, holding-period, and lot-consumption projection is added. When US tax calc is enabled, US estimates include non-US market gains as a planning assumption for US citizens/residents.
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-[12px]">
          <thead className="text-[10px] uppercase tracking-[0.08em] text-ink-3">
            <tr>
              <th className="pb-2 pr-4 font-medium">Year</th>
              <th className="pb-2 pr-4 font-medium">Market</th>
              <th className="pb-2 pr-4 font-medium">
                Tax profile
                <InfoTooltip align="left">Which country tax calculations are enabled for that year. US_AND_KR means both US and Korea estimates are included.</InfoTooltip>
              </th>
              <th className="pb-2 pr-4 text-right font-medium">
                Low-tax room
                <InfoTooltip align="right">Estimated sale proceeds that currently produce zero estimated tax across the enabled tax profile. If US_AND_KR is enabled, this includes US tax estimates too.</InfoTooltip>
              </th>
              <th className="pb-2 pr-4 text-right font-medium">
                Loss harvest
                <InfoTooltip align="right">Estimated unrealized loss that could be realized by selling loss lots. This is not sale cash; it is the loss amount that may offset gains subject to rule review.</InfoTooltip>
              </th>
              <th className="pb-2 pr-4 text-right font-medium">
                If all sold tax
                <InfoTooltip align="right">Estimated tax if all priced lots in this market row were sold under that year's tax profile. This is a stress-test number, not a recommendation to sell everything.</InfoTooltip>
              </th>
              <th className="pb-2 pr-4 font-medium">
                Planning readout
                <InfoTooltip align="left">Plain-language interpretation for where to start: loss harvesting, low-tax sale room, or taxable area that should be tested with smaller ranges.</InfoTooltip>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {rows.map((row) => {
              const readout = row.lossHarvestKrw > 0
                ? row.estimatedTaxIfAllSoldKrw <= 0
                  ? 'Loss-harvest area; no positive estimated tax in this row'
                  : 'Loss-harvest area, but some taxable gains remain'
                : row.taxLightProceedsKrw > 0
                  ? 'Possible low-tax sale room'
                  : row.estimatedTaxIfAllSoldKrw > 0
                    ? 'Likely taxable; test smaller ranges'
                    : 'No priced lots to evaluate'
              return (
                <tr key={`${row.year}-${row.market}`}>
                  <td className="py-3 pr-4 font-mono text-ink">{row.year}</td>
                  <td className="py-3 pr-4"><Badge tone={row.market === 'US' ? 'info' : 'success'}>{row.market}</Badge></td>
                  <td className="py-3 pr-4"><Badge tone="neutral">{row.filingScenario}</Badge></td>
                  <td className="py-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(row.taxLightProceedsKrw)}</td>
                  <td className="py-3 pr-4 text-right tabular-nums text-danger">{row.lossHarvestKrw > 0 ? fmtKrw(row.lossHarvestKrw) : '₩0'}</td>
                  <td className="py-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(row.estimatedTaxIfAllSoldKrw)}</td>
                  <td className="py-3 pr-4 text-ink-2">
                    <div>{readout}</div>
                    <div className="mt-0.5 text-[11px] text-ink-3">{fmtNumber(row.candidateCount)} priced lots · total sale room {fmtKrw(row.totalProceedsKrw)}</div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
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
                      <Badge tone={market.market === 'US' ? 'info' : 'success'}>{market.market}</Badge>
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
