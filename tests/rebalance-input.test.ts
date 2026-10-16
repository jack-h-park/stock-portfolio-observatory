import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'

const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'rebalance-input-')), 'portfolio.db')
const db = new Database(dbPath)
const common = `market text, currency text, base_currency text, brokerage text, account text, ticker text, name text,
  asset_class text default 'security', account_wrapper text default 'taxable', owner text default 'self'`
db.exec(`
create table fx_rates (id integer primary key, from_currency text, to_currency text, rate real, as_of_date text, source text);
create table cash_balances (id integer primary key, institution text, account text, owner text default 'self', kind text,
  currency text, as_of_date text, balance real, source text);
create table brokerage_cash (id integer primary key, institution text, account text, pool text, currency text,
  as_of_date text, balance real, source text, account_wrapper text, asset_class text);
create table holdings_all (id integer primary key, ${common}, quantity real, base_cost real, base_market_value real,
  total_cost_krw real, as_of_date text, native_price real, current_price real, native_market_value real);
create table tax_lots_all (id integer primary key, ${common}, fx_rate_to_base real, open_quantity real, native_cost_basis real,
  native_market_value real, native_unrealized_gl real, cost_basis_krw real, acquired_date text, holding_days integer, tax_term text);
create table realized_lots_all (id integer primary key, ${common}, sold_date text, tax_term text, realized_gl_krw real,
  native_realized_gl real, quantity_sold real, acquired_date text, superseded_by text);
create table transactions_all (id integer primary key, ${common}, date text, type text, quantity real, placed_agent text);
create view realized_lots as select * from realized_lots_all where account_wrapper in ('taxable', 'isa') and asset_class = 'security';
create view transactions as select * from transactions_all where account_wrapper in ('taxable', 'isa') and asset_class = 'security';
create table validation_checks (id integer primary key, name text, status text, detail text, severity text, scope text default 'stock');
`)
const hold = db.prepare(
  `insert into holdings_all (market,currency,base_currency,brokerage,account,ticker,name,account_wrapper,owner,quantity,base_cost,base_market_value,total_cost_krw,as_of_date)
   values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
)
const h = (account: string, ticker: string, wrapper: string, owner: string, value: number, market = 'KR') =>
  hold.run(market, market === 'US' ? 'USD' : 'KRW', 'KRW', 'Invented Broker', account, ticker, ticker, wrapper, owner, 10, value / 2, value, value / 2, '2026-10-14')
h('T-1', 'KRX1', 'taxable', 'self', 1_000_000)
h('T-1', 'AAA', 'taxable', 'self', 2_000_000, 'US')
h('I-1', 'KRX2', 'irp', 'self', 5_000_000)
h('S-1', 'KRX3', 'isa', 'self', 6_000_000)
h('C-1', 'KRX4', 'taxable', 'child:kid', 7_000_000)

const lot = db.prepare(
  `insert into tax_lots_all (market,currency,base_currency,brokerage,account,ticker,name,account_wrapper,owner,fx_rate_to_base,open_quantity,native_cost_basis,native_market_value,cost_basis_krw,acquired_date,tax_term)
   values ('KR','KRW','KRW','Invented Broker',?,?,?,?,?,1,10,100,200,100,'2025-01-02','short')`
)
lot.run('T-1', 'KRX1', 'KRX1', 'taxable', 'self')
lot.run('I-1', 'KRX2', 'KRX2', 'irp', 'self')
lot.run('C-1', 'KRX4', 'KRX4', 'taxable', 'child:kid')

db.exec(`
insert into fx_rates values (1,'USD','KRW',1300,'2026-10-01','x'),(2,'USD','KRW',1400,'2026-10-10','x');
insert into cash_balances (institution,account,owner,kind,currency,as_of_date,balance,source) values
  ('Invented Bank','B-1','self','cma','KRW','2026-10-01',100,'x'),
  ('Invented Bank','B-1','self','cma','KRW','2026-10-12',500_000,'x'),
  ('Invented Bank','B-9','child:kid','savings','KRW','2026-10-12',9_000_000,'x');
insert into brokerage_cash (institution,account,pool,currency,as_of_date,balance,source,account_wrapper,asset_class) values
  ('Invented Broker','T-1','usd','USD','2026-09-30',50,'x','taxable','security'),
  ('Invented Broker','T-1','usd','USD','2026-10-13',100,'x','taxable','security'),
  ('Invented Broker','I-1','krw','KRW','2026-10-13',8_000_000,'x','irp','security');
insert into validation_checks (name,status,detail,severity) values
  ('ok check','pass','d','error'),('bad error','fail','d','error'),('bad warning','fail','d','warning');
`)
const tx = db.prepare(
  `insert into transactions_all (market,currency,base_currency,brokerage,account,ticker,name,account_wrapper,owner,date,type,quantity)
   values (?,?,?,?,?,?,?,?,?,?,?,?)`
)
const t = (account: string, ticker: string, date: string, type: string, wrapper = 'taxable', owner = 'self', market = 'US', quantity = 1) =>
  tx.run(market, 'USD', 'KRW', 'Invented Broker', account, ticker, ticker, wrapper, owner, date, type, quantity)
t('T-1', 'AAA', '2026-09-15', 'BUY') // exactly 30 days back: in
t('T-1', 'AAA', '2026-09-14', 'BUY') // 31 days back: out
t('I-1', 'BBB', '2026-10-01', 'REINVEST', 'irp') // other wrapper still counts
t('C-1', 'CCC', '2026-10-01', 'BUY', 'taxable', 'child:kid') // child: out
t('T-1', 'DDD', '2026-10-01', 'SELL') // not a buy
t('T-1', 'EEE', '2026-10-01', 'BUY', 'taxable', 'self', 'CRYPTO') // wrong market
t('T-1', 'FFF', '2026-10-01', 'BUY', 'taxable', 'self', 'US', 0) // no quantity
t('T-1', 'AAA', '2026-10-10', 'DIVIDEND')
db.close()

const more = new Database(dbPath)
const sale = more.prepare(
  `insert into realized_lots_all (market,currency,base_currency,brokerage,account,ticker,name,account_wrapper,owner,sold_date,tax_term,realized_gl_krw,native_realized_gl,quantity_sold,acquired_date)
   values ('US','USD','KRW','Invented Broker',?,?,?,?,?,?,?,?,?,1,'2025-01-01')`
)
sale.run('T-1', 'LOSS', 'LOSS', 'taxable', 'self', '2026-10-05', 'short', -140_000, -100) // open wash window
sale.run('T-1', 'GAIN', 'GAIN', 'taxable', 'self', '2026-03-05', 'long', 280_000, 200)
sale.run('I-1', 'IRAX', 'IRAX', 'irp', 'self', '2026-03-05', 'short', 999_000, 999) // out of scope
sale.run('C-1', 'KID', 'KID', 'taxable', 'child:kid', '2026-03-05', 'short', 999_000, 999) // child
sale.run('T-1', 'OLD', 'OLD', 'taxable', 'self', '2025-12-31', 'short', 999_000, 999) // last year
more.prepare(
  `insert into transactions_all (market,currency,base_currency,brokerage,account,ticker,name,account_wrapper,owner,date,type,quantity)
   values ('US','USD','KRW','Invented Broker','T-1','LOSS','LOSS','taxable','self','2026-09-20','BUY',1)`
).run()
more.close()

const TODAY = '2026-10-15'
const load = async () => (await import('../lib/adapters/rebalance-input')).getRebalanceInput(TODAY, dbPath)

test('positions are taxable, self-owned holdings_all rows only', async () => {
  const input = await load()
  assert.deepEqual(input.positions.map((p) => p.ticker).sort(), ['AAA', 'KRX1'])
  assert.equal(input.positions.find((p) => p.ticker === 'KRX1')!.valueKrw, 1_000_000)
  assert.equal(input.positions.find((p) => p.ticker === 'KRX1')!.costKrw, 500_000)
  assert.deepEqual(input.lots.map((l) => l.ticker), ['KRX1'])
})

test('cash merges cash_balances latest-per-account with brokerage_cash latest-per-account-pool', async () => {
  const input = await load()
  assert.equal(input.usdKrwRate, 1400)
  const rows = input.cash.map((c) => [c.account, c.currency, c.balance, c.krw])
  assert.deepEqual(rows, [
    ['B-1', 'KRW', 500_000, 500_000],
    ['T-1', 'USD', 100, 140_000],
  ])
})

test('recentBuys covers 30 days back from today', async () => {
  const input = await load()
  assert.deepEqual(
    input.recentBuys.map((b) => [b.ticker, b.date, b.account]),
    [
      ['AAA', '2026-09-15', 'T-1'],
      ['LOSS', '2026-09-20', 'T-1'],
      ['BBB', '2026-10-01', 'I-1'],
    ]
  )
})

test('accountDataAsOf is the max transaction date per account', async () => {
  const input = await load()
  assert.deepEqual(input.accountDataAsOf, { 'Invented Broker::T-1': '2026-10-10' })
})

test('healthErrors lists failing error-severity checks', async () => {
  const input = await load()
  assert.deepEqual(input.healthErrors, ['bad error'])
})

test('the snapshot carries the as-of date', async () => {
  const input = await load()
  assert.equal(input.asOf, TODAY)
  assert.equal(input.ytd.year, 2026)
})

test('ytd sums the calendar year of today from taxable self lots; open wash windows are reported', async () => {
  const input = await load()
  assert.equal(input.ytd.lotCount, 2)
  assert.equal(input.ytd.usShortUsd, -100)
  assert.equal(input.ytd.usLongUsd, 200)
  assert.deepEqual(input.washSaleBlockedBuys.map((w) => w.ticker), ['LOSS'])
})
