import assert from 'node:assert/strict'
import test from 'node:test'
import { depositsSeries, monthEndCash, summarizeNetWorth } from '../lib/net-worth'

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

const row = (account: string, currency: 'KRW' | 'USD', date: string, balance: number, institution = 'Example Bank') => ({ institution, account, currency, date, balance })

test('deposits series: an account that starts mid-range contributes nothing before its first balance', () => {
  const r = depositsSeries(
    ['2026-01-10', '2026-02-10', '2026-03-10'],
    [row('A', 'KRW', '2026-01-01', 100), row('B', 'KRW', '2026-02-15', 50)],
    () => 1300
  )
  assert.deepEqual(r.series, [
    { date: '2026-01-10', krw: 100 },
    { date: '2026-02-10', krw: 100 },
    { date: '2026-03-10', krw: 150 },
  ])
  assert.equal(r.since, '2026-01-01')
})

test('deposits series: dates before any account has a balance are null, not zero', () => {
  const r = depositsSeries(['2025-12-01', '2026-02-01'], [row('A', 'KRW', '2026-01-05', 100)], () => 1300)
  assert.deepEqual(r.series, [
    { date: '2025-12-01', krw: null },
    { date: '2026-02-01', krw: 100 },
  ])
  assert.equal(r.since, '2026-01-05')
})

test('deposits series: a USD account is converted with the rate for each snapshot date', () => {
  const rates: Record<string, number> = { '2026-01-10': 1300, '2026-02-10': 1400 }
  const r = depositsSeries(['2026-01-10', '2026-02-10'], [row('U', 'USD', '2026-01-01', 10)], (date) => rates[date] ?? null)
  assert.deepEqual(r.series, [
    { date: '2026-01-10', krw: 13_000 },
    { date: '2026-02-10', krw: 14_000 },
  ])
})

test('deposits series: a balance is carried forward until the next row, and the last row of a date wins', () => {
  const r = depositsSeries(
    ['2026-01-05', '2026-01-20', '2026-02-05'],
    [row('A', 'KRW', '2026-01-01', 100), row('A', 'KRW', '2026-01-15', 200), row('A', 'KRW', '2026-01-15', 250), row('A', 'KRW', '2026-02-01', 300)],
    () => 1
  )
  assert.deepEqual(r.series.map((p) => p.krw), [100, 250, 300])
})

test('deposits series: accounts are keyed by institution and account', () => {
  const r = depositsSeries(['2026-01-10'], [row('Main', 'KRW', '2026-01-01', 100, 'one'), row('Main', 'KRW', '2026-01-02', 7, 'two')], () => 1)
  assert.deepEqual(r.series, [{ date: '2026-01-10', krw: 107 }])
})

test('deposits series: an empty cash table gives a null series and no start date', () => {
  const r = depositsSeries(['2026-01-10', '2026-02-10'], [], () => 1300)
  assert.deepEqual(r.series, [
    { date: '2026-01-10', krw: null },
    { date: '2026-02-10', krw: null },
  ])
  assert.equal(r.since, null)
})

test('deposits series: a USD account with no rate on a date is left out, and the start date only counts priced accounts', () => {
  const r = depositsSeries(
    ['2026-01-10', '2026-02-10'],
    [row('U', 'USD', '2026-01-01', 10), row('A', 'KRW', '2026-02-01', 100)],
    () => null
  )
  assert.deepEqual(r.series, [
    { date: '2026-01-10', krw: null },
    { date: '2026-02-10', krw: 100 },
  ])
  assert.equal(r.since, '2026-02-01')
})
