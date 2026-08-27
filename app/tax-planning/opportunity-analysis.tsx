import { Badge, Card, EmptyState, InfoTooltip, Label, MetricField, Signed, marketTone } from '@/components/ui'
import { fmtKrw, fmtNumber, fmtPct } from '@/lib/format'
import {
  buildTaxPlan,
  summarizeTaxCandidates,
  type MultiYearTaxScenario,
  type TaxPlanningLot,
} from '@/lib/tax-planning'
import { scenarioFromTaxYearProfile, type FilingScenario, type TaxPolicy, type TaxYearProfile } from '@/lib/tax-policy'
import type { TaxPlanningCopy } from './copy'
import { marketAmount, sameKrw } from './view-utils'

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

export type OpportunityCoverage = {
  holdingsMarketValueKrw: number
  holdingsUnrealizedGainKrw: number
  modeledProceedsKrw: number
  modeledGainKrw: number
  unallocatedMarketValueKrw: number
  unmodeledGainKrw: number
}

export function buildOpportunityRows({
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

export function opportunitySummary(rows: OpportunityRow[]) {
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

function buildTakeaways(rows: OpportunityRow[], policy: TaxPolicy, assumptionsAreExample: boolean, copy: TaxPlanningCopy): OpportunityTakeaway[] {
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
        label: copy.opportunity.timingSignal,
        title: copy.opportunity.timingSignalTitle(fmtKrw(afterCreditDifference)),
        body: copy.opportunity.timingSignalBody(highestKrTax.yearLabel, fmtKrw(highestKrTax.krTaxIfAllSoldKrw), fmtKrw(highestKrTax.estimatedCrossBorderTaxCreditKrw), fmtKrw(highestKrTax.incrementalKrTaxAfterCreditKrw)),
        action: copy.opportunity.timingSignalAction(lowestKrTax.yearLabel),
        caveat: copy.opportunity.timingSignalCaveat(assumptionsAreExample),
        metric: copy.opportunity.afterCreditMetric(fmtKrw(afterCreditDifference)),
        tone: 'success',
      })
    } else {
      takeaways.push({
        label: copy.opportunity.filingProfileOnly,
        title: copy.opportunity.filingProfileOnlyTitle,
        body: copy.opportunity.filingProfileOnlyBody(highestKrTax.yearLabel, fmtKrw(highestKrTax.krTaxIfAllSoldKrw), fmtKrw(highestKrTax.estimatedCrossBorderTaxCreditKrw), fmtKrw(highestKrTax.incrementalKrTaxAfterCreditKrw), fmtKrw(highestKrTax.combinedTaxAfterCreditsKrw), lowestKrTax.yearLabel),
        action: copy.opportunity.filingProfileOnlyAction,
        caveat: copy.opportunity.filingProfileOnlyCaveat(assumptionsAreExample),
        metric: copy.opportunity.modeledSavingMetric(fmtKrw(afterCreditDifference)),
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
      label: copy.opportunity.potentialPairing,
      title: copy.opportunity.potentialPairingTitle,
      body: copy.opportunity.potentialPairingBody(fmtKrw(krLoss.shortLossHarvestKrw), fmtKrw(usGain.netShortGainKrw), fmtKrw(pairableShortGainKrw)),
      action: copy.opportunity.potentialPairingAction,
      caveat: copy.opportunity.potentialPairingCaveat(fmtKrw(screeningTaxImpactKrw), fmtNumber(shortRatePct, 2)),
      metric: copy.opportunity.gainToScreenMetric(fmtKrw(pairableShortGainKrw)),
      tone: 'info',
    })
  }

  if (krLoss && krLoss.lossLotProceedsKrw > 0) {
    takeaways.push({
      label: copy.opportunity.meaningOfNumber,
      title: copy.opportunity.meaningOfNumberTitle(fmtKrw(krLoss.lossLotProceedsKrw)),
      body: copy.opportunity.meaningOfNumberBody(fmtKrw(krLoss.lossLotProceedsKrw), fmtKrw(krLoss.lossHarvestKrw)),
      action: copy.opportunity.meaningOfNumberAction,
      caveat: copy.opportunity.meaningOfNumberCaveat,
      metric: copy.opportunity.lossInventoryMetric(fmtKrw(krLoss.lossHarvestKrw)),
      tone: 'warning',
    })
  }
  return takeaways.slice(0, 3)
}

export function DecisionSummary({
  hasPlanningTarget,
  tiedTax,
  bestScenario,
  opportunities,
  inputIssueCount,
  openLotCount,
  copy,
}: {
  hasPlanningTarget: boolean
  tiedTax: boolean
  bestScenario: MultiYearTaxScenario | null
  opportunities: ReturnType<typeof opportunitySummary>
  inputIssueCount: number
  openLotCount: number
  copy: TaxPlanningCopy
}) {
  const title = !hasPlanningTarget
    ? copy.opportunity.reviewTimingSignals
    : tiedTax
      ? copy.opportunity.noTaxDifference
      : copy.opportunity.currentLowestTaxPath(bestScenario?.label ?? 'n/a')
  const body = !hasPlanningTarget
    ? copy.opportunity.noPlanningTargetBody
    : tiedTax
      ? copy.opportunity.tiedTaxBody
      : copy.opportunity.recommendationBody

  return (
    <Card title={copy.opportunity.currentDecision} className="mb-5" accent>
      <div className="grid gap-4 xl:grid-cols-[1fr_26rem]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={!hasPlanningTarget ? 'warning' : tiedTax ? 'neutral' : 'success'}>
              {!hasPlanningTarget ? copy.opportunity.explore : tiedTax ? copy.opportunity.tie : copy.opportunity.recommendation}
            </Badge>
            <h2 className="text-title font-medium leading-tight tracking-tight text-ink">{title}</h2>
          </div>
          <p className="mt-2 max-w-[56rem] text-body leading-relaxed text-ink-2">{body}</p>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            <div className="rounded-md border border-line-subtle bg-surface px-3 py-2">
              <Label size="micro">{copy.opportunity.step1}</Label>
              <div className="mt-1 text-caption text-ink">{copy.opportunity.step1Body}</div>
            </div>
            <div className="rounded-md border border-line-subtle bg-surface px-3 py-2">
              <Label size="micro">{copy.opportunity.step2}</Label>
              <div className="mt-1 text-caption text-ink">{copy.opportunity.step2Body}</div>
            </div>
            <div className="rounded-md border border-line-subtle bg-surface px-3 py-2">
              <Label size="micro">{copy.opportunity.step3}</Label>
              <div className="mt-1 text-caption text-ink">{copy.opportunity.step3Body}</div>
            </div>
          </div>
        </div>
        <div className="grid gap-3 rounded-md border border-line-subtle bg-surface p-3 sm:grid-cols-2">
          <MetricField
            label={copy.opportunity.openLots}
            value={fmtNumber(openLotCount)}
            hint={copy.opportunity.openLotsHint}
            valueClassName="text-title"
          />
          <MetricField
            label={copy.opportunity.inputIssues}
            value={fmtNumber(inputIssueCount)}
            info={copy.opportunity.inputIssuesInfo}
            hint={copy.opportunity.inputIssuesHint}
            tone={inputIssueCount ? 'warning' : 'success'}
            valueClassName="text-title"
          />
          <MetricField
            label={hasPlanningTarget ? copy.opportunity.annualTest : copy.opportunity.lossLotProceeds}
            value={hasPlanningTarget ? fmtKrw(bestScenario?.years[0]?.targetCashKrw ?? 0) : fmtKrw(opportunities.lossLotProceedsKrw)}
            hint={!hasPlanningTarget && opportunities.bestLoss ? `${opportunities.bestLoss.year} ${opportunities.bestLoss.market}` : copy.opportunity.scenarioInputAmount}
            tone={hasPlanningTarget ? 'neutral' : 'success'}
            valueClassName="text-title"
          />
          <MetricField
            label={hasPlanningTarget ? copy.opportunity.estimatedTax : copy.opportunity.lossHarvest}
            value={hasPlanningTarget ? fmtKrw(bestScenario?.summary.taxKrw ?? 0) : fmtKrw(opportunities.lossHarvestKrw)}
            hint={hasPlanningTarget ? fmtPct(bestScenario?.summary.effectiveTaxRatePct) : opportunities.bestLoss ? `${opportunities.bestLoss.year} ${opportunities.bestLoss.market}` : copy.opportunity.modeledLossInventory}
            tone={!hasPlanningTarget ? 'info' : (bestScenario?.summary.taxKrw ?? 0) > 0 ? 'warning' : 'success'}
            valueClassName="text-title"
          />
        </div>
      </div>
    </Card>
  )
}

export function PlanningMap({
  scenario,
  hasPlanningTarget,
  annualTargetCashKrw,
  opportunityRows,
  coverage,
  policy,
  assumptionsAreExample,
  copy,
}: {
  scenario: MultiYearTaxScenario | null
  hasPlanningTarget: boolean
  annualTargetCashKrw: number
  opportunityRows: OpportunityRow[]
  coverage: OpportunityCoverage
  policy: TaxPolicy
  assumptionsAreExample: boolean
  copy: TaxPlanningCopy
}) {
  return (
    <Card
      title={hasPlanningTarget ? copy.opportunity.actionPlanTitle : copy.opportunity.opportunityMapTitle}
      info={hasPlanningTarget ? copy.opportunity.actionPlanInfo : copy.opportunity.opportunityMapInfo}
      className="mb-5"
      accent
      action={hasPlanningTarget && scenario ? <Badge tone="info">{scenario.label}</Badge> : undefined}
    >
      {!hasPlanningTarget || !scenario ? (
        <OpportunityTable rows={opportunityRows} coverage={coverage} policy={policy} assumptionsAreExample={assumptionsAreExample} copy={copy} />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-caption">
            <thead className="text-micro uppercase tracking-[0.08em] text-ink-3">
              <tr>
                <th className="pb-2 pr-4 font-medium">{copy.opportunity.year}</th>
                <th className="pb-2 pr-4 font-medium">{copy.opportunity.filingProfile}</th>
                <th className="pb-2 pr-4 text-right font-medium">{copy.opportunity.sellKrMarket}</th>
                <th className="pb-2 pr-4 text-right font-medium">{copy.opportunity.sellUsMarket}</th>
                <th className="pb-2 pr-4 text-right font-medium">{copy.opportunity.target}</th>
                <th className="pb-2 pr-4 text-right font-medium">{copy.opportunity.estimatedTax}</th>
                <th className="pb-2 pr-4 font-medium">{copy.opportunity.readout}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {scenario.years.map((year) => {
                const krAmount = marketAmount(year, 'KR')
                const usAmount = marketAmount(year, 'US')
                const readout = krAmount > usAmount
                  ? copy.opportunity.mostlyKrSales
                  : usAmount > krAmount
                    ? copy.opportunity.mostlyUsSales
                    : krAmount + usAmount > 0
                      ? copy.opportunity.mixedMarketSales
                      : copy.opportunity.noPlannedSale
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
  copy,
}: {
  rows: OpportunityRow[]
  coverage: OpportunityCoverage
  policy: TaxPolicy
  assumptionsAreExample: boolean
  copy: TaxPlanningCopy
}) {
  if (rows.length === 0) return <EmptyState>{copy.opportunity.noPlanningOpportunities}</EmptyState>
  const groups = groupOpportunityRows(rows)
  const takeaways = buildTakeaways(rows, policy, assumptionsAreExample, copy)
  return (
    <>
      <div className="mb-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-caption leading-relaxed text-ink-3">
        {copy.opportunity.stressTestNote}
      </div>
      <div className="mb-4 grid overflow-hidden rounded-md border border-line-subtle bg-card sm:grid-cols-2 xl:grid-cols-4">
        <div className="border-b border-line-subtle px-3 py-2 sm:border-r xl:border-b-0">
          <Label size="micro">{copy.opportunity.fullHoldingsGl}</Label>
          <div className="mt-1 text-body-lg font-medium tabular-nums text-ink">{fmtKrw(coverage.holdingsUnrealizedGainKrw)}</div>
        </div>
        <div className="border-b border-line-subtle px-3 py-2 xl:border-b-0 xl:border-r">
          <Label size="micro">{copy.opportunity.taxLotModeledGl}</Label>
          <div className="mt-1 text-body-lg font-medium tabular-nums text-ink">{fmtKrw(coverage.modeledGainKrw)}</div>
        </div>
        <div className="border-b border-line-subtle px-3 py-2 sm:border-b-0 sm:border-r">
          <Label size="micro">{copy.opportunity.unallocatedHoldingValue}</Label>
          <div className="mt-1 text-body-lg font-medium tabular-nums text-warning">{fmtKrw(coverage.unallocatedMarketValueKrw)}</div>
        </div>
        <div className="px-3 py-2">
          <Label size="micro">{copy.opportunity.unmodeledGlDifference}</Label>
          <div className="mt-1 text-body-lg font-medium tabular-nums text-warning">{fmtKrw(coverage.unmodeledGainKrw)}</div>
        </div>
      </div>
      {takeaways.length > 0 && (
        <div className="mb-4 grid gap-3 lg:grid-cols-3">
          {takeaways.map((takeaway) => (
            <div key={`${takeaway.title}-${takeaway.metric}`} className="flex min-h-[15rem] flex-col rounded-md border border-line-subtle bg-surface px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <Badge tone={takeaway.tone}>{takeaway.label}</Badge>
                <span className="text-right text-body font-medium tabular-nums text-ink">{takeaway.metric}</span>
              </div>
              <div className="mt-2 text-body font-medium leading-tight text-ink">{takeaway.title}</div>
              <div className="mt-1 text-label leading-relaxed text-ink-2">{takeaway.body}</div>
              <div className="mt-3 border-t border-line-subtle pt-2">
                <Label size="micro">{copy.opportunity.whatToConsider}</Label>
                <div className="mt-1 text-label leading-relaxed text-ink">{takeaway.action}</div>
              </div>
              <div className="mt-auto pt-3 text-micro leading-relaxed text-ink-3">{takeaway.caveat}</div>
            </div>
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-caption">
          <thead className="text-micro uppercase tracking-[0.08em] text-ink-3">
            <tr>
              <th className="pb-2 pr-4 font-medium">{copy.opportunity.years}</th>
              <th className="pb-2 pr-4 font-medium">{copy.opportunity.market}</th>
              <th className="pb-2 pr-4 font-medium">
                {copy.opportunity.taxProfile}
                <InfoTooltip align="left">{copy.opportunity.taxProfileInfo}</InfoTooltip>
              </th>
              <th className="pb-2 pr-4 text-right font-medium">
                {copy.opportunity.netGainLoss}
                <InfoTooltip align="right">{copy.opportunity.netGainLossInfo}</InfoTooltip>
              </th>
              <th className="pb-2 pr-4 text-right font-medium">
                {copy.opportunity.lossInventory}
                <InfoTooltip align="right">{copy.opportunity.lossInventoryInfo}</InfoTooltip>
              </th>
              <th className="pb-2 pr-4 text-right font-medium">
                {copy.opportunity.usEstimate}
                <InfoTooltip align="right">{copy.opportunity.usEstimateInfo}</InfoTooltip>
              </th>
              <th className="pb-2 pr-4 text-right font-medium">
                {copy.opportunity.krEstimate}
                <InfoTooltip align="right">{copy.opportunity.krEstimateInfo}</InfoTooltip>
              </th>
              <th className="pb-2 pr-4 text-right font-medium">
                {copy.opportunity.beforeCredits}
                <InfoTooltip align="right">{copy.opportunity.beforeCreditsInfo}</InfoTooltip>
              </th>
              <th className="pb-2 pr-4 text-right font-medium">
                {copy.opportunity.estimatedCredit}
                <InfoTooltip align="right">{copy.opportunity.estimatedCreditInfo}</InfoTooltip>
              </th>
              <th className="pb-2 pr-4 text-right font-medium">
                {copy.opportunity.afterCredit}
                <InfoTooltip align="right">{copy.opportunity.afterCreditInfo}</InfoTooltip>
              </th>
              <th className="pb-2 pr-4 font-medium">
                {copy.opportunity.whyItMatters}
                <InfoTooltip align="left">{copy.opportunity.whyItMattersInfo}</InfoTooltip>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {groups.map((row) => {
              const readout = row.market === 'US' && row.krTaxIfAllSoldKrw > 0
                ? copy.opportunity.rowReadoutUsKr(fmtKrw(row.krTaxIfAllSoldKrw), fmtKrw(row.estimatedCrossBorderTaxCreditKrw), fmtKrw(row.incrementalKrTaxAfterCreditKrw))
                : row.market === 'US'
                  ? copy.opportunity.rowReadoutUsOnly
                  : row.usTaxIfAllSoldKrw > 0
                    ? copy.opportunity.rowReadoutKrUs
                    : copy.opportunity.rowReadoutNone
              return (
                <tr key={`${row.yearLabel}-${row.market}-${row.filingScenario}`}>
                  <td className="py-3 pr-4 font-mono text-ink">{row.yearLabel}</td>
                  <td className="py-3 pr-4"><Badge tone={marketTone(row.market)}>{row.market}</Badge></td>
                  <td className="py-3 pr-4"><Badge tone="neutral">{row.filingScenario}</Badge></td>
                  <td className="py-3 pr-4 text-right tabular-nums"><Signed value={row.netGainKrw} format={fmtKrw} /></td>
                  <td className="py-3 pr-4 text-right tabular-nums text-danger">{row.lossHarvestKrw > 0 ? fmtKrw(row.lossHarvestKrw) : '₩0'}</td>
                  <td className="py-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(row.usTaxIfAllSoldKrw)}</td>
                  <td className="py-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(row.krTaxIfAllSoldKrw)}</td>
                  <td className="py-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(row.combinedTaxBeforeCreditsKrw)}</td>
                  <td className="py-3 pr-4 text-right tabular-nums text-success">-{fmtKrw(row.estimatedCrossBorderTaxCreditKrw)}</td>
                  <td className="py-3 pr-4 text-right tabular-nums font-medium text-ink">{fmtKrw(row.combinedTaxAfterCreditsKrw)}</td>
                  <td className="py-3 pr-4 text-ink-2">
                    <div>{readout}</div>
                    <div className="mt-0.5 text-label text-ink-3">
                      {copy.opportunity.rowDetail(fmtNumber(row.candidateCount), fmtKrw(row.lossLotProceedsKrw), fmtKrw(row.totalProceedsKrw))}
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
