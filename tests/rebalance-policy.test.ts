import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { getRebalancePolicy, marketTargetsFor, parseUsTargetPct, saveRebalancePolicy } from '../lib/rebalance-policy'

const scratch = () => path.join(mkdtempSync(path.join(tmpdir(), 'rebalance-policy-')), 'rebalance-policy.json')

test('no saved file falls back to 50/50 and says so', () => {
  const policy = getRebalancePolicy(scratch())
  assert.equal(policy.source, 'default')
  assert.deepEqual(policy.marketTargets, [
    { market: 'KR', targetPct: 50 },
    { market: 'US', targetPct: 50 },
  ])
})

test('a saved US share is read back, with KR as the remainder', () => {
  const file = scratch()
  saveRebalancePolicy(70, file)
  const policy = getRebalancePolicy(file)
  assert.equal(policy.source, 'saved')
  assert.equal(policy.usTargetPct, 70)
  assert.deepEqual(policy.marketTargets, [
    { market: 'KR', targetPct: 30 },
    { market: 'US', targetPct: 70 },
  ])
})

test('the two targets always sum to 100, even at a fractional US share', () => {
  const [kr, us] = marketTargetsFor(33.3)
  assert.equal(kr.targetPct, 66.7)
  assert.equal(kr.targetPct + us.targetPct, 100)
})

test('input is clamped to 0-100 and non-numbers are rejected', () => {
  assert.equal(parseUsTargetPct('150'), 100)
  assert.equal(parseUsTargetPct('-5'), 0)
  assert.equal(parseUsTargetPct('72.46'), 72.5)
  assert.equal(parseUsTargetPct(''), null)
  assert.equal(parseUsTargetPct('abc'), null)
  assert.equal(parseUsTargetPct(null), null)
})

test('a corrupt file degrades to the default instead of throwing', () => {
  const file = scratch()
  writeFileSync(file, '{ not json')
  assert.equal(getRebalancePolicy(file).source, 'default')
})
