import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'

// The adapter reads one database, fixed when it is first imported, so every test
// rebuilds its own `realized_lots` table in that single scratch file.
const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'realized-lots-adapter-')), 'portfolio.db')
process.env.STOCK_DB_PATH = dbPath

const OLD_COLUMNS = `market text, currency text, brokerage text, account text, ticker text, name text,
  acquired_date text, sold_date text, quantity_sold real, cost_basis_krw real, proceeds_krw real,
  realized_gl_krw real, acquisition_cost_usd real, native_proceeds real, holding_days integer,
  tax_term text, basis text`

function rebuild(extraColumns: string, rows: (string | number | null)[][]) {
  const db = new Database(dbPath)
  db.exec('drop table if exists realized_lots')
  db.exec(`create table realized_lots (${OLD_COLUMNS}${extraColumns ? `, ${extraColumns}` : ''})`)
  const width = rows[0].length
  const insert = db.prepare(`insert into realized_lots values (${Array(width).fill('?').join(',')})`)
  for (const row of rows) insert.run(...row)
  db.close()
}

const lot = (ticker: string, ...extra: (string | number | null)[]) => [
  'US', 'USD', 'Invented Broker', 'ACC-1', ticker, `${ticker} Inc`,
  '2024-01-02', '2025-03-04', 10, 1000, 1500, 500, 0.7, 1.1, 427, 'Long-term', 'lot',
  ...extra,
]

test('getRealizedLots leaves out lots owned by someone else', async () => {
  rebuild("owner text, asset_class text, form_8949_box text, covered_status text, superseded_by text", [
    lot('AAA', 'self', 'stock', null, null, null),
    lot('BBB', 'spouse', 'stock', null, null, null),
  ])
  const { getRealizedLots } = await import('../lib/adapters/portfolio-db')
  const rows = getRealizedLots()
  assert.deepEqual(rows.map((r) => r.ticker), ['AAA'])
})

test('getRealizedLots skips superseded rows unless asked', async () => {
  rebuild("owner text, asset_class text, form_8949_box text, covered_status text, superseded_by text", [
    lot('AAA', 'self', 'stock', 'A', 'covered', null),
    lot('BBB', 'self', 'stock', 'A', 'covered', 'filing-1'),
  ])
  const { getRealizedLots } = await import('../lib/adapters/portfolio-db')
  assert.deepEqual(getRealizedLots().map((r) => r.ticker), ['AAA'])
  const all = getRealizedLots({ includeSuperseded: true })
  assert.equal(all.length, 2)
  const bySymbol = Object.fromEntries(all.map((r) => [r.ticker, r]))
  assert.equal(bySymbol.AAA.superseded_by, null)
  assert.equal(bySymbol.BBB.superseded_by, 'filing-1')
  assert.equal(bySymbol.AAA.form_8949_box, 'A')
  assert.equal(bySymbol.AAA.covered_status, 'covered')
  assert.equal(bySymbol.AAA.asset_class, 'stock')
})

test('getRealizedLots works on a table without the extra columns', async () => {
  rebuild('', [lot('AAA')])
  const { getRealizedLots } = await import('../lib/adapters/portfolio-db')
  const rows = getRealizedLots()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].asset_class, null)
  assert.equal(rows[0].form_8949_box, null)
  assert.equal(rows[0].covered_status, null)
  assert.equal(rows[0].superseded_by, null)
  assert.equal(rows[0].native_realized_gl, null)
})

test('getRealizedLots selects native_realized_gl when the column exists', async () => {
  rebuild('native_realized_gl real', [lot('AAA', 12.34)])
  const { getRealizedLots } = await import('../lib/adapters/portfolio-db')
  assert.equal(getRealizedLots()[0].native_realized_gl, 12.34)
})

test('getIngestedAt reads the meta value, or null', async () => {
  const db = new Database(dbPath)
  db.exec('drop table if exists meta; create table meta (key text primary key, value text)')
  db.close()
  const { getIngestedAt } = await import('../lib/adapters/portfolio-db')
  assert.equal(getIngestedAt(), null)
  const w = new Database(dbPath)
  w.prepare('insert into meta values (?, ?)').run('ingested_at', '2025-06-01T00:00:00Z')
  w.close()
  assert.equal(getIngestedAt(), '2025-06-01T00:00:00Z')
})
