import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTaxPlanningLots } from '@/lib/adapters/portfolio-db'
import { PageHeader } from '@/components/PageHeader'
import { TaxPlanTimeline } from '@/components/TaxPlanTimeline'
import { Badge, Button, Card, Label } from '@/components/ui'
import { fmtDateShort, fmtDateTime, fmtKrw, fmtNumber } from '@/lib/format'
import { getLanguage } from '@/lib/i18n-server'
import { buildMonthlySalePlanSet } from '@/lib/tax-planning'
import { getSavedTaxPlan, savedTaxPlanProgress, type SavedTaxPlanStatus } from '@/lib/tax-plan-store'
import { getTaxPolicyState } from '@/lib/tax-policy'
import { updateSavedTaxPlanStatusAction } from '@/app/tax-planning/actions'
import { getPageCopy } from '@/lib/ui-copy'
import { Select } from '@/components/form'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const saved = getSavedTaxPlan(id)
  return { title: saved?.name ?? id }
}

const STATUS_TONE: Record<SavedTaxPlanStatus, 'neutral' | 'info' | 'success' | 'warning'> = {
  draft: 'neutral',
  reviewed: 'info',
  active: 'warning',
  completed: 'success',
  archived: 'neutral',
}

function deltaLabel(value: number, noChange: string, formatter: (amount: number) => string = fmtKrw) {
  if (Math.abs(value) < 0.5) return noChange
  return `${value > 0 ? '+' : '-'}${formatter(Math.abs(value))}`
}

export default async function SavedTaxPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const language = await getLanguage()
  const copy = getPageCopy('taxPlanning', language).savedPlanDetail
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
        eyebrow={copy.eyebrow}
        title={saved.name}
        subtitle={copy.subtitle(fmtDateShort(saved.asOfDate, language), saved.revision)}
        action={
          <Link href="/tax-planning" className="text-caption font-medium text-info hover:underline">
            {copy.backToPlanner}
          </Link>
        }
      />

      <Card
        title={copy.executionOverview}
        info={copy.executionOverviewInfo}
        className="mb-5"
        accent
        action={<Badge tone={STATUS_TONE[saved.status]}>{copy.statusLabels[saved.status]}</Badge>}
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line-subtle bg-line-subtle md:grid-cols-4">
              {[
                [copy.plannedSales, fmtKrw(saved.plan.summary.proceedsKrw)],
                [copy.estimatedTax, fmtKrw(saved.plan.summary.estimatedTaxKrw)],
                [copy.instructions, fmtNumber(progress.total)],
                [copy.complete, `${fmtNumber(progress.completionPct, 1)}%`],
              ].map(([label, value]) => (
                <div key={label} className="bg-card px-3 py-3">
                  <Label size="micro">{label}</Label>
                  <div className="mt-1 text-title font-medium tabular-nums text-ink">{value}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-pill bg-line-subtle">
              <div className="h-full bg-success" style={{ width: `${progress.completionPct}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-label text-ink-3">
              <span><strong className="font-medium text-ink">{progress.executed}</strong> {copy.executed}</span>
              <span><strong className="font-medium text-ink">{progress.reviewed}</strong> {copy.reviewed}</span>
              <span><strong className="font-medium text-ink">{progress.planned}</strong> {copy.planned}</span>
              <span><strong className="font-medium text-ink">{progress.skipped}</strong> {copy.skipped}</span>
              <span><strong className="font-medium text-ink">{fmtKrw(progress.executedProceedsKrw)}</strong> {copy.actualProceeds}</span>
            </div>
          </div>

          <form action={updateSavedTaxPlanStatusAction} className="rounded-md border border-line-subtle bg-surface p-3">
            <input type="hidden" name="planId" value={saved.id} />
            <label className="block text-micro font-medium uppercase text-ink-3" htmlFor="plan-status">
              {copy.planStatus}
            </label>
            <Select
              id="plan-status"
              name="status"
              defaultValue={saved.status} className="mt-1.5 w-full">
              <option value="draft">{copy.statusLabels.draft}</option>
              <option value="reviewed">{copy.statusLabels.reviewed}</option>
              <option value="active">{copy.statusLabels.active}</option>
              <option value="completed">{copy.statusLabels.completed}</option>
              <option value="archived">{copy.statusLabels.archived}</option>
            </Select>
            <Button type="submit" variant="solid" size="md" className="mt-2 w-full">
              {copy.updateStatus}
            </Button>
            <div className="mt-3 border-t border-line-subtle pt-2 text-micro leading-relaxed text-ink-3">
              {copy.created} {fmtDateTime(saved.createdAt)}<br />
              {copy.updated} {fmtDateTime(saved.updatedAt)}
            </div>
          </form>
        </div>
      </Card>

      <Card
        title={copy.currentDataDrift}
        info={copy.currentDataDriftInfo}
        className="mb-5"
        action={<Badge tone={changed ? 'warning' : 'success'}>{changed ? copy.reviewChanges : copy.noMaterialChange}</Badge>}
      >
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line-subtle bg-line-subtle lg:grid-cols-4">
          {[
            [copy.plannedSales, deltaLabel(drift.proceedsKrw, copy.noChange), drift.proceedsKrw],
            [copy.estimatedTax, deltaLabel(drift.estimatedTaxKrw, copy.noChange), -drift.estimatedTaxKrw],
            [copy.afterTaxCash, deltaLabel(drift.afterTaxKrw, copy.noChange), drift.afterTaxKrw],
            [copy.instructions, deltaLabel(drift.instructionCount, copy.noChange, (value) => fmtNumber(value)), -Math.abs(drift.instructionCount)],
          ].map(([label, value, toneValue]) => (
            <div key={String(label)} className="bg-card px-3 py-3">
              <Label size="micro">{label}</Label>
              <div className={`mt-1 text-title font-medium tabular-nums ${Number(toneValue) > 0 ? 'text-success' : Number(toneValue) < 0 ? 'text-warning' : 'text-ink'}`}>
                {value}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-col gap-2 text-label leading-relaxed text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {copy.driftSummary(saved.asOfDate, livePlanSet.asOfDate, saved.policyVersion, policyState.policy.version)}
          </span>
          <Link
            href={`/tax-planning?master=${saved.strategy}&pace=${saved.executionMonths}&horizon=${saved.horizonYears}`}
            className="shrink-0 font-medium text-info hover:underline"
          >
            {copy.openFreshCalculation}
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
        language={language}
      />

      <Card title={copy.snapshotProvenance} className="mb-5">
        <dl className="grid gap-x-8 gap-y-3 text-caption sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-ink-3">{copy.strategy}</dt><dd className="mt-1 text-ink">{saved.plan.label}</dd></div>
          <div><dt className="text-ink-3">{copy.executionWindow}</dt><dd className="mt-1 tabular-nums text-ink">{saved.executionMonths} {copy.months}</dd></div>
          <div><dt className="text-ink-3">{copy.taxHorizon}</dt><dd className="mt-1 tabular-nums text-ink">{saved.horizonYears} {copy.years}</dd></div>
          <div><dt className="text-ink-3">{copy.taxPolicy}</dt><dd className="mt-1 tabular-nums text-ink">{copy.version} {saved.policyVersion}</dd></div>
        </dl>
      </Card>
    </>
  )
}
