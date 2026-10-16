import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  appendTrigger,
  createProposal,
  editTargets,
  expireStale,
  getProposal,
  listProposals,
  openProposal,
  proposalId,
  recordFill,
  setPlan,
  transition,
  type Fill,
  type Proposal,
} from '../lib/rebalance/proposal-store'
import type { Instruction, TradePlan } from '../lib/rebalance/engine'

const T0 = new Date('2026-11-02T00:00:00Z')
const at = (days: number) => new Date(T0.getTime() + days * 86_400_000)
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rbp-'))

const ins = (id: string, kind: Instruction['kind'], quantity: number): Instruction =>
  ({ id, kind, sleeve: 'us_equity', brokerage: 'BrokerA', account: 'acct-1', market: 'US', ticker: 'AAA', currency: 'USD', lotIds: [], lots: [], quantity, estimatedKrw: 1000 }) as unknown as Instruction

const plan = (): TradePlan =>
  ({ moves: [], instructions: [ins('sell:a:US:AAA', 'sell', 10), ins('transfer:a:KRW', 'transfer', 0)], warnings: [], taxSummary: {} }) as unknown as TradePlan

function base(decision: 'change' | 'hold' = 'change', id = 'rb-2026-11'): Parameters<typeof createProposal>[0] {
  return {
    id,
    kind: 'monthly',
    triggers: [],
    policyAtCreation: {} as never,
    inputSnapshot: {} as never,
    outlook: null,
    llm: null,
    targetChange: { decision, sleeves: { us_equity: { from: 40, to: 45, reason: 'r' } }, boundsErrors: [] },
    plan: plan(),
    planSkips: [],
  }
}

const exec = (q: number | null, p: number | null, id = 'sell:a:US:AAA'): Fill => ({ instructionId: id, status: 'executed', quantity: q, price: p, date: '2026-11-03', note: '' })

function toApproved(dir: string, id = 'rb-2026-11') {
  createProposal(base('change', id), T0, dir)
  transition(id, 'targets_approved', 'ok', at(1), dir)
  return transition(id, 'plan_approved', 'ok', at(1), dir)
}

test('proposalId formats', () => {
  assert.equal(proposalId('monthly', '2026-11-02'), 'rb-2026-11')
  assert.equal(proposalId('trigger', '2026-11-14', 'harvest'), 'rb-2026-11-14-harvest')
  assert.equal(proposalId('manual', '2026-11-14'), 'rb-2026-11-14-manual')
})

test('createProposal refuses while another is open, suffixes colliding ids', () => {
  const dir = tmp()
  const p = createProposal(base(), T0, dir)
  assert.equal(p.status, 'draft')
  assert.equal(p.expiresAt, at(7).toISOString())
  assert.equal(p.events.length, 1)
  assert.throws(() => createProposal(base('change', 'rb-2026-11-14-manual'), T0, dir), /open/)
  transition(p.id, 'rejected', 'no', at(1), dir)
  assert.equal(openProposal(dir), null)
  const q = createProposal(base(), at(2), dir)
  assert.equal(q.id, 'rb-2026-11-2')
  transition(q.id, 'rejected', 'no', at(3), dir)
  assert.equal(createProposal(base(), at(4), dir).id, 'rb-2026-11-3')
  assert.equal(listProposals(dir)[0].id, 'rb-2026-11-3')
})

test('transition table: allowed ones succeed, others throw', () => {
  const dir = tmp()
  createProposal(base('hold'), T0, dir)
  assert.throws(() => transition('rb-2026-11', 'targets_approved', '', T0, dir))
  assert.equal(transition('rb-2026-11', 'plan_approved', '', T0, dir).status, 'plan_approved')
  assert.throws(() => transition('rb-2026-11', 'draft', '', T0, dir))
  assert.equal(transition('rb-2026-11', 'executing', '', T0, dir).status, 'executing')
  assert.throws(() => transition('rb-2026-11', 'rejected', '', T0, dir))
  assert.throws(() => transition('rb-2026-11', 'closed', '', T0, dir))
  transition('rb-2026-11', 'reconciled', '', T0, dir)
  assert.throws(() => transition('rb-2026-11', 'rejected', '', T0, dir))
  assert.equal(transition('rb-2026-11', 'closed', '', T0, dir).status, 'closed')
  assert.throws(() => transition('rb-2026-11', 'executing', '', T0, dir))

  const d2 = tmp()
  createProposal(base('change'), T0, d2)
  assert.throws(() => transition('rb-2026-11', 'plan_approved', '', T0, d2))
})

test('a reconciled proposal awaiting its close does not block a new one', () => {
  const dir = tmp()
  createProposal(base('hold'), T0, dir)
  transition('rb-2026-11', 'plan_approved', '', T0, dir)
  transition('rb-2026-11', 'executing', '', T0, dir)
  assert.equal(openProposal(dir)?.id, 'rb-2026-11', 'executing is open')
  transition('rb-2026-11', 'reconciled', '', T0, dir)
  assert.equal(openProposal(dir), null)
  const next = createProposal(base('hold', 'rb-2026-12'), at(30), dir)
  assert.equal(next.status, 'draft')
  assert.equal(openProposal(dir)?.id, 'rb-2026-12')
  // The reconciled one can still be closed.
  assert.equal(transition('rb-2026-11', 'closed', '', at(31), dir).status, 'closed')
})

test('draft may expire; targets_approved may not', () => {
  const dir = tmp()
  createProposal(base(), T0, dir)
  assert.equal(transition('rb-2026-11', 'expired', '', T0, dir).status, 'expired')
  const d2 = tmp()
  createProposal(base(), T0, d2)
  transition('rb-2026-11', 'targets_approved', '', T0, d2)
  assert.throws(() => transition('rb-2026-11', 'expired', '', T0, d2))
  assert.equal(transition('rb-2026-11', 'rejected', '', T0, d2).status, 'rejected')
})

test('editTargets is allowed only in draft and marks editedBy', () => {
  const dir = tmp()
  createProposal(base(), T0, dir)
  const p = editTargets('rb-2026-11', { us_equity: { from: 40, to: 42, reason: 'edit' } }, at(1), dir)
  assert.equal(p.targetChange.sleeves.us_equity?.to, 42)
  assert.equal(p.targetChange.sleeves.us_equity?.editedBy, 'maintainer')
  transition('rb-2026-11', 'targets_approved', '', at(1), dir)
  assert.throws(() => editTargets('rb-2026-11', {}, at(2), dir))
  // setPlan stays open until plan approval
  assert.equal(setPlan('rb-2026-11', plan(), ['x'], at(2), dir).planSkips[0], 'x')
  transition('rb-2026-11', 'plan_approved', '', at(2), dir)
  assert.throws(() => setPlan('rb-2026-11', plan(), [], at(3), dir))
})

test('recordFill rejects quantity above plan or non-positive price', () => {
  const dir = tmp()
  toApproved(dir)
  const n = getProposal('rb-2026-11', dir)!.events.length
  for (const f of [
    exec(10.01, 5),
    exec(0, 5),
    exec(5, 0),
    exec(5, null),
    exec(5, 5, 'sell:a:US:ZZZ'),
    { ...exec(5, 5), date: '11/03/2026' },
    { instructionId: 'sell:a:US:AAA', status: 'skipped' as const, quantity: null, price: null, date: null, note: '' },
  ]) {
    assert.throws(() => recordFill('rb-2026-11', f, at(2), dir))
  }
  const after = getProposal('rb-2026-11', dir)!
  assert.equal(after.events.length, n)
  assert.equal(after.status, 'plan_approved')
  assert.deepEqual(after.fills, {})
  assert.doesNotThrow(() => recordFill('rb-2026-11', exec(10.0005, 5), at(2), dir))
})

test('transfer fills may be amount-only; skipped needs a note only', () => {
  const dir = tmp()
  toApproved(dir)
  const f: Fill = { instructionId: 'transfer:a:KRW', status: 'executed', quantity: null, price: null, date: '2026-11-03', note: '' }
  assert.equal(recordFill('rb-2026-11', f, at(2), dir).fills['transfer:a:KRW'].status, 'executed')
  const s: Fill = { instructionId: 'sell:a:US:AAA', status: 'skipped', quantity: null, price: null, date: null, note: 'wash sale' }
  assert.equal(recordFill('rb-2026-11', s, at(2), dir).fills['sell:a:US:AAA'].note, 'wash sale')
})

test('first fill moves plan_approved to executing', () => {
  const dir = tmp()
  toApproved(dir)
  const before = getProposal('rb-2026-11', dir)!.events.length
  const p = recordFill('rb-2026-11', exec(5, 5), at(2), dir)
  assert.equal(p.status, 'executing')
  assert.equal(p.events.length, before + 2)
  assert.equal(p.events.at(-2)!.type, 'fill')
  const q = recordFill('rb-2026-11', exec(4, 5, 'sell:a:US:AAA'), at(3), dir)
  assert.equal(q.events.length, before + 3)
})

test('expireStale expires drafts older than 7 days only', () => {
  const dir = tmp()
  createProposal(base(), T0, dir)
  assert.deepEqual(expireStale(at(6), dir), [])
  assert.deepEqual(expireStale(at(7), dir), ['rb-2026-11'])
  assert.equal(getProposal('rb-2026-11', dir)!.status, 'expired')
  const d2 = tmp()
  toApproved(d2)
  assert.deepEqual(expireStale(at(30), d2), [])
})

test('every mutation appends one event and bumps updatedAt', () => {
  const dir = tmp()
  let p: Proposal = createProposal(base(), T0, dir)
  const steps: ((n: number) => Proposal)[] = [
    (n) => editTargets(p.id, { us_equity: { from: 40, to: 41, reason: 'x' } }, at(n), dir),
    (n) => appendTrigger(p.id, 'drift', at(n), dir),
    (n) => setPlan(p.id, plan(), [], at(n), dir),
    (n) => transition(p.id, 'targets_approved', 'ok', at(n), dir),
    (n) => transition(p.id, 'plan_approved', 'ok', at(n), dir),
  ]
  steps.forEach((step, i) => {
    const prev = p
    p = step(i + 1)
    assert.equal(p.events.length, prev.events.length + 1)
    assert.ok(p.updatedAt > prev.updatedAt)
  })
  assert.deepEqual(p.triggers, ['drift'])
  assert.deepEqual(p.events.map((e) => e.type), ['created', 'targets_edited', 'trigger_appended', 'plan_edited', 'targets_approved', 'plan_approved'])
})

test('files are written atomically', () => {
  const dir = tmp()
  toApproved(dir)
  recordFill('rb-2026-11', exec(5, 5), at(2), dir)
  const names = fs.readdirSync(dir)
  assert.deepEqual(names, ['rb-2026-11.json'])
  assert.ok(fs.readFileSync(path.join(dir, names[0]), 'utf8').endsWith('}\n'))
})

test('listProposals names an unreadable file by its basename, without its content', () => {
  const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-store-bad-'))
  fs.writeFileSync(path.join(bad, 'rb-2026-10-15-manual.json'), '{"secret-ish": 12345')
  assert.throws(
    () => listProposals(bad),
    (error: Error) =>
      error.message.includes('rb-2026-10-15-manual.json') && !error.message.includes(bad) && !error.message.includes('12345')
  )
})
