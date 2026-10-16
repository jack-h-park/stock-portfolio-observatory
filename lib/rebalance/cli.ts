import { config } from '@/config'
import { portfolioToday } from '@/lib/adapters/portfolio-db'
import { loadTransactions, reconcile } from '@/lib/rebalance/reconcile'
import { runnerFromConfig, type LlmRunner } from '@/lib/rebalance/llm-runner'
import { proposeEngineOnly, proposeMonthly } from '@/lib/rebalance/propose'
import { expireStale, listProposals, openProposal, setReconciliation, transition, type ProposalKind } from '@/lib/rebalance/proposal-store'

export const SCHEMA_VERSION = 1
const KINDS: ProposalKind[] = ['manual', 'trigger', 'monthly']
const COMMANDS = ['propose', 'reconcile', 'status'] as const
type Command = (typeof COMMANDS)[number]

type Io = { out: (text: string) => void; err: (text: string) => void }
type Parsed = { command: Command; kind: ProposalKind; triggers: string[]; today: string | null; noLlm: boolean }
const USAGE =
  'usage: rebalance-cli <propose|reconcile|status> [--kind manual|trigger|monthly] [--trigger <text>] [--today YYYY-MM-DD] [--no-llm]'

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
 * Runs one command and returns the exit code: 0 ran (an LLM fallback to hold and an open-proposal refusal
 * included), 1 could not run (not configured, health errors, unreadable store, unexpected error), 2 usage.
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
      const result =
        parsed.kind === 'monthly' && !parsed.noLlm
          ? await proposeMonthly({
              today,
              now,
              runner: deps.runner ?? runnerFromConfig(),
              triggers: parsed.triggers.length ? parsed.triggers : undefined,
            })
          : proposeEngineOnly({ kind: parsed.kind, triggers: parsed.triggers, today, now })
      if (!result.ok) {
        emit({ ok: false, reason: result.reason, detail: result.detail, openId: result.openId ?? null })
        return result.reason === 'open_proposal_exists' ? 0 : 1
      }
      const p = result.proposal
      const llm = p.llm ? { status: p.llm.status, reason: p.llm.reason, attempts: p.llm.attempts.length } : null
      emit({ ok: true, id: p.id, status: p.status, decision: p.targetChange.decision, instructions: p.plan.instructions.length, warnings: p.plan.warnings.length, llm, path: `/rebalance/proposals/${p.id}` })
      return 0
    }
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
