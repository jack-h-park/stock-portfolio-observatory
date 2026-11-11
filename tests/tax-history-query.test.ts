import assert from 'node:assert/strict'
import test from 'node:test'
import example from '../examples/tax-history.synthetic.json'
import { validateTaxHistory } from '../lib/domain/taxes/history'
import { getTaxHistoryView, canCompareTaxEstimate } from '../lib/application/tax-history-query'

test('cash-date ranges filter occurrence dates independently of obligation year and posting date', () => {
  const store = validateTaxHistory(example)
  const view = getTaxHistoryView(store, {
    taxUnitId: 'self-2025',
    view: 'cash-date',
    cashDateFrom: '2026-04-10',
    cashDateTo: '2026-04-10',
  })
  assert.deepEqual(
    view.cashEvents.map((row) => row.id),
    ['payment'],
  )
  assert.equal(view.cashEvents[0].principal, '8000')
  assert.equal(
    getTaxHistoryView(store, {
      taxUnitId: 'self-2024',
      view: 'cash-date',
      cashDateFrom: '2026-04-10',
      cashDateTo: '2026-04-10',
    }).cashEvents[0].principal,
    '2000',
  )
  assert.equal(
    getTaxHistoryView(store, {
      taxUnitId: 'self-2025',
      view: 'cash-date',
      cashDateFrom: '2026-04-12',
      cashDateTo: '2026-04-12',
    }).cashEvents.length,
    0,
  )
})
test('tax-unit scope never includes another unit and date/year validation is explicit', () => {
  const store = validateTaxHistory(example)
  assert.deepEqual(
    getTaxHistoryView(store, { taxUnitId: 'self-2024', view: 'tax-year', taxYear: 2024 }).obligations.map(
      (row) => row.id,
    ),
    ['us-2024'],
  )
  assert.throws(() => getTaxHistoryView(store, { taxUnitId: 'self-2025', view: 'tax-year' }), /year/i)
  assert.throws(
    () => getTaxHistoryView(store, { taxUnitId: 'self-2025', view: 'cash-date', cashDateFrom: '2026-02-30' }),
    /date/i,
  )
  assert.throws(
    () =>
      getTaxHistoryView(store, {
        taxUnitId: 'self-2025',
        view: 'cash-date',
        cashDateFrom: '2026-05-01',
        cashDateTo: '2026-04-01',
      }),
    /range/i,
  )
})
test('estimate comparison requires all scope dimensions and excludes investment increments', () => {
  const annual = {
    taxUnitId: 'self-2025',
    taxYear: 2025,
    authority: 'US:federal',
    currency: 'USD',
    scope: 'annual-total',
  }
  assert.equal(canCompareTaxEstimate(annual, annual), true)
  for (const key of ['taxUnitId', 'taxYear', 'authority', 'currency', 'scope'])
    assert.equal(canCompareTaxEstimate(annual, { ...annual, [key]: 'different' }), false)
  assert.equal(canCompareTaxEstimate({ ...annual, scope: 'investment-incremental' }, annual), false)
})
test('an explicitly selected all-units view counts a cross-year payment once and labels its allocations', () => {
  const view = getTaxHistoryView(validateTaxHistory(example), { taxUnitId: '__all__', view: 'cash-date', cashDateFrom: '2026-04-10', cashDateTo: '2026-04-10' })
  assert.equal(view.cashEvents.length, 1)
  assert.equal(view.cashEvents[0].principal, '10000')
  assert.deepEqual(view.cashEvents[0].taxUnitIds, ['self-2024', 'self-2025'])
})
