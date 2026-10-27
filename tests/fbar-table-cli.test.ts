import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { buildCliFixture, runCli } from './cli-fixture'

// `pnpm fbar:table`: each foreign account's maximum in a year, from the scratch
// database tests/cli-fixture.ts builds. Every account and amount here is
// invented. The point is that a maximum is the highest balance on ANY day, never
// the year-end balance, which is what a year-end worksheet would have reported.

const RATE_2025 = JSON.parse(readFileSync(path.join(import.meta.dirname, '../data/treasury-reporting-rates.json'), 'utf8')).rates.find(
  (r: { year: number }) => r.year === 2025
).krwPerUsd as number

type Point = [institution: string, account: string, currency: string, date: string, balance: number, dayMax?: number]

function seeded(points: Point[]) {
  const f = buildCliFixture()
  const db = new Database(f.dbPath)
  const insert = db.prepare(
    "insert into cash_balances (institution, account, owner, kind, currency, as_of_date, balance, day_max_balance, source, derived) values (?, ?, 'self', 'checking', ?, ?, ?, ?, 'fixture', 0)"
  )
  for (const [institution, account, currency, date, balance, dayMax] of points) insert.run(institution, account, currency, date, balance, dayMax ?? null)
  db.close()
  return f
}

const POINTS: Point[] = [
  // A won account that peaks mid-year and ends the year small.
  ['examplebank', 'Example Won Account', 'KRW', '2025-01-01', 100_000_000],
  ['examplebank', 'Example Won Account', 'KRW', '2025-06-01', 500_000_000],
  ['examplebank', 'Example Won Account', 'KRW', '2025-12-31', 100_000_000],
  // A won account whose peak is intraday: money in and out on one day.
  ['examplebank', 'Example Pass-through', 'KRW', '2025-01-01', 0],
  ['examplebank', 'Example Pass-through', 'KRW', '2025-03-03', 50_000_000, 700_000_000],
  ['examplebank', 'Example Pass-through', 'KRW', '2025-12-31', 0],
  // A dollar account keeps its own dollars.
  ['examplebank', 'Example Dollar Account', 'USD', '2025-01-01', 1_000],
  ['examplebank', 'Example Dollar Account', 'USD', '2025-10-29', 80_000],
  ['examplebank', 'Example Dollar Account', 'USD', '2025-12-31', 0],
  // A US bank is not an FBAR account.
  ['chase', 'Example US Checking', 'USD', '2025-06-01', 999_999],
]

function table(args: string[]) {
  const f = seeded(POINTS)
  const result = runCli(f, ['fbar:table', ...args])
  return { f, result }
}

test('a maximum is the highest balance on any day, not the year-end balance, and a US bank is left out', () => {
  const { result } = table(['--year', '2025', '--json'])
  assert.equal(result.code, 0, result.stderr)
  const rows = result.json.rows as { account: string; maxUsd: number; maxKrw: number | null; maxDate: string; coverage: string; section: string }[]
  const by = Object.fromEntries(rows.map((r) => [r.account, r]))
  // The fixture's own brokerage account is foreign too; the US bank is not.
  for (const name of ['Example Dollar Account', 'Example Pass-through', 'Example Won Account']) assert.ok(by[name], name)
  assert.equal(by['Example US Checking'], undefined)

  assert.equal(by['Example Won Account'].maxDate, '2025-06-01')
  assert.equal(by['Example Won Account'].maxKrw, 500_000_000)
  assert.equal(by['Example Won Account'].maxUsd, Math.round((500_000_000 / RATE_2025) * 100) / 100)
  // The year ended at 100,000,000: that is not the maximum.
  assert.ok(by['Example Won Account'].maxKrw! > 100_000_000)

  assert.equal(by['Example Pass-through'].maxKrw, 700_000_000, 'the intraday peak competes with the end-of-day balance')
  assert.equal(by['Example Dollar Account'].maxUsd, 80_000)
  assert.equal(by['Example Dollar Account'].maxDate, '2025-10-29')
  assert.equal(result.json.year, 2025)
  assert.equal(result.json.rate.krwPerUsd, RATE_2025)
  assert.ok(Math.abs(result.json.aggregateMaxUsd - rows.reduce((sum, r) => sum + r.maxUsd, 0)) < 0.05, 'the aggregate is the sum of the rows')
})

test('--csv prints the table and nothing else, so a redirect saves a clean file', () => {
  const { result } = table(['--year', '2025', '--csv'])
  assert.equal(result.code, 0, result.stderr)
  const lines = result.stdout.trim().split('\n')
  assert.equal(lines[0], 'section,institution,account,kind,max_usd,max_krw,max_date,coverage,understated,cash_included,cash_daily_max_usd,cash_daily_max_date,best_known_max_usd')
  assert.equal(lines.length, 1 + 4, 'a header, the three seeded accounts and the fixture brokerage account')
  assert.ok(!lines.some((l) => l.includes('Example US Checking')))
  assert.ok(lines.every((l) => l.split(',').length === 13), 'thirteen columns on every line')
  assert.ok(lines.some((l) => l.includes('Example Dollar Account') && l.includes(',80000,')))
  assert.ok(!result.stdout.includes('provenance') && !result.stdout.includes('fbar:table'), 'no banner or provenance in the file')
})

test('the command writes nothing and refuses a malformed year', () => {
  const { result } = table(['--year', '25'])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /four-digit year/)
})

test("a brokerage row's cash is read day by day, and the best known maximum is the larger of the two", () => {
  const f = seeded(POINTS)
  const db = new Database(f.dbPath)
  const insert = db.prepare(
    "insert into brokerage_cash (institution, account, pool, currency, as_of_date, balance, source, account_wrapper, asset_class) values ('Example Broker', 'Example Taxable', ?, ?, ?, ?, 'fixture', 'taxable', 'brokerage')"
  )
  // Dollars swept in for two days and gone before the month-end the holdings are valued at, plus won cash in a second pool.
  insert.run('USD', 'USD', '2025-01-01', 100)
  insert.run('USD', 'USD', '2025-10-29', 76_933.07)
  insert.run('USD', 'USD', '2025-10-31', 0)
  insert.run('KRW', 'KRW', '2025-10-29', RATE_2025 * 1_000)
  db.close()
  const result = runCli(f, ['fbar:table', '--year', '2025', '--json'])
  assert.equal(result.code, 0, result.stderr)
  const row = (result.json.rows as { account: string; maxUsd: number; cashDailyMaxUsd: number; cashDailyMaxDate: string; bestKnownMaxUsd: number }[]).find((r) => r.account === 'Example Taxable')!
  assert.equal(row.cashDailyMaxDate, '2025-10-29')
  assert.equal(row.cashDailyMaxUsd, Math.round((76_933.07 + 1_000) * 100) / 100, 'both pools, in dollars, carried to the same day')
  assert.equal(row.bestKnownMaxUsd, Math.max(row.maxUsd, row.cashDailyMaxUsd))
  const bank = (result.json.rows as { account: string; cashDailyMaxUsd: number | null }[]).find((r) => r.account === 'Example Won Account')!
  assert.equal(bank.cashDailyMaxUsd, null, 'a bank row is already daily: no cash column')
})
