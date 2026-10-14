import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'

// Invented unclassified credits at a flat 1,000 KRW/USD.
const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'cash-inflow-unclassified-')), 'portfolio.db')
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
const b = (institution: string, currency: string, date: string, amount: number, description: string, category = 'unclassified') =>
  bank.run(institution, `${institution} account`, currency, date, amount, description, '', category, null, null, 1000, 1)
b('mg', 'KRW', '2025-03-01', 50_000, 'SENDER A')
b('mg', 'KRW', '2025-05-01', 70_000, 'SENDER A')
b('mg', 'KRW', '2025-04-01', 200_000, 'SENDER B')
b('chase', 'USD', '2025-04-10', 30, 'ODD CREDIT')
b('mg', 'KRW', '2024-01-01', 9_999_999, 'OLD SENDER') // outside the default 12 months
b('mg', 'KRW', '2025-04-02', 1_000, 'EXAMPLE PAYROLL', 'salary') // classified: never listed
db.close()

process.env.STOCK_DB_PATH = dbPath
process.env.STOCK_TIME_ZONE = 'Asia/Seoul'
const NOW = new Date('2025-06-15T03:00:00Z')

test('unclassified credits are grouped by where they came from, largest first, within the range', async () => {
  const { getCashInflowUnclassified } = await import('../lib/adapters/portfolio-db')
  const groups = getCashInflowUnclassified('KRW', {}, NOW)
  assert.deepEqual(
    groups.map((g) => [g.description, g.count, g.total, g.first, g.last]),
    [
      ['SENDER B', 1, 200_000, '2025-04-01', '2025-04-01'],
      ['SENDER A', 2, 120_000, '2025-03-01', '2025-05-01'],
      ['ODD CREDIT', 1, 30_000, '2025-04-10', '2025-04-10'],
    ]
  )
  assert.deepEqual(groups[1].rows.map((r) => [r.date, r.native, r.currency]), [['2025-03-01', 50_000, 'KRW'], ['2025-05-01', 70_000, 'KRW']])
})

test('the grouping follows the source, currency and range filters', async () => {
  const { getCashInflowUnclassified } = await import('../lib/adapters/portfolio-db')
  assert.deepEqual(getCashInflowUnclassified('KRW', { currency: 'USD' }, NOW).map((g) => g.description), ['ODD CREDIT'])
  assert.deepEqual(getCashInflowUnclassified('KRW', { source: 'broker' }, NOW), [])
  assert.ok(getCashInflowUnclassified('KRW', { range: 'all' }, NOW).some((g) => g.description === 'OLD SENDER'))
})

test('the suggested rule is valid JSON in the shape the ingest accepts, defaulting the category to other', async () => {
  const { ruleSnippet } = await import('../lib/cash-inflow-format')
  const shape = await import('../scripts/bank-inflow-rules.mjs')
  const accepted = (rule: { match: Record<string, string>; category: string }) => {
    assert.ok(shape.BANK_INFLOW_CATEGORIES.includes(rule.category), rule.category)
    for (const key of Object.keys(rule.match)) assert.ok([...shape.BANK_INFLOW_MATCH_KEYS, ...shape.BANK_INFLOW_BOUND_KEYS].includes(key), key)
    assert.ok(shape.BANK_INFLOW_MATCH_KEYS.some((k: string) => typeof rule.match[k] === 'string' && rule.match[k].trim() !== ''))
  }
  const rule = JSON.parse(ruleSnippet({ institution: 'mg', account: 'mg account', description: 'SENDER A' }))
  assert.deepEqual(rule.match, { institution: 'mg', descriptionIncludes: 'SENDER A' })
  assert.equal(rule.category, 'other')
  assert.match(rule.id, /^other-/)
  accepted(rule)
  // Two long descriptions that share a start still get different ids.
  const long = 'A'.repeat(50)
  assert.notEqual(
    JSON.parse(ruleSnippet({ institution: 'mg', account: 'x', description: `${long} ONE` })).id,
    JSON.parse(ruleSnippet({ institution: 'mg', account: 'x', description: `${long} TWO` })).id
  )
  // A credit with no description is matched on its account instead.
  const blank = JSON.parse(ruleSnippet({ institution: 'mg', account: 'mg account', description: '  ' }))
  assert.deepEqual(blank.match, { institution: 'mg', accountIncludes: 'mg account' })
  accepted(blank)
})
