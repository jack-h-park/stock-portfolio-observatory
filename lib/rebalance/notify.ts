import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/config'
import type { Proposal } from './proposal-store'

export type NotifyChannel = 'telegram' | 'discord'
export type NotifyEvent = {
  /** `${proposalId}:${kind}:${detail}`, stable across runs. */
  id: string
  proposalId: string
  kind: 'created' | 'status_changed' | 'reminder' | 'reconcile_mismatch' | 'llm_failed'
  /** Status name, count or reason code. */
  detail: string
  /** The channels this event has not yet been sent on. */
  channels: NotifyChannel[]
  telegram: string | null
  discord: string | null
  threadTitle: string | null
  threadPrompt: string | null
}
/** eventId -> ISO time it was sent, per channel. Host-owned, never pushed. */
export type NotifyState = { version: 1; seeded: boolean; announced: Record<string, { telegram?: string; discord?: string }> }

const DAY_MS = 86_400_000
export const REMINDER_DAYS = 3
const STATUS_EVENTS = ['targets_approved', 'plan_approved', 'reconciled', 'rejected', 'expired', 'closed'] as const
const STATUS_TEXT: Record<string, string> = {
  targets_approved: 'targets approved',
  plan_approved: 'plan approved',
  executing: 'executing',
  reconciled: 'reconciled',
  closed: 'closed',
  rejected: 'rejected',
  expired: 'expired',
}

const pagePath = (id: string) => `/rebalance/proposals/${id}`

/** Instruction counts by kind, the plan's tax effect to the nearest 10,000 KRW and warning counts: no account labels. */
function threadPrompt(p: Proposal): string {
  const counts = (items: string[]) => {
    const n: Record<string, number> = {}
    for (const item of items) n[item] = (n[item] ?? 0) + 1
    return Object.entries(n).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'
  }
  // A sleeve entry without both ends (a partial or hand-edited record) is left out rather than printed as "undefined%".
  const sleeves = Object.entries(p.targetChange.sleeves)
    .filter(([, c]) => Number.isFinite(c?.from) && Number.isFinite(c?.to))
    .map(([sleeve, c]) => `${sleeve} ${c?.from}% -> ${c?.to}%`)
    .join('; ')
  const tax = Math.round(p.plan.taxSummary.estimatedTaxKrw / 10_000) * 10_000
  const lines = [
    `Proposal ${p.id} (${p.kind}); triggers: ${p.triggers.join(', ') || 'none'}.`,
    `Decision: ${p.targetChange.decision}${sleeves ? ` (${sleeves})` : ''}.`,
    p.outlook ? `Outlook (${p.outlook.confidence} confidence): ${p.outlook.summary.slice(0, 600)}` : 'Outlook: none.',
    `Instructions by kind: ${counts(p.plan.instructions.map((i) => i.kind))}.`,
    `Estimated tax effect of the plan: about ${tax} KRW.`,
    `Warnings by code: ${counts(p.plan.warnings.map((w) => w.code))}.`,
    `Page: ${pagePath(p.id)}`,
    'Write a short opening (≤ 1,200 chars) for the maintainer: what this proposal suggests and why, what to check first, and that approval happens on the page. Do not invent figures. This is not advice.',
  ]
  return lines.join('\n')
}

function threadTitle(p: Proposal): string {
  const d = new Date(p.createdAt)
  return `⏳ ${d.getUTCMonth() + 1}/${d.getUTCDate()} · Rebalance ${p.id}`
}

function ev(p: Proposal, kind: NotifyEvent['kind'], detail: string, channels: NotifyChannel[], rest: Partial<NotifyEvent>): NotifyEvent {
  return {
    id: `${p.id}:${kind}:${detail}`,
    proposalId: p.id,
    kind,
    detail,
    channels,
    telegram: null,
    discord: null,
    threadTitle: null,
    threadPrompt: null,
    ...rest,
  }
}

/** Every event the proposals imply, with the channels each is meant for, before the state filters them. */
function allEvents(proposals: Proposal[], now: Date, announcedMismatch: (id: string) => number): NotifyEvent[] {
  const out: NotifyEvent[] = []
  for (const p of proposals) {
    out.push(
      ev(p, 'created', 'new', ['telegram', 'discord'], {
        telegram: `🧭 Rebalance proposal ${p.id} (${p.kind}) is ready for review — ${p.plan.instructions.length} instructions, decision ${p.targetChange.decision}. Discuss in its Discord thread; approve on ${pagePath(p.id)}.`,
        threadTitle: threadTitle(p),
        threadPrompt: threadPrompt(p),
      }),
    )
    if (p.kind === 'monthly' && p.llm?.status === 'failed') {
      out.push(
        ev(p, 'llm_failed', p.llm.reason ?? 'unknown', ['telegram'], {
          telegram: `⚠️ Rebalance ${p.id}: LLM step failed (${p.llm.reason ?? 'unknown'}); targets held, engine plan only.`,
        }),
      )
    }
    const seen = new Set<string>()
    for (const e of p.events) {
      const status = (STATUS_EVENTS as readonly string[]).includes(e.type) ? e.type : e.type === 'fill' ? 'executing' : null
      if (!status || seen.has(status)) continue
      seen.add(status)
      const expired = status === 'expired'
      out.push(
        ev(p, 'status_changed', status, expired ? ['telegram', 'discord'] : ['discord'], {
          discord: `Status → ${STATUS_TEXT[status]}.`,
          telegram: expired ? `⌛ Rebalance ${p.id} expired without approval.` : null,
        }),
      )
    }
    if (p.status === 'draft' && now.getTime() - Date.parse(p.createdAt) >= REMINDER_DAYS * DAY_MS) {
      out.push(
        ev(p, 'reminder', 'draft3d', ['discord'], {
          discord: `Reminder: this proposal has been in draft for ${REMINDER_DAYS} days; it expires on ${p.expiresAt.slice(0, 10)}.`,
        }),
      )
    }
    const missing = p.reconciliation?.missing.length ?? 0
    if (missing > announcedMismatch(p.id)) {
      out.push(
        ev(p, 'reconcile_mismatch', String(missing), ['telegram'], {
          telegram: `⚠️ Rebalance ${p.id}: ${missing} recorded fill(s) have no matching transaction yet.`,
        }),
      )
    }
  }
  return out
}

const empty = (): NotifyState => ({ version: 1, seeded: false, announced: {} })

/** The highest missing count already announced on telegram for a proposal. */
function maxAnnouncedMismatch(state: NotifyState, proposalId: string): number {
  const prefix = `${proposalId}:reconcile_mismatch:`
  let max = 0
  for (const [id, sent] of Object.entries(state.announced)) {
    if (id.startsWith(prefix) && sent.telegram) max = Math.max(max, Number(id.slice(prefix.length)) || 0)
  }
  return max
}

/** The events with at least one channel still unsent; `channels` lists only those. Pure: changes no state. */
export function pendingEvents(proposals: Proposal[], state: NotifyState, now: Date): NotifyEvent[] {
  const out: NotifyEvent[] = []
  for (const e of allEvents(proposals, now, (id) => maxAnnouncedMismatch(state, id))) {
    const sent = state.announced[e.id] ?? {}
    const channels = e.channels.filter((c) => !sent[c])
    if (!channels.length) continue
    out.push({
      ...e,
      channels,
      telegram: channels.includes('telegram') ? e.telegram : null,
      discord: channels.includes('discord') ? e.discord : null,
      threadTitle: channels.includes('discord') ? e.threadTitle : null,
      threadPrompt: channels.includes('discord') ? e.threadPrompt : null,
    })
  }
  return out
}

/** Marks everything the proposals imply right now as already announced on both channels, so a first run is silent. */
export function seedState(proposals: Proposal[], now: Date): NotifyState {
  const at = now.toISOString()
  const announced: NotifyState['announced'] = {}
  for (const e of allEvents(proposals, now, () => 0)) announced[e.id] = { telegram: at, discord: at }
  return { version: 1, seeded: true, announced }
}

/** Records the events as sent on `channel`. With `proposals`, entries of proposals that no longer exist are dropped. */
export function markSent(state: NotifyState, eventIds: string[], channel: NotifyChannel, now: Date, proposals?: Proposal[]): NotifyState {
  const announced = { ...state.announced }
  for (const id of eventIds) announced[id] = { ...announced[id], [channel]: now.toISOString() }
  if (proposals) {
    const live = new Set(proposals.map((p) => p.id))
    for (const id of Object.keys(announced)) {
      const owner = [...live].find((l) => id.startsWith(`${l}:`))
      if (!owner) delete announced[id]
    }
  }
  return { version: 1, seeded: state.seeded, announced }
}

/** A missing file is null (not seeded yet); an unreadable one throws, so a run fails instead of re-announcing everything. */
export function readNotifyState(filePath: string = config.stockRebalanceNotifyStatePath): NotifyState | null {
  if (!fs.existsSync(filePath)) return null
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<NotifyState>
  if (raw === null || typeof raw !== 'object' || raw.version !== 1 || raw.announced === null || typeof raw.announced !== 'object') {
    throw new Error(`Notify state unreadable: ${path.basename(filePath)}`)
  }
  return { version: 1, seeded: raw.seeded === true, announced: { ...raw.announced } }
}

/** Written to a temporary file and renamed, so a reader never sees half a file. */
export function writeNotifyState(state: NotifyState, filePath: string = config.stockRebalanceNotifyStatePath): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`)
  fs.renameSync(temporaryPath, filePath)
}

export { empty as emptyNotifyState }
