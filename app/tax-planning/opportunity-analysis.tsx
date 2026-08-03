import { Badge, Card, EmptyState, InfoTooltip, MetricField, marketTone } from '@/components/ui'
import { fmtKrw, fmtNumber } from '@/lib/format'
import { GLOSSARY } from '@/lib/glossary'
import {
  buildTaxPlan,
  summarizeTaxCandidates,
  type MultiYearTaxScenario,
  type TaxPlanningLot,
} from '@/lib/tax-planning'
import { scenarioFromTaxYearProfile, type FilingScenario, type TaxPolicy, type TaxYearProfile } from '@/lib/tax-policy'
import { marketAmount, pct, sameKrw, signedKrw } from './view-utils'

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

export function DecisionSummary({
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
        <div className="grid gap-3 rounded-md border border-line-subtle bg-surface p-3 sm:grid-cols-2">
          <MetricField
            label="Open Lots"
            value={fmtNumber(openLotCount)}
            hint="Available tax-lot rows"
            valueClassName="text-[18px]"
          />
          <MetricField
            label="Input Issues"
            value={fmtNumber(inputIssueCount)}
            info={GLOSSARY.inputIssues.description}
            hint="Items to resolve before relying on output"
            tone={inputIssueCount ? 'warning' : 'success'}
            valueClassName="text-[18px]"
          />
          <MetricField
            label={hasPlanningTarget ? 'Annual Test' : 'Loss-Lot Proceeds'}
            value={hasPlanningTarget ? fmtKrw(bestScenario?.years[0]?.targetCashKrw ?? 0) : fmtKrw(opportunities.lossLotProceedsKrw)}
            hint={!hasPlanningTarget && opportunities.bestLoss ? `${opportunities.bestLoss.year} ${opportunities.bestLoss.market}` : 'Scenario input amount'}
            tone={hasPlanningTarget ? 'neutral' : 'success'}
            valueClassName="text-[18px]"
          />
          <MetricField
            label={hasPlanningTarget ? 'Est. Tax' : 'Loss Harvest'}
            value={hasPlanningTarget ? fmtKrw(bestScenario?.summary.taxKrw ?? 0) : fmtKrw(opportunities.lossHarvestKrw)}
            hint={hasPlanningTarget ? pct(bestScenario?.summary.effectiveTaxRatePct) : opportunities.bestLoss ? `${opportunities.bestLoss.year} ${opportunities.bestLoss.market}` : 'Modeled loss inventory'}
            tone={!hasPlanningTarget ? 'info' : (bestScenario?.summary.taxKrw ?? 0) > 0 ? 'warning' : 'success'}
            valueClassName="text-[18px]"
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
