import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'

const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'cash-inflow-')), 'portfolio.db')
const db = new Database(dbPath)
db.exec(`
create table bank_inflows (
  institution text, account text, currency text, date text, amount real, description text,
  counterparty text, category text, rule text, usd_krw_rate real, usd_krw_rate_dated integer
);
create table dividends (
  date text, account text, ticker text, name text, currency text, native_amount real,
  native_tax_withheld real, type text, source_system text, income_category text,
  usd_krw_rate real, usd_krw_rate_dated integer
);
`)
const bank = db.prepare('insert into bank_inflows values (?,?,?,?,?,?,?,?,?,?,?)')
const b = (date: string, currency: string, amount: number, category: string, rate: number, dated = 1, description = 'invented') =>
  bank.run('Invented Bank', '000-1', currency, date, amount, description, null, category, null, rate, dated)
b('2025-03-10', 'KRW', 3_000_000, 'salary', 1400)
b('2025-03-11', 'USD', 2000, 'salary', 1400)
b('2025-03-12', 'KRW', 500_000, 'transfer', 1400)
b('2025-03-13', 'USD', 12.34, 'dividend', 1400)
b('2025-03-14', 'USD', 400, 'unclassified', 1400)
b('2024-01-05', 'USD', 1000, 'salary', 1500, 0)
b('2024-02-05', 'KRW', 1000, 'other', 1500, 0)

const div = db.prepare('insert into dividends values (?,?,?,?,?,?,?,?,?,?,?,?)')
const d = (date: string, native: number, tax: number | null, type: string, category: string, source = 'invented_pdf', currency = 'USD', rate = 1300) =>
  div.run(date, 'Invented Broker', 'AAA', 'Invented ETF', currency, native, tax, type, source, category, rate, 1)
d('2025-03-15', 10, 1.5, 'DIVIDEND', 'dividend')
d('2025-03-16', 5000, null, 'SHARE_REWARD', 'other', 'invented_pdf', 'KRW')
d('2025-03-17', 7, null, 'staking_reward', 'other')
d('2025-03-18', 99, null, '선환전차액입금', 'other')
d('2025-03-19', 20, 3, '외화증권배당금입금', 'dividend', 'korea_statement')
d('2025-03-20', 4, 1, '배당금환급', 'dividend')
d('2025-03-21', 2, null, 'INTEREST', 'interest')
db.close()

process.env.STOCK_DB_PATH = dbPath
const NOW = new Date('2025-06-15T12:00:00Z')

test('periods add salary and net dividends at their own rates; transfers and in-kind rewards never count', async () => {
  const { getCashInflow } = await import('../lib/adapters/portfolio-db')
  const m = getCashInflow('month', 'KRW', NOW)
  const march = m.periods.find((p) => p.period === '2025-03')!
  assert.equal(march.salary, 3_000_000 + 2_000 * 1400)
  // 10-1.5 net, 20 already net (Toss foreign), 4 refund as-is, all at 1300; plus bank dividend at 1400
  assert.equal(march.dividend, (8.5 + 20 + 4) * 1300 + 12.34 * 1400)
  assert.equal(march.interest, 2 * 1300)
  assert.equal(march.other, 0)
  assert.equal(march.unclassified, 400 * 1400)
  assert.equal(march.total, march.salary + march.dividend + march.interest + march.other)
  assert.equal(m.unclassifiedCount, 1)
  assert.equal(m.hasBankData, true)
  const y = getCashInflow('year', 'USD', NOW)
  assert.equal(y.periods.find((p) => p.period === '2025')!.salary, 3_000_000 / 1400 + 2_000)
  assert.deepEqual(y.periods.map((p) => p.period), ['2024', '2025'])
})

test('a row with no dated rate still converts, and is counted', async () => {
  const { getCashInflow } = await import('../lib/adapters/portfolio-db')
  const r = getCashInflow('month', 'KRW', NOW)
  assert.equal(r.undatedCount, 1) // the undated KRW row is already in KRW, never converted
  assert.equal(getCashInflow('month', 'USD', NOW).undatedCount, 1) // the undated USD row is not converted in USD
  assert.ok(r.periods.some((p) => p.period === '2024-01' && p.salary === 1_500_000))
})

test('trailing 12 months covers the current month and the 11 before it', async () => {
  const { getCashInflow } = await import('../lib/adapters/portfolio-db')
  const r = getCashInflow('month', 'KRW', NOW)
  const all = r.periods.filter((p) => p.period >= '2024-07').reduce((s, p) => s + p.total, 0)
  assert.equal(r.totals.trailing12m, all)
  assert.equal(r.totals.ytd, all)
  assert.equal(r.totals.monthlyAverage12m, all / 12)
  const salary = r.periods.filter((p) => p.period >= '2024-07').reduce((s, p) => s + p.salary, 0)
  assert.equal(r.totals.salaryShare12m, salary / all)
  // From January 2026 on, March 2025 is out of the window and the 2024 row too.
  const later = getCashInflow('month', 'KRW', new Date('2026-03-15T12:00:00Z'))
  assert.equal(later.totals.trailing12m, 0)
  assert.equal(later.totals.salaryShare12m, null)
  assert.equal(getCashInflow('month', 'KRW', new Date('2026-02-15T12:00:00Z')).totals.trailing12m, all)
})

test('getCashInflowRows lists the period rows, including unclassified, without excluded types', async () => {
  const { getCashInflowRows } = await import('../lib/adapters/portfolio-db')
  const rows = getCashInflowRows('2025-03', 'KRW')
  assert.ok(!rows.some((r) => r.category === 'unclassified' && r.source === 'dividend'))
  assert.ok(rows.some((r) => r.category === 'unclassified' && r.amount === 400 * 1400))
  assert.equal(rows.length, 4 + 4) // 4 bank rows (transfer left out) + 4 dividend rows (3 excluded types)
  assert.deepEqual(rows.map((r) => r.date), [...rows.map((r) => r.date)].sort())
  const net = rows.find((r) => r.source === 'dividend' && r.native === 8.5)!
  assert.equal(net.amount, 8.5 * 1300)
  assert.equal(getCashInflowRows('2025', 'USD').length, rows.length)
})

test('a currency other than KRW or USD is not converted at the USD rate', async () => {
  const { datedAmountSql } = await import('../lib/adapters/income-fx')
  assert.match(datedAmountSql('KRW'), /else null end/)
  assert.match(datedAmountSql('USD'), /else null end/)
  const c = new Database(':memory:')
  const v = (display: 'KRW' | 'USD', cur: string) =>
    (c.prepare(`select ${datedAmountSql(display, '100')} as v from (select ? as currency, 1400.0 as usd_krw_rate)`).get(cur) as any).v
  assert.equal(v('KRW', 'USD'), 140000)
  assert.equal(v('KRW', 'KRW'), 100)
  assert.equal(v('KRW', 'EUR'), null)
  assert.equal(v('USD', 'EUR'), null)
  c.close()
})

test('the current month follows the app time zone, not UTC', async () => {
  const { getCashInflow } = await import('../lib/adapters/portfolio-db')
  const before = process.env.STOCK_TIME_ZONE
  // 00:30 on 1 January 2025 in Seoul is still 31 December 2024 in UTC.
  const now = new Date('2024-12-31T15:30:00Z')
  try {
    process.env.STOCK_TIME_ZONE = 'Asia/Seoul'
    const seoul = getCashInflow('month', 'KRW', now)
    // Window 2024-02..2025-01: the January 2024 salary is out (the 1000 KRW row of February stays), and 2025 has no rows yet.
    assert.equal(seoul.totals.trailing12m, 1000)
    assert.equal(seoul.totals.ytd, 0)
    process.env.STOCK_TIME_ZONE = 'UTC'
    const utc = getCashInflow('month', 'KRW', now)
    // Window 2024-01..2024-12: the January 2024 salary (1000 USD at 1500) is in.
    assert.equal(utc.totals.trailing12m, 1_500_000 + 1000)
    assert.equal(utc.totals.ytd, 1_500_000 + 1000)
    assert.notEqual(seoul.totals.trailing12m, utc.totals.trailing12m)
  } finally {
    if (before === undefined) delete process.env.STOCK_TIME_ZONE
    else process.env.STOCK_TIME_ZONE = before
  }
})
