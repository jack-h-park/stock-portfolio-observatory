import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { SLEEVES, validateAllocationPolicy, type AllocationPolicy } from '../lib/rebalance/allocation-policy'
import { classesFromSettingsForm, policyFromSettingsForm } from '../lib/rebalance/settings-form'

const example = (): AllocationPolicy => {
  const raw = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'allocation-policy.example.json'), 'utf8'))
  for (const key of Object.keys(raw)) if (key.startsWith('_')) delete raw[key]
  return raw as AllocationPolicy
}

function boundsForm(targets: Record<string, number>, extra: Record<string, string> = {}) {
  const form = new FormData()
  for (const sleeve of SLEEVES) {
    form.set(`min_${sleeve}`, '0')
    form.set(`max_${sleeve}`, '100')
    form.set(`target_${sleeve}`, String(targets[sleeve]))
    form.set(`band_${sleeve}`, '5')
  }
  for (const [key, value] of Object.entries(extra)) form.set(key, value)
  return form
}

test('parses all six sleeves', () => {
  const form = new FormData()
  const values = { kr_equity: [10, 80, 30, 4], us_equity: [20, 70, 40, 3], bonds: [0, 20, 10, 2], gold: [0, 15, 5, 1], crypto: [0, 10, 5, 2], cash: [5, 30, 10, 5] }
  for (const [sleeve, [min, max, target, band]] of Object.entries(values)) {
    form.set(`min_${sleeve}`, String(min))
    form.set(`max_${sleeve}`, String(max))
    form.set(`target_${sleeve}`, String(target))
    form.set(`band_${sleeve}`, String(band))
  }
  const { policy, errors } = policyFromSettingsForm(form, example())
  assert.deepEqual(errors, [])
  assert.deepEqual(policy.bounds.sleeves.kr_equity, { min: 10, max: 80 })
  assert.deepEqual(policy.targets.us_equity, { target: 40, band: 3 })
  assert.deepEqual(policy.targets.cash, { target: 10, band: 5 })
  assert.equal(SLEEVES.length, 6)
  assert.deepEqual(validateAllocationPolicy(policy), [])
})

test('returns errors and leaves policy untouched when the sum != 100', () => {
  const current = example()
  const before = structuredClone(current)
  const { policy, errors } = policyFromSettingsForm(
    boundsForm({ kr_equity: 30, us_equity: 45, bonds: 5, gold: 5, crypto: 5, cash: 5 }),
    current,
  )
  assert.ok(errors.some((e) => /sum to 95/.test(e)), errors.join('|'))
  assert.deepEqual(policy, before)
  assert.deepEqual(current, before)
})

test('reports a field that is not a number', () => {
  const form = boundsForm({ kr_equity: 30, us_equity: 45, bonds: 5, gold: 5, crypto: 5, cash: 10 }, { target_gold: 'abc' })
  const { policy, errors } = policyFromSettingsForm(form, example())
  assert.ok(errors.some((e) => /gold/.test(e) && /number/.test(e)), errors.join('|'))
  assert.deepEqual(policy, example())
})

test('buy-list lines parse and reject malformed lines with the line number', () => {
  const ok = new FormData()
  ok.set('buy_us_equity', 'US:AAA@Broker One::ACCT-1\n\nKR:KRX1@::ACCT-2\n')
  const parsed = policyFromSettingsForm(ok, example())
  assert.deepEqual(parsed.errors, [])
  assert.deepEqual(parsed.policy.preferredInstruments.us_equity, [
    { market: 'US', ticker: 'AAA', brokerage: 'Broker One', account: 'ACCT-1' },
    { market: 'KR', ticker: 'KRX1', brokerage: null, account: 'ACCT-2' },
  ])

  const bad = new FormData()
  bad.set('buy_bonds', 'US:AAA@B::A1\nnot a line\nUS:BBB@B')
  const rejected = policyFromSettingsForm(bad, example())
  assert.equal(rejected.errors.length, 2)
  assert.match(rejected.errors[0], /line 2/)
  assert.match(rejected.errors[1], /line 3/)
  assert.deepEqual(rejected.policy, example())
})

test('an emptied buy list removes the sleeve entry', () => {
  const current = example()
  current.preferredInstruments = { gold: [{ market: 'KR', ticker: 'KRX1', brokerage: null, account: 'A' }] }
  const form = new FormData()
  form.set('buy_gold', '  \n')
  const { policy, errors } = policyFromSettingsForm(form, current)
  assert.deepEqual(errors, [])
  assert.equal(policy.preferredInstruments.gold, undefined)
})

test('missing policy starts from the example shape with every sleeve at 0 and is invalid until filled', () => {
  const { policy, errors } = policyFromSettingsForm(new FormData(), null)
  for (const sleeve of SLEEVES) {
    assert.equal(policy.targets[sleeve].target, 0)
    assert.equal(policy.targets[sleeve].band, 5)
    assert.deepEqual(policy.bounds.sleeves[sleeve], { min: 0, max: 100 })
  }
  assert.equal(policy.bounds.positionCapPct, example().bounds.positionCapPct)
  assert.equal(policy.bounds.minTradeKrw, example().bounds.minTradeKrw)
  assert.ok(errors.some((e) => /sum to 0/.test(e)))

  const filled = policyFromSettingsForm(boundsForm({ kr_equity: 30, us_equity: 45, bonds: 5, gold: 5, crypto: 5, cash: 10 }), null)
  assert.deepEqual(filled.errors, [])
  assert.equal(filled.policy.targets.us_equity.target, 45)
})

test('limits and account rules parse', () => {
  const form = new FormData()
  form.set('positionCapPct', '12')
  form.set('maxTargetShiftPctPerCycle', '4')
  form.set('maxTurnoverPctPerProposal', '8')
  form.set('minTradeKrw', '50000')
  form.set('staleDataDays', '30')
  form.set('harvestThresholdKrw', '2000000')
  form.set('acct_key_0', 'Broker One::ACCT-1')
  form.set('acct_lot_0', 'specific')
  form.set('acct_fractional_0', 'on')
  form.set('acct_managedBy_0', 'advisor')
  form.set('acct_key_1', '::ACCT-2')
  form.set('acct_lot_1', 'average')
  form.set('acct_excluded_1', 'on')
  const { policy, errors } = policyFromSettingsForm(form, example())
  assert.deepEqual(errors, [])
  assert.equal(policy.bounds.positionCapPct, 12)
  assert.equal(policy.bounds.harvestThresholdKrw, 2000000)
  assert.deepEqual(policy.accounts['Broker One::ACCT-1'], { lotMethod: 'specific', fractional: true, managedBy: 'advisor', excludedCash: false })
  assert.deepEqual(policy.accounts['::ACCT-2'], { lotMethod: 'average', fractional: false, managedBy: null, excludedCash: true })

  const bad = new FormData()
  bad.set('acct_key_0', 'B::A')
  bad.set('acct_lot_0', 'lifo')
  assert.ok(policyFromSettingsForm(bad, example()).errors.some((e) => /lot method/.test(e)))
})

test('classesFromSettingsForm sets, clears and rejects', () => {
  const current = { 'US:AAA': 'us_equity' as const, 'KR:KRX1': 'kr_equity' as const }
  const form = new FormData()
  form.set('class_US:AAA', '')
  form.set('class_KR:KRX1', 'bonds')
  form.set('class_US:BBB', 'gold')
  const { classes, errors } = classesFromSettingsForm(form, current)
  assert.deepEqual(errors, [])
  assert.deepEqual(classes, { 'KR:KRX1': 'bonds', 'US:BBB': 'gold' })
  const bad = new FormData()
  bad.set('class_US:AAA', 'stocks')
  const rejected = classesFromSettingsForm(bad, current)
  assert.equal(rejected.errors.length, 1)
  assert.deepEqual(rejected.classes, current)
})
