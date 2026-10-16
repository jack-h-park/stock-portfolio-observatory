import { config } from '@/config'
import { portfolioToday } from '@/lib/adapters/portfolio-db'
import { getRebalanceInput } from '@/lib/adapters/rebalance-input'
import { refreshLockHeld } from '@/lib/cli/common'
import { getTaxPolicyState } from '@/lib/tax-policy'
import { getAllocationPolicy } from '@/lib/rebalance/allocation-policy'
import { getInstrumentClasses } from '@/lib/rebalance/instrument-classes'
import { loadTransactions, reconcile } from '@/lib/rebalance/reconcile'
import { KNOWN_RUNNERS, runnerFromConfig, type LlmRunner } from '@/lib/rebalance/llm-runner'
import { proposeEngineOnly, proposeMonthly, skippedLlm } from '@/lib/rebalance/propose'
import { appendTrigger, expireStale, listProposals, openProposal, setReconciliation, transition, type ProposalKind } from '@/lib/rebalance/proposal-store'
import { dueTriggers, markFired, readTriggerState, writeTriggerState } from '@/lib/rebalance/trigger-state'
import { detectTriggers, triggerKind } from '@/lib/rebalance/triggers'

export const SCHEMA_VERSION = 1
const KINDS: ProposalKind[] = ['manual', 'trigger', 'monthly']
const COMMANDS = ['propose', 'reconcile', 'status', 'triggers'] as const
type Command = (typeof COMMANDS)[number]

type Io = { out: (text: string) => void; err: (text: string) => void }
type Parsed = { command: Command; kind: ProposalKind; triggers: string[]; today: string | null; noLlm: boolean }
const USAGE =
  'usage: rebalance-cli <propose|reconcile|status|triggers> [--kind manual|trigger|monthly] [--trigger <text>] [--today YYYY-MM-DD] [--no-llm]'

/** Today in the portfolio calendar (STOCK_TIME_ZONE), the same day the pages use. */
export function defaultToday(now: Date): string {
  return portfolioToday(now)
}

function parse(argv: string[]): Parsed | string {
  const [command, ...rest] = argv
  if (!command || !(COMMANDS as readonly string[]).includes(command)) {
    return `unknown command: ${command ?? '(none)'}; expected one of ${COMMANDS.join(', ')}`
  }
  const parsed: Parsed = { command: command as Command, kind: 'manual', triggers: [], today: null, noLlm: false }
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i]
    const value = rest[i + 1]
    if (flag === '--no-llm') {
      parsed.noLlm = true
      continue
    }
    if (flag !== '--kind' && flag !== '--trigger' && flag !== '--today') return `unknown option: ${flag}`
    if (value === undefined || value.startsWith('--')) return `${flag} needs a value`
    i += 1
    if (flag === '--kind') {
      if (!(KINDS as string[]).includes(value)) return `--kind must be one of ${KINDS.join(', ')}`
      parsed.kind = value as ProposalKind
    } else if (flag === '--trigger') {
      parsed.triggers.push(value)
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) return '--today must be YYYY-MM-DD'
      parsed.today = value
    }
  }
  return parsed
}

/**
 * Runs one command and returns the exit code: 0 ran (an LLM fallback to hold, an open-proposal refusal, and a
 * triggers run skipped for a refresh or blocked by health errors included), 1 could not run (not configured, health errors, unreadable store, unexpected error), 2 usage.
 * `deps.runner` replaces the configured LLM runner (tests).
 */
export async function runRebalanceCli(argv: string[], io: Io, now: Date = new Date(), deps: { runner?: LlmRunner } = {}): Promise<number> {
  const parsed = parse(argv)
  if (typeof parsed === 'string') {
    io.err(`${parsed}\n${USAGE}\n`)
    return 2
  }
  const emit = (payload: Record<string, unknown>) =>
    io.out(`${JSON.stringify({ schemaVersion: SCHEMA_VERSION, ok: payload.ok, command: parsed.command, ...payload })}\n`)
  const today = parsed.today ?? defaultToday(now)
  try {
    if (parsed.command === 'propose') {
      const useLlm = parsed.kind === 'monthly' && !parsed.noLlm
      const configured = config.stockRebalanceLlmRunner
      if (useLlm && !(KNOWN_RUNNERS as readonly string[]).includes(configured)) {
        // stderr only: stdout stays the one JSON line the job parses.
        io.err(`warning: STOCK_REBALANCE_LLM_RUNNER=${JSON.stringify(configured.slice(0, 40))} is not one of ${KNOWN_RUNNERS.join(', ')}; using claude\n`)
      }
      const result =
        useLlm
          ? await proposeMonthly({
              today,
              now,
              runner: deps.runner ?? runnerFromConfig(),
              triggers: parsed.triggers.length ? parsed.triggers : undefined,
            })
          : proposeEngineOnly({
              kind: parsed.kind,
              triggers: parsed.triggers,
              today,
              now,
              llm: parsed.kind === 'monthly' ? skippedLlm() : null,
            })
      if (!result.ok) {
        emit({ ok: false, reason: result.reason, detail: result.detail, openId: result.openId ?? null })
        return result.reason === 'open_proposal_exists' ? 0 : 1
      }
      const p = result.proposal
      const llm = p.llm ? { status: p.llm.status, reason: p.llm.reason, attempts: p.llm.attempts.length } : null
      emit({ ok: true, id: p.id, status: p.status, decision: p.targetChange.decision, instructions: p.plan.instructions.length, warnings: p.plan.warnings.length, llm, path: `/rebalance/proposals/${p.id}` })
      return 0
    }
    if (parsed.command === 'triggers') return runTriggers(today, now, emit)
    if (parsed.command === 'reconcile') {
      const expired = expireStale(now)
      const reconciled: { id: string; complete: boolean; matched: number; missing: number; unfilled: number; unplanned: number }[] = []
      const failed: { id: string; error: string }[] = []
      for (const p of listProposals().filter((item) => item.status === 'executing')) {
        try {
          const result = reconcile(p, loadTransactions(p.createdAt.slice(0, 10), config.stockDbPath), today, now)
          setReconciliation(p.id, result, now)
          if (result.complete) transition(p.id, 'reconciled', 'every instruction filled and every executed fill matched a transaction', now)
          reconciled.push({ id: p.id, complete: result.complete, matched: result.matched.length, missing: result.missing.length, unfilled: result.unfilled?.length ?? 0, unplanned: result.unplanned.length })
        } catch (error) {
          failed.push({ id: p.id, error: (error as Error).message })
        }
      }
      emit({ ok: failed.length === 0, expired, reconciled, failed })
      return failed.length ? 1 : 0
    }
    const open = openProposal()
    if (!open) {
      emit({ ok: true, open: null })
      return 0
    }
    emit({
      ok: true,
      open: {
        id: open.id,
        status: open.status,
        kind: open.kind,
        instructions: open.plan.instructions.length,
        fills: Object.keys(open.fills).length,
        warnings: open.plan.warnings.length,
        expiresAt: open.expiresAt,
        path: `/rebalance/proposals/${open.id}`,
      },
    })
    return 0
  } catch (error) {
    emit({ ok: false, reason: 'error', detail: (error as Error).message })
    return 1
  }
}

/**
 * Detects the trigger conditions, keeps the ones the debounce lets through, and acts on them once: appended to
 * the open proposal, or a new engine-only trigger proposal (never an LLM call). The state records them as fired
 * only after that write succeeded, so a failed run retries them next time.
 */
function runTriggers(today: string, now: Date, emit: (payload: Record<string, unknown>) => void): number {
  // A refresh is rewriting the database: try again on the next run rather than read it half-written.
  if (refreshLockHeld()) {
    emit({ ok: true, skipped: 'refresh_in_progress' })
    return 0
  }
  const policyState = getAllocationPolicy(config.stockAllocationPolicyPath)
  if (!policyState.policy) {
    emit({
      ok: false,
      reason: 'not_configured',
      detail: policyState.error ?? 'No allocation policy is configured; copy data/allocation-policy.example.json to data/allocation-policy.json.',
    })
    return 1
  }
  const policy = policyState.policy
  const input = getRebalanceInput(today, config.stockDbPath)
  if (input.healthErrors.length) {
    emit({ ok: true, blocked: 'health_errors' })
    return 0
  }
  const hits = detectTriggers({
    input,
    policy,
    classes: getInstrumentClasses(config.stockInstrumentClassesPath),
    taxPolicy: getTaxPolicyState().policy,
    today,
  })
  const state = readTriggerState()
  const due = dueTriggers(hits, state, today)
  const keys = due.map((hit) => hit.key)
  if (!due.length) {
    emit({ ok: true, due: [] })
    return 0
  }

  // A draft past its expiry is not open: the triggers start a new proposal instead.
  expireStale(now)
  const open = openProposal()
  if (open) {
    for (const hit of due) appendTrigger(open.id, `${hit.key}: ${hit.label}`, now)
    writeTriggerState(markFired(state, due, today))
    emit({ ok: true, appendedTo: open.id, due: keys })
    return 0
  }
  const result = proposeEngineOnly({ kind: 'trigger', triggers: keys, today, now, suffix: triggerKind(keys[0]) })
  if (!result.ok) {
    emit({ ok: false, reason: result.reason, detail: result.detail, openId: result.openId ?? null })
    return 1
  }
  writeTriggerState(markFired(state, due, today))
  emit({ ok: true, created: result.proposal.id, due: keys })
  return 0
}
