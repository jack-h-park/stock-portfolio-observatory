import type { TaxPolicy } from '@/lib/tax-policy'
import type { RebalanceInput } from '@/lib/adapters/rebalance-input'
import { sanitizeBenchmarks, type BriefingContext } from '@/lib/adapters/rebalance-context'
import { accountKey, SLEEVES, type AllocationPolicy, type Sleeve } from './allocation-policy'
import { computeAllocation } from './allocation'
import type { InstrumentClasses } from './instrument-classes'
import { classify, instrumentKey } from './instrument-classes'
import { displayName, snapshotDisplayNames } from './display-names'
import { buildHarvestScenario } from './harvest'
import { prepareSellContext } from './sell-selection'
import type { Proposal } from './proposal-store'
import { loadAccountMap } from '@/scripts/account-map.mjs'

export type { BriefingContext, MacroNote } from '@/lib/adapters/rebalance-context'

export type LlmInput = {
  asOf: string
  allocation: { sleeve: Sleeve; pct: number; target: number; band: number; lower: number; upper: number; status: string }[]
  bounds: AllocationPolicy['bounds']
  positions: { alias: string; market: string; ticker: string; name: string; sleeve: Sleeve; pctOfTotal: number }[]
  /**
   * The largest instruments, each summed across accounts, with their shares already computed. The prompt tells
   * the model to quote these and never to compute a share or a sum itself: it got both wrong when left to.
   */
  concentration: {
    /** The cap applies to each position separately, never to positions combined. */
    positionCapPct: number
    top: { market: string; ticker: string; name: string; sleeve: Sleeve; pctOfTotal: number; pctOfSleeve: number }[]
  }
  /** What selling every harvestable loss lot would realize and do to the year's tax; null when there is no loss. */
  harvest: {
    totalLossKrw: number
    /** The year's tax with those sells minus without them; negative is a reduction. */
    taxEffectKrw: number
    top: { market: string; ticker: string; name: string; lossKrw: number; lotCount: number }[]
  } | null
  tax: {
    krDeductionRemainingKrw: number
    ytdKrTaxableGainKrw: number
    ytdUsShortUsd: number
    ytdUsLongUsd: number
    harvestableLossKrw: number
  }
  /** What every idea must respect; the prompt states the rules that read these. */
  constraints: {
    usTaxPerson: boolean
    washSaleBlockedBuys: { ticker: string; blockedThrough: string }[]
  }
  /**
   * The briefing context, plus the maintainer's answers to earlier proposals' questions (newest first). The prompt
   * treats the answers as standing context: a question already answered is not asked again unless something changed.
   */
  context: BriefingContext & { priorAnswers: PriorAnswer[] }
  pastDecisions: {
    id: string
    status: string
    decision: 'change' | 'hold'
    sleeves: Partial<Record<Sleeve, { from: number; to: number }>>
    rejectedReason: string | null
    editedByMaintainer: boolean
  }[]
}

/** One answered question from an earlier proposal. `date` is the day it was answered. */
export type PriorAnswer = { proposalId: string; date: string; question: string; answer: string }

const NAME_MAX = 80
const PAST_DECISIONS = 3
const REASON_MAX = 500
const MACRO_MAX = 2000
const CONCENTRATION_TOP = 10
const HARVEST_TOP = 10
/** Answers come from at most this many of the newest proposals that have any, and at most PRIOR_ANSWER_ITEMS in all. */
const PRIOR_ANSWER_PROPOSALS = 3
const PRIOR_ANSWER_ITEMS = 10
const QUESTION_MAX = 500
const ANSWER_MAX = 2000

const byCreatedDesc = (a: Proposal, b: Proposal) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)

/**
 * The newest answered questions across the newest proposals that carry answers, newest first. Both the question and
 * the answer pass through `scrub`: the answer is free text the maintainer typed.
 */
export function priorAnswers(past: Proposal[], scrub: (text: string) => string): PriorAnswer[] {
  const answered = past.filter((p) => (p.answers?.length ?? 0) > 0).sort(byCreatedDesc).slice(0, PRIOR_ANSWER_PROPOSALS)
  const out: PriorAnswer[] = []
  for (const p of answered) {
    const answers = [...(p.answers ?? [])].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.index - b.index))
    for (const a of answers) {
      out.push({
        proposalId: p.id,
        date: a.at.slice(0, 10),
        question: scrub(a.question).slice(0, QUESTION_MAX),
        answer: scrub(a.answer).slice(0, ANSWER_MAX),
      })
    }
  }
  return out.slice(0, PRIOR_ANSWER_ITEMS)
}

/** A share for the model, to one decimal place, so it quotes the figure rather than re-deriving it. */
const pct1 = (value: number) => Math.round(value * 10) / 10

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Free text that reaches the model: known account and brokerage strings (case-insensitive, longest
 * first) and account-number-shaped digit runs become [redacted]. Years, ISO dates and figures with
 * separators or decimals are kept.
 */
export function scrubText(text: string, secrets: Iterable<string>): string {
  const list = [...new Set([...secrets].map((s) => s.trim()).filter((s) => s.length >= 3))].sort((a, b) => b.length - a.length)
  let out = text
  if (list.length) {
    // Plain ASCII secrets match whole tokens, so a short one cannot mangle a word or a date;
    // anything else (punctuation, Korean) is matched as a substring.
    const pattern = list
      .map((s) => (/^[A-Za-z0-9 ]+$/.test(s) ? `(?<![A-Za-z0-9])${escapeRe(s)}(?![A-Za-z0-9])` : escapeRe(s)))
      .join('|')
    out = out.replace(new RegExp(pattern, 'gi'), '[redacted]')
  }
  // A full ISO date is its own token; otherwise digit groups joined by single spaces or dashes form one chain.
  return out.replace(/(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)|\d+(?:[ -]\d+)*/g, (match, offset: number, whole: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(match)) return match
    const before = whole[offset - 1]
    const after = whole[offset + match.length]
    const next = whole[offset + match.length + 1]
    const decimalAfter = (after === '.' || after === ',') && next !== undefined && /\d/.test(next)
    const decimalBefore = (before === '.' || before === ',') && offset >= 2 && /\d/.test(whole[offset - 2])
    if (decimalAfter || decimalBefore) return match
    const digits = match.replace(/\D/g, '').length
    return digits >= 8 || /^\d{6,}$/.test(match) || /^\d{3}-\d{2,}-\d+$/.test(match) ? '[redacted]' : match
  })
}

const MAP_FIELDS = ['alias', 'label', 'account', 'accountNumber', 'accountId'] as const

/** The owner's name in `child:<name>` (or a bare name); 'self' is not a name. */
const ownerName = (owner: unknown): string | null => {
  if (typeof owner !== 'string') return null
  const name = owner.includes(':') ? owner.slice(owner.indexOf(':') + 1) : owner
  return name.trim() && name.trim() !== 'self' ? name.trim() : null
}

/**
 * Account labels, aliases, account numbers and owner names from the host's account map. A missing or unreadable
 * map yields nothing: scrubbing is a second line of defence and must never stop the run.
 */
export function accountMapSecrets(file: string | null | undefined): string[] {
  if (!file) return []
  let map: ReturnType<typeof loadAccountMap>
  try {
    map = loadAccountMap(file)
  } catch {
    return []
  }
  const out: string[] = []
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) out.push(value)
  }
  for (const [label, entry] of Object.entries((map.accounts ?? {}) as Record<string, { owner?: unknown } | null>)) {
    add(label)
    add(ownerName(entry?.owner))
  }
  for (const list of [map.bankAccounts, map.brokerageAccounts, map.pensionAccounts] as unknown[]) {
    if (!Array.isArray(list)) continue
    for (const entry of list) {
      if (entry === null || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>
      for (const field of MAP_FIELDS) add(e[field])
      add(ownerName(e.owner))
    }
  }
  return out
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
  /** The host's account map; its labels and names join the scrub list. Omitted or unreadable: skipped. */
  accountMapPath?: string | null
}): LlmInput {
  const { input, policy, classes, context } = args
  const allocation = computeAllocation(input, policy, classes)
  const aliases = aliasMap(input.positions)
  const secrets = new Set<string>()
  for (const row of [...input.positions, ...input.lots, ...input.cash, ...input.recentBuys]) {
    if (row.brokerage) secrets.add(row.brokerage)
    if (row.account) secrets.add(row.account)
  }
  for (const key of Object.keys(input.accountDataAsOf ?? {})) {
    // accountKey is `brokerage::account`; each half is a secret on its own.
    const at = key.indexOf('::')
    for (const part of at >= 0 ? [key.slice(0, at), key.slice(at + 2)] : [key]) if (part) secrets.add(part)
  }
  for (const secret of accountMapSecrets(args.accountMapPath)) secrets.add(secret)
  const scrub = (text: string) => scrubText(text, secrets)

  // One name per instrument: the same KR code can come from two brokerages under two spellings.
  const names = snapshotDisplayNames(input)
  const nameOf = (market: string, ticker: string) => scrub(displayName(names, market, ticker)).slice(0, NAME_MAX)
  const positions: LlmInput['positions'] = []
  const byInstrument = new Map<string, { market: string; ticker: string; sleeve: Sleeve; valueKrw: number }>()
  for (const p of input.positions) {
    const sleeve = classify(p, classes)
    if (!sleeve) continue
    const value = p.valueKrw ?? p.costKrw
    positions.push({
      alias: aliases.get(`${p.market}|${accountKey(p.brokerage, p.account)}`) as string,
      market: p.market,
      ticker: p.ticker,
      name: nameOf(p.market, p.ticker),
      sleeve,
      pctOfTotal: allocation.totalKrw > 0 ? (value / allocation.totalKrw) * 100 : 0,
    })
    const key = instrumentKey(p.market, p.ticker)
    const entry = byInstrument.get(key) ?? { market: p.market, ticker: p.ticker, sleeve, valueKrw: 0 }
    entry.valueKrw += value
    byInstrument.set(key, entry)
  }
  // Same values as the allocation (at cost when unpriced), so the shares add up against input.allocation.
  const sleeveValue = new Map(allocation.sleeves.map((row) => [row.sleeve, row.valueKrw]))
  const concentration: LlmInput['concentration'] = {
    positionCapPct: policy.bounds.positionCapPct,
    top: [...byInstrument.values()]
      .sort((a, b) => b.valueKrw - a.valueKrw || a.market.localeCompare(b.market) || a.ticker.localeCompare(b.ticker))
      .slice(0, CONCENTRATION_TOP)
      .map((e) => {
        const ofSleeve = sleeveValue.get(e.sleeve) ?? 0
        return {
          market: e.market,
          ticker: e.ticker,
          name: nameOf(e.market, e.ticker),
          sleeve: e.sleeve,
          pctOfTotal: allocation.totalKrw > 0 ? pct1((e.valueKrw / allocation.totalKrw) * 100) : 0,
          pctOfSleeve: ofSleeve > 0 ? pct1((e.valueKrw / ofSleeve) * 100) : 0,
        }
      }),
  }

  // The engine's own context: same deduction assumption, same pinned planning rate.
  const ctx = prepareSellContext({ input, policy, classes, taxPolicy: args.taxPolicy })
  const scenario = buildHarvestScenario({ input, policy, classes, taxPolicy: args.taxPolicy, today: input.asOf })
  const harvestable = scenario.totalLossKrw
  const harvest: LlmInput['harvest'] =
    harvestable > 0
      ? {
          totalLossKrw: Math.round(harvestable),
          taxEffectKrw: Math.round(scenario.taxEffectKrw),
          top: scenario.rows.slice(0, HARVEST_TOP).map((r) => ({
            market: r.market,
            ticker: r.ticker,
            name: scrub(r.name).slice(0, NAME_MAX),
            lossKrw: Math.round(r.lossKrw),
            lotCount: r.lotCount,
          })),
        }
      : null

  const newest = [...args.past].sort(byCreatedDesc).slice(0, PAST_DECISIONS)
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
    concentration,
    harvest,
    tax: {
      krDeductionRemainingKrw: ctx.krDeductionRemainingKrw,
      ytdKrTaxableGainKrw: input.ytd.krTaxableGainKrw,
      ytdUsShortUsd: input.ytd.usShortUsd,
      ytdUsLongUsd: input.ytd.usLongUsd,
      harvestableLossKrw: harvestable,
    },
    constraints: {
      usTaxPerson: policy.investor?.usTaxPerson ?? false,
      washSaleBlockedBuys: (input.washSaleBlockedBuys ?? []).map((b) => ({ ticker: b.ticker, blockedThrough: b.blockedThrough })),
    },
    context: {
      macro: context.macro.map((n) => ({ date: n.date, macro: scrub(n.macro).slice(0, MACRO_MAX) })),
      benchmarks: sanitizeBenchmarks(context.benchmarks),
      priorAnswers: priorAnswers(args.past, scrub),
    },
    pastDecisions,
  }
}
