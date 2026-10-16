import { buildTaxPlan } from '@/lib/tax-planning'
import type { TaxPolicy } from '@/lib/tax-policy'
import type { RebalanceInput } from '@/lib/adapters/rebalance-input'
import { sanitizeBenchmarks, type BriefingContext } from '@/lib/adapters/rebalance-context'
import { accountKey, SLEEVES, type AllocationPolicy, type Sleeve } from './allocation-policy'
import { computeAllocation } from './allocation'
import type { InstrumentClasses } from './instrument-classes'
import { classify } from './instrument-classes'
import { prepareSellContext } from './sell-selection'
import type { Proposal } from './proposal-store'

export type { BriefingContext, MacroNote } from '@/lib/adapters/rebalance-context'

export type LlmInput = {
  asOf: string
  allocation: { sleeve: Sleeve; pct: number; target: number; band: number; lower: number; upper: number; status: string }[]
  bounds: AllocationPolicy['bounds']
  positions: { alias: string; market: string; ticker: string; name: string; sleeve: Sleeve; pctOfTotal: number }[]
  tax: {
    krDeductionRemainingKrw: number
    ytdKrTaxableGainKrw: number
    ytdUsShortUsd: number
    ytdUsLongUsd: number
    harvestableLossKrw: number
  }
  context: BriefingContext
  pastDecisions: {
    id: string
    status: string
    decision: 'change' | 'hold'
    sleeves: Partial<Record<Sleeve, { from: number; to: number }>>
    rejectedReason: string | null
    editedByMaintainer: boolean
  }[]
}

const NAME_MAX = 80
const PAST_DECISIONS = 3
const REASON_MAX = 500
const MACRO_MAX = 2000

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Free text that reaches the model: known account and brokerage strings (case-insensitive, longest
 * first) and account-number-shaped digit runs become [redacted]. Years, ISO dates and figures with
 * separators or decimals are kept.
 */
export function scrubText(text: string, secrets: Iterable<string>): string {
  const list = [...new Set([...secrets].map((s) => s.trim()).filter(Boolean))].sort((a, b) => b.length - a.length)
  let out = text
  if (list.length) out = out.replace(new RegExp(list.map(escapeRe).join('|'), 'gi'), '[redacted]')
  out = out.replace(/(?<!\d)\d{3}-\d{2,}-\d+/g, '[redacted]')
  return out.replace(/\d{6,}/g, (match, offset: number, whole: string) => {
    const before = whole[offset - 1]
    const after = whole[offset + match.length]
    const next = whole[offset + match.length + 1]
    const decimalAfter = (after === '.' || after === ',') && next !== undefined && /\d/.test(next)
    const decimalBefore = (before === '.' || before === ',') && offset >= 2 && /\d/.test(whole[offset - 2])
    return decimalAfter || decimalBefore ? match : '[redacted]'
  })
}

/** Per market, distinct accountKeys sorted and numbered from 1; the only account identity the LLM sees. */
function aliasMap(positions: { brokerage: string | null; account: string; market: string }[]): Map<string, string> {
  const byMarket = new Map<string, Set<string>>()
  for (const p of positions) {
    const keys = byMarket.get(p.market) ?? new Set<string>()
    keys.add(accountKey(p.brokerage, p.account))
    byMarket.set(p.market, keys)
  }
  const aliases = new Map<string, string>()
  for (const [market, keys] of byMarket) {
    ;[...keys].sort().forEach((key, index) => {
      aliases.set(`${market}|${key}`, market === 'CRYPTO' ? `CRYPTO-${index + 1}` : `${market}-taxable-${index + 1}`)
    })
  }
  return aliases
}

export function buildLlmInput(args: {
  input: RebalanceInput
  policy: AllocationPolicy
  classes: InstrumentClasses
  taxPolicy: TaxPolicy
  context: BriefingContext
  past: Proposal[]
}): LlmInput {
  const { input, policy, classes, context } = args
  const allocation = computeAllocation(input, policy, classes)
  const aliases = aliasMap(input.positions)
  const secrets = new Set<string>()
  for (const row of [...input.positions, ...input.lots, ...input.cash]) {
    if (row.brokerage) secrets.add(row.brokerage)
    if (row.account) secrets.add(row.account)
  }
  const scrub = (text: string) => scrubText(text, secrets)

  const positions: LlmInput['positions'] = []
  for (const p of input.positions) {
    const sleeve = classify(p, classes)
    if (!sleeve) continue
    const value = p.valueKrw ?? p.costKrw
    positions.push({
      alias: aliases.get(`${p.market}|${accountKey(p.brokerage, p.account)}`) as string,
      market: p.market,
      ticker: p.ticker,
      name: scrub(String(p.name ?? '')).slice(0, NAME_MAX),
      sleeve,
      pctOfTotal: allocation.totalKrw > 0 ? (value / allocation.totalKrw) * 100 : 0,
    })
  }

  // The engine's own context: same deduction assumption, same pinned planning rate.
  const ctx = prepareSellContext({ input, policy, classes, taxPolicy: args.taxPolicy })
  const plan = buildTaxPlan({ lots: input.lots, policy: ctx.taxPolicy })
  const harvestableLossKrw = plan.candidates.reduce(
    (sum, c) => (c.proceedsKrw != null && c.gainKrw != null && c.gainKrw < 0 ? sum + -c.gainKrw : sum),
    0,
  )

  const newest = [...args.past].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)).slice(0, PAST_DECISIONS)
  const pastDecisions = newest.map((p) => {
    const sleeves: LlmInput['pastDecisions'][number]['sleeves'] = {}
    let edited = false
    for (const sleeve of SLEEVES) {
      const change = p.targetChange.sleeves[sleeve]
      if (!change) continue
      sleeves[sleeve] = { from: change.from, to: change.to }
      if (change.editedBy === 'maintainer') edited = true
    }
    const rejected = [...p.events].reverse().find((e) => e.type === 'rejected')
    return {
      id: p.id,
      status: p.status,
      decision: p.targetChange.decision,
      sleeves,
      rejectedReason: rejected ? scrub(String(rejected.detail ?? '')).slice(0, REASON_MAX) : null,
      editedByMaintainer: edited,
    }
  })

  return {
    asOf: input.asOf,
    allocation: allocation.sleeves.map((s) => ({
      sleeve: s.sleeve,
      pct: s.pct,
      target: s.target,
      band: s.band,
      lower: s.lower,
      upper: s.upper,
      status: s.status,
    })),
    bounds: policy.bounds,
    positions,
    tax: {
      krDeductionRemainingKrw: ctx.krDeductionRemainingKrw,
      ytdKrTaxableGainKrw: input.ytd.krTaxableGainKrw,
      ytdUsShortUsd: input.ytd.usShortUsd,
      ytdUsLongUsd: input.ytd.usLongUsd,
      harvestableLossKrw,
    },
    context: {
      macro: context.macro.map((n) => ({ date: n.date, macro: scrub(n.macro).slice(0, MACRO_MAX) })),
      benchmarks: sanitizeBenchmarks(context.benchmarks),
    },
    pastDecisions,
  }
}
