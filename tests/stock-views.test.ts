import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { REPO_ROOT, runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

const SECURITIES_TABLES = ['holdings', 'tax_lots', 'transactions', 'dividends', 'realized_lots']

/** The shape every writer must produce: each name a view, each `<name>_all` a table carrying the filter columns. */
function assertStockViews(db: Database.Database) {
  for (const name of SECURITIES_TABLES) {
    const kind = db.prepare("select type from sqlite_master where name = ?").get(name) as { type: string }
    assert.equal(kind.type, 'view', name)
    const all = db.prepare("select type from sqlite_master where name = ?").get(`${name}_all`) as { type: string }
    assert.equal(all.type, 'table', `${name}_all`)
    const cols = (db.prepare(`pragma table_info(${name}_all)`).all() as { name: string }[]).map((c) => c.name)
    for (const col of ['account_wrapper', 'owner', 'asset_class']) assert.ok(cols.includes(col), `${name}_all.${col}`)
  }
}

// The default view's safety must not depend on 44 call sites each remembering a
// filter. The five securities tables are views over *_all tables, so a row that
// is not a stock is invisible to every existing read by construction.
test('the five securities names are stock-only views over *_all tables', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'stock-views-'))
  writeSheetPayloads(dir)
  const dbPath = runIngest(dir, { allowFailure: true })
  const db = new Database(dbPath)
  assertStockViews(db)
  const before = (db.prepare('select count(*) as n from holdings').get() as { n: number }).n
  const allBefore = (db.prepare('select count(*) as n from holdings_all').get() as { n: number }).n
  db.prepare(
    "insert into holdings_all (market, currency, base_currency, account, ticker, name, quantity, native_cost, total_cost_krw, account_wrapper, owner, asset_class) values ('KR', 'KRW', 'KRW', 'x', 'X', 'x', 1, 1, 1, 'irp', 'self', 'security')"
  ).run()
  db.prepare(
    "insert into holdings_all (market, currency, base_currency, account, ticker, name, quantity, native_cost, total_cost_krw, account_wrapper, owner, asset_class) values ('KR', 'KRW', 'KRW', 'y', 'Y', 'y', 1, 1, 1, 'taxable', 'self', 'gold')"
  ).run()
  assert.equal((db.prepare('select count(*) as n from holdings').get() as { n: number }).n, before)
  assert.equal((db.prepare('select count(*) as n from holdings_all').get() as { n: number }).n, allBefore + 2)
})

// seed-sample.mjs is the other writer of these tables: it builds the sample
// database CI and the screenshot baseline read. It must produce the same shape,
// or a page that names *_all works against real data and fails on the sample.
test('the sample seed writes the same stock-only views over *_all tables', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'stock-views-seed-'))
  const dbPath = path.join(dir, 'sample.db')
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !key.startsWith('STOCK_')) env[key] = value
  execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts/seed-sample.mjs')], {
    cwd: dir,
    stdio: 'pipe',
    env: { ...env, SAMPLE_STOCK_DB_PATH: dbPath } as unknown as NodeJS.ProcessEnv,
  })
  const db = new Database(dbPath)
  assertStockViews(db)
  for (const name of SECURITIES_TABLES) {
    const n = (db.prepare(`select count(*) as n from ${name}`).get() as { n: number }).n
    assert.ok(n > 0, `${name} has sample rows through the view`)
  }
})

// A probe for `type = 'table'` stops finding a name once it becomes a view. The
// home realized trend probed realized_lots that way and would have gone blank on
// every real database while the fixture test, which builds a plain table, stayed
// green.
test('the realized trend still reads realized_lots once it is a view', async () => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'stock-views-realized-')), 'portfolio.db')
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
    create table realized_lots_all (
      market text not null, sold_date text, realized_gl_krw real, basis text, superseded_by text,
      account_wrapper text not null default 'taxable', owner text not null default 'self', asset_class text not null default 'security'
    );
    create view realized_lots as select * from realized_lots_all where account_wrapper in ('taxable', 'isa') and asset_class = 'security';
  `)
  const today = new Date().toISOString().slice(0, 10)
  db.prepare('insert into portfolio_snapshots (snapshot_date, captured_at, global_base_cost) values (?, ?, 0)').run(today, today)
  const lot = db.prepare('insert into realized_lots_all (market, sold_date, realized_gl_krw, basis, account_wrapper) values (?, ?, ?, ?, ?)')
  lot.run('KR', '2025-01-02', 100_000, 'replay', 'taxable')
  // A pension sale is not a stock realization and must stay out of the trend.
  lot.run('KR', '2025-01-03', 7_000, 'replay', 'irp')
  db.close()

  process.env.STOCK_DB_PATH = dbPath
  const { getPortfolioSnapshots } = await import('../lib/adapters/portfolio-db')
  const [row] = getPortfolioSnapshots(30)
  assert.equal(row.kr_realized_gl, 100_000)
  assert.equal(row.global_realized_gl, 100_000)
})
