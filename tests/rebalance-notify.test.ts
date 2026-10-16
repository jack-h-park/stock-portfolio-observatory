import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { NotifyState } from '../lib/rebalance/notify'
import type { Proposal, ProposalEvent } from '../lib/rebalance/proposal-store'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-notify-'))
process.env.STOCK_REBALANCE_PROPOSALS_DIR = path.join(root, 'proposals')
process.env.STOCK_REBALANCE_NOTIFY_STATE_PATH = path.join(root, 'notify-state.json')
process.env.STOCK_ALLOCATION_POLICY_PATH = path.join(root, 'none.json')

const DAY = 86_400_000
const T0 = new Date('2026-10-01T00:00:00Z')

function proposal(over: Partial<Proposal> = {}, events: ProposalEvent[] = []): Proposal {
  const base = {
    schemaVersion: 1,
    id: 'rb-2026-10',
    kind: 'monthly',
    triggers: ['band:us_equity'],
    status: 'draft',
    createdAt: T0.toISOString(),
    updatedAt: T0.toISOString(),
    expiresAt: new Date(T0.getTime() + 7 * DAY).toISOString(),
    outlook: { summary: 'Rates are easing.', drivers: [], risks: [], whatWouldChangeMyView: [], sources: [], confidence: 'medium' },
    llm: { status: 'ok', runner: 'claude', model: null, attempts: [], reason: null },
    targetChange: { decision: 'change', sleeves: { us_equity: { from: 40, to: 45, reason: 'r' } }, boundsErrors: [] },
    plan: {
      moves: [],
      instructions: [
        { kind: 'sell', brokerage: 'Secret Broker', account: 'ACC-1', ticker: 'AAA', estimatedKrw: 123_456_789 },
        { kind: 'buy', brokerage: 'Secret Broker', account: 'ACC-1', ticker: 'BBB', estimatedKrw: 987_654_321 },
      ],
      warnings: [{ code: 'wash_sale_block', message: 'Secret Broker ACC-1 blocked' }],
      taxSummary: { estimatedTaxKrw: 1_234_567 },
    },
    reconciliation: null,
    events: [{ at: T0.toISOString(), type: 'created', detail: 'x' }, ...events],
    ...over,
  }
  return base as unknown as Proposal
}

test('first run seeds without events', async () => {
  const { runRebalanceCli } = await import('../lib/rebalance/cli')
  const run = async () => {
    let out = ''
    const code = await runRebalanceCli(['notify'], { out: (t) => (out += t), err: () => {} }, T0)
    return { code, body: JSON.parse(out) }
  }
  const first = await run()
  assert.equal(first.code, 0)
  assert.deepEqual([first.body.events, first.body.seeded], [[], true])
  assert.ok(fs.existsSync(process.env.STOCK_REBALANCE_NOTIFY_STATE_PATH as string))
  const second = await run()
  assert.equal(second.body.seeded, undefined)
  assert.deepEqual(second.body.events, [])
})

test('seedState marks every current event announced on both channels', async () => {
  const { seedState, pendingEvents } = await import('../lib/rebalance/notify')
  const p = proposal({ status: 'plan_approved' }, [{ at: T0.toISOString(), type: 'plan_approved', detail: '' }])
  const state = seedState([p], T0)
  assert.equal(state.seeded, true)
  assert.deepEqual(pendingEvents([p], state, T0), [])
})

test('new proposal yields created with telegram+discord', async () => {
  const { pendingEvents } = await import('../lib/rebalance/notify')
  const events = pendingEvents([proposal()], { version: 1, seeded: true, announced: {} }, T0)
  const created = events.find((e) => e.kind === 'created')
  assert.ok(created)
  assert.equal(created.id, 'rb-2026-10:created:new')
  assert.deepEqual(created.channels, ['telegram', 'discord'])
  assert.equal(created.telegram, '🧭 Rebalance proposal rb-2026-10 (monthly) is ready for review — 2 instructions, decision change. Discuss in its Discord thread; approve on /rebalance/proposals/rb-2026-10.')
  assert.equal(created.threadTitle, '⏳ 10/1 · Rebalance rb-2026-10')
  assert.match(created.threadPrompt ?? '', /us_equity 40% -> 45%/)
  assert.match(created.threadPrompt ?? '', /about 1230000 KRW/)
  assert.match(created.threadPrompt ?? '', /sell 1, buy 1/)
})

test('status change yields one status_changed per transition', async () => {
  const { pendingEvents, seedState } = await import('../lib/rebalance/notify')
  const before = proposal()
  const state = seedState([before], T0)
  const after = proposal({ status: 'executing' }, [
    { at: T0.toISOString(), type: 'targets_approved', detail: '' },
    { at: T0.toISOString(), type: 'plan_approved', detail: '' },
    { at: T0.toISOString(), type: 'fill', detail: 'a executed' },
    { at: T0.toISOString(), type: 'fill', detail: 'b executed' },
  ])
  const events = pendingEvents([after], state, T0)
  assert.deepEqual(events.map((e) => e.id), ['rb-2026-10:status_changed:targets_approved', 'rb-2026-10:status_changed:plan_approved', 'rb-2026-10:status_changed:executing'])
  assert.deepEqual(events.map((e) => e.channels), [['discord'], ['discord'], ['discord']])
  assert.equal(events[1].discord, 'Status → plan approved.')
  assert.equal(events[1].telegram, null)
})

test('expired goes to telegram too', async () => {
  const { pendingEvents } = await import('../lib/rebalance/notify')
  const p = proposal({ status: 'expired' }, [{ at: T0.toISOString(), type: 'expired', detail: '' }])
  const e = pendingEvents([p], { version: 1, seeded: true, announced: { 'rb-2026-10:created:new': { telegram: 'x', discord: 'x' }, 'rb-2026-10:llm_failed:x': {} } }, T0)
  assert.equal(e.length, 1)
  assert.equal(e[0].telegram, '⌛ Rebalance rb-2026-10 expired without approval.')
  assert.deepEqual(e[0].channels, ['telegram', 'discord'])
})

test('reminder once after 3 days in draft', async () => {
  const { pendingEvents, markSent } = await import('../lib/rebalance/notify')
  const p = proposal()
  let state: NotifyState = { version: 1, seeded: true, announced: { 'rb-2026-10:created:new': { telegram: 'x', discord: 'x' } } }
  assert.deepEqual(pendingEvents([p], state, new Date(T0.getTime() + 2 * DAY)), [])
  const due = pendingEvents([p], state, new Date(T0.getTime() + 3 * DAY))
  assert.equal(due.length, 1)
  assert.equal(due[0].id, 'rb-2026-10:reminder:draft3d')
  assert.equal(due[0].discord, 'Reminder: this proposal has been in draft for 3 days; it expires on 2026-10-08.')
  assert.equal(due[0].telegram, null)
  state = markSent(state, [due[0].id], 'discord', T0)
  assert.deepEqual(pendingEvents([p], state, new Date(T0.getTime() + 5 * DAY)), [])
  // Not for a proposal past draft.
  assert.deepEqual(pendingEvents([proposal({ status: 'plan_approved' })], { ...state, announced: { 'rb-2026-10:created:new': { telegram: 'x', discord: 'x' } } }, new Date(T0.getTime() + 5 * DAY)), [])
})

test('reconcile mismatch only when missing grows', async () => {
  const { pendingEvents, markSent } = await import('../lib/rebalance/notify')
  const rec = (n: number) => ({ at: '', matched: [], unplanned: [], complete: false, missing: Array.from({ length: n }, (_, i) => ({ instructionId: `i${i}`, daysSinceFill: 1 })) })
  const base = { version: 1 as const, seeded: true, announced: { 'rb-2026-10:created:new': { telegram: 'x', discord: 'x' } } }
  const at2 = proposal({ status: 'executing', reconciliation: rec(2) })
  const first = pendingEvents([at2], base, T0)
  assert.equal(first.length, 1)
  assert.equal(first[0].id, 'rb-2026-10:reconcile_mismatch:2')
  assert.equal(first[0].telegram, '⚠️ Rebalance rb-2026-10: 2 recorded fill(s) have no matching transaction yet.')
  const sent = markSent(base, [first[0].id], 'telegram', T0)
  assert.deepEqual(pendingEvents([at2], sent, T0), [])
  assert.deepEqual(pendingEvents([proposal({ status: 'executing', reconciliation: rec(1) })], sent, T0), [])
  assert.equal(pendingEvents([proposal({ status: 'executing', reconciliation: rec(3) })], sent, T0)[0].id, 'rb-2026-10:reconcile_mismatch:3')
})

test('llm_failed on a failed monthly', async () => {
  const { pendingEvents } = await import('../lib/rebalance/notify')
  const failed = proposal({ llm: { status: 'failed', runner: 'claude', model: null, attempts: [], reason: 'timeout' } })
  const e = pendingEvents([failed], { version: 1, seeded: true, announced: { 'rb-2026-10:created:new': { telegram: 'x', discord: 'x' } } }, T0)
  assert.equal(e.length, 1)
  assert.equal(e[0].kind, 'llm_failed')
  assert.equal(e[0].telegram, '⚠️ Rebalance rb-2026-10: LLM step failed (timeout); targets held, engine plan only.')
  assert.deepEqual(pendingEvents([proposal({ kind: 'trigger', llm: failed.llm })], { version: 1, seeded: true, announced: { 'rb-2026-10:created:new': { telegram: 'x', discord: 'x' } } }, T0), [])
})

test('marking telegram leaves discord pending', async () => {
  const { pendingEvents, markSent } = await import('../lib/rebalance/notify')
  const empty = { version: 1 as const, seeded: true, announced: {} }
  const state = markSent(empty, ['rb-2026-10:created:new'], 'telegram', T0)
  const e = pendingEvents([proposal()], state, T0)
  assert.deepEqual(e.map((x) => [x.id, x.channels, x.telegram === null, x.threadPrompt === null]), [['rb-2026-10:created:new', ['discord'], true, false]])
  assert.deepEqual(pendingEvents([proposal()], markSent(state, ['rb-2026-10:created:new'], 'discord', T0), T0), [])
})

test('deleted proposal entries are dropped', async () => {
  const { markSent } = await import('../lib/rebalance/notify')
  const state = { version: 1 as const, seeded: true, announced: { 'rb-gone:created:new': { telegram: 'x' }, 'rb-2026-10:created:new': { telegram: 'x' } } }
  const next = markSent(state, ['rb-2026-10:created:new'], 'discord', T0, [proposal()])
  assert.deepEqual(Object.keys(next.announced), ['rb-2026-10:created:new'])
})

test('telegram text has no account label or amount', async () => {
  const { pendingEvents } = await import('../lib/rebalance/notify')
  const p = proposal({ status: 'executing', llm: { status: 'failed', runner: 'c', model: null, attempts: [], reason: 'timeout' } })
  const events = pendingEvents([p], { version: 1, seeded: true, announced: {} }, new Date(T0.getTime() + 4 * DAY))
  const texts = events.map((e) => e.telegram).filter((t): t is string => t !== null)
  assert.ok(texts.length >= 2)
  for (const t of texts) assert.doesNotMatch(t, /Secret Broker|ACC-1|123|987|KRW|₩/)
})

test('threadPrompt has no account label', async () => {
  const { pendingEvents } = await import('../lib/rebalance/notify')
  const e = pendingEvents([proposal()], { version: 1, seeded: true, announced: {} }, T0).find((x) => x.kind === 'created')
  assert.ok(e?.threadPrompt)
  assert.doesNotMatch(e.threadPrompt, /Secret Broker|ACC-1|AAA|BBB|123456789|987654321/)
  assert.match(e.threadPrompt, /Write a short opening \(≤ 1,200 chars\)/)
})

test('--mark records ids per channel and drops unknown proposals', async () => {
  const { runRebalanceCli } = await import('../lib/rebalance/cli')
  const { readNotifyState } = await import('../lib/rebalance/notify')
  let out = ''
  const code = await runRebalanceCli(['notify', '--mark', 'rb-x:created:new,rb-x:reminder:draft3d', '--channel', 'telegram'], { out: (t) => (out += t), err: () => {} }, T0)
  assert.equal(code, 0)
  assert.equal(JSON.parse(out).ok, true)
  // No proposals exist on disk, so unknown-proposal entries are pruned.
  assert.deepEqual(readNotifyState()?.announced, {})
  let err = ''
  assert.equal(await runRebalanceCli(['notify', '--mark', 'a:b:c'], { out: () => {}, err: (t) => (err += t) }, T0), 2)
  assert.match(err, /--channel/)
})

test('threadPrompt skips a sleeve change missing from or to (no "undefined%")', async () => {
  const { pendingEvents } = await import('../lib/rebalance/notify')
  const p = proposal({
    targetChange: { decision: 'change', sleeves: { us_equity: { from: 40, to: 45, reason: 'r' }, kr_equity: undefined, bonds: { from: null, to: 10, reason: 'r' } }, boundsErrors: [] } as never,
  })
  const e = pendingEvents([p], { version: 1, seeded: true, announced: {} }, T0).find((x) => x.kind === 'created')
  assert.ok(e?.threadPrompt)
  assert.match(e.threadPrompt, /Decision: change \(us_equity 40% -> 45%\)\./)
  assert.doesNotMatch(e.threadPrompt, /undefined|null%/)
})
