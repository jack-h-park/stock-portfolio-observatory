import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'

// How far a Robinhood account's transaction CSVs reach. Two things used to
// distort it: a quiet account read as covering only its last trade, however
// late the export was taken; and fills bridged from the MCP's orders, stored
// in the same table, made a stale CSV read current.

const dir = mkdtempSync(path.join(tmpdir(), 'robinhood-csv-coverage-'))
const dbPath = path.join(dir, 'portfolio.db')
const snapshotPath = path.join(dir, 'robinhood-snapshot.json')

const daysAgo = (days: number) => {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}
const compact = (date: string) => date.replaceAll('-', '')

const db = new Database(dbPath)
db.exec(`
create table source_files (name text primary key, filename text not null, mtime_ms integer not null);
create table holdings (market text, brokerage text, account_type text, account text, as_of_date text, account_wrapper text not null default 'taxable');
create table transactions (market text, brokerage text, account_type text, account text, date text, source_system text);
create table tax_lots (market text, brokerage text, account_type text, account text, as_of_date text);
create table validation_checks (name text, detail text, status text);
`)
const file = (name: string) => db.prepare('insert into source_files values (?, ?, 0)').run(`Robinhood:${name}`, name)
const trade = (strategy: string, date: string, source: string) =>
  db
    .prepare('insert into transactions (market, brokerage, account_type, account, date, source_system) values (?, ?, ?, ?, ?, ?)')
    .run('US', 'Robinhood', strategy, `Robinhood ${strategy}`, date, source)

// Agentic: last trade 17 days ago, but the export was asked for through yesterday.
const agentic = `robinhood-transactions-agentic-${compact(daysAgo(60))}-${compact(daysAgo(1))}.csv`
file(agentic)
trade('Agentic', daysAgo(17), agentic)

// Mid-term: CSV stopped 30 days ago; orders bridged since then go up to today.
const midterm = `robinhood-transactions-midterm-${compact(daysAgo(30))}.csv`
file(midterm)
trade('Mid-term', daysAgo(30), midterm)
trade('Mid-term', daysAgo(0), 'robinhood_mcp_orders')

// Long-term: a typo puts the period end next year. Not coverage.
const longterm = `robinhood-transactions-longterm-${compact(daysAgo(40))}-${compact(daysAgo(-365))}.csv`
file(longterm)
trade('Long-term', daysAgo(20), longterm)
db.close()

writeFileSync(snapshotPath, JSON.stringify({ fetchedAt: `${daysAgo(0)}T04:00:00.000Z`, accounts: [] }))
process.env.STOCK_DB_PATH = dbPath
process.env.STOCK_ROBINHOOD_SNAPSHOT_PATH = snapshotPath
process.env.STOCK_KR_STATEMENTS_DIR = path.join(dir, 'absent')

async function csvSource(strategy: string) {
  const { getAccountCoverage } = await import('../lib/adapters/portfolio-db')
  const row = getAccountCoverage().rows.find((r) => r.account === `Robinhood ${strategy}`)!
  return row.sources.find((s) => s.label === 'CSV')!
}

test('a quiet account is covered through the period its CSV is named for, not its last trade', async () => {
  const csv = await csvSource('Agentic')
  assert.equal(csv.coveredThrough, daysAgo(1))
  assert.equal(csv.status, 'current')
})

test('fills bridged from orders do not make a stale CSV read current', async () => {
  const csv = await csvSource('Mid-term')
  assert.equal(csv.coveredThrough, daysAgo(30))
  assert.equal(csv.status, 'action_needed')
})

test('a period ending in the future is ignored, and the rows decide', async () => {
  const csv = await csvSource('Long-term')
  assert.equal(csv.coveredThrough, daysAgo(20))
})

test('reads the three filename shapes the specs accept', async () => {
  const { robinhoodCsvPeriodEnd } = await import('../lib/adapters/portfolio-db')
  assert.deepEqual(robinhoodCsvPeriodEnd('robinhood-transactions-agentic-20260812-20261009.csv'), { account: 'agentic', end: '2026-10-09' })
  assert.deepEqual(robinhoodCsvPeriodEnd('robinhood-transactions-midterm-20260811.csv'), { account: 'midterm', end: '2026-08-11' })
  assert.deepEqual(robinhoodCsvPeriodEnd('robinhood-transactions-midterm-2024-2025.csv'), { account: 'midterm', end: '2025-12-31' })
  assert.equal(robinhoodCsvPeriodEnd('chase-transactions-20260803-20261007.csv'), null)
})
