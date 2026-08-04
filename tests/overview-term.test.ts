import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'

const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'overview-term-')), 'portfolio.db')
const db = new Database(dbPath)

db.exec(`
create table holdings (
  id integer primary key,
  market text not null,
  currency text not null,
  base_currency text not null,
  fx_rate_to_base real,
  brokerage text,
  account_type text,
  source_system text,
  as_of_date text,
  account text not null,
  ticker text not null,
  name text not null,
  quantity real not null,
  native_average_unit_cost real,
  native_cost real not null,
  native_price real,
  native_market_value real,
  native_unrealized_gl real,
  native_unrealized_gl_pct real,
  base_cost real,
  base_market_value real,
  base_unrealized_gl real,
  average_unit_cost real,
  total_cost_krw real not null,
  current_price real,
  pe real,
  eps real,
  unrealized_gl_krw real,
  unrealized_gl_pct real,
  long_term_qty real,
  short_term_qty real,
  lot_count integer
);
create table tax_lots (
  id integer primary key,
  market text not null,
  currency text not null,
  base_currency text not null,
  fx_rate_to_base real,
  brokerage text,
  account_type text,
  source_system text,
  as_of_date text,
  account text not null,
  ticker text not null,
  name text not null,
  acquired_date text not null,
  open_quantity real not null,
  native_cost_basis real not null,
  native_unit_cost real,
  native_market_value real,
  native_unrealized_gl real,
  cost_basis_krw real not null,
  unit_cost real,
  holding_days integer,
  tax_term text,
  source text
);
create table dividends (currency text, native_amount real);
create table realized_lots (realized_gl_krw real);
create table transactions (date text);
create table validation_checks (status text);
create table fx_rates (as_of_date text, from_currency text);
`)

db.prepare(
  `insert into holdings (
    market, currency, base_currency, account, ticker, name, quantity,
    native_cost, native_market_value, base_cost, base_market_value, total_cost_krw,
    long_term_qty, short_term_qty, lot_count
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
).run('US', 'USD', 'KRW', 'Brokerage Account', 'AAPL', 'Apple', 10, 100, 1000, 100000, 1000000, 100000, null, null, null)
db.prepare(
  `insert into holdings (
    market, currency, base_currency, account, ticker, name, quantity,
    native_cost, native_market_value, base_cost, base_market_value, total_cost_krw,
    long_term_qty, short_term_qty, lot_count
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
).run('US', 'USD', 'KRW', 'Second Account', 'AAPL', 'Apple', 5, 60, 600, 60000, 600000, 60000, 5, 0, 1)

const lotInsert = db.prepare(
  `insert into tax_lots (
    market, currency, base_currency, account, ticker, name, acquired_date,
    open_quantity, native_cost_basis, cost_basis_krw, tax_term
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
)
lotInsert.run('US', 'USD', 'KRW', 'Brokerage Account', 'AAPL', 'Apple', '2025-01-01', 4, 40, 40000, 'Long-term')
lotInsert.run('US', 'USD', 'KRW', 'Brokerage Account', 'AAPL', 'Apple', '2026-01-01', 6, 60, 60000, 'Short-term')
db.close()

test('overview classifies holdings from tax lots when holding term fields are empty', async () => {
  process.env.STOCK_DB_PATH = dbPath
  const { getOverview } = await import('../lib/adapters/portfolio-db')
  const { totals } = getOverview()

  assert.equal(totals.term_classified_base_value, 1_600_000)
  assert.equal(totals.term_long_base_value, 1_000_000)
  assert.equal(totals.term_short_base_value, 600_000)
  assert.equal(totals.term_unclassified_base_value, 0)
  assert.equal(totals.us_term_short_base_value, 600_000)
})

test('top holdings aggregate the same ticker across accounts', async () => {
  process.env.STOCK_DB_PATH = dbPath
  const { getTopHoldings } = await import('../lib/adapters/portfolio-db')
  const top = getTopHoldings(10)

  assert.equal(top.filter((row) => row.market === 'US' && row.ticker === 'AAPL').length, 1)
  assert.equal(top[0].ticker, 'AAPL')
  assert.equal(top[0].base_cost, 160_000)
})
