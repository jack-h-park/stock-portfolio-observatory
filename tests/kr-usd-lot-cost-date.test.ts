import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

// When the lot walk has no won figure for a dollar lot, the ingest converts it.
// It used to convert every leg at `Date || Sold Date`: a realized lot's cost at
// the SALE date, and an open lot, which has neither, at today's rate. Either way
// the won cost moved with the currency and the won gain lost the currency's move
// over the holding period. Cost converts at the acquisition date; proceeds at the
// sale date.

const TRANSACTION_COLUMNS = [
  'Date', 'Account', 'Type', 'Raw Type', 'Ticker', 'Name', 'Quantity',
  'Currency', 'Native Amount', 'FX Rate',
  'Amount (KRW)', 'Settlement (KRW)', 'Unit Price', 'Fee', 'Tax', 'Balance',
  'Source', 'Page',
]
const REALIZED_COLUMNS = [
  'Account', 'Ticker', 'Name', 'Acquired Date', 'Sold Date', 'Quantity Sold',
  'Currency', 'Native Cost Basis', 'Native Proceeds',
  'Cost Basis (KRW)', 'Proceeds (KRW)', 'Realized G/L (KRW)',
  'Holding Days', 'Tax Term', 'Source',
]
const TAXLOT_COLUMNS = [
  'Account', 'Ticker', 'Name', 'Acquired Date', 'Open Quantity',
  'Currency', 'Native Cost Basis', 'Native Unit Cost',
  'Cost Basis (KRW)', 'Unit Cost', 'Holding Days', 'As Of Date', 'Tax Term', 'Source',
]

function tsv(columns: string[], rows: Record<string, string | number>[]) {
  return [columns.join('\t'), ...rows.map((r) => columns.map((c) => String(r[c] ?? '')).join('\t'))].join('\n') + '\n'
}

const ACCOUNT = '미래에셋증권(종합)'
const SOURCE = 'mirae-certificate-2025.pdf'
const txn = (row: Record<string, string | number>) => ({
  Account: ACCOUNT, Ticker: 'QQQ', Name: 'INVESCO QQQ TRUST', Currency: 'USD',
  Fee: 0, Tax: 0, Balance: 0, Source: SOURCE, Page: 1, ...row,
})

function ingest() {
  const dir = mkdtempSync(path.join(tmpdir(), 'kr-usd-cost-date-'))
  writeSheetPayloads(dir)
  const kr = path.join(dir, 'kr-statements')
  mkdirSync(kr, { recursive: true })
  writeFileSync(path.join(kr, 'transactions.tsv'), tsv(TRANSACTION_COLUMNS, [
    txn({ Date: '2021-08-31', Type: 'BUY', 'Raw Type': '해외주식매수입고', Quantity: 3, 'Native Amount': 1_200, 'Unit Price': 400 }),
    txn({ Date: '2025-10-29', Type: 'SELL', 'Raw Type': '해외주식매도출고', Quantity: 1, 'Native Amount': 600, 'Unit Price': 600 }),
  ]), 'utf8')
  writeFileSync(path.join(kr, 'realized.tsv'), tsv(REALIZED_COLUMNS, [{
    Account: ACCOUNT, Ticker: 'QQQ', Name: 'INVESCO QQQ TRUST',
    'Acquired Date': '2021-08-31', 'Sold Date': '2025-10-29', 'Quantity Sold': 1,
    Currency: 'USD', 'Native Cost Basis': 400, 'Native Proceeds': 600,
    'Holding Days': 1520, 'Tax Term': 'Long-term', Source: SOURCE,
  }]), 'utf8')
  writeFileSync(path.join(kr, 'taxlots.tsv'), tsv(TAXLOT_COLUMNS, [{
    Account: ACCOUNT, Ticker: 'QQQ', Name: 'INVESCO QQQ TRUST',
    'Acquired Date': '2021-08-31', 'Open Quantity': 2,
    Currency: 'USD', 'Native Cost Basis': 800, 'Native Unit Cost': 400,
    'Holding Days': 1580, 'As Of Date': '2025-12-31', 'Tax Term': 'Long-term', Source: SOURCE,
  }]), 'utf8')
  const fxPath = path.join(dir, 'historical-fx-rates.json')
  writeFileSync(fxPath, JSON.stringify({ rates: [
    { price_date: '2021-08-31', rate: 1_200, source: 'test' },
    { price_date: '2025-10-29', rate: 1_400, source: 'test' },
  ] }), 'utf8')

  const dbPath = runIngest(dir, {
    env: { STOCK_KR_STATEMENTS_DIR: kr, STOCK_HISTORICAL_FX_RATES_PATH: fxPath },
    allowFailure: true,
  })
  return new Database(dbPath, { readonly: true })
}

test('a realized dollar lot is costed at its acquisition date and sold at its sale date', () => {
  const db = ingest()
  const lot = db.prepare(
    "select cost_basis_krw, proceeds_krw, realized_gl_krw from realized_lots where market = 'KR' and ticker = 'QQQ'"
  ).get() as { cost_basis_krw: number; proceeds_krw: number; realized_gl_krw: number }
  assert.equal(lot.cost_basis_krw, 480_000)
  assert.equal(lot.proceeds_krw, 840_000)
  assert.equal(lot.realized_gl_krw, 360_000)
})

test('an open dollar lot is costed at its acquisition date, not at today\'s rate', () => {
  const db = ingest()
  const lot = db.prepare(
    "select cost_basis_krw from tax_lots where market = 'KR' and ticker = 'QQQ'"
  ).get() as { cost_basis_krw: number }
  assert.equal(lot.cost_basis_krw, 960_000)
})
