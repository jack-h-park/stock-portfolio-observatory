import { getTaxPolicyState, type TaxPolicy } from '@/lib/tax-policy'
import {
  SLEEVES,
  applyTargets,
  checkTargetsAgainstBounds,
  getAllocationPolicy,
  saveAllocationPolicy,
  validateAllocationPolicy,
  type AllocationPolicy,
  type Sleeve,
  type SleeveTarget,
} from './allocation-policy'
import { buildTradePlan, type Instruction, type TradePlan } from './engine'
import { getInstrumentClasses } from './instrument-classes'
import {
  editTargets,
  getProposal,
  setPlan,
  transition,
  type Fill,
  type Proposal,
  type ProposalStatus,
  type TargetChange,
} from './proposal-store'

/**
 * Fixed codes for every way a proposal action can fail. Only these travel in a URL (`?error=<code>`);
 * the page maps each to fixed copy, and the underlying message goes to the server log.
 */
export const PROPOSAL_ERROR_CODES = [
  'not_found',
  'not_configured',
  'health_errors',
  'open_proposal_exists',
  'propose_failed',
  'policy_unreadable',
  'wrong_status',
  'unknown_instruction',
  'status_invalid',
  'quantity_invalid',
  'quantity_above_plan',
  'price_invalid',
  'date_invalid',
  'note_required',
  'reason_required',
  'number_invalid',
  'target_bounds',
  'target_shift',
  'targets_sum',
  'write_failed',
  'action_failed',
  'text_too_long',
  // The plan has no buy or sell; approving it would leave a proposal with nothing to fill or reconcile.
  'empty_plan',
  // The policy file now holds the approved targets, but the plan or status did not follow; approving again finishes it.
  'targets_saved_not_advanced',
  // The target edits are saved, but the plan was not rebuilt against them; recompute or save again.
  'targets_saved_plan_stale',
] as const
export type ProposalErrorCode = (typeof PROPOSAL_ERROR_CODES)[number]

export const PROPOSAL_DONE_CODES = [
  'created',
  'targets_saved',
  'targets_approved',
  'recomputed',
  'plan_approved',
  'rejected',
  'fill_recorded',
  'closed',
] as const
export type ProposalDoneCode = (typeof PROPOSAL_DONE_CODES)[number]

export function isProposalErrorCode(value: unknown): value is ProposalErrorCode {
  return typeof value === 'string' && (PROPOSAL_ERROR_CODES as readonly string[]).includes(value)
}

export function isProposalDoneCode(value: unknown): value is ProposalDoneCode {
  return typeof value === 'string' && (PROPOSAL_DONE_CODES as readonly string[]).includes(value)
}

/** Badge tone per status: open work is info or warning, finished is success, ended is neutral. */
export const PROPOSAL_STATUS_TONE: Record<ProposalStatus, 'neutral' | 'info' | 'success' | 'warning'> = {
  draft: 'info',
  targets_approved: 'info',
  plan_approved: 'warning',
  executing: 'warning',
  reconciled: 'success',
  closed: 'neutral',
  rejected: 'neutral',
  expired: 'neutral',
}

const text = (form: FormData, name: string) => {
  const raw = form.get(name)
  return typeof raw === 'string' ? raw.trim() : ''
}

/** A number, or null when the field is empty or not numeric. */
const num = (form: FormData, name: string) => {
  const raw = text(form, name)
  if (raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/** YYYY-MM-DD naming a real calendar day (2026-02-30 is refused). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** The longest free text (a reason or a note) a form may carry. */
export const MAX_TEXT = 500

// Matches the store's tolerance for rounding in a reported fill quantity.
const QTY_SLACK = 1.0001

/**
 * One fill from the fills form. Buys and sells need quantity, price and date; a transfer needs only a
 * date and a note; a skip needs only a note. The store validates again when it records the fill.
 */
export function parseFillForm(form: FormData, plan: TradePlan): { fill: Fill } | { error: ProposalErrorCode } {
  const instructionId = text(form, 'instructionId')
  const instruction = plan.instructions.find((i) => i.id === instructionId)
  if (!instruction) return { error: 'unknown_instruction' }
  const status = text(form, 'status')
  const note = text(form, 'note')
  if (note.length > MAX_TEXT) return { error: 'text_too_long' }

  if (status === 'skipped') {
    if (!note) return { error: 'note_required' }
    return { fill: { instructionId, status: 'skipped', quantity: null, price: null, date: null, note } }
  }
  if (status !== 'executed') return { error: 'status_invalid' }

  const date = text(form, 'date')
  if (!isIsoDate(date)) return { error: 'date_invalid' }
  if (instruction.kind === 'transfer') {
    if (!note) return { error: 'note_required' }
    return { fill: { instructionId, status: 'executed', quantity: null, price: null, date, note } }
  }

  const quantity = num(form, 'quantity')
  if (quantity === null || quantity <= 0) return { error: 'quantity_invalid' }
  if (quantity > instruction.quantity * QTY_SLACK) return { error: 'quantity_above_plan' }
  const price = num(form, 'price')
  if (price === null || price <= 0) return { error: 'price_invalid' }
  return { fill: { instructionId, status: 'executed', quantity, price, date, note } }
}

/** The policy targets with each proposed sleeve's `to` laid over them; bands are the policy's. */
export function approvedTargets(policy: AllocationPolicy, change: TargetChange): Record<Sleeve, SleeveTarget> {
  const out = structuredClone(policy.targets)
  for (const sleeve of SLEEVES) {
    const proposed = change.sleeves[sleeve]
    if (proposed) out[sleeve] = { ...out[sleeve], target: proposed.to }
  }
  return out
}

/**
 * The targets tab's edit form: one `to_<sleeve>` per sleeve and an optional `reason_<sleeve>`. The result
 * must sit inside the sleeve bounds, move no sleeve by more than the per-cycle limit from the policy, and
 * still sum to 100. Returns the sleeves that differ from the policy or were already proposed.
 */
export function parseTargetEditForm(
  form: FormData,
  policy: AllocationPolicy,
  current: TargetChange,
): { sleeves: TargetChange['sleeves'] } | { error: ProposalErrorCode } {
  const targets = structuredClone(policy.targets)
  for (const sleeve of SLEEVES) {
    const value = num(form, `to_${sleeve}`)
    if (value === null) return { error: 'number_invalid' }
    targets[sleeve] = { ...targets[sleeve], target: value }
  }
  for (const sleeve of SLEEVES) if (text(form, `reason_${sleeve}`).length > MAX_TEXT) return { error: 'text_too_long' }
  const errors = checkTargetsAgainstBounds(policy, targets, { enforceShift: true })
  if (errors.some((e) => /is outside bounds/.test(e))) return { error: 'target_bounds' }
  if (errors.length) return { error: 'target_shift' }
  const sum = SLEEVES.reduce((total, sleeve) => total + targets[sleeve].target, 0)
  if (Math.abs(sum - 100) > 0.05) return { error: 'targets_sum' }

  const sleeves: TargetChange['sleeves'] = {}
  for (const sleeve of SLEEVES) {
    const existing = current.sleeves[sleeve]
    const to = targets[sleeve].target
    if (!existing && to === policy.targets[sleeve].target) continue
    sleeves[sleeve] = {
      from: existing?.from ?? policy.targets[sleeve].target,
      to,
      reason: text(form, `reason_${sleeve}`) || existing?.reason || '',
    }
  }
  return { sleeves }
}

/** The plan tab's skip checkboxes: every distinct, non-empty `skip` value. */
export function parseSkipForm(form: FormData): string[] {
  const out: string[] = []
  for (const raw of form.getAll('skip')) {
    const id = typeof raw === 'string' ? raw.trim() : ''
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

/** The reject form's reason: required, and capped like every free-text field. */
export function parseRejectReason(form: FormData): { reason: string } | { error: ProposalErrorCode } {
  const reason = text(form, 'reason')
  if (!reason) return { error: 'reason_required' }
  if (reason.length > MAX_TEXT) return { error: 'text_too_long' }
  return { reason }
}

/** How an instruction reads to a person: side, security and account; the raw id when the plan no longer has it. */
export function describeInstruction(
  id: string,
  instructions: Instruction[],
  sideLabel: (kind: Instruction['kind']) => string,
): string {
  const label = (brokerage: string, account: string) => (brokerage ? `${brokerage} · ${account}` : account)
  const i = instructions.find((x) => x.id === id)
  if (i) {
    const security = i.kind === 'transfer' ? i.currency : `${i.market}:${i.ticker}`
    return `${sideLabel(i.kind)} ${security} · ${label(i.brokerage ?? '', i.account)}`
  }
  // A skipped instruction is no longer in the plan; its id still names it (see Instruction.id).
  const parts = id.split(':')
  const kind = parts[0] as Instruction['kind']
  const tail = kind === 'transfer' ? 1 : kind === 'buy' || kind === 'sell' ? 2 : 0
  if (!tail || parts.length < tail + 3) return id
  const key = parts.slice(1, -tail).join(':')
  const split = key.indexOf('::')
  if (split === -1) return id
  const security = parts.slice(-tail).join(':')
  return `${sideLabel(kind)} ${security} · ${label(key.slice(0, split), key.slice(split + 2))}`
}

/** The policy's most recent target change, if it is newer than `since` (an ISO timestamp). */
export function policyChangedSince(policy: AllocationPolicy, since: string): string | null {
  const head = policy.history.at(-1)
  return head && Date.parse(head.at) > Date.parse(since) ? head.at : null
}

// ---------------------------------------------------------------------------------------------------
// Proposal steps that write files. Paths are injectable so they can be tested against temp files; the
// server actions call them with the defaults and turn the outcome into a redirect.

export type ProposalPaths = { policy?: string; proposals?: string; classes?: string }
export type StepOutcome = { ok: true; proposal: Proposal } | { ok: false; code: ProposalErrorCode; detail?: unknown }

const failed = (code: ProposalErrorCode, detail?: unknown): StepOutcome => ({ ok: false, code, detail })

function readPolicy(paths: ProposalPaths): { policy: AllocationPolicy } | { code: ProposalErrorCode; detail?: unknown } {
  const state = getAllocationPolicy(paths.policy)
  if (state.error) return { code: 'policy_unreadable', detail: state.error }
  if (!state.policy) return { code: 'not_configured' }
  return { policy: state.policy }
}

function loadFor(id: string, paths: ProposalPaths): Proposal | null {
  try {
    return getProposal(id, paths.proposals)
  } catch {
    return null
  }
}

/**
 * The targets a proposal plans against: a change proposal's targets (proposed while draft, approved after)
 * laid over the policy's; a hold proposal plans against the policy's targets as they are now.
 */
export function planTargets(policy: AllocationPolicy, proposal: Proposal): Record<Sleeve, SleeveTarget> {
  return proposal.targetChange.decision === 'change' ? approvedTargets(policy, proposal.targetChange) : policy.targets
}

/** The plan from the proposal's frozen input snapshot, the given policy, targets and skips, and today's tax policy. */
export function rebuildPlan(
  proposal: Proposal,
  policy: AllocationPolicy,
  targets: Record<Sleeve, SleeveTarget>,
  skips: string[],
  paths: ProposalPaths = {},
  taxPolicy?: TaxPolicy,
): TradePlan {
  return buildTradePlan({
    input: proposal.inputSnapshot,
    policy,
    targets,
    classes: getInstrumentClasses(paths.classes),
    taxPolicy: taxPolicy ?? getTaxPolicyState().policy,
    skip: skips,
  })
}

const boundsCode = (errors: string[]): ProposalErrorCode =>
  errors.some((e) => /is outside bounds/.test(e)) ? 'target_bounds' : 'target_shift'

/**
 * Approves a change proposal's targets. The plan is rebuilt first, so a failure there leaves every file as it
 * was. Then the targets go into the policy (history by `proposal:<id>`), then the plan and the status. If
 * those last steps fail the policy already holds the targets: the code says so, and running this again
 * completes the step (the targets are then unchanged, so no second history entry is written).
 */
export function approveProposalTargets(id: string, now: Date, paths: ProposalPaths = {}, taxPolicy?: TaxPolicy): StepOutcome {
  const p = loadFor(id, paths)
  if (!p) return failed('not_found')
  if (p.status !== 'draft' || p.targetChange.decision !== 'change') return failed('wrong_status')
  const read = readPolicy(paths)
  if ('code' in read) return failed(read.code, read.detail)
  const { policy } = read
  const targets = approvedTargets(policy, p.targetChange)
  const bounds = checkTargetsAgainstBounds(policy, targets, { enforceShift: true })
  if (bounds.length) return failed(boundsCode(bounds), bounds)
  const next = applyTargets(policy, targets, `proposal:${p.id}`, now.toISOString())
  const invalid = validateAllocationPolicy(next)
  if (invalid.length) return failed(invalid.some((e) => /sum to/.test(e)) ? 'targets_sum' : 'target_bounds', invalid)

  let plan: TradePlan
  try {
    plan = rebuildPlan(p, next, targets, p.planSkips, paths, taxPolicy)
  } catch (error) {
    return failed('action_failed', error)
  }
  try {
    saveAllocationPolicy(next, paths.policy)
  } catch (error) {
    return failed('write_failed', error)
  }
  try {
    setPlan(p.id, plan, p.planSkips, now, paths.proposals)
    return { ok: true, proposal: transition(p.id, 'targets_approved', 'targets approved by the maintainer', now, paths.proposals) }
  } catch (error) {
    return failed('targets_saved_not_advanced', error)
  }
}

/** Saves edited targets on a draft change proposal and rebuilds its plan against them, so the figures follow the edits. */
export function saveProposalTargetEdits(
  id: string,
  form: FormData,
  now: Date,
  paths: ProposalPaths = {},
  taxPolicy?: TaxPolicy,
): StepOutcome {
  const p = loadFor(id, paths)
  if (!p) return failed('not_found')
  if (p.status !== 'draft' || p.targetChange.decision !== 'change') return failed('wrong_status')
  const read = readPolicy(paths)
  if ('code' in read) return failed(read.code, read.detail)
  const parsed = parseTargetEditForm(form, read.policy, p.targetChange)
  if ('error' in parsed) return failed(parsed.error)
  const edited: Proposal = { ...p, targetChange: { ...p.targetChange, sleeves: { ...p.targetChange.sleeves, ...parsed.sleeves } } }
  let plan: TradePlan
  try {
    plan = rebuildPlan(edited, read.policy, planTargets(read.policy, edited), p.planSkips, paths, taxPolicy)
  } catch (error) {
    return failed('action_failed', error)
  }
  try {
    editTargets(p.id, parsed.sleeves, now, paths.proposals)
  } catch (error) {
    return failed('action_failed', error)
  }
  try {
    return { ok: true, proposal: setPlan(p.id, plan, p.planSkips, now, paths.proposals) }
  } catch (error) {
    return failed('targets_saved_plan_stale', error)
  }
}

/**
 * Approves the plan: from targets_approved, or from draft for a hold proposal. A plan with no buy
 * or sell is refused (`empty_plan`): it could never reach reconciled, so it would hold the only
 * open slot until rejected.
 */
export function approveProposalPlan(id: string, now: Date, paths: ProposalPaths = {}): StepOutcome {
  const p = loadFor(id, paths)
  if (!p) return failed('not_found')
  const allowed = p.status === 'targets_approved' || (p.status === 'draft' && p.targetChange.decision === 'hold')
  if (!allowed) return failed('wrong_status')
  if (!p.plan.instructions.some((i) => i.kind === 'buy' || i.kind === 'sell')) return failed('empty_plan')
  try {
    return { ok: true, proposal: transition(p.id, 'plan_approved', 'plan approved by the maintainer', now, paths.proposals) }
  } catch (error) {
    return failed('wrong_status', error)
  }
}

/** Rebuilds the plan with the given instructions left out, against planTargets. */
export function recomputeProposalPlan(
  id: string,
  skips: string[],
  now: Date,
  paths: ProposalPaths = {},
  taxPolicy?: TaxPolicy,
): StepOutcome {
  const p = loadFor(id, paths)
  if (!p) return failed('not_found')
  if (p.status !== 'draft' && p.status !== 'targets_approved') return failed('wrong_status')
  const read = readPolicy(paths)
  if ('code' in read) return failed(read.code, read.detail)
  try {
    const plan = rebuildPlan(p, read.policy, planTargets(read.policy, p), skips, paths, taxPolicy)
    return { ok: true, proposal: setPlan(p.id, plan, skips, now, paths.proposals) }
  } catch (error) {
    return failed('action_failed', error)
  }
}
