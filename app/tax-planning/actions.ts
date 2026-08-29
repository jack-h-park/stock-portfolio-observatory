'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTaxPlanningLots } from '@/lib/adapters/portfolio-db'
import { buildMonthlySalePlanSet, type MasterPlanStrategyKey } from '@/lib/tax-planning'
import {
  createSavedTaxPlan,
  updateSavedInstructionExecution,
  updateSavedTaxPlanStatus,
  type SavedInstructionStatus,
  type SavedTaxPlanStatus,
} from '@/lib/tax-plan-store'
import { getTaxPolicyState } from '@/lib/tax-policy'

function strategy(value: FormDataEntryValue | null): MasterPlanStrategyKey {
  if (value === 'EARLIEST_LT' || value === 'STAGED' || value === 'WAIT_US_ONLY' || value === 'ACCELERATE_LOSSES') {
    return value
  }
  return 'STAGED'
}

function boundedNumber(value: FormDataEntryValue | null, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.round(parsed), min), max) : fallback
}

function optionalNumber(value: FormDataEntryValue | null) {
  if (value == null || String(value).trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function createSavedTaxPlanAction(formData: FormData) {
  const selectedStrategy = strategy(formData.get('strategy'))
  const executionMonths = boundedNumber(formData.get('executionMonths'), 24, 1, 60)
  const horizonYears = boundedNumber(formData.get('horizonYears'), 5, 1, 10)
  const policyState = getTaxPolicyState()
  const planSet = buildMonthlySalePlanSet({
    lots: getTaxPlanningLots(5000),
    policy: policyState.policy,
    selectedStrategy,
    executionMonths,
    horizonYears,
  })
  // The browser blocks an empty field with `required`, but a form can be
  // posted without one. Storing a nameless plan would leave a row that cannot
  // be told from the next one — and since #145 the tab title is the plan name,
  // a blank tab too.
  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect('/tax-planning?error=name')
  const saved = createSavedTaxPlan({
    name,
    plan: planSet.selectedPlan,
    asOfDate: planSet.asOfDate,
    horizonYears,
    policyVersion: policyState.policy.version,
    policyUpdatedAt: policyState.updatedAt,
  })
  revalidatePath('/tax-planning')
  redirect(`/tax-planning/plans/${saved.id}?saved=1`)
}

export async function updateSavedTaxPlanStatusAction(formData: FormData) {
  const id = String(formData.get('planId') ?? '')
  const rawStatus = String(formData.get('status') ?? '')
  const allowed: SavedTaxPlanStatus[] = ['draft', 'reviewed', 'active', 'completed', 'archived']
  if (!id || !allowed.includes(rawStatus as SavedTaxPlanStatus)) return
  updateSavedTaxPlanStatus({ id, status: rawStatus as SavedTaxPlanStatus })
  revalidatePath('/tax-planning')
  revalidatePath(`/tax-planning/plans/${id}`)
}

export async function updateSavedInstructionExecutionAction(formData: FormData) {
  const planId = String(formData.get('planId') ?? '')
  const instructionId = String(formData.get('instructionId') ?? '')
  const rawStatus = String(formData.get('status') ?? '')
  const allowed: SavedInstructionStatus[] = ['planned', 'reviewed', 'executed', 'skipped']
  if (!planId || !instructionId || !allowed.includes(rawStatus as SavedInstructionStatus)) return
  updateSavedInstructionExecution({
    planId,
    instructionId,
    status: rawStatus as SavedInstructionStatus,
    executedAt: String(formData.get('executedAt') ?? '') || null,
    actualProceedsKrw: optionalNumber(formData.get('actualProceedsKrw')),
    actualGainKrw: optionalNumber(formData.get('actualGainKrw')),
    note: String(formData.get('note') ?? ''),
  })
  revalidatePath('/tax-planning')
  revalidatePath(`/tax-planning/plans/${planId}`)
}
