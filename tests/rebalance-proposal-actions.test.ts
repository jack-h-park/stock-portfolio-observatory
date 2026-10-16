import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import type { AllocationPolicy } from '../lib/rebalance/allocation-policy'
import type { Instruction, TradePlan } from '../lib/rebalance/engine'
import type { TargetChange } from '../lib/rebalance/proposal-store'
import { approvedTargets, parseFillForm, parseSkipForm, parseTargetEditForm } from '../lib/rebalance/proposal-actions'

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
