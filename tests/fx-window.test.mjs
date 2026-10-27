// The historical USD/KRW table has to reach the earliest income row. A row dated
// a few days before the first trade left `income_fx_dated` warning because the
// table started on the first trade. Every date below is invented.
import assert from 'node:assert/strict'
import test from 'node:test'
import { fxCoversIncome, fxWindowStart } from '../scripts/fx-window.mjs'

test('the table starts on the first trade when no income row is earlier', () => {
  assert.equal(fxWindowStart('2020-03-09', ''), '2020-03-09')
  assert.equal(fxWindowStart('2020-03-09', '2020-03-09'), '2020-03-09')
  assert.equal(fxWindowStart('2020-03-09', '2020-09-01'), '2020-03-09')
})

test('an earlier income row moves the start a week before it, past a weekend', () => {
  // 2020-03-05 is a Thursday; a week earlier is a business day with a quote.
  assert.equal(fxWindowStart('2020-03-09', '2020-03-05'), '2020-02-27')
  // Across a month boundary.
  assert.equal(fxWindowStart('2021-03-08', '2021-03-06'), '2021-02-27')
})

test('with no trade date the earlier income row decides', () => {
  assert.equal(fxWindowStart('', '2020-03-05'), '2020-02-27')
})

test('a table already covers the earliest income row only if it starts on or before it', () => {
  assert.equal(fxCoversIncome('2020-03-09', '2020-03-05'), false)
  assert.equal(fxCoversIncome('2020-02-27', '2020-03-05'), true)
  assert.equal(fxCoversIncome('2020-03-09', '2020-03-09'), true)
})

test('no income row, or no table at all, is handled', () => {
  assert.equal(fxCoversIncome('2020-03-09', ''), true)
  assert.equal(fxCoversIncome(undefined, '2020-03-05'), false)
})
