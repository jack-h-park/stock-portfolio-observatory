import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { config } from '@/config'
import { foreignAccountMaxima, isUsBrokerage, isUsCashInstitution, lastCompleteYear, maxBalance, treasuryRateFor } from '../lib/fbar'
import { bankAccountName, brokerageAccountLabel, retiredBankAccounts, retiredBrokerageAccounts } from '../lib/bank-accounts'
import treasuryRates from '../data/treasury-reporting-rates.json'

// No real account map: a test that needs one writes its own.
config.stockAccountMapPath = path.join(mkdtempSync(path.join(tmpdir(), 'fbar-map-')), 'absent.json')

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

test('US brokerages are named by brokerage, or by account when the brokerage is blank; Korean brokers are foreign', () => {
  for (const [brokerage, account] of [['Robinhood', 'Robinhood individual'], ['Fidelity', 'Fidelity Account'], ['Chase', 'Chase x'], ['Merrill', 'Merrill y'], [null, 'Merrill CMA'], ['', 'Fidelity Account']] as const)
    assert.equal(isUsBrokerage(brokerage, account), true, `${brokerage} ${account}`)
  for (const [brokerage, account] of [['Example KR Broker', 'Example KR Broker'], ['미래에셋증권', '미래에셋증권(종합)'], [null, 'Example general']] as const)
    assert.equal(isUsBrokerage(brokerage, account), false, `${brokerage} ${account}`)
})

test('lastCompleteYear is the year before today', () => {
  assert.equal(lastCompleteYear('2026-10-10'), 2025)
  assert.equal(lastCompleteYear('2026-01-01'), 2025)
})

test('foreignAccountMaxima converts at the Treasury rate; a USD account keeps its own USD max', () => {
  const r = foreignAccountMaxima(2024, { krwPerUsd: 1_000, date: '2024-12-31' }, [
    { institution: 'X', account: 'A', kind: 'brokerage', maxKrw: 5_000_000, maxDate: '2024-06-30', coverage: 'month_end' },
    { institution: 'Y', account: 'B', kind: 'cash', maxKrw: 2_000_000, maxDate: '2024-02-01', coverage: 'daily' },
    { institution: 'Z', account: 'C', kind: 'cash', maxKrw: 3_300_000, maxDate: '2024-03-01', coverage: 'daily', maxUsdNative: 2_500 },
  ])
  assert.deepEqual(r.rows, [
    { id: 'X|A', institution: 'X', account: 'A', kind: 'brokerage', maxKrw: 5_000_000, maxDate: '2024-06-30', maxUsd: 5_000, coverage: 'month_end', understated: true },
    { id: 'Y|B', institution: 'Y', account: 'B', kind: 'cash', maxKrw: 2_000_000, maxDate: '2024-02-01', maxUsd: 2_000, coverage: 'daily', understated: false },
    { id: 'Z|C', institution: 'Z', account: 'C', kind: 'cash', maxKrw: 2_500_000, maxDate: '2024-03-01', maxUsd: 2_500, coverage: 'daily', understated: false },
  ])
  assert.equal(r.aggregateMaxUsd, 9_500)
})

test('foreignAccountMaxima with no rate leaves every maxUsd null', () => {
  const r = foreignAccountMaxima(2026, null, [
    { institution: 'X', account: 'A', kind: 'cash', maxKrw: 1_000, maxDate: '2026-02-01', coverage: 'partial', maxUsdNative: 1 },
    { institution: 'X', account: 'B', kind: 'cash', maxKrw: null, maxDate: '2026-02-01', coverage: 'partial', maxUsdNative: 5 },
  ])
  assert.equal(r.rate, null)
  assert.equal(r.rows[0].maxUsd, null)
  assert.equal(r.rows[0].maxKrw, 1_000)
  // A USD account with no rate at all keeps its row, with no won figure.
  assert.equal(r.rows[1].maxKrw, null)
  assert.equal(r.aggregateMaxUsd, null)
})

test('foreignAccountMaxima keeps crypto exchange rows out of the aggregate, with their own subtotal', () => {
  const r = foreignAccountMaxima(2024, { krwPerUsd: 1_000, date: '2024-12-31' }, [
    { institution: 'X', account: 'A', kind: 'brokerage', maxKrw: 5_000_000, maxDate: '2024-06-30', coverage: 'month_end', cashIncluded: false },
    { institution: 'Ex', account: 'Ex', kind: 'crypto', maxKrw: 2_000_000, maxDate: '2024-03-31', coverage: 'month_end', cashIncluded: false },
  ])
  assert.deepEqual(r.rows.map((row) => row.id), ['X|A'])
  assert.equal(r.rows[0].cashIncluded, false)
  assert.equal(r.aggregateMaxUsd, 5_000)
  assert.deepEqual(r.cryptoRows, [
    { id: 'Ex|Ex', institution: 'Ex', account: 'Ex', kind: 'crypto', maxKrw: 2_000_000, maxDate: '2024-03-31', maxUsd: 2_000, coverage: 'month_end', understated: true, cashIncluded: false },
  ])
  assert.equal(r.cryptoSubtotalMaxUsd, 2_000)
  assert.equal(foreignAccountMaxima(2026, null, []).cryptoSubtotalMaxUsd, null)
})

test('bankAccountName names an entry the way the bank extractor names its account', () => {
  assert.equal(bankAccountName({ institution: 'tossbank', last4: '1111', kind: 'savings', alias: 'Example savings' }), 'Example savings')
  assert.equal(bankAccountName({ institution: 'tossbank', last4: '1111', kind: 'savings' }), 'tossbank 1111')
  assert.equal(bankAccountName({ institution: 'mirae', kind: 'cma' }), '미래에셋 CMA')
  assert.equal(bankAccountName({ institution: 'mg', kind: 'deposit' }), 'mg deposit')
  // Only the families whose files carry a last4 (Toss Bank) are named by it.
  assert.equal(bankAccountName({ institution: 'mg', last4: '2222', kind: 'deposit' }), 'mg deposit')
})

test('retiredBankAccounts lists entries marked retired, with the retirement date when one is given', () => {
  const retired = retiredBankAccounts([
    { institution: 'tossbank', last4: '1111', kind: 'savings', alias: 'Example savings', retiredOn: '2024-06-30' },
    { institution: 'mg', last4: '2222', kind: 'deposit', retired: true },
    { institution: 'hana', kind: 'fx', alias: 'Example USD' },
    { institution: 'boa', kind: 'checking', alias: 'Example old', retired: false },
    { institution: 'bad', kind: 'checking', retiredOn: 'soon' },
  ])
  assert.deepEqual(
    [...retired.entries()],
    [
      ['tossbank|Example savings', '2024-06-30'],
      ['mg|mg deposit', null],
    ]
  )
})

// --- adapter ----------------------------------------------------------------

function scenarioDb({ withFx = true, extra }: { withFx?: boolean; extra?: (db: Database.Database) => void } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fbar-'))
  const dbPath = path.join(dir, 'fbar.db')
  const db = new Database(dbPath)
  const lotCols = `id integer primary key, market text not null, currency text not null, brokerage text, account text not null, ticker text not null,
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
  // A second institution with the same alias: its own row.
  cash.run('mg', 'Example savings', 'savings', 'KRW', '2023-12-01', 50_000, 'x')
  cash.run('mg', 'Example savings', 'savings', 'KRW', '2025-01-01', 50_000, 'x')

  const lot = db.prepare(
    'insert into tax_lots_all (market, currency, brokerage, account, ticker, acquired_date, open_quantity, native_cost_basis, cost_basis_krw, account_wrapper) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  lot.run('KR', 'KRW', 'Example KR Broker', 'Example KR general', '000001', '2023-06-01', 10, 100_000, 100_000, 'taxable')
  // A Korean broker's US stock: market US, still a foreign account.
  lot.run('US', 'USD', 'Example KR Broker', 'Example KR overseas', 'EXUS', '2024-03-01', 2, 200, 260_000, 'taxable')
  // A US brokerage: never foreign.
  lot.run('US', 'USD', 'Robinhood', 'Example US brokerage', 'EXMP', '2023-06-01', 100, 10_000, 13_000_000, 'taxable')
  db.prepare(
    'insert into realized_lots_all (market, currency, brokerage, account, ticker, acquired_date, sold_date, quantity_sold, cost_basis_krw, account_wrapper) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('KR', 'KRW', 'Example KR Broker', 'Example KR general', '000001', '2023-06-01', '2024-07-15', 5, 50_000, 'taxable')
  const price = db.prepare("insert into historical_prices (market, ticker, symbol, currency, price_date, close, source) values (?, ?, ?, ?, ?, ?, 'x')")
  price.run('KR', '000001', '000001', 'KRW', '2023-12-28', 10_000)
  price.run('KR', '000001', '000001', 'KRW', '2024-06-28', 20_000)
  price.run('KR', '000001', '000001', 'KRW', '2024-12-30', 15_000)
  price.run('US', 'EXMP', 'EXMP', 'USD', '2023-12-28', 999)
  price.run('US', 'EXUS', 'EXUS', 'USD', '2024-03-28', 100)
  price.run('US', 'EXUS', 'EXUS', 'USD', '2024-11-29', 150)
  if (withFx) {
    db.prepare("insert into historical_fx_rates (price_date, rate, source) values ('2023-01-02', 1300, 'x')").run()
    db.prepare("insert into historical_fx_rates (price_date, rate, source) values ('2024-12-02', 1400, 'x')").run()
    db.prepare("insert into fx_rates (from_currency, to_currency, as_of_date, rate) values ('USD', 'KRW', '2026-10-01', 1400)").run()
  }

  const pension = db.prepare("insert into pension_points (account, account_wrapper, date, value_krw, source) values (?, 'irp', ?, ?, 'certificate')")
  pension.run('Example(IRP)', '2023-12-31', 7_000_000)
  pension.run('Example(IRP)', '2024-12-31', 8_000_000)

  db.prepare(
    "insert into transactions_all (market, currency, date, account, type, ticker, quantity, amount_krw, settlement_krw, asset_class) values ('KR', 'KRW', '2024-02-01', 'Example(gold)', 'BUY', 'GOLD', 10, 1_000_000, 1_000_000, 'gold')"
  ).run()
  extra?.(db)
  db.close()
  return dbPath
}

const BROKERAGE_CASH_TABLE = `create table brokerage_cash (id integer primary key, institution text not null, account text not null, pool text not null, currency text not null,
  as_of_date text not null, balance real not null, source text not null, account_wrapper text not null default 'taxable', asset_class text not null default 'security')`

/** Statement periods per account, as the extractor writes them to cash-coverage.tsv. */
function cashCoverage(db: Database.Database, rows: [string, string, string, string][]) {
  db.exec('create table brokerage_cash_coverage (id integer primary key, institution text not null, account text not null, source text not null, period_start text not null, period_end text not null)')
  const insert = db.prepare("insert into brokerage_cash_coverage (institution, account, source, period_start, period_end) values (?, ?, 'x', ?, ?)")
  for (const row of rows) insert.run(...row)
}

function brokerageCash(db: Database.Database, rows: [string, string, string, string, string, number, string?][]) {
  db.exec(BROKERAGE_CASH_TABLE)
  const insert = db.prepare(
    "insert into brokerage_cash (institution, account, pool, currency, as_of_date, balance, source, account_wrapper) values (?, ?, ?, ?, ?, ?, 'x', ?)"
  )
  for (const [institution, account, pool, currency, date, balance, wrapper] of rows) insert.run(institution, account, pool, currency, date, balance, wrapper ?? 'taxable')
}

test('getForeignAccountMaxima excludes US institutions and converts at the Treasury rate', async () => {
  config.stockDbPath = scenarioDb()
  const { getForeignAccountMaxima } = await import('../lib/adapters/portfolio-db')
  const r = getForeignAccountMaxima(2024)
  assert.deepEqual(r.rate, { krwPerUsd: 1473.27, date: '2024-12-31' })
  const byAccount = new Map(r.rows.map((row) => [row.id, row]))
  assert.deepEqual([...byAccount.keys()].sort(), [
    'Example KR Broker|Example KR general',
    'Example KR Broker|Example KR overseas',
    'Example|Example(gold)',
    'Example|Example(IRP)',
    'hana|Example USD',
    'mg|Example savings',
    'tossbank|Example savings',
  ].sort())
  assert.ok(r.rows.every((row) => row.id === `${row.institution}|${row.account}`))
  assert.ok(!r.rows.some((row) => row.account === 'Example checking' || row.account === 'Example US brokerage'))
  assert.equal(byAccount.get('mg|Example savings')!.maxKrw, 50_000)

  const savings = byAccount.get('tossbank|Example savings')!
  assert.deepEqual(
    { kind: savings.kind, maxKrw: savings.maxKrw, maxDate: savings.maxDate, coverage: savings.coverage, understated: savings.understated },
    { kind: 'cash', maxKrw: 3_000_000, maxDate: '2024-04-02', coverage: 'daily', understated: false }
  )
  assert.equal(savings.maxUsd, 3_000_000 / 1473.27)

  const usd = byAccount.get('hana|Example USD')!
  assert.equal(usd.maxUsd, 4_000)
  assert.equal(usd.maxKrw, 4_000 * 1473.27)

  // Month-end lots × price: 15 shares (10 still open, 5 sold in July) at 20,000 on 2024-06-30.
  const kr = byAccount.get('Example KR Broker|Example KR general')!
  assert.deepEqual([kr.kind, kr.maxKrw, kr.maxDate, kr.coverage, kr.understated], ['brokerage', 300_000, '2024-06-30', 'month_end', true])

  // A US stock in a Korean account: month-end USD close times the USD/KRW rate on that date,
  // 2 × 150 × 1,400 on 2024-12-31 (the November month-end was at 1,300).
  const overseas = byAccount.get('Example KR Broker|Example KR overseas')!
  assert.deepEqual([overseas.kind, overseas.maxKrw, overseas.maxDate, overseas.coverage], ['brokerage', 2 * 150 * 1_400, '2024-12-31', 'partial'])

  const irp = byAccount.get('Example|Example(IRP)')!
  assert.deepEqual([irp.kind, irp.maxKrw, irp.maxDate, irp.coverage], ['pension', 8_000_000, '2024-12-31', 'year_end'])

  // No gold price stored: valued at cost, and partial.
  const gold = byAccount.get('Example|Example(gold)')!
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
  assert.equal(usd.maxKrw, 100 * 1400)
  // The savings history stops in 2025: carried into 2026, but it never reaches 31 December.
  assert.equal(r.rows.find((row) => row.id === 'tossbank|Example savings')!.coverage, 'partial')
})

test('a USD account with neither a Treasury rate nor a market rate keeps its row, with no won figure', async () => {
  config.stockDbPath = scenarioDb({ withFx: false })
  const { getForeignAccountMaxima } = await import('../lib/adapters/portfolio-db')
  const r = getForeignAccountMaxima(2026)
  const usd = r.rows.find((row) => row.id === 'hana|Example USD')
  assert.ok(usd, 'the row is listed, not skipped')
  assert.equal(usd.maxKrw, null)
  assert.equal(usd.maxUsd, null)
})

test('brokerage rows add the uninvested cash carried forward to each month-end', async () => {
  config.stockDbPath = scenarioDb({
    extra: (db) =>
      brokerageCash(db, [
        ['Example KR Broker', 'Example KR general', 'KRW', 'KRW', '2023-12-20', 100_000],
        ['Example KR Broker', 'Example KR general', 'KRW', 'KRW', '2024-06-15', 400_000],
        ['Example KR Broker', 'Example KR general', 'KRW', 'KRW', '2024-08-01', 0],
        // The statement's coverage end: the balance stands through it.
        ['Example KR Broker', 'Example KR general', 'KRW', 'KRW', '2024-12-31', 0],
        // A dollar pool, converted at the month-end USD/KRW rate.
        ['Example KR Broker', 'Example KR overseas', 'USD', 'USD', '2024-12-10', 1_000],
        ['Example KR Broker', 'Example KR overseas', 'USD', 'USD', '2024-12-31', 1_000],
        // An account holding only cash still has a row.
        ['Example Rewards', 'Example Rewards(stock comp)', 'KRW', 'KRW', '2023-12-31', 5_000],
        ['Example Rewards', 'Example Rewards(stock comp)', 'KRW', 'KRW', '2024-03-01', 9_000],
        ['Example Rewards', 'Example Rewards(stock comp)', 'KRW', 'KRW', '2024-12-31', 9_000],
        // A pension account's cash is in its certificate totals already.
        ['Example', 'Example(IRP)', 'KRW', 'KRW', '2024-05-01', 99_000_000, 'irp'],
        // A US brokerage is never foreign.
        ['Robinhood', 'Example US brokerage', 'USD', 'USD', '2024-05-01', 99_000],
      ]),
  })
  const { getForeignAccountMaxima } = await import('../lib/adapters/portfolio-db')
  const r = getForeignAccountMaxima(2024)
  const byId = new Map(r.rows.map((row) => [row.id, row]))

  // 15 shares at 20,000 plus 400,000 of cash on 2024-06-30.
  const kr = byId.get('Example KR Broker|Example KR general')!
  assert.deepEqual([kr.maxKrw, kr.maxDate, kr.coverage, kr.understated, kr.cashIncluded], [700_000, '2024-06-30', 'month_end', true, true])

  // 2 × 150 × 1,400 of stock plus $1,000 × 1,400 on 2024-12-31.
  const overseas = byId.get('Example KR Broker|Example KR overseas')!
  assert.deepEqual([overseas.maxKrw, overseas.maxDate, overseas.cashIncluded], [420_000 + 1_400_000, '2024-12-31', true])

  const rewards = byId.get('Example Rewards|Example Rewards(stock comp)')!
  assert.deepEqual([rewards.kind, rewards.maxKrw, rewards.maxDate, rewards.coverage, rewards.cashIncluded], ['brokerage', 9_000, '2024-03-31', 'month_end', true])

  assert.equal(byId.get('Example|Example(IRP)')!.maxKrw, 8_000_000)
  assert.equal(byId.get('Example|Example(IRP)')!.cashIncluded, undefined)
  assert.ok(!r.rows.some((row) => row.institution === 'Robinhood'))
})

test('cash history that stops before 31 December makes the brokerage row partial', async () => {
  config.stockDbPath = scenarioDb({
    extra: (db) =>
      brokerageCash(db, [
        ['Example KR Broker', 'Example KR general', 'KRW', 'KRW', '2023-12-20', 100_000],
        ['Example KR Broker', 'Example KR general', 'KRW', 'KRW', '2024-08-01', 0],
      ]),
  })
  const { getForeignAccountMaxima } = await import('../lib/adapters/portfolio-db')
  const kr = getForeignAccountMaxima(2024).rows.find((row) => row.id === 'Example KR Broker|Example KR general')!
  assert.equal(kr.coverage, 'partial')
  assert.equal(kr.cashIncluded, true)
  // Before the cash history starts, the year has no cash in it.
  const early = getForeignAccountMaxima(2023).rows.find((row) => row.id === 'Example KR Broker|Example KR general')!
  assert.equal(early.cashIncluded, true)
  assert.equal(early.coverage, 'partial')
})

test('a brokerage account with no cash history says so, and other kinds carry no cash flag', async () => {
  config.stockDbPath = scenarioDb()
  const { getForeignAccountMaxima } = await import('../lib/adapters/portfolio-db')
  const r = getForeignAccountMaxima(2024)
  for (const row of r.rows) assert.equal(row.cashIncluded, row.kind === 'brokerage' ? false : undefined, row.id)
})

test('crypto exchanges are reference rows: foreign ones only, month-end values, outside the aggregate', async () => {
  config.stockDbPath = scenarioDb({
    extra: (db) => {
      const lot = db.prepare(
        "insert into tax_lots_all (market, currency, brokerage, account, ticker, acquired_date, open_quantity, native_cost_basis, cost_basis_krw) values ('CRYPTO', ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      lot.run('KRW', 'Example Exchange', 'Example Exchange', 'BTC', '2023-05-01', 0.1, 3_000_000, 3_000_000)
      // Robinhood Crypto is a US account.
      lot.run('USD', 'Robinhood', 'Robinhood Crypto', 'ETH', '2023-05-01', 1, 2_000, 2_600_000)
      const price = db.prepare("insert into historical_prices (market, ticker, symbol, currency, price_date, close, source) values ('CRYPTO', ?, ?, 'USD', ?, ?, 'x')")
      price.run('BTC', 'BTC', '2023-12-29', 40_000)
      price.run('BTC', 'BTC', '2024-03-28', 70_000)
      price.run('BTC', 'BTC', '2024-12-31', 90_000)
      price.run('ETH', 'ETH', '2024-03-28', 999_999)
    },
  })
  const { getForeignAccountMaxima } = await import('../lib/adapters/portfolio-db')
  const r = getForeignAccountMaxima(2024)
  assert.ok(!r.rows.some((row) => row.kind === 'crypto'))
  assert.deepEqual(r.cryptoRows.map((row) => row.id), ['Example Exchange|Example Exchange'])
  const exchange = r.cryptoRows[0]
  // 0.1 × 90,000 × 1,400 on 2024-12-31.
  assert.deepEqual(
    [exchange.kind, exchange.maxKrw, exchange.maxDate, exchange.coverage, exchange.understated, exchange.cashIncluded],
    ['crypto', 0.1 * 90_000 * 1_400, '2024-12-31', 'month_end', true, false]
  )
  assert.equal(r.cryptoSubtotalMaxUsd, exchange.maxUsd)
  assert.equal(r.aggregateMaxUsd, r.rows.reduce((sum, row) => sum + (row.maxUsd ?? 0), 0))
})

test('a retired cash account ends its series on its retirement date', async () => {
  config.stockDbPath = scenarioDb()
  const mapPath = path.join(mkdtempSync(path.join(tmpdir(), 'fbar-retired-')), 'accounts.local.json')
  writeFileSync(
    mapPath,
    JSON.stringify({ bankAccounts: [{ institution: 'tossbank', last4: '0000', kind: 'savings', alias: 'Example savings', retiredOn: '2024-06-30' }] })
  )
  const saved = config.stockAccountMapPath
  config.stockAccountMapPath = mapPath
  try {
    const { getForeignAccountMaxima } = await import('../lib/adapters/portfolio-db')
    // The year it closed is complete: nothing is held after the retirement date.
    const closing = getForeignAccountMaxima(2024).rows.find((row) => row.id === 'tossbank|Example savings')!
    assert.deepEqual([closing.maxKrw, closing.maxDate, closing.coverage], [3_000_000, '2024-04-02', 'daily'])
    // Later years carry nothing forward, even though a later balance row exists.
    assert.ok(!getForeignAccountMaxima(2025).rows.some((row) => row.id === 'tossbank|Example savings'))
    // Another institution's account with the same alias is not retired.
    assert.ok(getForeignAccountMaxima(2025).rows.some((row) => row.id === 'mg|Example savings'))
  } finally {
    config.stockAccountMapPath = saved
  }
})

test('retiredBrokerageAccounts keys closed brokerage accounts by their transaction label', () => {
  assert.equal(brokerageAccountLabel({ institution: 'mirae', kind: 'general' }), '미래에셋증권(종합)')
  assert.equal(brokerageAccountLabel({ institution: 'mirae', kind: 'isa' }), '미래에셋증권(ISA)')
  assert.equal(brokerageAccountLabel({ institution: 'mirae', kind: 'general', account: 'Example Broker(second)' }), 'Example Broker(second)')
  assert.equal(brokerageAccountLabel({ institution: 'example', kind: 'general' }), null)
  const retired = retiredBrokerageAccounts([
    { institution: 'mirae', kind: 'general', retiredOn: '2024-05-20' },
    { institution: 'mirae', kind: 'isa' },
    { institution: 'example', kind: 'general', account: 'Example Broker(old)', retired: true },
    { institution: 'example', kind: 'general', account: 'Example Broker(typo)', retiredOn: 'May' },
    // No label to key it by: ignored rather than guessed.
    { institution: 'example', kind: 'general', retiredOn: '2024-05-20' },
  ])
  assert.deepEqual(
    [...retired.entries()],
    [
      ['미래에셋증권(종합)', '2024-05-20'],
      ['Example Broker(old)', null],
    ]
  )
})

test('a closed brokerage account ends its series on its closing date, whatever balance its statements leave', async () => {
  config.stockDbPath = scenarioDb({
    extra: (db) => {
      brokerageCash(db, [
        ['Example Broker', 'Example Broker(closed)', 'KRW', 'KRW', '2023-12-31', 50_000],
        ['Example Broker', 'Example Broker(closed)', 'KRW', 'KRW', '2024-03-10', 900_000],
        // The last line printed before the account closed; the statement runs on past it.
        ['Example Broker', 'Example Broker(closed)', 'KRW', 'KRW', '2024-05-07', 300_000],
      ])
      cashCoverage(db, [
        ['Example Broker', 'Example Broker(closed)', '2023-01-01', '2023-12-31'],
        ['Example Broker', 'Example Broker(closed)', '2024-01-01', '2024-10-10'],
      ])
    },
  })
  const { getForeignAccountMaxima } = await import('../lib/adapters/portfolio-db')
  const rowFor = (year: number) => getForeignAccountMaxima(year).rows.find((row) => row.id === 'Example Broker|Example Broker(closed)')
  // Without the map entry, the statement ending on 10 October leaves the year partial.
  assert.equal(rowFor(2024)!.coverage, 'partial')

  const mapPath = path.join(mkdtempSync(path.join(tmpdir(), 'fbar-closed-')), 'accounts.local.json')
  writeFileSync(
    mapPath,
    JSON.stringify({ brokerageAccounts: [{ institution: 'example', kind: 'general', account: 'Example Broker(closed)', retiredOn: '2024-05-20' }] })
  )
  const saved = config.stockAccountMapPath
  config.stockAccountMapPath = mapPath
  try {
    // The closing year is complete up to the closing date, and its maximum stands.
    const closing = rowFor(2024)!
    assert.deepEqual([closing.maxKrw, closing.maxDate, closing.coverage, closing.cashIncluded], [900_000, '2024-03-31', 'month_end', true])
    // Nothing after the closing date: the year after has no row.
    assert.equal(rowFor(2025), undefined)
  } finally {
    config.stockAccountMapPath = saved
  }
})

test('a pool in won is added unconverted whatever its name; only a USD pool is converted', async () => {
  config.stockDbPath = scenarioDb({
    extra: (db) =>
      brokerageCash(db, [
        // Toss prints its dollar section in won.
        ['Example Rewards', 'Example Rewards(stock comp)', 'KRW_dollar_section', 'KRW', '2023-12-31', 7_000],
        ['Example Rewards', 'Example Rewards(stock comp)', 'KRW_dollar_section', 'KRW', '2024-12-31', 7_000],
        ['Example Other', 'Example Other(stock comp)', 'USD', 'KRW', '2023-12-31', 3_000],
        ['Example Other', 'Example Other(stock comp)', 'USD', 'KRW', '2024-12-31', 3_000],
      ]),
  })
  const { getForeignAccountMaxima } = await import('../lib/adapters/portfolio-db')
  const byId = new Map(getForeignAccountMaxima(2024).rows.map((row) => [row.id, row]))
  assert.equal(byId.get('Example Rewards|Example Rewards(stock comp)')!.maxKrw, 7_000)
  assert.equal(byId.get('Example Other|Example Other(stock comp)')!.maxKrw, 3_000)
})

// An account whose lots predate every statement, so its securities alone cover each year.
function oldLot(db: Database.Database, account: string) {
  db.prepare(
    "insert into tax_lots_all (market, currency, brokerage, account, ticker, acquired_date, open_quantity, native_cost_basis, cost_basis_krw) values ('KR', 'KRW', 'Example KR Broker', ?, '000001', '2021-01-04', 1, 10000, 10000)"
  ).run(account)
}

test('a year between two statements is partial, not month-end, and its cash is not carried across the gap', async () => {
  config.stockDbPath = scenarioDb({
    extra: (db) => {
      oldLot(db, 'Example KR gap')
      brokerageCash(db, [
        ['Example KR Broker', 'Example KR gap', 'KRW', 'KRW', '2022-01-01', 100_000],
        ['Example KR Broker', 'Example KR gap', 'KRW', 'KRW', '2024-01-01', 200_000],
      ])
      cashCoverage(db, [
        ['Example KR Broker', 'Example KR gap', '2022-01-01', '2022-12-31'],
        ['Example KR Broker', 'Example KR gap', '2024-01-01', '2024-12-31'],
      ])
    },
  })
  const { getForeignAccountMaxima } = await import('../lib/adapters/portfolio-db')
  const rowFor = (year: number) => getForeignAccountMaxima(year).rows.find((row) => row.id === 'Example KR Broker|Example KR gap')!
  assert.equal(rowFor(2022).coverage, 'month_end')
  assert.equal(rowFor(2024).coverage, 'month_end')
  const gap = rowFor(2023)
  assert.equal(gap.coverage, 'partial')
  // Only the prior year-end, inside the 2022 statement, has cash: 10,000 at cost plus 100,000.
  assert.deepEqual([gap.maxKrw, gap.maxDate], [110_000, '2023-01-01'])
})

test('cash stops at the last statement coverage end, and a cash-only account has no row once it stops', async () => {
  config.stockDbPath = scenarioDb({
    extra: (db) => {
      oldLot(db, 'Example KR stale')
      brokerageCash(db, [
        ['Example KR Broker', 'Example KR stale', 'KRW', 'KRW', '2024-02-01', 5_000_000],
        ['Example Rewards', 'Example Rewards(stock comp)', 'KRW', 'KRW', '2023-03-01', 9_000],
      ])
      cashCoverage(db, [
        ['Example KR Broker', 'Example KR stale', '2024-01-01', '2024-06-30'],
        ['Example Rewards', 'Example Rewards(stock comp)', '2023-01-01', '2023-12-31'],
      ])
    },
  })
  const { getForeignAccountMaxima } = await import('../lib/adapters/portfolio-db')
  const stale = (year: number) => getForeignAccountMaxima(year).rows.find((row) => row.id === 'Example KR Broker|Example KR stale')!
  // 1 share at 20,000 plus the cash on the last month-end a statement covers.
  assert.deepEqual([stale(2024).maxKrw, stale(2024).maxDate, stale(2024).coverage], [5_020_000, '2024-06-30', 'partial'])
  // The next year: securities only (1 share at 15,000), no cash carried in.
  assert.deepEqual([stale(2025).maxKrw, stale(2025).cashIncluded], [15_000, false])

  const rewards = (year: number) => getForeignAccountMaxima(year).rows.some((row) => row.id === 'Example Rewards|Example Rewards(stock comp)')
  assert.equal(rewards(2023), true)
  assert.equal(rewards(2024), false)
})

test('an account with both brokerage and crypto lots keeps its brokerage row and gets a crypto row', async () => {
  config.stockDbPath = scenarioDb({
    extra: (db) => {
      db.prepare(
        "insert into tax_lots_all (market, currency, brokerage, account, ticker, acquired_date, open_quantity, native_cost_basis, cost_basis_krw) values ('CRYPTO', 'KRW', 'Example KR Broker', 'Example KR general', 'BTC', '2023-05-01', 0.1, 3000000, 3000000)"
      ).run()
      db.prepare("insert into historical_prices (market, ticker, symbol, currency, price_date, close, source) values ('CRYPTO', 'BTC', 'BTC', 'USD', '2023-12-29', 40000, 'x')").run()
    },
  })
  const { getForeignAccountMaxima } = await import('../lib/adapters/portfolio-db')
  const r = getForeignAccountMaxima(2024)
  const brokerage = r.rows.find((row) => row.id === 'Example KR Broker|Example KR general')!
  assert.deepEqual([brokerage.kind, brokerage.maxKrw], ['brokerage', 300_000])
  const crypto = r.cryptoRows.find((row) => row.id === 'Example KR Broker|Example KR general')!
  assert.deepEqual([crypto.kind, crypto.maxKrw], ['crypto', 0.1 * 40_000 * 1_400])
})

// One invented account (lot from 2021, so its securities cover every year) with the given cash rows and statement periods.
function cashScenario(cash: [string, number][], periods: [string, string][]) {
  return scenarioDb({
    extra: (db) => {
      oldLot(db, 'Example KR cash')
      brokerageCash(db, cash.map(([date, balance]) => ['Example KR Broker', 'Example KR cash', 'KRW', 'KRW', date, balance]))
      cashCoverage(db, periods.map(([from, to]) => ['Example KR Broker', 'Example KR cash', from, to]))
    },
  })
}

async function cashRow(year: number) {
  const { getForeignAccountMaxima } = await import('../lib/adapters/portfolio-db')
  return getForeignAccountMaxima(year).rows.find((row) => row.id === 'Example KR Broker|Example KR cash')!
}

test('a month-end before a period\'s first cash line takes no balance from an earlier period', async () => {
  config.stockDbPath = cashScenario(
    [
      ['2022-01-01', 500_000],
      ['2024-02-15', 50_000],
    ],
    [
      ['2022-01-01', '2022-12-31'],
      ['2024-01-01', '2024-12-31'],
    ]
  )
  // 2024-01-31 is securities only (10,000), not 510,000; the maximum is 20,000 + 50,000 on 2024-06-30.
  const row = await cashRow(2024)
  assert.deepEqual([row.maxKrw, row.maxDate], [70_000, '2024-06-30'])
})

test('a declared full-year period whose first cash line comes in March is partial', async () => {
  config.stockDbPath = cashScenario([['2024-03-01', 50_000]], [['2024-01-01', '2024-12-31']])
  const row = await cashRow(2024)
  assert.deepEqual([row.coverage, row.cashIncluded], ['partial', true])
})

test('adjacent statement periods merge into a covered year', async () => {
  config.stockDbPath = cashScenario(
    [['2024-01-01', 50_000]],
    [
      ['2024-01-01', '2024-06-30'],
      ['2024-07-01', '2024-12-31'],
    ]
  )
  const row = await cashRow(2024)
  assert.deepEqual([row.coverage, row.maxKrw, row.maxDate], ['month_end', 70_000, '2024-06-30'])
})
