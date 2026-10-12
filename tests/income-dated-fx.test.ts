import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

const DIVIDEND_COLUMNS = [
  'Date', 'Account', 'Symbol', 'Name', 'Currency', 'Native Amount', 'FX Rate',
  'Amount (KRW)', 'Tax', 'Type', 'Source', 'Page',
]
const TRANSACTION_COLUMNS = [
  'Date', 'Account', 'Type', 'Raw Type', 'Ticker', 'Name', 'Quantity',
  'Currency', 'Native Amount', 'FX Rate',
  'Amount (KRW)', 'Settlement (KRW)', 'Unit Price', 'Fee', 'Tax', 'Balance',
  'Source', 'Page',
]

const div = (date: string): Record<string, string | number> => ({
  Date: date, Account: 'Invented Broker(주식종합)', Symbol: 'AAA', Name: 'Invented ETF', Currency: 'USD',
  'Native Amount': 10, 'FX Rate': '', 'Amount (KRW)': '', Tax: '', Type: '배당금입금',
  Source: 'invented.pdf', Page: 1,
})

function tsv(columns: string[], rows: Record<string, string | number>[]) {
  return [columns.join('\t'), ...rows.map((r) => columns.map((c) => String(r[c] ?? '')).join('\t'))].join('\n') + '\n'
}

function ingestWith(rates: { price_date: string; rate: number }[], dividends: Record<string, string | number>[]) {
  const dir = mkdtempSync(path.join(tmpdir(), 'income-fx-'))
  writeSheetPayloads(dir)
  const kr = path.join(dir, 'kr-statements')
  mkdirSync(kr, { recursive: true })
  writeFileSync(path.join(kr, 'dividends.tsv'), tsv(DIVIDEND_COLUMNS, dividends), 'utf8')
  const txns = dividends.map((r) => ({
    Date: r.Date, Account: r.Account, Type: 'DIVIDEND', 'Raw Type': r.Type, Ticker: r.Symbol, Name: r.Name,
    Quantity: 0, Currency: r.Currency, 'Native Amount': r['Native Amount'], 'FX Rate': '',
    'Amount (KRW)': '', 'Settlement (KRW)': 0, 'Unit Price': 0, Fee: 0, Tax: '',
    Balance: 0, Source: r.Source, Page: r.Page,
  }))
  writeFileSync(path.join(kr, 'transactions.tsv'), tsv(TRANSACTION_COLUMNS, txns), 'utf8')
  const fx = path.join(dir, 'historical-fx-rates.json')
  writeFileSync(fx, JSON.stringify({ rates: rates.map((r) => ({ ...r, source: 'test' })) }))
  const dbPath = runIngest(dir, {
    env: { STOCK_KR_STATEMENTS_DIR: kr, STOCK_HISTORICAL_FX_RATES_PATH: fx },
    allowFailure: true,
  })
  return new Database(dbPath, { readonly: true })
}

test('a dividend carries the USD/KRW rate of its own date, or the closest earlier one', () => {
  const db = ingestWith(
    [{ price_date: '2025-01-02', rate: 1400 }, { price_date: '2025-03-03', rate: 1450 }],
    [div('2025-03-01'), div('2025-03-03')],
  )
  const rows = db.prepare('select date, usd_krw_rate, usd_krw_rate_dated from dividends_all order by date').all()
  assert.deepEqual(rows, [
    { date: '2025-03-01', usd_krw_rate: 1400, usd_krw_rate_dated: 1 },
    { date: '2025-03-03', usd_krw_rate: 1450, usd_krw_rate_dated: 1 },
  ])
})

test('a dividend older than every dated rate is marked undated and the check says so', () => {
  const db = ingestWith([{ price_date: '2025-01-02', rate: 1400 }], [div('2024-06-01')])
  const row = db.prepare('select usd_krw_rate_dated from dividends_all').get() as { usd_krw_rate_dated: number }
  assert.equal(row.usd_krw_rate_dated, 0)
  const check = db.prepare("select status, severity, detail from validation_checks where name = 'income_fx_dated'").get() as { status: string; severity: string; detail: string }
  // The ingest's non-blocking checks are status 'fail' at severity 'warning'.
  assert.equal(check.status, 'fail')
  assert.equal(check.severity, 'warning')
  assert.match(check.detail, /1 .*2024-06-01/)
})

test('income totals convert each row at its own rate, in either display currency', async () => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'income-adapter-')), 'portfolio.db')
  const db = new Database(dbPath)
  db.exec(`
    create table holdings (base_market_value real, base_cost real, total_cost_krw real, account_wrapper text, market text, ticker text);
    create table dividends (market text, currency text, date text, ticker text, name text, type text, native_amount real,
      native_tax_withheld real, amount_krw real, income_category text, usd_krw_rate real, usd_krw_rate_dated integer);
  `)
  const ins = db.prepare('insert into dividends values (?,?,?,?,?,?,?,?,?,?,?,?)')
  ins.run('US', 'USD', '2025-01-10', 'AAA', 'A', 'DIVIDEND', 10, 0, 15000, 'dividend', 1300, 1)
  ins.run('US', 'USD', '2025-02-10', 'AAA', 'A', 'DIVIDEND', 10, 0, 15000, 'dividend', 1400, 1)
  ins.run('KR', 'KRW', '2025-02-11', 'BBB', 'B', '배당', 28000, 0, 28000, 'dividend', 1400, 1)
  // An undated KRW row adds nothing, and is only "undated" where it would be converted.
  ins.run('KR', 'KRW', '2025-02-12', 'BBB', 'B', '배당', 0, 0, 0, 'dividend', 1400, 0)
  db.close()
  process.env.STOCK_DB_PATH = dbPath
  const { getIncomeReview } = await import('../lib/adapters/portfolio-db')
  const krw = getIncomeReview('KRW')
  assert.deepEqual(krw.byMonth.map((m) => [m.month, m.base_income]), [['2025-01', 13000], ['2025-02', 42000]])
  assert.equal(krw.currency, 'KRW')
  assert.equal(krw.totals.undated_count, 0)
  const usd = getIncomeReview('USD')
  assert.deepEqual(usd.byMonth.map((m) => [m.month, m.base_income]), [['2025-01', 10], ['2025-02', 30]])
  assert.equal(usd.currency, 'USD')
  assert.equal(usd.totals.undated_count, 1)
})
