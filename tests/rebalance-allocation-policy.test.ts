import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  applyTargets,
  checkTargetsAgainstBounds,
  deriveUsTargetPct,
  getAllocationPolicy,
  saveAllocationPolicy,
  validateAllocationPolicy,
  type AllocationPolicy,
} from '../lib/rebalance/allocation-policy'

const scratch = () => path.join(mkdtempSync(path.join(tmpdir(), 'allocation-policy-')), 'allocation-policy.json')

const example = (): AllocationPolicy => {
  const raw = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'allocation-policy.example.json'), 'utf8'))
  for (const key of Object.keys(raw)) if (key.startsWith('_')) delete raw[key]
  return raw as AllocationPolicy
}

test('getAllocationPolicy reports missing when no file', () => {
  const state = getAllocationPolicy(scratch())
  assert.equal(state.source, 'missing')
  assert.equal(state.policy, null)
  assert.equal(state.error, null)
})

test('round-trips a valid policy', () => {
  const file = scratch()
  const policy = example()
  saveAllocationPolicy(policy, file)
  const state = getAllocationPolicy(file)
  assert.equal(state.source, 'saved')
  assert.equal(state.error, null)
  assert.deepEqual(state.policy, policy)
})

test('the loader ignores top-level keys starting with an underscore', () => {
  const file = scratch()
  writeFileSync(file, JSON.stringify({ _comment: 'note', ...example() }))
  const state = getAllocationPolicy(file)
  assert.deepEqual(state.policy, example())
})

test('saveAllocationPolicy rejects targets not summing to 100', () => {
  const file = scratch()
  const policy = example()
  policy.targets.cash.target = 8
  assert.throws(() => saveAllocationPolicy(policy, file), /98/)
  assert.equal(existsSync(file), false)
})

test('rejects a target outside its sleeve bounds', () => {
  const policy = example()
  policy.bounds.sleeves.us_equity = { min: 30, max: 70 }
  policy.targets.us_equity.target = 75
  policy.targets.cash.target = -20
  const errors = validateAllocationPolicy(policy)
  assert.ok(errors.some((e) => e.includes('us_equity')))
})

test('rejects band <= 0 and min > max', () => {
  const policy = example()
  policy.targets.gold.band = 0
  policy.bounds.sleeves.bonds = { min: 60, max: 40 }
  const errors = validateAllocationPolicy(policy)
  assert.ok(errors.some((e) => e.includes('gold') && e.includes('band')))
  assert.ok(errors.some((e) => e.includes('bonds') && e.includes('min')))
})

test('rejects a missing sleeve and negative numeric bounds', () => {
  const policy = example()
  delete (policy.targets as Record<string, unknown>).gold
  policy.bounds.minTradeKrw = -1
  const errors = validateAllocationPolicy(policy)
  assert.ok(errors.some((e) => e.includes('gold')))
  assert.ok(errors.some((e) => e.includes('minTradeKrw')))
})

test('checkTargetsAgainstBounds enforces maxTargetShiftPctPerCycle when asked', () => {
  const policy = example()
  policy.targets.us_equity.target = 50
  const proposed = structuredClone(policy.targets)
  proposed.us_equity.target = 44
  assert.equal(checkTargetsAgainstBounds(policy, proposed, { enforceShift: true }).length, 1)
  assert.deepEqual(checkTargetsAgainstBounds(policy, proposed, { enforceShift: false }), [])
})

test('applyTargets records only changed sleeves', () => {
  const policy = example()
  policy.targets.us_equity.target = 50
  policy.targets.kr_equity.target = 25
  const proposed = structuredClone(policy.targets)
  proposed.us_equity.target = 47
  proposed.kr_equity.target = 28
  const next = applyTargets(policy, proposed, 'tester', '2026-01-01T00:00:00.000Z')
  assert.equal(next.history.length, 1)
  assert.deepEqual(next.history[0], {
    at: '2026-01-01T00:00:00.000Z',
    by: 'tester',
    changes: { us_equity: [50, 47], kr_equity: [25, 28] },
  })
  assert.equal(next.targets.us_equity.target, 47)
  assert.equal(policy.history.length, 0)
})

test('deriveUsTargetPct', () => {
  const policy = example()
  policy.targets.kr_equity.target = 30
  policy.targets.us_equity.target = 45
  assert.equal(deriveUsTargetPct(policy), 60)
  policy.targets.kr_equity.target = 0
  policy.targets.us_equity.target = 0
  assert.equal(deriveUsTargetPct(policy), null)
})

test('a corrupt file reads as saved with an error and does not throw', () => {
  const file = scratch()
  writeFileSync(file, '{not json')
  const state = getAllocationPolicy(file)
  assert.equal(state.source, 'saved')
  assert.equal(state.policy, null)
  assert.ok(state.error)
})
