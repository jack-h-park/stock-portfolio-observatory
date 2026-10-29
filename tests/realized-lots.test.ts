import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import {
  ALL_YEARS,
  defaultSoldYear,
  rateOnOrBefore,
  sumRealized,
  toRealizedView,
  type RealizedLotRow,
} from '../lib/realized-lots'
import { queryRealized } from '../lib/realized-lots-query'

const RATES = [
  { price_date: '2026-10-09', rate: 1340 },
  { price_date: '2026-10-12', rate: 1330 },
]

function lot(over: Partial<RealizedLotRow> = {}): RealizedLotRow {
  return {
    market: 'CRYPTO',
    currency: 'KRW',
    brokerage: 'Invented Exchange',
    account: 'Invented',
    ticker: 'AAA',
    name: 'AAA',
    acquired_date: '2025-01-02',
    sold_date: '2026-10-12',
    quantity_sold: 0.5,
    cost_basis_krw: 700_000,
    proceeds_krw: 665_000,
    realized_gl_krw: -35_000,
    acquisition_cost_usd: 500,
    native_proceeds: 665_000,
    holding_days: 648,
    tax_term: 'Long-term',
    basis: 'replay',
    asset_class: null,
    form_8949_box: null,
    covered_status: null,
    superseded_by: null,
    collectible: null,
    ...over,
  }
}

const at = (date: string) => rateOnOrBefore(RATES, date)

test('the rate is the latest on or before the date, and absent before the first', () => {
  assert.deepEqual(rateOnOrBefore(RATES, '2026-10-12'), { rate: 1330, date: '2026-10-12' })
  assert.deepEqual(rateOnOrBefore(RATES, '2026-10-11'), { rate: 1340, date: '2026-10-09' })
  assert.equal(rateOnOrBefore(RATES, '2026-10-01'), null)
})

test('a won lot is priced at the sale-date rate; its cost is the stored dollar cost', () => {
  const view = toRealizedView(lot(), at)
  assert.equal(view.sold_year, '2026')
  assert.equal(view.cost_usd, 500)
  assert.equal(view.proceeds_usd, 665_000 / 1330)
  assert.equal(view.gain_usd, 665_000 / 1330 - 500)
  assert.equal(view.rate_approximate, false)
})

test('a sale on a day with no rate uses the nearest earlier one and says so', () => {
  const view = toRealizedView(lot({ sold_date: '2026-10-11' }), at)
  assert.equal(view.proceeds_usd, 665_000 / 1340)
  assert.equal(view.rate_approximate, true)
})

test('a dollar lot keeps its own dollar proceeds and ignores the rate table', () => {
  const view = toRealizedView(lot({ currency: 'USD', native_proceeds: 12.5, acquisition_cost_usd: 10 }), () => null)
  assert.equal(view.proceeds_usd, 12.5)
  assert.equal(view.gain_usd, 2.5)
})

test('no rate, or no stored dollar cost, leaves the dollar gain empty rather than zero', () => {
  assert.equal(toRealizedView(lot({ sold_date: '2020-01-01' }), at).proceeds_usd, null)
  assert.equal(toRealizedView(lot({ acquisition_cost_usd: null }), at).gain_usd, null)
})

test('totals sum each currency and count the lots the dollar sum had to skip', () => {
  const rows = [
    toRealizedView(lot(), at),
    toRealizedView(lot({ cost_basis_krw: 300_000, proceeds_krw: 330_000, realized_gl_krw: 30_000, acquisition_cost_usd: 200 }), at),
    toRealizedView(lot({ acquisition_cost_usd: null }), at),
  ]
  const totals = sumRealized(rows)
  assert.equal(totals.count, 3)
  assert.equal(totals.gain_krw, -35_000 + 30_000 - 35_000)
  assert.equal(totals.missing_usd, 1)
  assert.equal(totals.cost_usd, 700)
})

test('the page opens on this year, else the latest year with sales, else every year', () => {
  assert.equal(defaultSoldYear(['2026', '2025'], '2026'), '2026')
  assert.equal(defaultSoldYear(['2025', '2024'], '2026'), '2025')
  assert.equal(defaultSoldYear([], '2026'), ALL_YEARS)
})

test('the year filter defaults, can be widened to every year, and ignores a year with no sales', () => {
  const rows = [
    toRealizedView(lot({ ticker: 'NEW' }), at),
    toRealizedView(lot({ ticker: 'OLD', sold_date: '2025-03-03' }), at),
  ]
  assert.deepEqual(queryRealized(rows, {}, '2026').filtered.map((r) => r.ticker), ['NEW'])
  assert.deepEqual(queryRealized(rows, { year: ALL_YEARS }, '2026').filtered.map((r) => r.ticker).sort(), ['NEW', 'OLD'])
  assert.deepEqual(queryRealized(rows, { year: '2025' }, '2026').filtered.map((r) => r.ticker), ['OLD'])
  assert.equal(queryRealized(rows, { year: '1999' }, '2026').year, '2026')
  assert.deepEqual(queryRealized(rows, { year: ALL_YEARS, market: 'KR' }, '2026').filtered, [])
  assert.deepEqual(queryRealized(rows, { q: 'old', year: ALL_YEARS }, '2026').filtered.map((r) => r.ticker), ['OLD'])
})

test('the adapter reads the view, skips a replaced replay row and prices each lot', async () => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'realized-')), 'portfolio.db')
  const db = new Database(dbPath)
  db.exec(`
    create table realized_lots (
      market text, currency text, brokerage text, account text, ticker text, name text,
      acquired_date text, sold_date text, quantity_sold real, cost_basis_krw real, proceeds_krw real,
      realized_gl_krw real, acquisition_cost_usd real, native_proceeds real, holding_days integer,
      tax_term text, basis text, superseded_by text
    );
    create table historical_fx_rates (id integer primary key, price_date text, rate real, source text);
  `)
  const insert = db.prepare('insert into realized_lots values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  insert.run('CRYPTO', 'KRW', 'Invented Exchange', 'Invented', 'AAA', 'AAA', '2025-01-02', '2026-10-12', 0.5, 700000, 665000, -35000, 500, 665000, 648, 'Long-term', 'replay', null)
  insert.run('US', 'USD', 'Invented Broker', 'Invented', 'BBB', 'BBB', '2025-02-02', '2026-09-01', 1, 100, 120, 20, 100, 120, 576, 'Long-term', 'replay', 'filing-1')
  db.prepare('insert into historical_fx_rates (price_date, rate, source) values (?,?,?)').run('2026-10-12', 1330, 'invented')
  db.close()

  process.env.STOCK_DB_PATH = dbPath
  const { getRealizedLots } = await import('../lib/adapters/portfolio-db')
  const rows = getRealizedLots()
  assert.deepEqual(rows.map((r) => r.ticker), ['AAA'])
  assert.equal(rows[0].proceeds_usd, 665000 / 1330)
})
