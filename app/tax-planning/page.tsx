import Link from 'next/link'
import { Fragment } from 'react'
import { createSavedTaxPlanAction } from '@/app/tax-planning/actions'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { TaxPlanTimeline } from '@/components/TaxPlanTimeline'
import { Badge, Card, EmptyState, InfoTooltip, StatCard , marketTone } from '@/components/ui'
import { getOperationalHealth, getOverview, getTaxPlanningLots } from '@/lib/adapters/portfolio-db'
import { fmtDateTime, fmtKrw, fmtMoney, fmtNumber, fmtQuantity } from '@/lib/format'
import { positionHref } from '@/lib/position-url'
import {
  buildMonthlySalePlanSet,
  buildMultiYearTaxPlan,
  buildTaxPlan,
  summarizeTaxCandidates,
  type MasterPlanStrategyKey,
  type MonthlySaleMasterPlan,
  type MonthlySalePlanSet,
  type MultiYearTaxScenario,
  type TaxPlanCandidate,
  type TaxPlanningLot,
} from '@/lib/tax-planning'
import { listSavedTaxPlans, savedTaxPlanProgress, type SavedTaxPlan } from '@/lib/tax-plan-store'
import {
  annualProfiles,
  assumptionNumber,
  assumptionString,
  getTaxPolicyState,
  projectedWagesUsd,
  scenarioFromTaxYearProfile,
  type FilingScenario,
  type TaxPolicy,
  type TaxYearProfile,
} from '@/lib/tax-policy'

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
  lossLotProceedsKrw: number
  lossHarvestKrw: number
  shortLossHarvestKrw: number
  longLossHarvestKrw: number
  totalProceedsKrw: number
  netGainKrw: number
  netShortGainKrw: number
  netLongGainKrw: number
  usTaxIfAllSoldKrw: number
  usFederalTaxOnUsMarketGainKrw: number
  krNetTaxableGainBeforeDeductionKrw: number
  krDeductionAppliedKrw: number
  krTaxableGainAfterDeductionKrw: number
  krTaxRatePct: number
  krTaxIfAllSoldKrw: number
  combinedTaxBeforeCreditsKrw: number
  estimatedCrossBorderTaxCreditKrw: number
  incrementalKrTaxAfterCreditKrw: number
  combinedTaxAfterCreditsKrw: number
}

type OpportunityGroup = Omit<OpportunityRow, 'year'> & {
  years: number[]
  yearLabel: string
}

type OpportunityTakeaway = {
  label: string
  title: string
  body: string
  action: string
  caveat: string
  metric: string
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
}

type OpportunityCoverage = {
  holdingsMarketValueKrw: number
  holdingsUnrealizedGainKrw: number
  modeledProceedsKrw: number
  modeledGainKrw: number
  unallocatedMarketValueKrw: number
  unmodeledGainKrw: number
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
      const aggregate = summarizeTaxCandidates({
        candidates: marketPlan.candidates,
        policy,
        scenario: yearScenario,
        year: profile.year,
      })
      return {
        year: profile.year,
        filingScenario: yearScenario,
        market,
        candidateCount: aggregate.pricedLotCount,
        lossLotProceedsKrw: aggregate.lossLotProceedsKrw,
        lossHarvestKrw: aggregate.lossHarvestKrw,
        shortLossHarvestKrw: aggregate.shortLossHarvestKrw,
        longLossHarvestKrw: aggregate.longLossHarvestKrw,
        totalProceedsKrw: aggregate.totalProceedsKrw,
        netGainKrw: aggregate.netGainKrw,
        netShortGainKrw: aggregate.netShortGainKrw,
        netLongGainKrw: aggregate.netLongGainKrw,
        usTaxIfAllSoldKrw: aggregate.usTaxKrw,
        usFederalTaxOnUsMarketGainKrw: aggregate.usFederalTaxOnUsMarketGainKrw,
        krNetTaxableGainBeforeDeductionKrw: aggregate.krNetTaxableGainBeforeDeductionKrw,
        krDeductionAppliedKrw: aggregate.krDeductionAppliedKrw,
        krTaxableGainAfterDeductionKrw: aggregate.krTaxableGainAfterDeductionKrw,
        krTaxRatePct: aggregate.krTaxRatePct,
        krTaxIfAllSoldKrw: aggregate.krTaxKrw,
        combinedTaxBeforeCreditsKrw: aggregate.combinedTaxBeforeCreditsKrw,
        estimatedCrossBorderTaxCreditKrw: aggregate.estimatedCrossBorderTaxCreditKrw,
        incrementalKrTaxAfterCreditKrw: aggregate.incrementalKrTaxAfterCreditKrw,
        combinedTaxAfterCreditsKrw: aggregate.combinedTaxAfterCreditsKrw,
      }
    })
  })
}

function opportunitySummary(rows: OpportunityRow[]) {
  const bestLoss = [...rows].sort((a, b) => b.lossHarvestKrw - a.lossHarvestKrw)[0] ?? null
  return {
    bestLoss,
    lossLotProceedsKrw: bestLoss?.lossLotProceedsKrw ?? 0,
    lossHarvestKrw: bestLoss?.lossHarvestKrw ?? 0,
  }
}

function yearLabel(years: number[]) {
  const sorted = [...years].sort((a, b) => a - b)
  if (sorted.length === 1) return String(sorted[0])
  return `${sorted[0]}-${sorted[sorted.length - 1]}`
}

function sameOpportunity(a: OpportunityGroup, b: OpportunityRow) {
  return (
    a.market === b.market &&
    a.filingScenario === b.filingScenario &&
    sameKrw(a.lossLotProceedsKrw, b.lossLotProceedsKrw) &&
    sameKrw(a.lossHarvestKrw, b.lossHarvestKrw) &&
    sameKrw(a.totalProceedsKrw, b.totalProceedsKrw) &&
    sameKrw(a.netGainKrw, b.netGainKrw) &&
    sameKrw(a.usTaxIfAllSoldKrw, b.usTaxIfAllSoldKrw) &&
    sameKrw(a.krTaxIfAllSoldKrw, b.krTaxIfAllSoldKrw) &&
    sameKrw(a.estimatedCrossBorderTaxCreditKrw, b.estimatedCrossBorderTaxCreditKrw) &&
    sameKrw(a.combinedTaxAfterCreditsKrw, b.combinedTaxAfterCreditsKrw)
  )
}

function groupOpportunityRows(rows: OpportunityRow[]): OpportunityGroup[] {
  const groups: OpportunityGroup[] = []
  for (const row of rows) {
    const existing = groups.find((group) => sameOpportunity(group, row))
    if (existing) {
      existing.years.push(row.year)
      existing.yearLabel = yearLabel(existing.years)
    } else {
      groups.push({ ...row, years: [row.year], yearLabel: String(row.year) })
    }
  }
  return groups
}

function buildTakeaways(rows: OpportunityRow[], policy: TaxPolicy, assumptionsAreExample: boolean): OpportunityTakeaway[] {
  const groups = groupOpportunityRows(rows)
  const takeaways: OpportunityTakeaway[] = []
  const usGroups = groups.filter((group) => group.market === 'US')
  const highestKrTax = [...usGroups].sort((a, b) => b.krTaxIfAllSoldKrw - a.krTaxIfAllSoldKrw)[0]
  const lowestKrTax = [...usGroups].sort((a, b) => a.krTaxIfAllSoldKrw - b.krTaxIfAllSoldKrw)[0]
  const grossKrDifference = Number(highestKrTax?.krTaxIfAllSoldKrw ?? 0) - Number(lowestKrTax?.krTaxIfAllSoldKrw ?? 0)
  if (highestKrTax && lowestKrTax && grossKrDifference > 0) {
    const afterCreditDifference = Math.max(
      Number(highestKrTax.combinedTaxAfterCreditsKrw) - Number(lowestKrTax.combinedTaxAfterCreditsKrw),
      0
    )
    if (afterCreditDifference > 0) {
      takeaways.push({
        label: 'Timing signal',
        title: `Deferring optional US-market gains may reduce tax by ${fmtKrw(afterCreditDifference)}`,
        body: `${highestKrTax.yearLabel} has ${fmtKrw(highestKrTax.krTaxIfAllSoldKrw)} of gross KR tax and ${fmtKrw(highestKrTax.estimatedCrossBorderTaxCreditKrw)} of estimated cross-border credit. The remaining KR increment is ${fmtKrw(highestKrTax.incrementalKrTaxAfterCreditKrw)}.`,
        action: `Compare executing optional gains in ${lowestKrTax.yearLabel}, after confirming the credit limitation and source treatment.`,
        caveat: `The estimate uses only modeled US federal tax as the credit pool and excludes California and NIIT from that pool. Final creditability, FX, and Form 1116/Korean filing treatment require review.${assumptionsAreExample ? ' The deduction and rate are example defaults.' : ''}`,
        metric: `${fmtKrw(afterCreditDifference)} after credit`,
        tone: 'success',
      })
    } else {
      takeaways.push({
        label: 'Filing-profile only',
        title: 'The filing-profile change alone shows ₩0 saving',
        body: `${highestKrTax.yearLabel} gross KR tax is ${fmtKrw(highestKrTax.krTaxIfAllSoldKrw)}, but the estimated credit is ${fmtKrw(highestKrTax.estimatedCrossBorderTaxCreditKrw)}. That leaves ${fmtKrw(highestKrTax.incrementalKrTaxAfterCreditKrw)} of additional KR tax and ${fmtKrw(highestKrTax.combinedTaxAfterCreditsKrw)} combined tax, the same modeled total as ${lowestKrTax.yearLabel}.`,
        action: 'Do not treat this as a sell-now signal. A real timing decision must also roll each lot forward from short-term to long-term and model future prices and FX.',
        caveat: `This static comparison freezes today's short/long buckets in every year. By 2028, current short-term lots may become long-term and reduce US federal tax, which can also change the Korea credit ceiling. US-listed gains are treated as US-source; California and NIIT are excluded from the credit pool.${assumptionsAreExample ? ' The rates are example defaults.' : ''}`,
        metric: `${fmtKrw(afterCreditDifference)} modeled saving`,
        tone: 'info',
      })
    }
  }

  const krLoss = groups.find((group) => group.market === 'KR')
  const usGain = groups.find((group) => group.market === 'US')
  const pairableShortGainKrw = Math.min(
    Number(krLoss?.shortLossHarvestKrw ?? 0),
    Math.max(Number(usGain?.netShortGainKrw ?? 0), 0)
  )
  if (krLoss && usGain && pairableShortGainKrw > 0) {
    const shortRatePct =
      Number(policy.jurisdictions.find((item) => item.code === 'US')?.manualAssumptions.federalShortTermRatePct ?? 37) +
      Number(policy.jurisdictions.find((item) => item.code === 'US')?.manualAssumptions.stateRatePct ?? 0) +
      Number(policy.jurisdictions.find((item) => item.code === 'US')?.manualAssumptions.netInvestmentIncomeTaxRatePct ?? 0)
    const screeningTaxImpactKrw = pairableShortGainKrw * (shortRatePct / 100)
    takeaways.push({
      label: 'Potential pairing',
      title: 'Pair KR loss lots with US short-term gains in the same US tax year',
      body: `The current screen shows ${fmtKrw(krLoss.shortLossHarvestKrw)} of KR short-term unrealized losses and ${fmtKrw(usGain.netShortGainKrw)} of net US-market short-term gains. A screening match of up to ${fmtKrw(pairableShortGainKrw)} could reduce the modeled US short-term gain.`,
      action: 'When a US short-term gain sale is planned, review enough KR short-term loss lots in that same US tax year before choosing the exact tickers.',
      caveat: `The screening tax effect is up to ${fmtKrw(screeningTaxImpactKrw)} at the current ${fmtNumber(shortRatePct, 2)}% assumption. A KRW loss is not automatically the US tax loss: USD tax basis, transaction-date FX, account eligibility, wash-sale rules, and other capital activity must be verified.`,
      metric: `${fmtKrw(pairableShortGainKrw)} gain to screen`,
      tone: 'info',
    })
  }

  if (krLoss && krLoss.lossLotProceedsKrw > 0) {
    takeaways.push({
      label: 'Meaning of the number',
      title: `${fmtKrw(krLoss.lossLotProceedsKrw)} is loss-lot proceeds, not a tax-free allowance`,
      body: `Selling the currently identified KR loss lots would produce about ${fmtKrw(krLoss.lossLotProceedsKrw)} of cash and realize about ${fmtKrw(krLoss.lossHarvestKrw)} of loss at today's values. Profitable KR lots are not included in that proceeds number.`,
      action: 'Use the loss amount as offset inventory and the proceeds amount only for liquidity planning.',
      caveat: 'US tax can still apply to profitable Korea-listed stock sales because US citizens and residents generally report worldwide income.',
      metric: `${fmtKrw(krLoss.lossHarvestKrw)} loss inventory`,
      tone: 'warning',
    })
  }
  return takeaways.slice(0, 3)
}

function PositionCell({ row }: { row: TaxPlanCandidate }) {
  return (
    <div className="min-w-[14rem]">
      <div className="flex items-center gap-2">
        <Badge tone={marketTone(row.market)}>{row.market}</Badge>
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
        { key: 'open_quantity', label: 'Qty', align: 'right', render: (r) => fmtQuantity(r.open_quantity, 4) },
        { key: 'proceedsNative', label: 'Proceeds', align: 'right', render: (r) => (r.proceedsNative == null ? 'n/a' : fmtMoney(r.proceedsNative, r.currency)) },
        { key: 'gainKrw', label: 'Base G/L', align: 'right', render: (r) => signedKrw(r.gainKrw) },
        { key: 'estimatedTaxKrw', label: 'Gross Lot Tax', align: 'right', render: (r) => fmtKrw(r.estimatedTaxKrw) },
        { key: 'estimatedAfterTaxKrw', label: 'After Tax', align: 'right', render: (r) => (r.estimatedAfterTaxKrw == null ? 'n/a' : fmtKrw(r.estimatedAfterTaxKrw)) },
      ]}
    />
  )
}

function dateLabel(value: string | null | undefined) {
  if (!value) return 'n/a'
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
}

function durationLabel(days: number) {
  const rounded = Math.round(days)
  if (rounded < 31) return `${fmtNumber(rounded)} days`
  return `${fmtNumber(rounded / 30.4375, 1)} months`
}

function PlanMetric({
  label,
  value,
  hint,
  tone = 'text-ink',
}: {
  label: string
  value: string
  hint: string
  tone?: string
}) {
  return (
    <div className="min-w-0 px-3 py-3 first:pl-0 last:pr-0">
      <div className="text-[10px] font-medium uppercase text-ink-3">{label}</div>
      <div className={`mt-1 truncate text-[20px] font-medium tabular-nums ${tone}`}>{value}</div>
      <div className="mt-1 text-[10px] leading-relaxed text-ink-3">{hint}</div>
    </div>
  )
}

function MasterPlanOverview({
  planSet,
  inputIssueCount,
  fullHoldingsValueKrw,
}: {
  planSet: MonthlySalePlanSet
  inputIssueCount: number
  fullHoldingsValueKrw: number
}) {
  const plan = planSet.selectedPlan
  const earliest = planSet.scenarios.find((item) => item.strategy === 'EARLIEST_LT')
  const wait = planSet.scenarios.find((item) => item.strategy === 'WAIT_US_ONLY')
  const waitSavings = Number(earliest?.summary.estimatedTaxKrw ?? 0) - Number(wait?.summary.estimatedTaxKrw ?? 0)
  const waitDays = Number(wait?.summary.averageWaitDays ?? 0) - Number(earliest?.summary.averageWaitDays ?? 0)
  const earliestKrTopUp = Number(earliest?.summary.incrementalKrTaxAfterCreditKrw ?? 0)
  const waitKrTopUp = Number(wait?.summary.incrementalKrTaxAfterCreditKrw ?? 0)
  const coveragePct = fullHoldingsValueKrw > 0 ? (planSet.coverage.modeledProceedsKrw / fullHoldingsValueKrw) * 100 : 0
  const coverageNeedsReview = coveragePct > 100.5

  return (
    <Card
      title="Selected plan"
      info="This plan uses tax-lot acquisition dates, annual filing profiles, current prices, and current FX. It does not use a market forecast."
      className="mb-5"
      accent
      action={<Badge tone="success">{plan.label}</Badge>}
    >
      <div className="flex flex-col gap-3 border-b border-line-subtle pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase text-ink-3">Recommended execution window</div>
          <h2 className="mt-1 text-[22px] font-medium leading-tight text-ink">
            {dateLabel(plan.summary.startDate)} <span className="text-ink-3">to</span>{' '}
            {dateLabel(plan.summary.endDate)}
          </h2>
          <p className="mt-2 max-w-[58rem] text-[13px] leading-relaxed text-ink-2">{plan.description}</p>
        </div>
        <div className="shrink-0 rounded-md border border-[color:var(--accent-success)]/25 bg-[color:var(--accent-success)]/5 px-3 py-2 lg:max-w-[19rem]">
          <div className="text-[10px] font-medium uppercase text-success">Why this matters</div>
          <div className="mt-1 text-[11px] leading-relaxed text-ink-2">
            {fmtNumber(plan.summary.longTermSalePct, 1)}% of planned proceeds receive long-term treatment under this schedule.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-line-subtle border-b border-line-subtle md:grid-cols-4">
        <PlanMetric
          label="Planned sales"
          value={fmtKrw(plan.summary.proceedsKrw)}
          hint={`${fmtNumber(plan.summary.lotCount)} priced lots`}
        />
        <PlanMetric
          label="Estimated tax"
          value={fmtKrw(plan.summary.estimatedTaxKrw)}
          hint={`${fmtNumber(plan.summary.longTermSalePct, 1)}% long-term`}
          tone={plan.summary.estimatedTaxKrw > 0 ? 'text-warning' : 'text-success'}
        />
        <PlanMetric
          label="After-tax cash"
          value={fmtKrw(plan.summary.afterTaxKrw)}
          hint={`${fmtNumber(plan.summary.instructionCount)} sale instructions`}
          tone="text-success"
        />
        <PlanMetric
          label="Input coverage"
          value={`${fmtNumber(coveragePct, 1)}%`}
          hint={`${fmtNumber(inputIssueCount)} issues · ${fmtNumber(planSet.coverage.missingValuationCount)} unpriced`}
          tone={inputIssueCount ? 'text-warning' : 'text-success'}
        />
      </div>

      {coverageNeedsReview ? (
        <div className="mt-3 rounded-md border border-[color:var(--accent-warning)]/30 bg-[color:var(--accent-warning)]/5 px-3 py-2 text-[12px] leading-relaxed text-ink-2" role="status">
          <span className="font-medium text-warning">Review the input range.</span>{' '}
          The planned amount is greater than the current holding market value, so coverage exceeds 100%. Check for duplicate tax lots or stale prices before using the result.
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="border-l-2 border-[color:var(--accent-info)] px-3 py-1">
          <div className="text-[10px] font-medium uppercase text-ink-3">Lots still waiting</div>
          <div className="mt-1 text-[12px] leading-relaxed text-ink-2">
            <span className="font-medium tabular-nums text-ink">{fmtNumber(planSet.timing.waitingLotCount)} lots</span>{' '}
            representing {fmtKrw(planSet.timing.waitingProceedsKrw)} have not crossed one year.
            {planSet.timing.nextLongTermDate ? ` Next: ${dateLabel(planSet.timing.nextLongTermDate)}.` : ''}
          </div>
        </div>
        <div className="border-l-2 border-[color:var(--accent-success)] px-3 py-1">
          <div className="text-[10px] font-medium uppercase text-ink-3">Estimated term benefit</div>
          <div className="mt-1 text-[12px] leading-relaxed text-ink-2">
            Waiting for long-term treatment avoids an estimated{' '}
            <span className="font-medium tabular-nums text-success">
              {fmtKrw(planSet.timing.estimatedFederalTaxAvoidedKrw)}
            </span>{' '}
            of federal rate difference on currently profitable short-term lots.
          </div>
        </div>
        <div className="border-l-2 border-[color:var(--accent-warning)] px-3 py-1">
          <div className="text-[10px] font-medium uppercase text-ink-3">Waiting until 2028</div>
          <div className="mt-1 text-[12px] leading-relaxed text-ink-2">
            Estimated {waitSavings >= 0 ? 'saving' : 'extra tax'}:{' '}
            <span className={`font-medium tabular-nums ${waitSavings >= 0 ? 'text-success' : 'text-danger'}`}>
              {fmtKrw(Math.abs(waitSavings))}
            </span>
            , for about {durationLabel(Math.max(waitDays, 0))} more waiting. KR top-up changes from{' '}
            {fmtKrw(earliestKrTopUp)} to {fmtKrw(waitKrTopUp)}.
          </div>
        </div>
      </div>
    </Card>
  )
}

function MasterScenarioComparison({
  planSet,
  horizonYears,
}: {
  planSet: MonthlySalePlanSet
  horizonYears: number
}) {
  const baseline = planSet.scenarios.find((item) => item.strategy === 'EARLIEST_LT')
  const minTax = Math.min(...planSet.scenarios.map((item) => item.summary.estimatedTaxKrw))
  const maxTax = Math.max(...planSet.scenarios.map((item) => item.summary.estimatedTaxKrw), 1)
  return (
    <Card
      title="Plan comparison"
      info="Every row sells the same currently priced lots. Only timing and holding-term treatment change."
      className="mb-5"
    >
      <div className="mb-3 flex flex-col gap-1 border-b border-line-subtle pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase text-ink-3">Lowest estimated tax</div>
          <div className="mt-1 text-[18px] font-medium tabular-nums text-success">{fmtKrw(minTax)}</div>
        </div>
        <div className="text-[11px] text-ink-3">Tax bars share one scale. Shorter is lower.</div>
      </div>
      <div className="divide-y divide-line-subtle">
        {planSet.scenarios.map((scenarioRow) => {
          const delta = scenarioRow.summary.estimatedTaxKrw - Number(baseline?.summary.estimatedTaxKrw ?? 0)
          const selected = scenarioRow.strategy === planSet.selectedPlan.strategy
          const taxWidth = Math.max((scenarioRow.summary.estimatedTaxKrw / maxTax) * 100, 2)
          return (
            <div
              key={scenarioRow.strategy}
              className={`grid gap-3 py-3 lg:grid-cols-[minmax(18rem,1.5fr)_minmax(15rem,1fr)_minmax(14rem,0.8fr)] lg:items-center ${
                selected ? '-mx-2 rounded-md bg-surface px-2' : ''
              }`}
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/tax-planning?master=${scenarioRow.strategy}&pace=${planSet.executionMonths}&horizon=${horizonYears}`}
                    className="text-[13px] font-medium text-info hover:underline"
                  >
                    {scenarioRow.label}
                  </Link>
                  {selected && <Badge tone="success">Selected</Badge>}
                  {scenarioRow.summary.estimatedTaxKrw === minTax && <Badge tone="success">Lowest tax</Badge>}
                </div>
                <div className="mt-1 max-w-[34rem] text-[11px] leading-relaxed text-ink-3">
                  {scenarioRow.description}
                </div>
              </div>

              <div>
                <div className="flex items-end justify-between gap-3">
                  <span className="text-[10px] uppercase text-ink-3">Estimated tax</span>
                  <span className="text-[13px] font-medium tabular-nums text-ink">
                    {fmtKrw(scenarioRow.summary.estimatedTaxKrw)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-pill bg-line-subtle">
                  <div
                    className={scenarioRow.summary.estimatedTaxKrw === minTax ? 'h-full bg-success' : 'h-full bg-warning'}
                    style={{ width: `${taxWidth}%` }}
                  />
                </div>
                <div className={`mt-1 text-right text-[10px] tabular-nums ${delta <= 0 ? 'text-success' : 'text-danger'}`}>
                  {delta === 0 ? 'Earliest baseline' : delta < 0 ? `${fmtKrw(Math.abs(delta))} less` : `${fmtKrw(delta)} more`}
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <dt className="text-ink-3">Execution</dt>
                <dd className="text-right text-ink">
                  {dateLabel(scenarioRow.summary.startDate)} to {dateLabel(scenarioRow.summary.endDate)}
                </dd>
                <dt className="text-ink-3">Long-term sales</dt>
                <dd className="text-right tabular-nums text-ink">{fmtNumber(scenarioRow.summary.longTermSalePct, 1)}%</dd>
                <dt className="text-ink-3">Average wait</dt>
                <dd className="text-right tabular-nums text-ink">{durationLabel(scenarioRow.summary.averageWaitDays)}</dd>
                <dt className="text-ink-3">KR top-up</dt>
                <dd className="text-right tabular-nums text-ink">{fmtKrw(scenarioRow.summary.incrementalKrTaxAfterCreditKrw)}</dd>
              </dl>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function SavedPlansPanel({
  plans,
  selectedStrategy,
  executionMonths,
  horizonYears,
}: {
  plans: SavedTaxPlan[]
  selectedStrategy: MasterPlanStrategyKey
  executionMonths: number
  horizonYears: number
}) {
  const visiblePlans = plans.filter((plan) => plan.status !== 'archived').slice(0, 5)
  return (
    <Card
      title="Saved execution plans"
      info="Saving creates an immutable calculation snapshot. Review and execution states are recorded separately from the original tax estimate."
      className="mb-5"
      action={<Badge>{fmtNumber(visiblePlans.length)} recent</Badge>}
    >
      <div className="grid gap-5 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <form action={createSavedTaxPlanAction} className="rounded-md border border-line-subtle bg-surface p-3">
          <div className="text-[10px] font-medium uppercase text-ink-3">Save current calculation</div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
            Freeze the selected strategy, quantities, dates, tax assumptions, and lot-level instructions before review.
          </p>
          <input type="hidden" name="strategy" value={selectedStrategy} />
          <input type="hidden" name="executionMonths" value={executionMonths} />
          <input type="hidden" name="horizonYears" value={horizonYears} />
          <label htmlFor="plan-name" className="mt-3 block text-[10px] font-medium uppercase text-ink-3">
            Plan name
          </label>
          <input
            id="plan-name"
            name="name"
            type="text"
            maxLength={120}
            placeholder="e.g. 2026 staged baseline"
            className="mt-1 w-full rounded-md border border-line bg-card px-3 py-2 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-info"
          />
          <button type="submit" className="mt-2 w-full rounded-md border border-ink bg-ink px-3 py-2 text-[12px] font-medium text-card">
            Save as draft
          </button>
          <div className="mt-2 text-[10px] leading-relaxed text-ink-3">
            Stored locally in an ignored private JSON file; it is not committed to the public repository.
          </div>
        </form>

        <div>
          {visiblePlans.length ? (
            <div className="divide-y divide-line-subtle">
              {visiblePlans.map((saved) => {
                const progress = savedTaxPlanProgress(saved)
                return (
                  <div key={saved.id} className="grid gap-3 py-3 first:pt-0 lg:grid-cols-[minmax(15rem,1fr)_12rem_11rem_auto] lg:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/tax-planning/plans/${saved.id}`} className="text-[13px] font-medium text-info hover:underline">
                          {saved.name}
                        </Link>
                        <Badge tone={saved.status === 'active' ? 'warning' : saved.status === 'completed' ? 'success' : saved.status === 'reviewed' ? 'info' : 'neutral'}>
                          {saved.status}
                        </Badge>
                      </div>
                      <div className="mt-1 text-[10px] text-ink-3">
                        {saved.plan.label} · snapshot {saved.asOfDate} · revision {saved.revision}
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] text-ink-3">
                        <span>Execution</span><span>{fmtNumber(progress.completionPct, 1)}%</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-pill bg-line-subtle">
                        <div className="h-full bg-success" style={{ width: `${progress.completionPct}%` }} />
                      </div>
                    </div>
                    <div className="text-[11px] tabular-nums text-ink-2">
                      <div>{fmtKrw(saved.plan.summary.proceedsKrw)} planned</div>
                      <div className="mt-0.5 text-ink-3">{fmtNumber(progress.executed)} / {fmtNumber(progress.total)} executed</div>
                    </div>
                    <div className="text-right text-[10px] text-ink-3">{fmtDateTime(saved.updatedAt)}</div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex min-h-[10rem] items-center justify-center text-center text-[12px] text-ink-3">
              No saved plans yet. Save the current calculation when it is ready for review.
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

function MasterPlanAnnualTax({ plan }: { plan: MonthlySaleMasterPlan }) {
  return (
    <Card
      title="Annual tax roll-up"
      info="The annual result nets scheduled gains and losses, stacks short-term gains on projected ordinary income, applies long-term brackets, NIIT and California tax, then applies only the configured cross-border credit model."
      className="mb-5"
    >
      <div className="space-y-3 md:hidden">
        {plan.years.map((year) => (
          <article key={year.year} className="rounded-md border border-line-subtle bg-surface px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[13px] text-ink">{year.year}</span>
                <Badge tone="info">{year.filingScenario}</Badge>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase text-ink-3">Net tax</div>
                <div className="mt-0.5 text-[15px] font-medium tabular-nums text-ink">{fmtKrw(year.estimatedTaxKrw)}</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-y border-line-subtle py-2 text-[11px]">
              <div><span className="text-ink-3">Sales</span><div className="mt-0.5 tabular-nums text-ink">{fmtKrw(year.proceedsKrw)}</div></div>
              <div className="text-right"><span className="text-ink-3">Net G/L</span><div className="mt-0.5 tabular-nums">{signedKrw(year.gainKrw)}</div></div>
              <div><span className="text-ink-3">US gross</span><div className="mt-0.5 tabular-nums text-ink">{fmtKrw(year.usGrossTaxKrw ?? 0)}</div></div>
              <div className="text-right"><span className="text-ink-3">KR gross</span><div className="mt-0.5 tabular-nums text-ink">{fmtKrw(year.krGrossTaxKrw ?? 0)}</div></div>
              <div><span className="text-ink-3">Credit used</span><div className="mt-0.5 tabular-nums text-success">-{fmtKrw(year.estimatedCrossBorderTaxCreditKrw)}</div></div>
              <div className="text-right"><span className="text-ink-3">After-tax cash</span><div className="mt-0.5 tabular-nums text-ink">{fmtKrw(year.afterTaxKrw)}</div></div>
            </div>
            <details className="mt-2 text-[10px] text-ink-3">
              <summary className="cursor-pointer font-medium text-info">Tax components</summary>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <span>Federal ST {fmtKrw(year.usFederalShortTermTaxKrw ?? 0)}</span>
                <span>Federal LT {fmtKrw(year.usFederalLongTermTaxKrw ?? 0)}</span>
                <span>NIIT {fmtKrw(year.usNiitTaxKrw ?? 0)}</span>
                <span>California {fmtKrw(year.usStateTaxKrw ?? 0)}</span>
                <span>US FTC limit {fmtKrw(year.usForeignTaxCreditLimitKrw ?? 0)}</span>
                <span>KR credit {fmtKrw(year.krForeignTaxCreditKrw ?? 0)}</span>
              </div>
            </details>
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full text-left text-[12px]">
          <thead className="text-[10px] uppercase text-ink-3">
            <tr>
              <th className="pb-2 pr-4 font-medium">Tax year</th>
              <th className="pb-2 pr-4 font-medium">Profile</th>
              <th className="pb-2 pr-4 text-right font-medium">Sales</th>
              <th className="pb-2 pr-4 text-right font-medium">Net G/L</th>
              <th className="pb-2 pr-4 text-right font-medium">US gross</th>
              <th className="pb-2 pr-4 text-right font-medium">KR gross</th>
              <th className="pb-2 pr-4 text-right font-medium">Credit</th>
              <th className="pb-2 pr-4 text-right font-medium">Net tax</th>
              <th className="pb-2 text-right font-medium">After-tax cash</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {plan.years.map((year) => (
              <Fragment key={year.year}>
                <tr>
                  <td className="pt-3 pr-4 font-mono text-ink">{year.year}</td>
                  <td className="pt-3 pr-4"><Badge tone="info">{year.filingScenario}</Badge></td>
                  <td className="pt-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(year.proceedsKrw)}</td>
                  <td className="pt-3 pr-4 text-right tabular-nums">{signedKrw(year.gainKrw)}</td>
                  <td className="pt-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(year.usGrossTaxKrw ?? 0)}</td>
                  <td className="pt-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(year.krGrossTaxKrw ?? 0)}</td>
                  <td className="pt-3 pr-4 text-right tabular-nums text-success">-{fmtKrw(year.estimatedCrossBorderTaxCreditKrw)}</td>
                  <td className="pt-3 pr-4 text-right tabular-nums font-medium text-ink">{fmtKrw(year.estimatedTaxKrw)}</td>
                  <td className="pt-3 text-right tabular-nums text-ink">{fmtKrw(year.afterTaxKrw)}</td>
                </tr>
                <tr>
                  <td colSpan={9} className="pb-3 pt-2">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-surface px-3 py-2 text-[10px] text-ink-3">
                      <span>Federal ST <strong className="font-medium text-ink">{fmtKrw(year.usFederalShortTermTaxKrw ?? 0)}</strong></span>
                      <span>Federal LT <strong className="font-medium text-ink">{fmtKrw(year.usFederalLongTermTaxKrw ?? 0)}</strong></span>
                      <span>NIIT <strong className="font-medium text-ink">{fmtKrw(year.usNiitTaxKrw ?? 0)}</strong></span>
                      <span>California <strong className="font-medium text-ink">{fmtKrw(year.usStateTaxKrw ?? 0)}</strong></span>
                      <span>US FTC limit <strong className="font-medium text-ink">{fmtKrw(year.usForeignTaxCreditLimitKrw ?? 0)}</strong></span>
                      <span>US FTC used <strong className="font-medium text-success">-{fmtKrw(year.usForeignTaxCreditKrw ?? 0)}</strong></span>
                      <span>KR credit used <strong className="font-medium text-success">-{fmtKrw(year.krForeignTaxCreditKrw ?? 0)}</strong></span>
                    </div>
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
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
    ? 'Review timing signals before choosing sales'
    : tiedTax
      ? 'No tax difference across timing choices'
      : `Current lowest-tax path: ${bestScenario?.label ?? 'n/a'}`
  const body = !hasPlanningTarget
    ? 'The opportunity map separates gross timing differences, loss-pairing candidates, and jurisdiction estimates. Use those signals to choose a plausible annual range before testing exact sale amounts.'
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
              <div className="mt-1 text-[12px] text-ink">Find timing signals and loss inventory</div>
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
            label={hasPlanningTarget ? 'Annual Test' : 'Loss-Lot Proceeds'}
            value={hasPlanningTarget ? fmtKrw(bestScenario?.years[0]?.targetCashKrw ?? 0) : fmtKrw(opportunities.lossLotProceedsKrw)}
            hint={!hasPlanningTarget && opportunities.bestLoss ? `${opportunities.bestLoss.year} ${opportunities.bestLoss.market}` : undefined}
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
  coverage,
  policy,
  assumptionsAreExample,
}: {
  scenario: MultiYearTaxScenario | null
  hasPlanningTarget: boolean
  annualTargetCashKrw: number
  opportunityRows: OpportunityRow[]
  coverage: OpportunityCoverage
  policy: TaxPolicy
  assumptionsAreExample: boolean
}) {
  return (
    <Card
      title={hasPlanningTarget ? 'Year-by-year action plan' : 'Opportunity map'}
      info={hasPlanningTarget ? 'This is the decision layer: which market to realize in each tax year. Specific lots are shown later as execution detail.' : 'This exploration layer separates timing signals, loss inventory, and jurisdiction-level tax estimates before you commit to a target amount.'}
      className="mb-5"
      accent
      action={hasPlanningTarget && scenario ? <Badge tone="info">{scenario.label}</Badge> : undefined}
    >
      {!hasPlanningTarget || !scenario ? (
        <OpportunityTable rows={opportunityRows} coverage={coverage} policy={policy} assumptionsAreExample={assumptionsAreExample} />
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

function OpportunityTable({
  rows,
  coverage,
  policy,
  assumptionsAreExample,
}: {
  rows: OpportunityRow[]
  coverage: OpportunityCoverage
  policy: TaxPolicy
  assumptionsAreExample: boolean
}) {
  if (rows.length === 0) return <EmptyState>No planning opportunities from current tax lots</EmptyState>
  const groups = groupOpportunityRows(rows)
  const takeaways = buildTakeaways(rows, policy, assumptionsAreExample)
  return (
    <>
      <div className="mb-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-[12px] leading-relaxed text-ink-3">
        This is a sell-all stress test for every currently priced open tax lot with an acquisition record. It is not quite the full holdings balance: positions without complete lot allocation are excluded from tax-term analysis. Each future year currently reuses today&apos;s price, FX, and short/long classification, so the table isolates filing-profile changes rather than forecasting an actual future sale. Gross country tax, estimated cross-border credit, and after-credit tax are shown separately.
      </div>
      <div className="mb-4 grid overflow-hidden rounded-md border border-line-subtle bg-card sm:grid-cols-2 xl:grid-cols-4">
        <div className="border-b border-line-subtle px-3 py-2 sm:border-r xl:border-b-0">
          <div className="text-[10px] uppercase tracking-[0.08em] text-ink-3">Full holdings unrealized G/L</div>
          <div className="mt-1 text-[14px] font-medium tabular-nums text-ink">{fmtKrw(coverage.holdingsUnrealizedGainKrw)}</div>
        </div>
        <div className="border-b border-line-subtle px-3 py-2 xl:border-b-0 xl:border-r">
          <div className="text-[10px] uppercase tracking-[0.08em] text-ink-3">Tax-lot modeled G/L</div>
          <div className="mt-1 text-[14px] font-medium tabular-nums text-ink">{fmtKrw(coverage.modeledGainKrw)}</div>
        </div>
        <div className="border-b border-line-subtle px-3 py-2 sm:border-b-0 sm:border-r">
          <div className="text-[10px] uppercase tracking-[0.08em] text-ink-3">Unallocated holding value</div>
          <div className="mt-1 text-[14px] font-medium tabular-nums text-warning">{fmtKrw(coverage.unallocatedMarketValueKrw)}</div>
        </div>
        <div className="px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.08em] text-ink-3">Unmodeled G/L difference</div>
          <div className="mt-1 text-[14px] font-medium tabular-nums text-warning">{fmtKrw(coverage.unmodeledGainKrw)}</div>
        </div>
      </div>
      {takeaways.length > 0 && (
        <div className="mb-4 grid gap-3 lg:grid-cols-3">
          {takeaways.map((takeaway) => (
            <div key={`${takeaway.title}-${takeaway.metric}`} className="flex min-h-[15rem] flex-col rounded-md border border-line-subtle bg-surface px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <Badge tone={takeaway.tone}>{takeaway.label}</Badge>
                <span className="text-right text-[13px] font-medium tabular-nums text-ink">{takeaway.metric}</span>
              </div>
              <div className="mt-2 text-[13px] font-medium leading-tight text-ink">{takeaway.title}</div>
              <div className="mt-1 text-[11px] leading-relaxed text-ink-2">{takeaway.body}</div>
              <div className="mt-3 border-t border-line-subtle pt-2">
                <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-3">What to consider</div>
                <div className="mt-1 text-[11px] leading-relaxed text-ink">{takeaway.action}</div>
              </div>
              <div className="mt-auto pt-3 text-[10px] leading-relaxed text-ink-3">{takeaway.caveat}</div>
            </div>
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-[12px]">
          <thead className="text-[10px] uppercase tracking-[0.08em] text-ink-3">
            <tr>
              <th className="pb-2 pr-4 font-medium">Years</th>
              <th className="pb-2 pr-4 font-medium">Market</th>
              <th className="pb-2 pr-4 font-medium">
                Tax profile
                <InfoTooltip align="left">Which country tax calculations are enabled for that year. US_AND_KR means both US and Korea estimates are included.</InfoTooltip>
              </th>
              <th className="pb-2 pr-4 text-right font-medium">
                Net G/L
                <InfoTooltip align="right">Estimated gain or loss if every currently priced lot in this market were sold. This stress case is not a sale recommendation.</InfoTooltip>
              </th>
              <th className="pb-2 pr-4 text-right font-medium">
                Loss inventory
                <InfoTooltip align="right">Unrealized loss in the loss lots. The related sale proceeds are shown in the row detail; they are not a tax-free allowance.</InfoTooltip>
              </th>
              <th className="pb-2 pr-4 text-right font-medium">
                US estimate
                <InfoTooltip align="right">US planning estimate after short-term and long-term netting. It uses KRW gains as a proxy; filing requires USD basis and transaction-date FX.</InfoTooltip>
              </th>
              <th className="pb-2 pr-4 text-right font-medium">
                KR estimate
                <InfoTooltip align="right">Korea planning estimate after applicable loss netting and the configured annual deduction. Domestic listed-stock taxability follows Tax Settings.</InfoTooltip>
              </th>
              <th className="pb-2 pr-4 text-right font-medium">
                Before credits
                <InfoTooltip align="right">US plus Korea estimates before any foreign tax credit. Do not interpret this as final combined cash tax.</InfoTooltip>
              </th>
              <th className="pb-2 pr-4 text-right font-medium">
                Est. credit
                <InfoTooltip align="right">Estimated Korea credit for modeled US federal tax attributable to US-market gains, capped at gross KR tax. California and NIIT are excluded from this credit pool.</InfoTooltip>
              </th>
              <th className="pb-2 pr-4 text-right font-medium">
                After credit
                <InfoTooltip align="right">US estimate plus KR gross tax minus the estimated cross-border credit. This is still a planning estimate, not a filed credit calculation.</InfoTooltip>
              </th>
              <th className="pb-2 pr-4 font-medium">
                Why it matters
                <InfoTooltip align="left">The specific timing or jurisdiction implication to review before selecting individual lots.</InfoTooltip>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {groups.map((row) => {
              const readout = row.market === 'US' && row.krTaxIfAllSoldKrw > 0
                ? `KR gross ${fmtKrw(row.krTaxIfAllSoldKrw)} - estimated credit ${fmtKrw(row.estimatedCrossBorderTaxCreditKrw)} = ${fmtKrw(row.incrementalKrTaxAfterCreditKrw)} incremental KR tax.`
                : row.market === 'US'
                  ? 'KR tax calc is off in this profile; the US estimate remains.'
                  : row.usTaxIfAllSoldKrw > 0
                    ? 'US estimate still applies to Korea-listed gains under the worldwide-income assumption.'
                    : 'No positive aggregate tax is modeled for this row.'
              return (
                <tr key={`${row.yearLabel}-${row.market}-${row.filingScenario}`}>
                  <td className="py-3 pr-4 font-mono text-ink">{row.yearLabel}</td>
                  <td className="py-3 pr-4"><Badge tone={marketTone(row.market)}>{row.market}</Badge></td>
                  <td className="py-3 pr-4"><Badge tone="neutral">{row.filingScenario}</Badge></td>
                  <td className="py-3 pr-4 text-right tabular-nums">{signedKrw(row.netGainKrw)}</td>
                  <td className="py-3 pr-4 text-right tabular-nums text-danger">{row.lossHarvestKrw > 0 ? fmtKrw(row.lossHarvestKrw) : '₩0'}</td>
                  <td className="py-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(row.usTaxIfAllSoldKrw)}</td>
                  <td className="py-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(row.krTaxIfAllSoldKrw)}</td>
                  <td className="py-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(row.combinedTaxBeforeCreditsKrw)}</td>
                  <td className="py-3 pr-4 text-right tabular-nums text-success">-{fmtKrw(row.estimatedCrossBorderTaxCreditKrw)}</td>
                  <td className="py-3 pr-4 text-right tabular-nums font-medium text-ink">{fmtKrw(row.combinedTaxAfterCreditsKrw)}</td>
                  <td className="py-3 pr-4 text-ink-2">
                    <div>{readout}</div>
                    <div className="mt-0.5 text-[11px] text-ink-3">
                      {fmtNumber(row.candidateCount)} priced lots · loss-lot proceeds {fmtKrw(row.lossLotProceedsKrw)} · all-lot proceeds {fmtKrw(row.totalProceedsKrw)}
                    </div>
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
