import { config } from '@/config'
import { getRebalanceInput, type RebalanceInput } from '@/lib/adapters/rebalance-input'
import { readBriefingContext } from '@/lib/adapters/rebalance-context'
import { getAllocationPolicy, SLEEVES, type AllocationPolicy, type Sleeve, type SleeveTarget } from '@/lib/rebalance/allocation-policy'
import { buildTradePlan } from '@/lib/rebalance/engine'
import { getInstrumentClasses, type InstrumentClasses } from '@/lib/rebalance/instrument-classes'
import { parseLlmJson, validateLlmOutput, type LlmOutput, type LlmRecord } from '@/lib/rebalance/llm-contract'
import { buildLlmInput } from '@/lib/rebalance/llm-input'
import { buildPrompt } from '@/lib/rebalance/llm-prompt'
import type { LlmRunner } from '@/lib/rebalance/llm-runner'
import {
  createProposal,
  expireStale,
  listProposals,
  openProposal,
  proposalId,
  type Proposal,
  type ProposalKind,
  type TargetChange,
} from '@/lib/rebalance/proposal-store'
import { getTaxPolicyState } from '@/lib/tax-policy'

export type ProposeResult =
  | { ok: true; proposal: Proposal }
  | { ok: false; reason: 'not_configured' | 'health_errors' | 'open_proposal_exists'; detail: string; openId?: string }

type ProposePaths = { policy?: string; classes?: string; proposals?: string; db?: string }
type Prepared = { ok: true; dir: string; policy: AllocationPolicy; input: RebalanceInput; classes: InstrumentClasses }

const MAX_LLM_ATTEMPTS = 2
const DEFAULT_TIMEOUT_MS = 600_000
const ERROR_MAX = 500
const SAME = 1e-9
const hold = (): TargetChange => ({ decision: 'hold', sleeves: {}, boundsErrors: [] })

/** The checks every proposal shares, then the snapshot. A failure returns before anything else runs. */
function prepare(today: string, now: Date, paths: ProposePaths): Prepared | Extract<ProposeResult, { ok: false }> {
  const dir = paths.proposals ?? config.stockRebalanceProposalsDir
  // A draft past its expiry must not block a new proposal.
  expireStale(now, dir)
  const open = openProposal(dir)
  if (open) {
    return { ok: false, reason: 'open_proposal_exists', detail: `Proposal ${open.id} is still open (${open.status}).`, openId: open.id }
  }

  const state = getAllocationPolicy(paths.policy ?? config.stockAllocationPolicyPath)
  if (!state.policy) {
    return {
      ok: false,
      reason: 'not_configured',
      detail: state.error ?? 'No allocation policy is configured; copy data/allocation-policy.example.json to data/allocation-policy.json.',
    }
  }

  const input = getRebalanceInput(today, paths.db ?? config.stockDbPath)
  if (input.healthErrors.length) {
    return { ok: false, reason: 'health_errors', detail: `Failing error checks: ${input.healthErrors.join(', ')}` }
  }
  return { ok: true, dir, policy: state.policy, input, classes: getInstrumentClasses(paths.classes ?? config.stockInstrumentClassesPath) }
}

/** The P0 proposal: no target change (hold), and the plan the engine builds for today's targets. */
export function proposeEngineOnly(args: {
  kind: ProposalKind
  triggers: string[]
  today: string
  now: Date
  paths?: ProposePaths
}): ProposeResult {
  const prep = prepare(args.today, args.now, args.paths ?? {})
  if (!prep.ok) return prep
  const { dir, policy, input, classes } = prep
  const plan = buildTradePlan({ input, policy, targets: policy.targets, classes, taxPolicy: getTaxPolicyState().policy })
  const proposal = createProposal(
    {
      id: proposalId(args.kind, args.today),
      kind: args.kind,
      triggers: args.triggers,
      policyAtCreation: policy,
      inputSnapshot: input,
      outlook: null,
      llm: null,
      targetChange: hold(),
      plan,
      planSkips: [],
    },
    args.now,
    dir
  )
  return { ok: true, proposal }
}

type Judgment = { record: LlmRecord; output: LlmOutput | null; targets: Record<Sleeve, SleeveTarget> | null }

/** Up to two attempts; the second is told what the first got wrong. A throw or timeout ends it at once. */
async function judge(runner: LlmRunner, prompt: (errors?: string[]) => string, policy: AllocationPolicy, model: string | null, timeoutMs: number): Promise<Judgment> {
  const record: LlmRecord = { status: 'failed', runner: runner.name, model, attempts: [], reason: null }
  let available = false
  try {
    available = runner.available()
  } catch {
    available = false
  }
  if (!available) return { record: { ...record, reason: 'runner_unavailable' }, output: null, targets: null }

  let previousErrors: string[] | undefined
  for (let attempt = 0; attempt < MAX_LLM_ATTEMPTS; attempt += 1) {
    const text = prompt(previousErrors)
    let raw: string
    try {
      const result = await runner.run(text, { model, timeoutMs })
      raw = result.raw
      if (result.model) record.model = result.model
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'LlmTimeoutError'
      const message = error instanceof Error ? error.message : String(error)
      record.attempts.push({ prompt: text, raw: '', errors: [`runner: ${message.slice(0, ERROR_MAX)}`] })
      return { record: { ...record, reason: timedOut ? 'timeout' : 'runner_failed' }, output: null, targets: null }
    }
    const parsed = parseLlmJson(raw)
    const verdict = parsed === null ? { ok: false as const, errors: ['output: no JSON object found'] } : validateLlmOutput(parsed, policy)
    record.attempts.push({ prompt: text, raw, errors: verdict.ok ? [] : verdict.errors })
    if (verdict.ok) return { record: { ...record, status: 'ok' }, output: verdict.output, targets: verdict.targets }
    previousErrors = verdict.errors
  }
  return { record: { ...record, reason: 'invalid_output' }, output: null, targets: null }
}

/** Only sleeves whose target actually moved; none moved is a hold. */
function targetChangeFrom(output: LlmOutput, targets: Record<Sleeve, SleeveTarget>, policy: AllocationPolicy): TargetChange {
  if (output.targetChange.decision !== 'change') return hold()
  const sleeves: TargetChange['sleeves'] = {}
  for (const sleeve of SLEEVES) {
    const proposed = output.targetChange.sleeves[sleeve]
    const from = policy.targets[sleeve].target
    const to = targets[sleeve].target
    if (proposed && Math.abs(to - from) > SAME) sleeves[sleeve] = { from, to, reason: proposed.reason }
  }
  return Object.keys(sleeves).length ? { decision: 'change', sleeves, boundsErrors: [] } : hold()
}

/**
 * The monthly proposal: the same checks and snapshot as the engine-only one, then the LLM's judgment.
 * Any LLM failure still creates the proposal, with targets held and the reason recorded.
 */
export async function proposeMonthly(args: {
  today: string
  now: Date
  runner: LlmRunner
  model?: string | null
  timeoutMs?: number
  paths?: ProposePaths
  contextDir?: string
  triggers?: string[]
}): Promise<ProposeResult> {
  const prep = prepare(args.today, args.now, args.paths ?? {})
  if (!prep.ok) return prep
  const { dir, policy, input, classes } = prep
  const taxPolicy = getTaxPolicyState().policy

  const model = args.model !== undefined ? args.model : config.stockRebalanceLlmModel || null
  const configured = Number(config.stockRebalanceLlmTimeoutMs)
  const timeoutMs = args.timeoutMs ?? (Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS)

  const llmInput = buildLlmInput({
    input,
    policy,
    classes,
    taxPolicy,
    context: readBriefingContext(args.today, undefined, args.contextDir),
    past: listProposals(dir),
  })
  const { record, output, targets } = await judge(args.runner, (errors) => buildPrompt(llmInput, errors), policy, model, timeoutMs)

  const targetChange = output && targets ? targetChangeFrom(output, targets, policy) : hold()
  const plan = buildTradePlan({
    input,
    policy,
    targets: targetChange.decision === 'change' && targets ? targets : policy.targets,
    classes,
    taxPolicy,
  })
  const proposal = createProposal(
    {
      id: proposalId('monthly', args.today),
      kind: 'monthly',
      triggers: args.triggers ?? ['monthly'],
      policyAtCreation: policy,
      inputSnapshot: input,
      outlook: output?.outlook ?? null,
      llm: record,
      ideas: output?.ideas ?? [],
      questionsForMaintainer: output?.questionsForMaintainer ?? [],
      targetChange,
      plan,
      planSkips: [],
    },
    args.now,
    dir
  )
  return { ok: true, proposal }
}
