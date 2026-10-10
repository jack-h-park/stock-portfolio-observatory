import assert from 'node:assert/strict'
import test from 'node:test'
import { monthEndCash, summarizeNetWorth } from '../lib/net-worth'

const cash = (over: object) => ({ institution: 'x', account: 'A', kind: 'checking', currency: 'KRW' as const, asOfDate: '2026-10-01', balance: 1000, derived: false, ...over })

test('KRW and USD deposits add to cash; stocks and crypto keep their own classes', () => {
  const r = summarizeNetWorth({ stocksKrw: 10_000, cryptoKrw: 500, usdKrw: 1300, cash: [cash({}), cash({ account: 'B', currency: 'USD', balance: 2 })] })
  assert.equal(r.byClass.cash, 1000 + 2600)
  assert.equal(r.totalKrw, 10_000 + 500 + 3600)
  assert.deepEqual(r.unpricedCash, [])
})

test('a USD deposit with no rate is unpriced, not zero and not one-to-one', () => {
  const r = summarizeNetWorth({ stocksKrw: 0, cryptoKrw: 0, usdKrw: null, cash: [cash({ account: 'B', currency: 'USD', balance: 2 })] })
  assert.equal(r.byClass.cash, 0)
  assert.equal(r.cash[0].krw, null)
  assert.deepEqual(r.unpricedCash, ['B'])
})

test('month-end cash takes each account’s last balance on or before the month end', () => {
  const r = monthEndCash(
    [
      { institution: 'x', account: 'A', currency: 'KRW', date: '2026-08-10', balance: 100 },
      { institution: 'x', account: 'A', currency: 'KRW', date: '2026-09-05', balance: 300 },
      { institution: 'x', account: 'B', currency: 'USD', date: '2026-09-20', balance: 1 },
    ],
    () => 1000
  )
  assert.deepEqual(r, [{ month: '2026-08', cash: 100 }, { month: '2026-09', cash: 1300 }])
})

test('a currency other than KRW or USD is unpriced, never treated as dollars', () => {
  const r = summarizeNetWorth({ stocksKrw: 0, cryptoKrw: 0, usdKrw: 1300, cash: [cash({ account: 'E', currency: 'EUR' as any, balance: 5 })] })
  assert.equal(r.cash[0].krw, null)
  assert.equal(r.byClass.cash, 0)
  assert.deepEqual(r.unpricedCash, ['E'])
})

test('month-end cash keys accounts by institution and account', () => {
  const r = monthEndCash(
    [
      { institution: 'one', account: 'Main', currency: 'KRW', date: '2026-09-05', balance: 100 },
      { institution: 'two', account: 'Main', currency: 'KRW', date: '2026-09-06', balance: 50 },
    ],
    () => 1
  )
  assert.deepEqual(r, [{ month: '2026-09', cash: 150 }])
})
