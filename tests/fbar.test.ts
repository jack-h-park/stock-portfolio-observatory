import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { config } from '@/config'
import { foreignAccountMaxima, isUsCashInstitution, lastCompleteYear, maxBalance, treasuryRateFor } from '../lib/fbar'
import treasuryRates from '../data/treasury-reporting-rates.json'

// Invented figures throughout; the repository is public. The Treasury rates
// are public data.

test('maxBalance: daily balances carried forward from before the year give the max and its date', () => {
  const r = maxBalance(
    [
      { date: '2023-11-02', valueKrw: 900 },
      { date: '2024-03-05', valueKrw: 1_500 },
      { date: '2024-03-09', valueKrw: 1_500 },
      { date: '2024-07-01', valueKrw: 400 },
      { date: '2025-02-01', valueKrw: 9_999 },
    ],
    2024
  )
  assert.deepEqual(r, { maxKrw: 1_500, date: '2024-03-05', coverage: 'daily' })
})

test('maxBalance: a balance carried in from the prior year counts on 1 January', () => {
  const r = maxBalance(
    [
      { date: '2023-12-20', valueKrw: 2_000 },
      { date: '2024-05-01', valueKrw: 1_000 },
      { date: '2024-12-31', valueKrw: 1_200 },
    ],
    2024
  )
  assert.deepEqual(r, { maxKrw: 2_000, date: '2024-01-01', coverage: 'daily' })
})

test('maxBalance: month-end values give month_end coverage', () => {
  const points = ['2023-12-31', '2024-01-31', '2024-06-30', '2024-12-31'].map((date, i) => ({ date, valueKrw: [10, 30, 70, 50][i] }))
  assert.deepEqual(maxBalance(points, 2024, 'month_end'), { maxKrw: 70, date: '2024-06-30', coverage: 'month_end' })
})

test('maxBalance: certificate points give year_end coverage', () => {
  const points = [
    { date: '2023-12-31', valueKrw: 100 },
    { date: '2024-12-31', valueKrw: 140 },
  ]
  assert.deepEqual(maxBalance(points, 2024, 'year_end'), { maxKrw: 140, date: '2024-12-31', coverage: 'year_end' })
})

test('maxBalance: history that starts after 1 January or ends before 31 December is partial', () => {
  const late = maxBalance(
    [
      { date: '2024-04-10', valueKrw: 300 },
      { date: '2025-01-05', valueKrw: 100 },
    ],
    2024
  )
  assert.deepEqual(late, { maxKrw: 300, date: '2024-04-10', coverage: 'partial' })
  const early = maxBalance(
    [
      { date: '2023-12-31', valueKrw: 100 },
      { date: '2024-01-31', valueKrw: 500 },
      { date: '2024-08-31', valueKrw: 200 },
    ],
    2024,
    'month_end'
  )
  assert.equal(early?.coverage, 'partial')
  assert.equal(early?.maxKrw, 500)
})

test('maxBalance: no point in or before the year is null', () => {
  assert.equal(maxBalance([{ date: '2025-03-01', valueKrw: 1 }], 2024), null)
  assert.equal(maxBalance([], 2024), null)
})

test('the Treasury rates file holds the year-end KRW rate for 2020 through 2025, with its query URL', () => {
  assert.match(treasuryRates.source, /^https:\/\/api\.fiscaldata\.treasury\.gov\/.*rates_of_exchange.*Korea-Won/)
  assert.deepEqual(
    treasuryRates.rates.map((r) => [r.year, r.date]),
    [2020, 2021, 2022, 2023, 2024, 2025].map((y) => [y, `${y}-12-31`])
  )
  assert.equal(treasuryRateFor(2024, treasuryRates.rates)?.krwPerUsd, 1473.27)
  assert.equal(treasuryRateFor(2019, treasuryRates.rates), null)
})

test('US institutions are not foreign; Korean ones are', () => {
  for (const name of ['chase', 'boa', 'robinhood-bank', 'fidelity', 'Chase']) assert.equal(isUsCashInstitution(name), true, name)
  for (const name of ['mg', 'tossbank', 'mirae', 'hana', 'Sample Bank']) assert.equal(isUsCashInstitution(name), false, name)
})

test('lastCompleteYear is the year before today', () => {
  assert.equal(lastCompleteYear('2026-10-10'), 2025)
  assert.equal(lastCompleteYear('2026-01-01'), 2025)
})

test('foreignAccountMaxima converts at the Treasury rate; a USD account keeps its own USD max', () => {
  const r = foreignAccountMaxima(2024, { krwPerUsd: 1_000, date: '2024-12-31' }, [
    { account: 'A', kind: 'brokerage', maxKrw: 5_000_000, maxDate: '2024-06-30', coverage: 'month_end' },
    { account: 'B', kind: 'cash', maxKrw: 2_000_000, maxDate: '2024-02-01', coverage: 'daily' },
    { account: 'C', kind: 'cash', maxKrw: 3_300_000, maxDate: '2024-03-01', coverage: 'daily', maxUsdNative: 2_500 },
  ])
  assert.deepEqual(r.rows, [
    { account: 'A', kind: 'brokerage', maxKrw: 5_000_000, maxDate: '2024-06-30', maxUsd: 5_000, coverage: 'month_end', understated: true },
    { account: 'B', kind: 'cash', maxKrw: 2_000_000, maxDate: '2024-02-01', maxUsd: 2_000, coverage: 'daily', understated: false },
    { account: 'C', kind: 'cash', maxKrw: 2_500_000, maxDate: '2024-03-01', maxUsd: 2_500, coverage: 'daily', understated: false },
  ])
  assert.equal(r.aggregateMaxUsd, 9_500)
})

test('foreignAccountMaxima with no rate leaves every maxUsd null', () => {
  const r = foreignAccountMaxima(2026, null, [
    { account: 'A', kind: 'cash', maxKrw: 1_000, maxDate: '2026-02-01', coverage: 'partial', maxUsdNative: 1 },
  ])
  assert.equal(r.rate, null)
  assert.equal(r.rows[0].maxUsd, null)
  assert.equal(r.rows[0].maxKrw, 1_000)
  assert.equal(r.aggregateMaxUsd, null)
})

// --- adapter ----------------------------------------------------------------

function scenarioDb() {
  const dir = mkdtempSync(path.join(tmpdir(), 'fbar-'))
  const dbPath = path.join(dir, 'fbar.db')
  const db = new Database(dbPath)
  const lotCols = `id integer primary key, market text not null, currency text not null, account text not null, ticker text not null,
    acquired_date text, asset_class text not null default 'security', account_wrapper text not null default 'taxable'`
  db.exec(`
    create table cash_balances (id integer primary key, institution text not null, account text not null, owner text not null default 'self', kind text not null,
      currency text not null, as_of_date text not null, balance real not null, source text not null, derived integer not null default 0);
    create table tax_lots_all (${lotCols}, open_quantity real not null, native_cost_basis real not null, cost_basis_krw real not null);
    create table realized_lots_all (${lotCols}, sold_date text, quantity_sold real, cost_basis_krw real);
    create table historical_prices (id integer primary key, market text not null, ticker text not null, symbol text not null, currency text not null,
      price_date text not null, close real not null, source text not null);
    create table historical_fx_rates (id integer primary key, price_date text not null unique, rate real not null, source text not null);
    create table fx_rates (id integer primary key, from_currency text, to_currency text, as_of_date text, rate real);
    create table pension_points (id integer primary key, account text not null, account_wrapper text not null, date text not null, value_krw real not null, source text not null);
    create table transactions_all (id integer primary key, market text not null, currency text not null, date text not null, account text not null, type text not null,
      ticker text, quantity real, amount_krw real, settlement_krw real, asset_class text not null default 'security', account_wrapper text not null default 'taxable');
    create table gold_prices (id integer primary key, date text not null unique, price real not null, source text not null);
  `)
  const cash = db.prepare('insert into cash_balances (institution, account, kind, currency, as_of_date, balance, source) values (?, ?, ?, ?, ?, ?, ?)')
  // A US bank: never foreign, however large.
  cash.run('chase', 'Example checking', 'checking', 'USD', '2023-12-01', 90_000, 'x')
  cash.run('chase', 'Example checking', 'checking', 'USD', '2025-01-01', 90_000, 'x')
  // A Korean KRW savings account, carried forward through 2024.
  cash.run('tossbank', 'Example savings', 'savings', 'KRW', '2023-12-15', 1_000_000, 'x')
  cash.run('tossbank', 'Example savings', 'savings', 'KRW', '2024-04-02', 3_000_000, 'x')
  cash.run('tossbank', 'Example savings', 'savings', 'KRW', '2024-09-01', 500_000, 'x')
  cash.run('tossbank', 'Example savings', 'savings', 'KRW', '2025-03-01', 600_000, 'x')
  // A Korean USD account: its max is in dollars.
  cash.run('hana', 'Example USD', 'fx', 'USD', '2023-12-31', 1_000, 'x')
  cash.run('hana', 'Example USD', 'fx', 'USD', '2024-05-10', 4_000, 'x')
  cash.run('hana', 'Example USD', 'fx', 'USD', '2025-01-02', 100, 'x')

  const lot = db.prepare(
    'insert into tax_lots_all (market, currency, account, ticker, acquired_date, open_quantity, native_cost_basis, cost_basis_krw, account_wrapper) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  lot.run('KR', 'KRW', 'Example KR general', '000001', '2023-06-01', 10, 100_000, 100_000, 'taxable')
  // A US-market account: never foreign.
  lot.run('US', 'USD', 'Example US brokerage', 'EXMP', '2023-06-01', 100, 10_000, 13_000_000, 'taxable')
  db.prepare(
    'insert into realized_lots_all (market, currency, account, ticker, acquired_date, sold_date, quantity_sold, cost_basis_krw, account_wrapper) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('KR', 'KRW', 'Example KR general', '000001', '2023-06-01', '2024-07-15', 5, 50_000, 'taxable')
  const price = db.prepare("insert into historical_prices (market, ticker, symbol, currency, price_date, close, source) values (?, ?, ?, ?, ?, ?, 'x')")
  price.run('KR', '000001', '000001', 'KRW', '2023-12-28', 10_000)
  price.run('KR', '000001', '000001', 'KRW', '2024-06-28', 20_000)
  price.run('KR', '000001', '000001', 'KRW', '2024-12-30', 15_000)
  price.run('US', 'EXMP', 'EXMP', 'USD', '2023-12-28', 999)
  db.prepare("insert into historical_fx_rates (price_date, rate, source) values ('2023-01-02', 1300, 'x')").run()
  db.prepare("insert into fx_rates (from_currency, to_currency, as_of_date, rate) values ('USD', 'KRW', '2026-10-01', 1400)").run()

  const pension = db.prepare("insert into pension_points (account, account_wrapper, date, value_krw, source) values (?, 'irp', ?, ?, 'certificate')")
  pension.run('Example IRP', '2023-12-31', 7_000_000)
  pension.run('Example IRP', '2024-12-31', 8_000_000)

  db.prepare(
    "insert into transactions_all (market, currency, date, account, type, ticker, quantity, amount_krw, settlement_krw, asset_class) values ('KR', 'KRW', '2024-02-01', 'Example gold', 'BUY', 'GOLD', 10, 1_000_000, 1_000_000, 'gold')"
  ).run()
  db.close()
  return dbPath
}

test('getForeignAccountMaxima excludes US institutions and converts at the Treasury rate', async () => {
  config.stockDbPath = scenarioDb()
  const { getForeignAccountMaxima } = await import('../lib/adapters/portfolio-db')
  const r = getForeignAccountMaxima(2024)
  assert.deepEqual(r.rate, { krwPerUsd: 1473.27, date: '2024-12-31' })
  const byAccount = new Map(r.rows.map((row) => [row.account, row]))
  assert.deepEqual([...byAccount.keys()].sort(), ['Example IRP', 'Example KR general', 'Example USD', 'Example gold', 'Example savings'])
  assert.ok(!byAccount.has('Example checking'))
  assert.ok(!byAccount.has('Example US brokerage'))

  const savings = byAccount.get('Example savings')!
  assert.deepEqual(
    { kind: savings.kind, maxKrw: savings.maxKrw, maxDate: savings.maxDate, coverage: savings.coverage, understated: savings.understated },
    { kind: 'cash', maxKrw: 3_000_000, maxDate: '2024-04-02', coverage: 'daily', understated: false }
  )
  assert.equal(savings.maxUsd, 3_000_000 / 1473.27)

  const usd = byAccount.get('Example USD')!
  assert.equal(usd.maxUsd, 4_000)
  assert.equal(usd.maxKrw, 4_000 * 1473.27)

  // Month-end lots × price: 15 shares (10 still open, 5 sold in July) at 20,000 on 2024-06-30.
  const kr = byAccount.get('Example KR general')!
  assert.deepEqual([kr.kind, kr.maxKrw, kr.maxDate, kr.coverage, kr.understated], ['brokerage', 300_000, '2024-06-30', 'month_end', true])

  const irp = byAccount.get('Example IRP')!
  assert.deepEqual([irp.kind, irp.maxKrw, irp.maxDate, irp.coverage], ['pension', 8_000_000, '2024-12-31', 'year_end'])

  // No gold price stored: valued at cost, and partial.
  const gold = byAccount.get('Example gold')!
  assert.deepEqual([gold.kind, gold.maxKrw, gold.coverage, gold.understated], ['gold', 1_000_000, 'partial', true])

  const sum = r.rows.reduce((s, row) => s + (row.maxUsd ?? 0), 0)
  assert.equal(r.aggregateMaxUsd, sum)
})

test('getForeignAccountMaxima for a year with no Treasury rate gives KRW only', async () => {
  config.stockDbPath = scenarioDb()
  const { getForeignAccountMaxima } = await import('../lib/adapters/portfolio-db')
  // The file stops at 2025: 2026 has no year-end rate yet.
  const r = getForeignAccountMaxima(2026)
  assert.equal(r.rate, null)
  assert.equal(r.aggregateMaxUsd, null)
  assert.ok(r.rows.length > 0)
  for (const row of r.rows) assert.equal(row.maxUsd, null)
  // A USD account's won figure falls back to the market rate on the date of its maximum.
  const usd = r.rows.find((row) => row.account === 'Example USD')!
  assert.equal(usd.maxKrw, 100 * 1300)
  // The savings history stops in 2025: carried into 2026, but it never reaches 31 December.
  assert.equal(r.rows.find((row) => row.account === 'Example savings')!.coverage, 'partial')
})
