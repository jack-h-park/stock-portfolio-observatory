import { config } from '@/config'
import { getRebalanceInput } from '@/lib/adapters/rebalance-input'
import { getAllocationPolicy } from '@/lib/rebalance/allocation-policy'
import { buildTradePlan } from '@/lib/rebalance/engine'
import { getInstrumentClasses } from '@/lib/rebalance/instrument-classes'
import { createProposal, expireStale, openProposal, proposalId, type Proposal, type ProposalKind } from '@/lib/rebalance/proposal-store'
import { getTaxPolicyState } from '@/lib/tax-policy'

export type ProposeResult =
  | { ok: true; proposal: Proposal }
  | { ok: false; reason: 'not_configured' | 'health_errors' | 'open_proposal_exists'; detail: string; openId?: string }

/** The P0 proposal: no target change (hold), and the plan the engine builds for today's targets. */
export function proposeEngineOnly(args: {
  kind: ProposalKind
  triggers: string[]
  today: string
  now: Date
  paths?: { policy?: string; classes?: string; proposals?: string; db?: string }
}): ProposeResult {
  const paths = args.paths ?? {}
  const dir = paths.proposals ?? config.stockRebalanceProposalsDir
  // A draft past its expiry must not block a new proposal.
  expireStale(args.now, dir)
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
  const policy = state.policy

  const input = getRebalanceInput(args.today, paths.db ?? config.stockDbPath)
  if (input.healthErrors.length) {
    return { ok: false, reason: 'health_errors', detail: `Failing error checks: ${input.healthErrors.join(', ')}` }
  }

  const plan = buildTradePlan({
    input,
    policy,
    targets: policy.targets,
    classes: getInstrumentClasses(paths.classes ?? config.stockInstrumentClassesPath),
    taxPolicy: getTaxPolicyState().policy,
  })
  const proposal = createProposal(
    {
      id: proposalId(args.kind, args.today),
      kind: args.kind,
      triggers: args.triggers,
      policyAtCreation: policy,
      inputSnapshot: input,
      outlook: null,
      llm: null,
      targetChange: { decision: 'hold', sleeves: {}, boundsErrors: [] },
      plan,
      planSkips: [],
    },
    args.now,
    dir
  )
  return { ok: true, proposal }
}
