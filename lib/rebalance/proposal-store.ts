import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/config'
import type { RebalanceInput } from '@/lib/adapters/rebalance-input'
import type { AllocationPolicy, Sleeve } from '@/lib/rebalance/allocation-policy'
import type { TradePlan } from '@/lib/rebalance/engine'
import { isHarvestScenario, type HarvestScenario } from '@/lib/rebalance/harvest'
import type { LlmIdea, LlmOutlook, LlmRecord } from '@/lib/rebalance/llm-contract'

export type ProposalStatus =
  | 'draft'
  | 'targets_approved'
  | 'plan_approved'
  | 'executing'
  | 'reconciled'
  | 'closed'
  | 'rejected'
  | 'expired'
export type ProposalKind = 'monthly' | 'trigger' | 'manual'
export type TargetChange = {
  decision: 'change' | 'hold'
  sleeves: Partial<Record<Sleeve, { from: number; to: number; reason: string; editedBy?: 'maintainer' }>>
  boundsErrors: string[]
}
export type Fill = {
  instructionId: string
  status: 'executed' | 'skipped'
  quantity: number | null
  price: number | null
  date: string | null
  note: string
}
export type ProposalEvent = {
  at: string
  type:
    | 'created'
    | 'targets_edited'
    | 'targets_approved'
    | 'plan_edited'
    | 'plan_approved'
    | 'fill'
    | 'reconciled'
    | 'rejected'
    | 'expired'
    | 'closed'
    | 'trigger_appended'
    // The maintainer answered (or cleared the answer to) one of the LLM's questions. Never notified (notify.ts).
    | 'answered'
  detail: string
}
/**
 * The maintainer's answer to one of the LLM's questions. `index` is the question's position in
 * questionsForMaintainer; the question text is stored beside it so the answer still reads on its own.
 */
export type ProposalAnswer = { index: number; question: string; answer: string; at: string }
export type ReconciliationResult = {
  at: string
  matched: { instructionId: string; txDate: string }[]
  missing: { instructionId: string; daysSinceFill: number }[]
  unplanned: {
    brokerage: string | null
    account: string
    market: string
    ticker: string
    type: string
    date: string
    quantity: number
  }[]
  complete: boolean
  /** Buy and sell instruction ids with no fill record yet (executed or skipped). */
  unfilled?: string[]
}
export type Proposal = {
  schemaVersion: 1
  id: string
  kind: ProposalKind
  triggers: string[]
  status: ProposalStatus
  createdAt: string
  updatedAt: string
  expiresAt: string
  policyAtCreation: AllocationPolicy
  inputSnapshot: RebalanceInput
  outlook: LlmOutlook | null
  llm: LlmRecord | null
  ideas: LlmIdea[]
  questionsForMaintainer: string[]
  targetChange: TargetChange
  plan: TradePlan
  planSkips: string[]
  /**
   * The loss-harvest scenario at creation, when there was a harvestable loss (harvest.ts). Absent on proposals
   * written before it existed and on ones with nothing to harvest; never turned into instructions.
   */
  harvest?: HarvestScenario
  /**
   * The maintainer's answers to questionsForMaintainer, one per answered question, in question order. Absent until
   * the first answer. The next proposal's LLM input carries them (llm-input.ts `context.priorAnswers`).
   */
  answers?: ProposalAnswer[]
  fills: Record<string, Fill>
  reconciliation: ReconciliationResult | null
  events: ProposalEvent[]
}

const EXPIRY_DAYS = 7
const DAY_MS = 86_400_000
const CLOSED_STATUSES: ProposalStatus[] = ['rejected', 'expired', 'closed']
/**
 * The statuses that hold the one open slot. `reconciled` is not among them: its trades are done and matched, and only
 * the close is left, so a forgotten close must not block every later monthly or trigger proposal.
 */
export const OPEN_STATUSES: readonly ProposalStatus[] = ['draft', 'targets_approved', 'plan_approved', 'executing']
const QTY_SLACK = 1.0001
/** The longest answer to one question the maintainer may store. */
export const MAX_ANSWER = 2000

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function resolveDir(dir?: string) {
  return dir ?? config.stockRebalanceProposalsDir
}

function fileFor(dir: string, id: string) {
  if (!/^[A-Za-z0-9._-]+$/.test(id) || id.startsWith('.')) throw new Error(`Invalid proposal id: ${id}`)
  return path.join(dir, `${id}.json`)
}

function writeProposal(p: Proposal, dir: string) {
  fs.mkdirSync(dir, { recursive: true })
  const filePath = fileFor(dir, p.id)
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(p, null, 2)}\n`)
  fs.renameSync(temporaryPath, filePath)
}

export function proposalId(kind: ProposalKind, today: string, suffix?: string): string {
  if (kind === 'monthly') return `rb-${today.slice(0, 7)}`
  return `rb-${today}-${suffix ?? kind}`
}

/** Files written before the LLM fields existed read as null and empty lists. */
const OUTLOOK_LISTS = ['drivers', 'risks', 'whatWouldChangeMyView', 'sources'] as const

/** An outlook the page can render: an object whose list fields are arrays. Anything else reads as null. */
function isOutlookShape(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const o = value as Record<string, unknown>
  return OUTLOOK_LISTS.every((key) => Array.isArray(o[key]))
}

const isAnswer = (value: unknown): value is ProposalAnswer => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const a = value as Record<string, unknown>
  return (
    Number.isInteger(a.index) &&
    (a.index as number) >= 0 &&
    typeof a.question === 'string' &&
    a.question.trim() !== '' &&
    typeof a.answer === 'string' &&
    a.answer.trim() !== '' &&
    a.answer.length <= MAX_ANSWER &&
    typeof a.at === 'string' &&
    !Number.isNaN(Date.parse(a.at))
  )
}

/** Well-formed answers, one per question index (the last wins), in question order; null when none survive. */
function readAnswers(raw: unknown): ProposalAnswer[] | null {
  if (!Array.isArray(raw)) return null
  const byIndex = new Map<number, ProposalAnswer>()
  for (const entry of raw) {
    if (!isAnswer(entry)) continue
    byIndex.set(entry.index, { index: entry.index, question: entry.question, answer: entry.answer, at: entry.at })
  }
  return byIndex.size ? [...byIndex.values()].sort((a, b) => a.index - b.index) : null
}

function fromFile(text: string): Proposal {
  const p = JSON.parse(text) as Proposal
  if (!isOutlookShape(p.outlook)) p.outlook = null
  p.llm ??= null
  if (!Array.isArray(p.ideas)) p.ideas = []
  if (!Array.isArray(p.questionsForMaintainer)) p.questionsForMaintainer = []
  if (p.harvest !== undefined && !isHarvestScenario(p.harvest)) delete p.harvest
  if (p.answers !== undefined) {
    const answers = readAnswers(p.answers)
    if (answers) p.answers = answers
    else delete p.answers
  }
  return p
}

export function getProposal(id: string, dir?: string): Proposal | null {
  const filePath = fileFor(resolveDir(dir), id)
  if (!fs.existsSync(filePath)) return null
  return fromFile(fs.readFileSync(filePath, 'utf8'))
}

export function listProposals(dir?: string): Proposal[] {
  const d = resolveDir(dir)
  if (!fs.existsSync(d)) return []
  const out: Proposal[] = []
  for (const name of fs.readdirSync(d)) {
    if (!name.endsWith('.json')) continue
    try {
      out.push(fromFile(fs.readFileSync(path.join(d, name), 'utf8')))
    } catch (error) {
      // The basename only, and the error's kind rather than its message: a JSON parse message quotes the content.
      throw new Error(`Proposal file unreadable: ${name} (${(error as Error).name ?? 'Error'})`, { cause: error })
    }
  }
  // Newest first; the id breaks ties so '-2' follows its base id.
  return out.sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1))
}

export function openProposal(dir?: string): Proposal | null {
  return listProposals(dir).find((p) => OPEN_STATUSES.includes(p.status)) ?? null
}

function load(id: string, dir: string): Proposal {
  const p = getProposal(id, dir)
  if (!p) throw new Error(`Proposal not found: ${id}`)
  return p
}

function commit(p: Proposal, events: ProposalEvent[], now: Date, dir: string): Proposal {
  p.events.push(...events)
  p.updatedAt = now.toISOString()
  writeProposal(p, dir)
  return clone(p)
}

type ProposalInput = Omit<
  Proposal,
  | 'schemaVersion'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
  | 'expiresAt'
  | 'events'
  | 'fills'
  | 'reconciliation'
  | 'ideas'
  | 'questionsForMaintainer'
  | 'harvest'
  | 'answers'
> &
  Partial<Pick<Proposal, 'ideas' | 'questionsForMaintainer' | 'harvest'>>

export function createProposal(input: ProposalInput, now: Date, dir?: string): Proposal {
  const d = resolveDir(dir)
  const open = openProposal(d)
  if (open) throw new Error(`Proposal ${open.id} is still open (${open.status}); finish or reject it first.`)
  let id = input.id
  for (let n = 2; fs.existsSync(fileFor(d, id)); n += 1) id = `${input.id}-${n}`
  const at = now.toISOString()
  const p: Proposal = {
    ...clone(input),
    ideas: clone(input.ideas ?? []),
    questionsForMaintainer: [...(input.questionsForMaintainer ?? [])],
    id,
    schemaVersion: 1,
    status: 'draft',
    createdAt: at,
    updatedAt: at,
    expiresAt: new Date(now.getTime() + EXPIRY_DAYS * DAY_MS).toISOString(),
    fills: {},
    reconciliation: null,
    events: [{ at, type: 'created', detail: `${input.kind} proposal created` }],
  }
  writeProposal(p, d)
  return clone(p)
}

const EVENT_FOR: Partial<Record<ProposalStatus, ProposalEvent['type']>> = {
  targets_approved: 'targets_approved',
  plan_approved: 'plan_approved',
  reconciled: 'reconciled',
  rejected: 'rejected',
  expired: 'expired',
  closed: 'closed',
}

/** True when the plan has a buy or a sell: something to fill and reconcile. Transfers alone are not trades. */
export function planHasTrades(plan: Pick<TradePlan, 'instructions'>): boolean {
  return plan.instructions.some((i) => i.kind === 'buy' || i.kind === 'sell')
}

function assertTransition(p: Proposal, to: ProposalStatus) {
  const from = p.status
  const nothingToTrade = !planHasTrades(p.plan)
  const ok =
    (from === 'draft' && to === 'targets_approved' && p.targetChange.decision === 'change') ||
    (from === 'draft' && to === 'plan_approved' && p.targetChange.decision === 'hold') ||
    (from === 'targets_approved' && to === 'plan_approved') ||
    (from === 'plan_approved' && to === 'executing') ||
    (from === 'executing' && to === 'reconciled') ||
    (from === 'reconciled' && to === 'closed') ||
    // A plan with nothing to buy or sell can never reach reconciled; closing ends it without trades.
    (from === 'draft' && to === 'closed' && p.targetChange.decision === 'hold' && nothingToTrade) ||
    (from === 'targets_approved' && to === 'closed' && nothingToTrade) ||
    (['draft', 'targets_approved', 'plan_approved'].includes(from) && to === 'rejected') ||
    (from === 'draft' && to === 'expired')
  if (!ok) throw new Error(`Transition ${from} -> ${to} is not allowed (decision: ${p.targetChange.decision})`)
}

function transitionEvent(p: Proposal, to: ProposalStatus, detail: string, now: Date): ProposalEvent {
  assertTransition(p, to)
  const type = EVENT_FOR[to]
  const at = now.toISOString()
  // 'executing' has no event type of its own; it is recorded as a fill-driven change.
  if (!type) return { at, type: 'fill', detail: detail || `status ${p.status} -> ${to}` }
  return { at, type, detail }
}

export function transition(id: string, to: ProposalStatus, detail: string, now: Date, dir?: string): Proposal {
  const d = resolveDir(dir)
  const p = load(id, d)
  const event = transitionEvent(p, to, detail, now)
  p.status = to
  return commit(p, [event], now, d)
}

export function editTargets(id: string, sleeves: TargetChange['sleeves'], now: Date, dir?: string): Proposal {
  const d = resolveDir(dir)
  const p = load(id, d)
  if (p.status !== 'draft') throw new Error(`Targets can only be edited in draft (status: ${p.status})`)
  const names: string[] = []
  for (const [sleeve, change] of Object.entries(sleeves) as [Sleeve, NonNullable<TargetChange['sleeves'][Sleeve]>][]) {
    p.targetChange.sleeves[sleeve] = { ...change, editedBy: 'maintainer' }
    names.push(sleeve)
  }
  return commit(p, [{ at: now.toISOString(), type: 'targets_edited', detail: `edited ${names.join(', ') || 'nothing'}` }], now, d)
}

export function setPlan(id: string, plan: TradePlan, skips: string[], now: Date, dir?: string): Proposal {
  const d = resolveDir(dir)
  const p = load(id, d)
  if (p.status !== 'draft' && p.status !== 'targets_approved') throw new Error(`The plan can only be set in draft or targets_approved (status: ${p.status})`)
  p.plan = clone(plan)
  p.planSkips = [...skips]
  return commit(p, [{ at: now.toISOString(), type: 'plan_edited', detail: `${plan.instructions.length} instructions` }], now, d)
}

export function setReconciliation(id: string, result: ReconciliationResult, now: Date, dir?: string): Proposal {
  const d = resolveDir(dir)
  const p = load(id, d)
  p.reconciliation = clone(result)
  p.updatedAt = now.toISOString()
  writeProposal(p, d)
  return clone(p)
}

function validateFill(p: Proposal, fill: Fill) {
  if (p.status !== 'plan_approved' && p.status !== 'executing') throw new Error(`Fills can only be recorded once the plan is approved (status: ${p.status})`)
  const instruction = p.plan.instructions.find((i) => i.id === fill.instructionId)
  if (!instruction) throw new Error(`Unknown instruction: ${fill.instructionId}`)
  if (fill.status === 'skipped') {
    if (!fill.note.trim()) throw new Error('A skipped instruction needs a note')
    return
  }
  if (fill.status !== 'executed') throw new Error(`Invalid fill status: ${String(fill.status)}`)
  if (fill.date === null || !/^\d{4}-\d{2}-\d{2}$/.test(fill.date) || Number.isNaN(Date.parse(fill.date))) {
    throw new Error('An executed fill needs an ISO date (YYYY-MM-DD)')
  }
  if (instruction.kind === 'transfer') return
  const { quantity, price } = fill
  if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Executed quantity must be positive')
  if (quantity > instruction.quantity * QTY_SLACK) throw new Error(`Executed quantity ${quantity} exceeds the planned ${instruction.quantity}`)
  if (price === null || !Number.isFinite(price) || price <= 0) throw new Error('Executed price must be positive')
}

export function recordFill(id: string, fill: Fill, now: Date, dir?: string): Proposal {
  const d = resolveDir(dir)
  const p = load(id, d)
  validateFill(p, fill)
  const at = now.toISOString()
  const events: ProposalEvent[] = [{ at, type: 'fill', detail: `${fill.instructionId} ${fill.status}` }]
  if (p.status === 'plan_approved') {
    events.push(transitionEvent(p, 'executing', 'first fill recorded', now))
    p.status = 'executing'
  }
  p.fills[fill.instructionId] = clone(fill)
  return commit(p, events, now, d)
}

export function appendTrigger(id: string, trigger: string, now: Date, dir?: string): Proposal {
  const d = resolveDir(dir)
  const p = load(id, d)
  if (CLOSED_STATUSES.includes(p.status)) throw new Error(`Proposal is ${p.status}; triggers can no longer be added`)
  if (!p.triggers.includes(trigger)) p.triggers.push(trigger)
  return commit(p, [{ at: now.toISOString(), type: 'trigger_appended', detail: trigger }], now, d)
}

/**
 * Stores, replaces or (with an empty answer) clears the maintainer's answer to question `index`. Allowed in every
 * status, closed ones included: the answers are context for the next proposal, not a step in this one, and they
 * change nothing the proposal trades on. Throws on an unknown question or an answer over MAX_ANSWER characters.
 */
export function setAnswer(id: string, index: number, answer: string, now: Date, dir?: string): Proposal {
  const d = resolveDir(dir)
  const p = load(id, d)
  const question = Number.isInteger(index) && index >= 0 ? p.questionsForMaintainer[index] : undefined
  if (question === undefined) throw new Error(`Unknown question: ${index}`)
  const text = answer.trim()
  if (text.length > MAX_ANSWER) throw new Error(`An answer is at most ${MAX_ANSWER} characters`)
  const at = now.toISOString()
  const rest = (p.answers ?? []).filter((a) => a.index !== index)
  const next = text ? [...rest, { index, question, answer: text, at }].sort((a, b) => a.index - b.index) : rest
  if (next.length) p.answers = next
  else delete p.answers
  return commit(p, [{ at, type: 'answered', detail: `question ${index + 1} ${text ? 'answered' : 'cleared'}` }], now, d)
}

export function expireStale(now: Date, dir?: string): string[] {
  const d = resolveDir(dir)
  const expired: string[] = []
  for (const p of listProposals(d)) {
    if (p.status === 'draft' && Date.parse(p.expiresAt) <= now.getTime()) {
      transition(p.id, 'expired', 'draft not approved within 7 days', now, d)
      expired.push(p.id)
    }
  }
  return expired
}
