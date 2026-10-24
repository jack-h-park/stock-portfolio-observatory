import assert from 'node:assert/strict'
import fs, { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { RebalanceInput } from '../lib/adapters/rebalance-input'
import { getAllocationPolicy, type AllocationPolicy } from '../lib/rebalance/allocation-policy'
import type { Instruction, TradePlan } from '../lib/rebalance/engine'
import { createProposal, getProposal, transition, type TargetChange } from '../lib/rebalance/proposal-store'
import {
  approvedTargets,
  approveProposalPlan,
  approveProposalTargets,
  describeInstruction,
  parseFillForm,
  parseRejectReason,
  parseSkipForm,
  parseTargetEditForm,
  policyChangedSince,
  recomputeProposalPlan,
  saveProposalTargetEdits,
} from '../lib/rebalance/proposal-actions'
import type { TaxPolicy } from '../lib/tax-policy'

const example = (): AllocationPolicy => {
  const raw = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'allocation-policy.example.json'), 'utf8'))
  for (const key of Object.keys(raw)) if (key.startsWith('_')) delete raw[key]
  return raw as AllocationPolicy
}

const ins = (id: string, kind: Instruction['kind'], quantity: number): Instruction =>
  ({ id, kind, sleeve: 'us_equity', brokerage: 'BrokerA', account: 'acct-1', market: 'US', ticker: 'AAA', currency: 'USD', lotIds: [], lots: [], quantity, estimatedKrw: 1000, gainKrw: null, usGainUsd: null, holdingBucket: null, tier: null, notes: [] }) as Instruction

const plan = (): TradePlan =>
  ({
    moves: [],
    instructions: [ins('sell:BrokerA::acct-1:US:AAA', 'sell', 10), ins('transfer:BrokerA::acct-1:KRW', 'transfer', 0)],
    warnings: [],
    taxSummary: {},
  }) as unknown as TradePlan

const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) f.append(key, v)
  }
  return f
}

const SELL = 'sell:BrokerA::acct-1:US:AAA'
const TRANSFER = 'transfer:BrokerA::acct-1:KRW'

test('parseFillForm: a valid executed sell', () => {
  const out = parseFillForm(form({ instructionId: SELL, status: 'executed', quantity: '4', price: '101.5', date: '2026-11-03', note: ' part ' }), plan())
  assert.deepEqual(out, { fill: { instructionId: SELL, status: 'executed', quantity: 4, price: 101.5, date: '2026-11-03', note: 'part' } })
})

test('parseFillForm: quantity above the plan is refused', () => {
  const out = parseFillForm(form({ instructionId: SELL, status: 'executed', quantity: '11', price: '100', date: '2026-11-03' }), plan())
  assert.deepEqual(out, { error: 'quantity_above_plan' })
})

test('parseFillForm: a price of zero or below is refused', () => {
  for (const price of ['0', '-3', '', 'abc']) {
    const out = parseFillForm(form({ instructionId: SELL, status: 'executed', quantity: '4', price, date: '2026-11-03' }), plan())
    assert.deepEqual(out, { error: 'price_invalid' }, price)
  }
})

test('parseFillForm: a date that is not ISO is refused', () => {
  for (const date of ['11/03/2026', '2026-11-3', '2026-02-30', '']) {
    const out = parseFillForm(form({ instructionId: SELL, status: 'executed', quantity: '4', price: '100', date }), plan())
    assert.deepEqual(out, { error: 'date_invalid' }, date)
  }
})

test('parseFillForm: quantity must be positive; unknown instructions are refused', () => {
  assert.deepEqual(parseFillForm(form({ instructionId: SELL, status: 'executed', quantity: '0', price: '1', date: '2026-11-03' }), plan()), { error: 'quantity_invalid' })
  assert.deepEqual(parseFillForm(form({ instructionId: 'sell:x', status: 'executed', quantity: '1', price: '1', date: '2026-11-03' }), plan()), { error: 'unknown_instruction' })
  assert.deepEqual(parseFillForm(form({ instructionId: SELL, status: 'done', date: '2026-11-03' }), plan()), { error: 'status_invalid' })
})

test('parseFillForm: a transfer needs only a date and a note', () => {
  assert.deepEqual(parseFillForm(form({ instructionId: TRANSFER, status: 'executed', quantity: '', price: '', date: '2026-11-03', note: 'moved' }), plan()), {
    fill: { instructionId: TRANSFER, status: 'executed', quantity: null, price: null, date: '2026-11-03', note: 'moved' },
  })
  assert.deepEqual(parseFillForm(form({ instructionId: TRANSFER, status: 'executed', date: '2026-11-03', note: ' ' }), plan()), { error: 'note_required' })
})

test('parseFillForm: a skip needs a note and nothing else', () => {
  assert.deepEqual(parseFillForm(form({ instructionId: SELL, status: 'skipped', note: '' }), plan()), { error: 'note_required' })
  assert.deepEqual(parseFillForm(form({ instructionId: SELL, status: 'skipped', note: 'price moved', quantity: '3' }), plan()), {
    fill: { instructionId: SELL, status: 'skipped', quantity: null, price: null, date: null, note: 'price moved' },
  })
})

const current = (): TargetChange => ({ decision: 'change', sleeves: { us_equity: { from: 45, to: 48, reason: 'outlook' } }, boundsErrors: [] })

function targetForm(to: Partial<Record<string, string>>, reasons: Record<string, string> = {}) {
  const policy = example()
  const fields: Record<string, string> = {}
  for (const [sleeve, t] of Object.entries(policy.targets)) fields[`to_${sleeve}`] = to[sleeve] ?? String(t.target)
  for (const [sleeve, reason] of Object.entries(reasons)) fields[`reason_${sleeve}`] = reason
  return form(fields)
}

test('parseTargetEditForm: a target outside its bounds is refused', () => {
  const policy = example()
  policy.bounds.sleeves.us_equity = { min: 40, max: 47 }
  const out = parseTargetEditForm(targetForm({ us_equity: '48', kr_equity: '27' }), policy, current())
  assert.deepEqual(out, { error: 'target_bounds' })
})

test('parseTargetEditForm: a shift above the per-cycle limit is refused', () => {
  const out = parseTargetEditForm(targetForm({ us_equity: '51', kr_equity: '24' }), example(), current())
  assert.deepEqual(out, { error: 'target_shift' })
})

test('parseTargetEditForm: targets must still sum to 100, and be numbers', () => {
  assert.deepEqual(parseTargetEditForm(targetForm({ us_equity: '48' }), example(), current()), { error: 'targets_sum' })
  assert.deepEqual(parseTargetEditForm(targetForm({ us_equity: 'x' }), example(), current()), { error: 'number_invalid' })
})

test('parseTargetEditForm: a valid edit returns the changed sleeves with their reasons', () => {
  const out = parseTargetEditForm(targetForm({ us_equity: '47', kr_equity: '28' }, { kr_equity: ' trim KR ' }), example(), current())
  assert.deepEqual(out, {
    sleeves: {
      kr_equity: { from: 30, to: 28, reason: 'trim KR' },
      us_equity: { from: 45, to: 47, reason: 'outlook' },
    },
  })
})

test('approvedTargets overlays the proposed sleeves on the policy targets', () => {
  const targets = approvedTargets(example(), current())
  assert.equal(targets.us_equity.target, 48)
  assert.equal(targets.us_equity.band, 5)
  assert.equal(targets.kr_equity.target, 30)
})

test('parseSkipForm: collects every skipped id once', () => {
  assert.deepEqual(parseSkipForm(form({ skip: [SELL, TRANSFER, SELL, ' '] })), [SELL, TRANSFER])
  assert.deepEqual(parseSkipForm(form({})), [])
})

test('free text is capped at 500 characters', () => {
  const long = 'x'.repeat(501)
  assert.deepEqual(parseFillForm(form({ instructionId: SELL, status: 'skipped', note: long }), plan()), { error: 'text_too_long' })
  assert.deepEqual(parseTargetEditForm(targetForm({}, { bonds: long }), example(), current()), { error: 'text_too_long' })
  assert.deepEqual(parseRejectReason(form({ reason: long })), { error: 'text_too_long' })
  assert.deepEqual(parseRejectReason(form({ reason: '  ' })), { error: 'reason_required' })
  assert.deepEqual(parseRejectReason(form({ reason: ' no ' })), { reason: 'no' })
})

test('describeInstruction names side, security and account, from the plan or from the id', () => {
  const side = (k: string) => k.toUpperCase()
  assert.equal(describeInstruction(SELL, plan().instructions, side), 'SELL US:AAA · BrokerA · acct-1')
  assert.equal(describeInstruction('buy:BrokerB::acct-2:KR:KRX1', [], side), 'BUY KR:KRX1 · BrokerB · acct-2')
  assert.equal(describeInstruction('transfer:BrokerB::acct-2:USD', [], side), 'TRANSFER USD · BrokerB · acct-2')
  assert.equal(describeInstruction('odd-id', [], side), 'odd-id')
})

test('policyChangedSince reports a history head newer than the proposal', () => {
  const policy = example()
  assert.equal(policyChangedSince(policy, '2026-10-01T00:00:00Z'), null)
  policy.history = [{ at: '2026-10-02T00:00:00Z', by: 'maintainer', changes: {} }]
  assert.equal(policyChangedSince(policy, '2026-10-01T00:00:00Z'), '2026-10-02T00:00:00Z')
  assert.equal(policyChangedSince(policy, '2026-10-03T00:00:00Z'), null)
})

// ---- File-writing steps, against temp paths --------------------------------------------------------

const T0 = new Date('2026-10-15T00:00:00Z')
const taxPolicy = (): TaxPolicy => JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'tax-policy.example.json'), 'utf8')) as TaxPolicy

// Cash only: every other sleeve is below its band, cash is above it, so the cash move shows which targets planned it.
const snapshot = (): RebalanceInput => ({
  asOf: '2026-10-15',
  usdKrwRate: 1000,
  positions: [],
  cash: [{ brokerage: 'BrokerA', account: 'acct-1', currency: 'KRW', balance: 10_000_000, krw: 10_000_000, asOf: '2026-10-15' }],
  lots: [],
  recentBuys: [],
  washSaleBlockedBuys: [],
  accountDataAsOf: {},
  ytd: { year: 2026, krTaxableGainKrw: 0, usShortUsd: 0, usLongUsd: 0, lotCount: 0 },
  healthErrors: [],
})

function setup(change: TargetChange['sleeves'] = { cash: { from: 10, to: 12, reason: 'r' }, kr_equity: { from: 30, to: 28, reason: 'r' } }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-actions-'))
  const paths = { policy: path.join(dir, 'policy.json'), classes: path.join(dir, 'classes.json'), proposals: path.join(dir, 'proposals') }
  fs.writeFileSync(paths.policy, JSON.stringify(example(), null, 2))
  fs.writeFileSync(paths.classes, JSON.stringify({ 'KR:KRX1': 'kr_equity' }))
  const p = createProposal(
    {
      id: 'rb-2026-10-15-manual',
      kind: 'manual',
      triggers: [],
      policyAtCreation: example(),
      inputSnapshot: snapshot(),
      outlook: null,
      llm: null,
      targetChange: { decision: 'change', sleeves: change, boundsErrors: [] },
      plan: { moves: [], instructions: [], warnings: [], taxSummary: {} } as unknown as TradePlan,
      planSkips: [],
    },
    T0,
    paths.proposals,
  )
  return { id: p.id, paths }
}

const cashIntended = (planned: TradePlan) => planned.moves.find((m) => m.sleeve === 'cash')?.intendedAmountKrw

test('approveProposalTargets: writes the policy, rebuilds the plan against the approved targets, advances', () => {
  const { id, paths } = setup()
  const out = approveProposalTargets(id, T0, paths, taxPolicy())
  assert.equal(out.ok, true)
  const policy = getAllocationPolicy(paths.policy).policy!
  assert.equal(policy.targets.cash.target, 12)
  assert.equal(policy.targets.kr_equity.target, 28)
  assert.deepEqual(policy.history.at(-1), { at: T0.toISOString(), by: `proposal:${id}`, changes: { kr_equity: [30, 28], cash: [10, 12] } })
  const p = getProposal(id, paths.proposals)!
  assert.equal(p.status, 'targets_approved')
  // Cash at 100% moves to the approved upper edge, 12 + 5 = 17%.
  assert.equal(Math.round(cashIntended(p.plan)!), -8_300_000)
})

test('approveProposalTargets: a rebuild failure changes no file', () => {
  const { id, paths } = setup()
  fs.writeFileSync(paths.classes, JSON.stringify({ 'KR:KRX1': 'not_a_sleeve' }))
  const policyBefore = fs.readFileSync(paths.policy)
  const proposalBefore = fs.readFileSync(path.join(paths.proposals, `${id}.json`))
  const out = approveProposalTargets(id, T0, paths, taxPolicy())
  assert.equal(out.ok, false)
  assert.equal(!out.ok && out.code, 'action_failed')
  assert.deepEqual(fs.readFileSync(paths.policy), policyBefore)
  assert.deepEqual(fs.readFileSync(path.join(paths.proposals, `${id}.json`)), proposalBefore)
  assert.equal(getProposal(id, paths.proposals)!.status, 'draft')
})

test('approveProposalTargets: after the policy is saved but the proposal cannot be written, a retry completes the step', { skip: process.getuid?.() === 0 }, () => {
  const { id, paths } = setup()
  fs.chmodSync(paths.proposals, 0o555)
  let out
  try {
    out = approveProposalTargets(id, T0, paths, taxPolicy())
  } finally {
    fs.chmodSync(paths.proposals, 0o755)
  }
  assert.equal(!out.ok && out.code, 'targets_saved_not_advanced')
  assert.equal(getAllocationPolicy(paths.policy).policy!.targets.cash.target, 12)
  assert.equal(getProposal(id, paths.proposals)!.status, 'draft')
  const retry = approveProposalTargets(id, new Date(T0.getTime() + 1000), paths, taxPolicy())
  assert.equal(retry.ok, true)
  assert.equal(getProposal(id, paths.proposals)!.status, 'targets_approved')
  // The second run changes no target, so it adds no second history entry.
  assert.equal(getAllocationPolicy(paths.policy).policy!.history.filter((h) => h.by === `proposal:${id}`).length, 1)
})

test('saveProposalTargetEdits: saves the edits and rebuilds the plan against them', () => {
  const { id, paths } = setup()
  const out = saveProposalTargetEdits(id, targetForm({ cash: '14', kr_equity: '26' }), T0, paths, taxPolicy())
  assert.equal(out.ok, true)
  const p = getProposal(id, paths.proposals)!
  assert.equal(p.targetChange.sleeves.cash?.to, 14)
  assert.equal(p.targetChange.sleeves.cash?.editedBy, 'maintainer')
  assert.equal(Math.round(cashIntended(p.plan)!), -8_100_000)
  // The policy is not touched by an edit.
  assert.equal(getAllocationPolicy(paths.policy).policy!.targets.cash.target, 10)
})

test('recomputeProposalPlan: in targets_approved it plans against the approved targets, not what the policy holds now', () => {
  const { id, paths } = setup()
  assert.equal(approveProposalTargets(id, T0, paths, taxPolicy()).ok, true)
  // The policy is edited afterwards (cash back to 10, KR to 30).
  fs.writeFileSync(paths.policy, JSON.stringify(example(), null, 2))
  const out = recomputeProposalPlan(id, ['buy:x'], T0, paths, taxPolicy())
  assert.equal(out.ok, true)
  const p = getProposal(id, paths.proposals)!
  assert.equal(Math.round(cashIntended(p.plan)!), -8_300_000)
  assert.deepEqual(p.planSkips, ['buy:x'])
  transition(id, 'plan_approved', 'ok', T0, paths.proposals)
  assert.equal(!recomputeProposalPlan(id, [], T0, paths, taxPolicy()).ok, true)
})

function setupHold(instructions: Instruction[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-actions-'))
  const proposals = path.join(dir, 'proposals')
  const p = createProposal(
    {
      id: 'rb-2026-10-15-manual',
      kind: 'manual',
      triggers: [],
      policyAtCreation: example(),
      inputSnapshot: snapshot(),
      outlook: null,
      llm: null,
      targetChange: { decision: 'hold', sleeves: {}, boundsErrors: [] },
      plan: { moves: [], instructions, warnings: [], taxSummary: {} } as unknown as TradePlan,
      planSkips: [],
    },
    T0,
    proposals,
  )
  return { id: p.id, paths: { proposals } }
}

test('approveProposalPlan: a plan with no buy or sell is refused as empty_plan and stays in draft', () => {
  for (const instructions of [[], [ins(TRANSFER, 'transfer', 0)]]) {
    const { id, paths } = setupHold(instructions)
    const out = approveProposalPlan(id, T0, paths)
    assert.deepEqual(out, { ok: false, code: 'empty_plan', detail: undefined })
    assert.equal(getProposal(id, paths.proposals)!.status, 'draft')
  }
})

test('approveProposalPlan: a plan with a sell is approved', () => {
  const { id, paths } = setupHold([ins(SELL, 'sell', 10)])
  const out = approveProposalPlan(id, T0, paths)
  assert.equal(out.ok, true)
  assert.equal(getProposal(id, paths.proposals)!.status, 'plan_approved')
})

test('approveProposalPlan: a change proposal still in draft is the wrong status', () => {
  const { id, paths } = setup()
  assert.equal(approveProposalPlan(id, T0, paths).ok, false)
  assert.equal(getProposal(id, paths.proposals)!.status, 'draft')
})
