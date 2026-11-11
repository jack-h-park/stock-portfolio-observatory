import assert from 'node:assert/strict'
import test from 'node:test'
import example from '../examples/tax-history.synthetic.json'
import { validateTaxHistory } from '../lib/domain/taxes/history'
import { reconcileTaxHistory } from '../lib/domain/taxes/reconcile'

const fixture = () => structuredClone(example)
test('reviewed assessment governs without adding original and amended liabilities', () => {
  const result = reconcileTaxHistory(validateTaxHistory(fixture()))
  const us = result.obligations.find((r) => r.id === 'us-2025')!
  assert.equal(us.liabilityMinor, '11000')
  assert.equal(us.principalSettledMinor, '9500')
  assert.equal(us.outstandingMinor, '1500')
  assert.equal(us.interestSettledMinor, '100')
  assert.equal(us.penaltySettledMinor, '50')
  assert.equal(us.status, 'confirmed')
  assert.equal(result.cashEvents.filter((r) => r.id === 'payment').length, 1)
  assert.equal(result.cashEvents.find((r) => r.id === 'payment')!.principal, '10000')
})
test('missing and stale effective bases are provisional, never a guessed amount', () => {
  const data = fixture()
  data.assessments[0].recordRevision = 2
  const result = reconcileTaxHistory(validateTaxHistory(data))
  for (const row of result.obligations) {
    assert.equal(row.status, 'provisional')
    assert.equal(row.outstandingMinor, null)
  }
  assert.equal(result.obligations[0].candidates.length, 3)
})
test('unreviewed settlement and absent evidence prevent confirmed outstanding balance', () => {
  const data = fixture()
  data.events[1].review = 'unreviewed'
  data.events[1].evidenceIds = []
  const row = reconcileTaxHistory(validateTaxHistory(data)).obligations[0]
  assert.equal(row.status, 'provisional')
  assert.equal(row.outstandingMinor, null)
})
test('unallocated amounts remain visible and documents do not multiply events', () => {
  const data = fixture()
  data.allocations = data.allocations.filter((r) => r.id !== 'alloc-p24')
  const result = reconcileTaxHistory(validateTaxHistory(data))
  assert.equal(result.unallocated.find((r) => r.eventId === 'payment')!.principal, '2000')
  assert.equal(result.cashEvents.length, 4)
})
test('validation rejects duplicate IDs, dangling references and overallocations', () => {
  const duplicate = fixture()
  duplicate.events.push(duplicate.events[0])
  assert.throws(() => validateTaxHistory(duplicate), /duplicate/i)
  const dangling = fixture()
  dangling.allocations[0].eventId = 'missing'
  assert.throws(() => validateTaxHistory(dangling), /event/i)
  const excess = fixture()
  excess.allocations[1].principal = '10001'
  assert.throws(() => validateTaxHistory(excess), /allocat/i)
})
test('validation rejects cross-currency allocations, invalid signs, dates and precision', () => {
  const currency = fixture()
  currency.allocations[1].obligationId = 'kr-2025'
  assert.throws(() => validateTaxHistory(currency), /currency/i)
  const sign = fixture()
  sign.events[2].principal = '1000'
  assert.throws(() => validateTaxHistory(sign), /sign/i)
  const precision = fixture()
  precision.events[0].principal = '30.00'
  assert.throws(() => validateTaxHistory(precision), /principal/i)
  const date = fixture()
  date.events[0].date = '2025-02-30'
  assert.throws(() => validateTaxHistory(date), /date/i)
})
test('cross-year allocations retain the target tax unit and credit transfers have no cash flow', () => {
  const data = fixture()
  data.events[1].kind = 'credit-transfer'
  // Transfer allocations must balance; a cash payment cannot simply be relabeled.
  assert.throws(() => validateTaxHistory(data), /transfer/i)
  const result = reconcileTaxHistory(validateTaxHistory(fixture()))
  assert.equal(result.obligations.find((r) => r.id === 'us-2024')!.taxUnitId, 'self-2024')
})
test('a zero cash event cannot conceal opposite allocations; explicit credit transfers can', () => {
  const data = fixture()
  data.events.push({
    ...data.events[1],
    id: 'transfer',
    principal: '0',
    interest: '0',
    penalty: '0',
    evidenceIds: ['doc-1'],
  })
  data.allocations.push({ ...data.allocations[0], id: 'credit-in', eventId: 'transfer', principal: '500' })
  data.allocations.push({ ...data.allocations[2], id: 'credit-out', eventId: 'transfer', principal: '-500' })
  assert.throws(() => validateTaxHistory(data), /allocat/i)
  data.events[data.events.length - 1].kind = 'credit-transfer'
  const result = reconcileTaxHistory(validateTaxHistory(data))
  assert.equal(result.cashEvents.length, 4)
  assert.equal(result.obligations[0].principalSettledMinor, '10000')
})
