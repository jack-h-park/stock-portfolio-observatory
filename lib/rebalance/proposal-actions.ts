import { SLEEVES, checkTargetsAgainstBounds, type AllocationPolicy, type Sleeve, type SleeveTarget } from './allocation-policy'
import type { TradePlan } from './engine'
import type { Fill, ProposalStatus, TargetChange } from './proposal-store'

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
