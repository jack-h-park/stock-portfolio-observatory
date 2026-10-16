'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getProposal, recordFill, transition, type Proposal } from '@/lib/rebalance/proposal-store'
import {
  approveProposalPlan,
  approveProposalTargets,
  parseFillForm,
  parseRejectReason,
  parseSkipForm,
  recomputeProposalPlan,
  saveProposalTargetEdits,
  type ProposalDoneCode,
  type ProposalErrorCode,
  type StepOutcome,
} from '@/lib/rebalance/proposal-actions'

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

function finish(id: string, tab: Tab, outcome: StepOutcome, doneTab: Tab, code: ProposalDoneCode): never {
  if (!outcome.ok) fail(id, tab, outcome.code, outcome.detail ?? outcome.code)
  done(id, doneTab, code)
}

export async function saveTargetEdits(formData: FormData) {
  const p = loadProposal(formData)
  finish(p.id, 'targets', saveProposalTargetEdits(p.id, formData, new Date()), 'targets', 'targets_saved')
}

/** Rebuilds the plan against the approved targets, writes them to the policy, then advances the proposal. */
export async function approveTargets(formData: FormData) {
  const p = loadProposal(formData)
  finish(p.id, 'targets', approveProposalTargets(p.id, new Date()), 'plan', 'targets_approved')
}

/** Rebuilds the plan with the checked instructions left out. */
export async function recomputePlan(formData: FormData) {
  const p = loadProposal(formData)
  finish(p.id, 'plan', recomputeProposalPlan(p.id, parseSkipForm(formData), new Date()), 'plan', 'recomputed')
}

export async function approvePlan(formData: FormData) {
  const p = loadProposal(formData)
  finish(p.id, 'plan', approveProposalPlan(p.id, new Date()), 'fills', 'plan_approved')
}

export async function rejectProposal(formData: FormData) {
  const p = loadProposal(formData)
  const tab = (String(formData.get('tab') ?? '') || 'summary') as Tab
  const safeTab: Tab = ['summary', 'targets', 'plan', 'fills'].includes(tab) ? tab : 'summary'
  const parsed = parseRejectReason(formData)
  if ('error' in parsed) fail(p.id, safeTab, parsed.error)
  try {
    transition(p.id, 'rejected', parsed.reason, new Date())
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
