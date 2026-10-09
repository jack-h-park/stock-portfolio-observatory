import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'

const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'overview-realized-')), 'portfolio.db')
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
create table realized_lots (
  market text not null, sold_date text, realized_gl_krw real, basis text, superseded_by text
);
`)

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
const snapshot = db.prepare('insert into portfolio_snapshots (snapshot_date, captured_at, global_base_cost) values (?, ?, 0)')
for (const days of [60, 30, 1]) snapshot.run(daysAgo(days), daysAgo(days))

const lot = db.prepare('insert into realized_lots (market, sold_date, realized_gl_krw, basis, superseded_by) values (?, ?, ?, ?, ?)')
// Sold long before any snapshot in the window: still part of the running total.
lot.run('KR', daysAgo(400), 100_000, 'replay', null)
lot.run('US', daysAgo(45), 50_000, '1099b', null)
// The replay estimate of the same sale, replaced by the filing above.
lot.run('US', daysAgo(45), 48_000, 'replay', 'Sample 1099-B')
lot.run('CRYPTO', `${daysAgo(10)}T09:30:00Z`, -20_000, 'replay', null)
lot.run('KR', null, 999_999, 'replay', null)
db.close()

test('snapshots carry cumulative realized G/L per market, skipping superseded replay rows', async () => {
  process.env.STOCK_DB_PATH = dbPath
  const { getPortfolioSnapshots } = await import('../lib/adapters/portfolio-db')
  const rows = getPortfolioSnapshots(90)

  assert.deepEqual(
    rows.map((row) => [row.kr_realized_gl, row.us_realized_gl_base, row.crypto_realized_gl_base, row.global_realized_gl]),
    [
      [100_000, 0, 0, 100_000],
      [100_000, 50_000, 0, 150_000],
      [100_000, 50_000, -20_000, 130_000],
    ]
  )
})
