import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, InfoTooltip, StatCard } from '@/components/ui'
import { getOperationalHealth, getTaxPlanningLots } from '@/lib/adapters/portfolio-db'
import { fmtKrw, fmtMoney, fmtNumber } from '@/lib/format'
import { positionHref } from '@/lib/position-url'
import { buildMultiYearTaxPlan, buildTaxPlan, type MultiYearTaxScenario, type TaxPlanCandidate } from '@/lib/tax-planning'
import { annualProfiles, getTaxPolicyState, scenarioFromTaxYearProfile, type FilingScenario } from '@/lib/tax-policy'

export const dynamic = 'force-dynamic'

function scenario(value: string | undefined, fallback: FilingScenario): FilingScenario {
  return value === 'US_ONLY' || value === 'KR_ONLY' || value === 'US_AND_KR' ? value : fallback
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
  const targetCashKrw = Number(params.target ?? 0) || 0
  const annualTargetCashKrw = Number(params.annualTarget ?? params.target ?? 0) || 0
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
  const taxRate = plan.summary.grossProceedsKrw > 0 ? (plan.summary.estimatedTaxKrw / plan.summary.grossProceedsKrw) * 100 : null
  const filingProfiles = annualProfiles(taxPolicy.policy, horizonYears)

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

      <form className="mb-5 grid gap-3 rounded-md border border-line bg-card p-3 shadow-card lg:grid-cols-[10rem_13rem_1fr_8rem_auto]">
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
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-[0.08em] text-ink-3">Annual cash target KRW</span>
          <input name="annualTarget" type="number" defaultValue={annualTargetCashKrw || ''} className="w-full rounded-md border border-line bg-card px-3 py-2 text-[13px] text-ink outline-none" />
        </label>
        <button type="submit" className="self-end rounded-md border border-line bg-ink px-4 py-2 text-[13px] font-medium text-card transition-opacity hover:opacity-90">
          Recalculate
        </button>
      </form>

      {annualTargetCashKrw <= 0 && (
        <div className="mb-5 rounded-md border border-[color:var(--accent-warning)]/25 bg-[color:var(--accent-warning)]/10 px-3 py-2 text-[12px] leading-relaxed text-ink-2">
          Set an annual cash target to compare market timing meaningfully. With no target, scenarios can converge because the planner is effectively reviewing available sale lots across the whole horizon.
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard label="Open Lots" value={fmtNumber(plan.summary.candidateCount)} accent />
        <StatCard label="Best Scenario" value={multiYearPlan.bestScenario?.label ?? 'n/a'} />
        <StatCard label="Total Proceeds" value={fmtKrw(multiYearPlan.bestScenario?.summary.proceedsKrw ?? 0)} />
        <StatCard label="Total Tax" value={fmtKrw(multiYearPlan.bestScenario?.summary.taxKrw ?? 0)} hint={pct(multiYearPlan.bestScenario?.summary.effectiveTaxRatePct)} tone={(multiYearPlan.bestScenario?.summary.taxKrw ?? 0) > 0 ? 'warning' : 'success'} />
        <StatCard label="Peak Year Tax" value={fmtKrw(multiYearPlan.bestScenario?.summary.peakYearTaxKrw ?? 0)} />
        <StatCard label="Input Issues" value={fmtNumber(plan.summary.missingValuationCount + operational.staleItems.length)} tone={plan.summary.missingValuationCount + operational.staleItems.length ? 'warning' : 'success'} />
      </div>

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
        title="Market timing scenario comparison"
        info="These scenarios compare which market exposure to realize earlier in the multi-year plan. They do not model whether Korea or the US return is filed first within the same year."
        className="mb-5"
        accent
      >
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

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        {multiYearPlan.scenarios.slice(0, 4).map((scenarioRow) => (
          <ScenarioTimeline key={scenarioRow.key} scenario={scenarioRow} />
        ))}
      </div>

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
