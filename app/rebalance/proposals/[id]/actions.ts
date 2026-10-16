'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  applyTargets,
  checkTargetsAgainstBounds,
  getAllocationPolicy,
  saveAllocationPolicy,
  type AllocationPolicy,
  type Sleeve,
  type SleeveTarget,
} from '@/lib/rebalance/allocation-policy'
import { buildTradePlan } from '@/lib/rebalance/engine'
import { getInstrumentClasses } from '@/lib/rebalance/instrument-classes'
import {
  editTargets,
  getProposal,
  recordFill,
  setPlan,
  transition,
  type Proposal,
} from '@/lib/rebalance/proposal-store'
import {
  approvedTargets,
  parseFillForm,
  parseSkipForm,
  parseTargetEditForm,
  type ProposalDoneCode,
  type ProposalErrorCode,
} from '@/lib/rebalance/proposal-actions'
import { policyWriteGuard } from '@/lib/rebalance/settings-form'
import { getTaxPolicyState } from '@/lib/tax-policy'

type Tab = 'summary' | 'targets' | 'plan' | 'fills'

const ID_RE = /^[A-Za-z0-9._-]+$/

function pathFor(id: string) {
  return `/rebalance/proposals/${encodeURIComponent(id)}`
}

/** Only the proposal id (a store-validated slug), the tab and a fixed code reach the URL. */
function fail(id: string, tab: Tab, code: ProposalErrorCode, detail?: unknown): never {
  if (detail !== undefined) console.error(`[rebalance-proposal] ${id} ${code}:`, detail)
  redirect(`${pathFor(id)}?tab=${tab}&error=${code}`)
}

function done(id: string, tab: Tab, code: ProposalDoneCode): never {
  revalidatePath(pathFor(id))
  revalidatePath('/rebalance')
  redirect(`${pathFor(id)}?tab=${tab}&done=${code}`)
}

function loadProposal(formData: FormData): Proposal {
  const id = String(formData.get('proposalId') ?? '')
  if (!ID_RE.test(id) || id.startsWith('.')) redirect('/rebalance?error=not_found')
  let proposal: Proposal | null = null
  try {
    proposal = getProposal(id)
  } catch (error) {
    console.error('[rebalance-proposal] load:', error)
  }
  if (!proposal) redirect('/rebalance?error=not_found')
  return proposal
}

/** The current policy, refusing an unreadable or missing one. */
function currentPolicy(id: string, tab: Tab): AllocationPolicy {
  const state = getAllocationPolicy()
  if (policyWriteGuard(state)) fail(id, tab, 'policy_unreadable', state.error)
  if (!state.policy) fail(id, tab, 'not_configured')
  return state.policy
}

function boundsCode(errors: string[]): ProposalErrorCode {
  return errors.some((e) => /is outside bounds/.test(e)) ? 'target_bounds' : 'target_shift'
}

/** The plan from the proposal's frozen input snapshot, today's tax policy and the given targets and skips. */
function rebuild(p: Proposal, policy: AllocationPolicy, targets: Record<Sleeve, SleeveTarget>, skips: string[]) {
  return buildTradePlan({
    input: p.inputSnapshot,
    policy,
    targets,
    classes: getInstrumentClasses(),
    taxPolicy: getTaxPolicyState().policy,
    skip: skips,
  })
}

export async function saveTargetEdits(formData: FormData) {
  const p = loadProposal(formData)
  if (p.status !== 'draft' || p.targetChange.decision !== 'change') fail(p.id, 'targets', 'wrong_status')
  const policy = currentPolicy(p.id, 'targets')
  const parsed = parseTargetEditForm(formData, policy, p.targetChange)
  if ('error' in parsed) fail(p.id, 'targets', parsed.error)
  try {
    editTargets(p.id, parsed.sleeves, new Date())
  } catch (error) {
    fail(p.id, 'targets', 'action_failed', error)
  }
  done(p.id, 'targets', 'targets_saved')
}

/**
 * Writes the approved targets into the policy (history by `proposal:<id>`), rebuilds the plan against
 * them from the proposal's snapshot, then moves the proposal to targets_approved.
 */
export async function approveTargets(formData: FormData) {
  const p = loadProposal(formData)
  if (p.status !== 'draft' || p.targetChange.decision !== 'change') fail(p.id, 'targets', 'wrong_status')
  const policy = currentPolicy(p.id, 'targets')
  const targets = approvedTargets(policy, p.targetChange)
  const errors = checkTargetsAgainstBounds(policy, targets, { enforceShift: true })
  if (errors.length) fail(p.id, 'targets', boundsCode(errors), errors)
  const now = new Date()
  const next = applyTargets(policy, targets, `proposal:${p.id}`, now.toISOString())
  try {
    saveAllocationPolicy(next)
  } catch (error) {
    // validateAllocationPolicy refuses targets that do not sum to 100.
    fail(p.id, 'targets', /sum to/.test(String(error)) ? 'targets_sum' : 'write_failed', error)
  }
  try {
    setPlan(p.id, rebuild(p, next, targets, p.planSkips), p.planSkips, now)
    transition(p.id, 'targets_approved', 'targets approved by the maintainer', now)
  } catch (error) {
    fail(p.id, 'targets', 'action_failed', error)
  }
  done(p.id, 'plan', 'targets_approved')
}

/** Rebuilds the plan with the checked instructions left out. */
export async function recomputePlan(formData: FormData) {
  const p = loadProposal(formData)
  if (p.status !== 'draft' && p.status !== 'targets_approved') fail(p.id, 'plan', 'wrong_status')
  const policy = currentPolicy(p.id, 'plan')
  // Once targets are approved they are the policy's; a draft change plans against the proposed ones.
  const targets =
    p.status === 'draft' && p.targetChange.decision === 'change' ? approvedTargets(policy, p.targetChange) : policy.targets
  const skips = parseSkipForm(formData)
  try {
    setPlan(p.id, rebuild(p, policy, targets, skips), skips, new Date())
  } catch (error) {
    fail(p.id, 'plan', 'action_failed', error)
  }
  done(p.id, 'plan', 'recomputed')
}

export async function approvePlan(formData: FormData) {
  const p = loadProposal(formData)
  const allowed = p.status === 'targets_approved' || (p.status === 'draft' && p.targetChange.decision === 'hold')
  if (!allowed) fail(p.id, 'plan', 'wrong_status')
  try {
    transition(p.id, 'plan_approved', 'plan approved by the maintainer', new Date())
  } catch (error) {
    fail(p.id, 'plan', 'wrong_status', error)
  }
  done(p.id, 'fills', 'plan_approved')
}

export async function rejectProposal(formData: FormData) {
  const p = loadProposal(formData)
  const tab = (String(formData.get('tab') ?? '') || 'summary') as Tab
  const safeTab: Tab = ['summary', 'targets', 'plan', 'fills'].includes(tab) ? tab : 'summary'
  const reason = String(formData.get('reason') ?? '').trim()
  if (!reason) fail(p.id, safeTab, 'reason_required')
  try {
    transition(p.id, 'rejected', reason, new Date())
  } catch (error) {
    fail(p.id, safeTab, 'wrong_status', error)
  }
  done(p.id, 'summary', 'rejected')
}

export async function recordFillAction(formData: FormData) {
  const p = loadProposal(formData)
  if (p.status !== 'plan_approved' && p.status !== 'executing') fail(p.id, 'fills', 'wrong_status')
  const parsed = parseFillForm(formData, p.plan)
  if ('error' in parsed) fail(p.id, 'fills', parsed.error)
  try {
    recordFill(p.id, parsed.fill, new Date())
  } catch (error) {
    fail(p.id, 'fills', 'action_failed', error)
  }
  done(p.id, 'fills', 'fill_recorded')
}

export async function closeProposal(formData: FormData) {
  const p = loadProposal(formData)
  if (p.status !== 'reconciled') fail(p.id, 'fills', 'wrong_status')
  try {
    transition(p.id, 'closed', 'closed by the maintainer', new Date())
  } catch (error) {
    fail(p.id, 'fills', 'wrong_status', error)
  }
  done(p.id, 'summary', 'closed')
}
