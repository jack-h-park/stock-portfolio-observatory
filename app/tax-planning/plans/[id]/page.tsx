import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTaxPlanningLots } from '@/lib/adapters/portfolio-db'
import { PageHeader } from '@/components/PageHeader'
import { TaxPlanTimeline } from '@/components/TaxPlanTimeline'
import { Badge, Card, Panel, TextLink } from '@/components/ui'
import { Split, Stat, StatStrip } from '@/components/layout'
import { ProgressBar } from '@/components/bars'
import { fmtDateShort, fmtDateTime, fmtKrw, fmtNumber, fmtPct, fmtSigned } from '@/lib/format'
import { getLanguage } from '@/lib/i18n-server'
import { buildMonthlySalePlanSet } from '@/lib/tax-planning'
import { getSavedTaxPlan, savedTaxPlanProgress, type SavedTaxPlanStatus } from '@/lib/tax-plan-store'
import { getTaxPolicyState } from '@/lib/tax-policy'
import { updateSavedTaxPlanStatusAction } from '@/app/tax-planning/actions'
import { getPageCopy, getUiCopy } from '@/lib/ui-copy'
import { Select } from '@/components/form'
import type { Metadata } from 'next'
import { SubmitButton } from '@/components/SubmitButton'
import { routeSection } from '@/lib/page-names'
import { savedPlanHeading } from '@/lib/page-headings'
import { deltaTone } from '@/lib/tone'

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
  return fmtSigned(value, formatter)
}

export default async function SavedTaxPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ saved?: string }>
}) {
  const { id } = await params
  const query = await searchParams
  const language = await getLanguage()
  const copy = getPageCopy('taxPlanning', language).savedPlanDetail
  const labels = getUiCopy(language)
  const saved = getSavedTaxPlan(id)
  if (!saved) notFound()
  const progress = savedTaxPlanProgress(saved)
  const policyState = getTaxPolicyState()
  const livePlanSet = buildMonthlySalePlanSet({
    lots: getTaxPlanningLots(5000, policyState.policy),
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
        eyebrow={routeSection('/tax-planning', language)}
        {...savedPlanHeading(saved.name)}
        subtitle={copy.subtitle(fmtDateShort(saved.asOfDate, language), saved.revision)}
        action={
          <span className="flex items-center gap-3">
            {/* createSavedTaxPlanAction has always redirected here with ?saved=1;
                until now nothing read it, so saving a plan ended in silence. */}
            {query.saved === '1' ? <Badge tone="success">{labels.form.saved}</Badge> : null}
            <TextLink href="/tax-planning">
              {copy.backToPlanner}
            </TextLink>
          </span>
        }
      />

      <Card
        title={copy.executionOverview}
        info={copy.executionOverviewInfo}
        className="mb-5"
        accent
        action={<Badge tone={STATUS_TONE[saved.status]}>{copy.statusLabels[saved.status]}</Badge>}
      >
        <Split side="18rem" at="lg" gap={5}>
          <div>
            <StatStrip columns="md-4">
              {[
                [copy.plannedSales, fmtKrw(saved.plan.summary.proceedsKrw)],
                [copy.estimatedTax, fmtKrw(saved.plan.summary.estimatedTaxKrw)],
                [copy.instructions, fmtNumber(progress.total)],
                [copy.complete, fmtPct(progress.completionPct, { digits: 1 })],
              ].map(([label, value]) => (
                <Stat key={label} label={label} value={value} />
              ))}
            </StatStrip>
            <ProgressBar pct={progress.completionPct} spacing="mt-4" />
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-label text-ink-3">
              <span><strong className="font-medium text-ink">{progress.executed}</strong> {copy.executed}</span>
              <span><strong className="font-medium text-ink">{progress.reviewed}</strong> {copy.reviewed}</span>
              <span><strong className="font-medium text-ink">{progress.planned}</strong> {copy.planned}</span>
              <span><strong className="font-medium text-ink">{progress.skipped}</strong> {copy.skipped}</span>
              <span><strong className="font-medium text-ink">{fmtKrw(progress.executedProceedsKrw)}</strong> {copy.actualProceeds}</span>
            </div>
          </div>

          <Panel as="form" pad="md" action={updateSavedTaxPlanStatusAction}>
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
            <SubmitButton variant="solid" size="md" className="mt-2 w-full">
              {copy.updateStatus}
            </SubmitButton>
            <div className="mt-3 border-t border-line-subtle pt-2 text-micro leading-relaxed text-ink-3">
              {copy.created} {fmtDateTime(saved.createdAt, language)}<br />
              {copy.updated} {fmtDateTime(saved.updatedAt, language)}
            </div>
          </Panel>
        </Split>
      </Card>

      <Card
        title={copy.currentDataDrift}
        info={copy.currentDataDriftInfo}
        className="mb-5"
        action={<Badge tone={changed ? 'warning' : 'success'}>{changed ? copy.reviewChanges : copy.noMaterialChange}</Badge>}
      >
        <StatStrip columns="lg-4">
          {[
            [copy.plannedSales, deltaLabel(drift.proceedsKrw, copy.noChange), drift.proceedsKrw],
            [copy.estimatedTax, deltaLabel(drift.estimatedTaxKrw, copy.noChange), -drift.estimatedTaxKrw],
            [copy.afterTaxCash, deltaLabel(drift.afterTaxKrw, copy.noChange), drift.afterTaxKrw],
            [copy.instructions, deltaLabel(drift.instructionCount, copy.noChange, (value) => fmtNumber(value)), -Math.abs(drift.instructionCount)],
          ].map(([label, value, toneValue]) => (
            <Stat
              key={String(label)}
              label={label}
              value={value}
              tone={deltaTone(Number(toneValue))}
            />
          ))}
        </StatStrip>
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
