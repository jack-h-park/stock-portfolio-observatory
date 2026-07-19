import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, StatCard } from '@/components/ui'
import { getOperationalHealth, getTaxPlanningLots } from '@/lib/adapters/portfolio-db'
import { fmtKrw, fmtMoney, fmtNumber } from '@/lib/format'
import { positionHref } from '@/lib/position-url'
import { buildTaxPlan, type TaxPlanCandidate } from '@/lib/tax-planning'
import { getTaxPolicyState, type FilingScenario } from '@/lib/tax-policy'

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
  searchParams: Promise<{ scenario?: string; objective?: string; target?: string }>
}) {
  const params = await searchParams
  const taxPolicy = getTaxPolicyState()
  const activeScenario = scenario(params.scenario, taxPolicy.policy.activeScenario)
  const objective = params.objective || 'minimize-tax'
  const targetCashKrw = Number(params.target ?? 0) || 0
  const lots = getTaxPlanningLots()
  const plan = buildTaxPlan({ lots, policy: taxPolicy.policy, scenario: activeScenario, objective, targetCashKrw })
  const operational = getOperationalHealth()
  const taxRate = plan.summary.grossProceedsKrw > 0 ? (plan.summary.estimatedTaxKrw / plan.summary.grossProceedsKrw) * 100 : null

  return (
    <>
      <PageHeader
        eyebrow="Tax"
        title="Tax Planning"
        emphasis="Planning"
        subtitle="Lot-level realization planning with configurable US/Korea assumptions. Treat outputs as review estimates, not filing advice."
        action={
          <div className="flex items-center gap-2">
            {taxPolicy.source === 'example' && <Badge tone="warning">Example assumptions</Badge>}
            <Link href="/tax-settings" className="text-[12px] font-medium text-info hover:underline">
              Adjust assumptions
            </Link>
          </div>
        }
      />

      <form className="mb-5 grid gap-3 rounded-md border border-line bg-card p-3 shadow-card lg:grid-cols-[12rem_12rem_1fr_auto]">
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
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-[0.08em] text-ink-3">Target cash KRW</span>
          <input name="target" type="number" defaultValue={targetCashKrw || ''} className="w-full rounded-md border border-line bg-card px-3 py-2 text-[13px] text-ink outline-none" />
        </label>
        <button type="submit" className="self-end rounded-md border border-line bg-ink px-4 py-2 text-[13px] font-medium text-card transition-opacity hover:opacity-90">
          Recalculate
        </button>
      </form>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard label="Open Lots" value={fmtNumber(plan.summary.candidateCount)} accent />
        <StatCard label="Plan Proceeds" value={fmtKrw(plan.summary.grossProceedsKrw)} />
        <StatCard label="Plan G/L" value={fmtKrw(plan.summary.grossGainKrw + plan.summary.grossLossKrw)} tone={plan.summary.grossGainKrw + plan.summary.grossLossKrw >= 0 ? 'success' : 'danger'} />
        <StatCard label="Est. Tax" value={fmtKrw(plan.summary.estimatedTaxKrw)} hint={pct(taxRate)} tone={plan.summary.estimatedTaxKrw > 0 ? 'warning' : 'success'} />
        <StatCard label="KR Deduction Room" value={fmtKrw(plan.summary.remainingKrDeductionKrw)} />
        <StatCard label="Input Issues" value={fmtNumber(plan.summary.missingValuationCount + operational.staleItems.length)} tone={plan.summary.missingValuationCount + operational.staleItems.length ? 'warning' : 'success'} />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Scenario assumptions">
          <div className="space-y-2 text-[12px] text-ink-2">
            <div className="flex items-center justify-between gap-3"><span>Scenario</span><Badge tone="info">{plan.assumptions.scenario}</Badge></div>
            <div className="flex items-center justify-between gap-3"><span>US ST / LT</span><span className="tabular-nums text-ink">{pct(plan.assumptions.usShortRatePct)} / {pct(plan.assumptions.usLongRatePct)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>US state + NIIT</span><span className="tabular-nums text-ink">{pct(plan.assumptions.usStateRatePct + plan.assumptions.usNiitRatePct)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>KR stock deduction</span><span className="tabular-nums text-ink">{fmtKrw(plan.assumptions.krBasicDeductionKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>KR foreign stock rate</span><span className="tabular-nums text-ink">{pct(plan.assumptions.krForeignStockRatePct)}</span></div>
          </div>
        </Card>

        <Card title="Plan tax split">
          <div className="space-y-2 text-[12px] text-ink-2">
            <div className="flex items-center justify-between gap-3"><span>US estimated tax</span><span className="tabular-nums text-ink">{fmtMoney(plan.summary.usTaxUsd, 'USD')} / {fmtKrw(plan.summary.usTaxKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>KR estimated tax</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.krTaxKrw)}</span></div>
            <div className="flex items-center justify-between gap-3"><span>After-tax proceeds</span><span className="tabular-nums text-ink">{fmtKrw(plan.summary.estimatedAfterTaxKrw)}</span></div>
            <div className="text-[11px] leading-relaxed text-ink-3">US+KR mode currently shows both calculations side-by-side. Foreign tax credit is manual until verified per filing profile.</div>
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
