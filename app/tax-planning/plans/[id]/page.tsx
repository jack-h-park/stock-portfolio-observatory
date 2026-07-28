import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTaxPlanningLots } from '@/lib/adapters/portfolio-db'
import { PageHeader } from '@/components/PageHeader'
import { TaxPlanTimeline } from '@/components/TaxPlanTimeline'
import { Badge, Card } from '@/components/ui'
import { fmtDateTime, fmtKrw, fmtNumber } from '@/lib/format'
import { buildMonthlySalePlanSet } from '@/lib/tax-planning'
import { getSavedTaxPlan, savedTaxPlanProgress, type SavedTaxPlanStatus } from '@/lib/tax-plan-store'
import { getTaxPolicyState } from '@/lib/tax-policy'
import { updateSavedTaxPlanStatusAction } from '@/app/tax-planning/actions'

export const dynamic = 'force-dynamic'

const STATUS_TONE: Record<SavedTaxPlanStatus, 'neutral' | 'info' | 'success' | 'warning'> = {
  draft: 'neutral',
  reviewed: 'info',
  active: 'warning',
  completed: 'success',
  archived: 'neutral',
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

function deltaLabel(value: number, formatter: (amount: number) => string = fmtKrw) {
  if (Math.abs(value) < 0.5) return 'No change'
  return `${value > 0 ? '+' : '-'}${formatter(Math.abs(value))}`
}

export default async function SavedTaxPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const saved = getSavedTaxPlan(id)
  if (!saved) notFound()
  const progress = savedTaxPlanProgress(saved)
  const policyState = getTaxPolicyState()
  const livePlanSet = buildMonthlySalePlanSet({
    lots: getTaxPlanningLots(5000),
    policy: policyState.policy,
    selectedStrategy: saved.strategy,
    executionMonths: saved.executionMonths,
    horizonYears: saved.horizonYears,
  })
  const livePlan = livePlanSet.selectedPlan
  const drift = {
    proceedsKrw: livePlan.summary.proceedsKrw - saved.plan.summary.proceedsKrw,
    estimatedTaxKrw: livePlan.summary.estimatedTaxKrw - saved.plan.summary.estimatedTaxKrw,
    afterTaxKrw: livePlan.summary.afterTaxKrw - saved.plan.summary.afterTaxKrw,
    instructionCount: livePlan.summary.instructionCount - saved.plan.summary.instructionCount,
  }
  const changed = Object.values(drift).some((value) => Math.abs(value) >= 0.5)

  return (
    <>
      <PageHeader
        eyebrow="Tax · Saved plan"
        title={saved.name}
        subtitle={`Immutable calculation snapshot from ${dateLabel(saved.asOfDate)} · revision ${saved.revision}`}
        action={
          <Link href="/tax-planning" className="text-[12px] font-medium text-info hover:underline">
            Back to planner
          </Link>
        }
      />

      <Card
        title="Execution overview"
        info="The tax calculation snapshot stays unchanged. Review and execution updates are recorded separately so the original plan remains auditable."
        className="mb-5"
        accent
        action={<Badge tone={STATUS_TONE[saved.status]}>{saved.status}</Badge>}
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line-subtle bg-line-subtle md:grid-cols-4">
              {[
                ['Planned sales', fmtKrw(saved.plan.summary.proceedsKrw)],
                ['Estimated tax', fmtKrw(saved.plan.summary.estimatedTaxKrw)],
                ['Instructions', fmtNumber(progress.total)],
                ['Complete', `${fmtNumber(progress.completionPct, 1)}%`],
              ].map(([label, value]) => (
                <div key={label} className="bg-card px-3 py-3">
                  <div className="text-[10px] font-medium uppercase text-ink-3">{label}</div>
                  <div className="mt-1 text-[18px] font-medium tabular-nums text-ink">{value}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-pill bg-line-subtle">
              <div className="h-full bg-success" style={{ width: `${progress.completionPct}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-ink-3">
              <span><strong className="font-medium text-ink">{progress.executed}</strong> executed</span>
              <span><strong className="font-medium text-ink">{progress.reviewed}</strong> reviewed</span>
              <span><strong className="font-medium text-ink">{progress.planned}</strong> planned</span>
              <span><strong className="font-medium text-ink">{progress.skipped}</strong> skipped</span>
              <span><strong className="font-medium text-ink">{fmtKrw(progress.executedProceedsKrw)}</strong> actual proceeds</span>
            </div>
          </div>

          <form action={updateSavedTaxPlanStatusAction} className="rounded-md border border-line-subtle bg-surface p-3">
            <input type="hidden" name="planId" value={saved.id} />
            <label className="block text-[10px] font-medium uppercase text-ink-3" htmlFor="plan-status">
              Plan status
            </label>
            <select
              id="plan-status"
              name="status"
              defaultValue={saved.status}
              className="mt-1.5 w-full rounded-md border border-line bg-card px-3 py-2 text-[12px] text-ink outline-none focus:border-info"
            >
              <option value="draft">Draft</option>
              <option value="reviewed">Reviewed</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
            <button type="submit" className="mt-2 w-full rounded-md border border-ink bg-ink px-3 py-2 text-[12px] font-medium text-card">
              Update status
            </button>
            <div className="mt-3 border-t border-line-subtle pt-2 text-[10px] leading-relaxed text-ink-3">
              Created {fmtDateTime(saved.createdAt)}<br />
              Updated {fmtDateTime(saved.updatedAt)}
            </div>
          </form>
        </div>
      </Card>

      <Card
        title="Current-data drift"
        info="This compares the saved immutable snapshot with a fresh calculation using today's holdings, prices, FX, and tax policy. It does not alter the saved plan."
        className="mb-5"
        action={<Badge tone={changed ? 'warning' : 'success'}>{changed ? 'Review changes' : 'No material change'}</Badge>}
      >
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line-subtle bg-line-subtle lg:grid-cols-4">
          {[
            ['Planned sales', deltaLabel(drift.proceedsKrw), drift.proceedsKrw],
            ['Estimated tax', deltaLabel(drift.estimatedTaxKrw), -drift.estimatedTaxKrw],
            ['After-tax cash', deltaLabel(drift.afterTaxKrw), drift.afterTaxKrw],
            ['Instructions', deltaLabel(drift.instructionCount, (value) => fmtNumber(value)), -Math.abs(drift.instructionCount)],
          ].map(([label, value, toneValue]) => (
            <div key={String(label)} className="bg-card px-3 py-3">
              <div className="text-[10px] font-medium uppercase text-ink-3">{label}</div>
              <div className={`mt-1 text-[18px] font-medium tabular-nums ${Number(toneValue) > 0 ? 'text-success' : Number(toneValue) < 0 ? 'text-warning' : 'text-ink'}`}>
                {value}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-col gap-2 text-[11px] leading-relaxed text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Saved as of {saved.asOfDate}; fresh calculation as of {livePlanSet.asOfDate}. Tax policy version {saved.policyVersion} → {policyState.policy.version}.
          </span>
          <Link
            href={`/tax-planning?master=${saved.strategy}&pace=${saved.executionMonths}&horizon=${saved.horizonYears}`}
            className="shrink-0 font-medium text-info hover:underline"
          >
            Open fresh calculation
          </Link>
        </div>
      </Card>

      <TaxPlanTimeline
        key={`${saved.id}:${saved.revision}`}
        plan={saved.plan}
        initialMonth={saved.plan.months[0]?.yearMonth ?? ''}
        initialPage={1}
        savedPlanId={saved.id}
        execution={saved.execution}
      />

      <Card title="Snapshot provenance" className="mb-5">
        <dl className="grid gap-x-8 gap-y-3 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-ink-3">Strategy</dt><dd className="mt-1 text-ink">{saved.plan.label}</dd></div>
          <div><dt className="text-ink-3">Execution window</dt><dd className="mt-1 tabular-nums text-ink">{saved.executionMonths} months</dd></div>
          <div><dt className="text-ink-3">Tax horizon</dt><dd className="mt-1 tabular-nums text-ink">{saved.horizonYears} years</dd></div>
          <div><dt className="text-ink-3">Tax policy</dt><dd className="mt-1 tabular-nums text-ink">version {saved.policyVersion}</dd></div>
        </dl>
      </Card>
    </>
  )
}
