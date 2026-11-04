import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { addGoldBooks, emptyGoldBook, goldScopeFields, physicalGoldBookAt } from '../lib/gold-trend'
import { resolveTrendScope, singleTrendPoints, TREND_SCOPES } from '../lib/overview-trend'

// Invented figures throughout; the repository is public.

const trades = [
  { date: '2025-01-10', type: 'BUY' as const, grams: 10, costKrw: 1_000_000 },
  { date: '2025-06-09', type: 'BUY' as const, grams: 10, costKrw: 1_400_000 },
]
const prices = [
  { date: '2025-02-01', price: 120_000 },
  { date: '2025-07-01', price: 150_000 },
]

test('physical gold: grams bought on or before the date at the latest KRX price, cost when there is none', () => {
  assert.deepEqual(physicalGoldBookAt(trades, prices, '2025-01-31'), { cost: 1_000_000, pricedCost: 0, marketValue: 0, positions: 1 })
  assert.deepEqual(physicalGoldBookAt(trades, prices, '2025-03-01'), { cost: 1_000_000, pricedCost: 1_000_000, marketValue: 1_200_000, positions: 1 })
  assert.deepEqual(physicalGoldBookAt(trades, prices, '2025-07-02'), { cost: 2_400_000, pricedCost: 2_400_000, marketValue: 3_000_000, positions: 1 })
  assert.deepEqual(physicalGoldBookAt(trades, prices, '2024-12-31'), emptyGoldBook())
})

test('physical gold: a sale takes grams from the oldest purchase first', () => {
  const book = physicalGoldBookAt([...trades, { date: '2025-08-01', type: 'SELL', grams: 5, costKrw: 0 }], prices, '2025-08-02')
  // 5 of the first 10 g (cost 500,000) are left, plus all of the second purchase (1,400,000).
  assert.equal(book.cost, 1_900_000)
  assert.equal(book.marketValue, 15 * 150_000)
})

test('scope fields: ETF and physical gold are summed once, unrealized is like-for-like on priced cost', () => {
  const physical = physicalGoldBookAt(trades, prices, '2025-03-01')
  const etf = { cost: 500_000, pricedCost: 500_000, marketValue: 560_000, positions: 1 }
  const fields = goldScopeFields(addGoldBooks(physical, etf), 30_000)
  assert.equal(fields.gold_market_value, 1_760_000)
  assert.equal(fields.gold_cost_basis, 1_500_000)
  assert.equal(fields.gold_unrealized_gl, 260_000)
  assert.equal(fields.gold_realized_gl, 30_000)
  assert.equal(fields.gold_market_value_coverage, 1)
  assert.ok(Math.abs((fields.gold_return_pct ?? 0) - (260_000 / 1_500_000) * 100) < 1e-9)
})

test('scope fields: unpriced physical gold lowers coverage and stays out of the gain', () => {
  const physical = physicalGoldBookAt(trades, prices, '2025-01-31')
  const etf = { cost: 1_000_000, pricedCost: 1_000_000, marketValue: 1_100_000, positions: 1 }
  const fields = goldScopeFields(addGoldBooks(physical, etf), 0)
  assert.equal(fields.gold_market_value_coverage, 0.5)
  assert.equal(fields.gold_unrealized_gl, 100_000)
})

test('scope fields: null before any gold position, so the chart draws nothing', () => {
  assert.equal(goldScopeFields(emptyGoldBook(), 0).gold_market_value, null)
  assert.equal(goldScopeFields(emptyGoldBook(), 0).gold_realized_gl, null)
})

test('the gold scope is selectable and reads its own snapshot fields', () => {
  assert.ok(TREND_SCOPES.some((scope) => scope.key === 'GOLD'))
  assert.equal(resolveTrendScope('GOLD'), 'GOLD')
  const [point] = singleTrendPoints(
    [{ snapshot_date: '2025-03-01', gold_market_value: 2_000_000, gold_market_value_coverage: 1 } as never],
    'GOLD',
    'market_value',
    (value) => value / 1_000_000
  )
  assert.equal(point.value, 2)
})

const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'gold-trend-')), 'portfolio.db')
const db = new Database(dbPath)
db.exec(`
create table portfolio_snapshots (
  snapshot_date text, captured_at text, global_base_cost real, global_base_market_value real,
  global_base_unrealized_gl real, global_base_return_pct real,
  kr_market_value real, us_market_value_base real, crypto_market_value_base real,
  kr_cost_basis real, us_cost_basis_base real, crypto_cost_basis_base real,
  kr_unrealized_gl real, us_unrealized_gl_base real, crypto_unrealized_gl_base real,
  kr_return_pct real, us_return_pct real, crypto_return_pct real,
  krw_cost real, usd_cost real, dividends_krw real, dividends_usd real, holding_count integer, share_count real
);
create table transactions_all (id integer primary key, date text, type text, quantity real, amount_krw real, settlement_krw real, asset_class text);
create table gold_prices (date text, price real);
create table tax_lots (market text, account text, ticker text, acquired_date text, open_quantity real, cost_basis_krw real);
create table realized_lots (market text, account text, ticker text, acquired_date text, sold_date text, quantity_sold real, cost_basis_krw real, realized_gl_krw real, superseded_by text);
create table realized_lots_all (sold_date text, realized_gl_krw real, superseded_by text, asset_class text);
create table historical_prices (market text, ticker text, currency text, price_date text, close real);
create table historical_fx_rates (price_date text, rate real);
create table holdings (ticker text, quantity real, base_cost real, base_market_value real);
create table holdings_all (ticker text, quantity real, base_cost real, base_market_value real, asset_class text);
`)
const snap = db.prepare('insert into portfolio_snapshots (snapshot_date, captured_at, global_base_cost) values (?, ?, 0)')
for (const date of ['2025-03-31', '2025-06-30', '2025-09-30']) snap.run(date, date)
db.prepare("insert into transactions_all (date, type, quantity, amount_krw, settlement_krw, asset_class) values ('2025-01-10', 'BUY', 10, 1000000, 0, 'gold')").run()
db.prepare("insert into gold_prices values ('2025-02-01', 120000), ('2025-09-01', 130000)").run()
// One ETF lot, bought in KRW terms at 500,000 for 5 shares, quoted in USD at 10 with 1,000 KRW per USD.
db.prepare("insert into tax_lots values ('US', 'acct', 'IAU', '2025-02-01', 5, 500000)").run()
db.prepare("insert into historical_prices values ('US', 'IAU', 'USD', '2025-03-01', 12), ('US', 'IAU', 'USD', '2025-06-01', 14)").run()
db.prepare("insert into historical_fx_rates values ('2025-01-01', 1000)").run()
// A sold lot, and a replay estimate of the same sale that a filing superseded.
db.prepare("insert into realized_lots values ('US', 'acct', 'IAU', '2025-01-15', '2025-05-01', 2, 180000, 40000, null)").run()
db.prepare("insert into realized_lots values ('US', 'acct', 'IAU', '2025-01-15', '2025-05-01', 2, 180000, 38000, 'Sample 1099-B')").run()
// A physical gold sale (written by the ingest to the _all table) joins the running realized total.
db.prepare("insert into realized_lots_all values ('2025-05-15', 15000, null, 'gold'), ('2025-05-16', 99999, null, 'security')").run()
// A stock that is not a gold ETF must not leak in.
db.prepare("insert into tax_lots values ('US', 'acct', 'AAPL', '2025-02-01', 5, 999999)").run()
db.prepare("insert into holdings values ('IAU', 5, 500000, 700000), ('AAPL', 5, 999999, 1200000)").run()
db.prepare("insert into holdings_all values ('IAU', 5, 500000, 700000, 'security'), ('M04020000', 10, 1000000, 1300000, 'gold')").run()
db.close()

test('adapter: past dates rebuild gold + ETF from lots, the last snapshot reads live holdings, realized skips superseded rows', async () => {
  process.env.STOCK_DB_PATH = dbPath
  const { getPortfolioSnapshots, withGoldScope } = await import('../lib/adapters/portfolio-db')
  const rows = withGoldScope(getPortfolioSnapshots(100000))

  assert.deepEqual(
    rows.map((row) => row.snapshot_date),
    ['2025-03-31', '2025-06-30', '2025-09-30']
  )
  // 2025-03-31: gold 10 g × 120,000 = 1,200,000; IAU is 5 open + 2 not yet sold = 7 × 12 × 1,000 = 84,000.
  // The superseded replay row is not a second position.
  assert.equal(rows[0].gold_market_value, 1_284_000)
  assert.equal(rows[0].gold_cost_basis, 1_680_000)
  assert.equal(rows[0].gold_realized_gl, 0)
  // 2025-06-30: IAU 5 × 14 × 1,000 = 70,000; the 40,000 ETF sale (not the superseded 38,000) and the 15,000 gold sale are realized.
  assert.equal(rows[1].gold_market_value, 1_270_000)
  assert.equal(rows[1].gold_realized_gl, 55_000)
  // The last snapshot is the live book: 1,300,000 + 700,000, and AAPL stays out.
  assert.equal(rows[2].gold_market_value, 2_000_000)
  assert.equal(rows[2].gold_cost_basis, 1_500_000)
  assert.equal(rows[2].gold_unrealized_gl, 500_000)
})
