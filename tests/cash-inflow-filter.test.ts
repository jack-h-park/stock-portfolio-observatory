import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'

// One invented month (2025-03) with a credit of every kind, at a flat 1,000 KRW/USD.
const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'cash-inflow-filter-')), 'portfolio.db')
const db = new Database(dbPath)
db.exec(`
create table bank_inflows (
  institution text, account text, currency text, date text, amount real, description text,
  counterparty text, category text, rule text, rule_note text, usd_krw_rate real, usd_krw_rate_dated integer
);
create table dividends (
  date text, account text, ticker text, name text, currency text, native_amount real,
  native_tax_withheld real, type text, source_system text, income_category text,
  usd_krw_rate real, usd_krw_rate_dated integer
);
`)
const bank = db.prepare('insert into bank_inflows values (?,?,?,?,?,?,?,?,?,?,?,?)')
bank.run('mg', 'Invented Checking', 'KRW', '2025-03-25', 3_000_000, 'EXAMPLE PAYROLL', '', 'salary', 'salary-example', 'Example payroll', 1000, 1)
bank.run('mg', 'Invented Checking', 'KRW', '2025-03-26', 2_000, '이자 지급', '', 'interest', null, null, 1000, 1)
bank.run('mg', 'Invented Checking', 'KRW', '2025-03-27', 50_000, 'EXAMPLE REFUND', '', 'other', 'refund-example', null, 1000, 1)
bank.run('mg', 'Invented Checking', 'KRW', '2025-03-28', 70_000, 'UNKNOWN SENDER', '', 'unclassified', null, null, 1000, 1)
bank.run('mg', 'Invented Checking', 'KRW', '2025-03-29', 900_000, 'OWN MOVE', '', 'transfer', 'own', 'Own account', 1000, 1)
bank.run('mg', 'Invented Checking', 'KRW', '2025-04-25', 3_000_000, 'EXAMPLE PAYROLL', '', 'salary', 'salary-example', 'Example payroll', 1000, 1)
const div = db.prepare('insert into dividends values (?,?,?,?,?,?,?,?,?,?,?,?)')
div.run('2025-03-15', 'Invented Broker', 'AAA', 'Invented ETF', 'USD', 10, 1, 'DIVIDEND', 'invented', 'dividend', 1000, 1)
div.run('2025-05-15', 'Invented Broker', 'BBB', 'Invented Fund', 'USD', 5, null, null, 'invented', null, 1000, 1)
db.close()

process.env.STOCK_DB_PATH = dbPath
const NOW = new Date('2025-04-30T12:00:00Z')

test('a filter sums only its categories; investment is dividends plus interest', async () => {
  const { getCashInflow } = await import('../lib/adapters/portfolio-db')
  const march = (filter: Parameters<typeof getCashInflow>[3]) => getCashInflow('month', 'KRW', NOW, filter).periods.find((p) => p.period === '2025-03')!
  assert.equal(march('All').total, 3_000_000 + 2_000 + 50_000 + 9_000)
  assert.equal(march('salary').total, 3_000_000)
  assert.equal(march('investment').total, 9_000 + 2_000)
  assert.equal(march('dividend').total, 9_000)
  assert.equal(march('unclassified').total, 70_000)
  // The per-category figures are untouched by the filter; only the total narrows.
  assert.equal(march('salary').interest, 2_000)
  const totals = getCashInflow('month', 'KRW', NOW, 'salary').totals
  assert.equal(totals.trailing12m, 6_000_000)
  assert.equal(totals.ytd, 6_000_000)
  // Salary share stays the share of all counted inflow, whatever the filter.
  assert.equal(totals.salaryShare12m, getCashInflow('month', 'KRW', NOW).totals.salaryShare12m)
})

test('the rows behind one cell carry why each row has its category', async () => {
  const { getCashInflowRows } = await import('../lib/adapters/portfolio-db')
  const salary = getCashInflowRows('2025-03', 'KRW', ['salary'])
  assert.equal(salary.length, 1)
  assert.equal(salary[0].reasonKind, 'rule')
  assert.equal(salary[0].reason, 'Example payroll')
  const refund = getCashInflowRows('2025-03', 'KRW', ['other'])[0]
  assert.deepEqual([refund.reasonKind, refund.reason], ['rule', 'refund-example'])
  const investment = getCashInflowRows('2025-03', 'KRW', ['dividend', 'interest'])
  assert.deepEqual(investment.map((r) => [r.category, r.reasonKind, r.reason]), [
    ['dividend', 'broker', 'DIVIDEND'],
    ['interest', 'default', null],
  ])
  const unclassified = getCashInflowRows('2025-03', 'KRW', ['unclassified'])[0]
  assert.deepEqual([unclassified.reasonKind, unclassified.reason], ['none', null])
  // No category list: every counted category plus unclassified, never transfers.
  assert.equal(getCashInflowRows('2025-03', 'KRW').length, 5)
})

test('a dividend row with no type of its own falls back to its category, never an empty reason', async () => {
  const { getCashInflowRows } = await import('../lib/adapters/portfolio-db')
  const [row] = getCashInflowRows('2025-05', 'KRW', ['other'])
  assert.deepEqual([row.reasonKind, row.reason], ['none', null])
})
