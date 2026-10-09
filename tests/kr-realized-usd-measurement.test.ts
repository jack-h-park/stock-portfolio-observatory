import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

// The worldwide year-to-date figure that `us_ytd_realized_assumption_reviewed`
// compares against has to measure a won-denominated lot the way the IRS does:
// basis at the acquisition-date rate, proceeds at the sale-date rate. Converting
// the won gain at one rate gets the sign wrong whenever the won moved more than
// the stock did.
//
// Bought for ₩1,500,000 at 1,500 ($1,000), sold for ₩1,375,000 at 1,250
// ($1,100): a ₩125,000 loss that is a $100 gain.

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

function tsv(columns: string[], rows: Record<string, string | number>[]) {
  return [columns.join('\t'), ...rows.map((r) => columns.map((c) => String(r[c] ?? '')).join('\t'))].join('\n') + '\n'
}

const ACCOUNT = '미래에셋증권(종합)'
const SOURCE = 'mirae-certificate-2026.pdf'

// Statement rows only count for accounts the statement's transactions name.
const txn = (row: Record<string, string | number>) => ({
  Account: ACCOUNT, Ticker: 'APL', Name: '애플', Currency: 'KRW', 'FX Rate': 1,
  Fee: 0, Tax: 0, Balance: 0, Source: SOURCE, Page: 1, ...row,
})
const BUY = txn({
  Date: '2026-01-05', Type: 'BUY', 'Raw Type': '해외주식매수입고', Quantity: 10,
  'Native Amount': 1_500_000, 'Amount (KRW)': 1_500_000, 'Settlement (KRW)': 1_500_000, 'Unit Price': 150_000,
})
const SELL = txn({
  Date: '2026-06-01', Type: 'SELL', 'Raw Type': '해외주식매도', Quantity: 10,
  'Native Amount': 1_375_000, 'Amount (KRW)': 1_375_000, 'Settlement (KRW)': 1_375_000, 'Unit Price': 137_500,
})

const LOT = {
  Account: ACCOUNT, Ticker: 'APL', Name: '애플',
  'Acquired Date': '2026-01-05', 'Sold Date': '2026-06-01', 'Quantity Sold': 10,
  Currency: 'KRW', 'Native Cost Basis': 1_500_000, 'Native Proceeds': 1_375_000,
  'Cost Basis (KRW)': 1_500_000, 'Proceeds (KRW)': 1_375_000, 'Realized G/L (KRW)': -125_000,
  'Holding Days': 147, 'Tax Term': 'Short-term', Source: SOURCE,
}

function computedYtd(fxRates: { price_date: string; rate: number }[]) {
  const dir = mkdtempSync(path.join(tmpdir(), 'kr-realized-usd-'))
  writeSheetPayloads(dir)
  const kr = path.join(dir, 'kr-statements')
  mkdirSync(kr, { recursive: true })
  writeFileSync(path.join(kr, 'transactions.tsv'), tsv(TRANSACTION_COLUMNS, [BUY, SELL]), 'utf8')
  writeFileSync(path.join(kr, 'realized.tsv'), tsv(REALIZED_COLUMNS, [LOT]), 'utf8')
  const fxPath = path.join(dir, 'historical-fx-rates.json')
  writeFileSync(fxPath, JSON.stringify({ rates: fxRates.map((r) => ({ ...r, source: 'test' })) }), 'utf8')
  const policyPath = path.join(dir, 'tax-policy.json')
  writeFileSync(policyPath, JSON.stringify({ jurisdictions: [{ code: 'US', manualAssumptions: { taxInputYear: 2026 } }] }), 'utf8')

  const dbPath = runIngest(dir, {
    env: {
      STOCK_KR_STATEMENTS_DIR: kr,
      STOCK_HISTORICAL_FX_RATES_PATH: fxPath,
      STOCK_TAX_POLICY_PATH: policyPath,
    },
    allowFailure: true,
  })
  const db = new Database(dbPath, { readonly: true })
  const row = db.prepare('select value from meta where key = ?').get('us_ytd_realized_computed') as { value: string }
  return JSON.parse(row.value) as { shortUsd: number; longUsd: number; unconvertibleLots: number }
}

test('a won-denominated sale is measured in dollars leg by leg, not by converting the won gain', () => {
  const ytd = computedYtd([
    { price_date: '2026-01-05', rate: 1500 },
    { price_date: '2026-06-01', rate: 1250 },
  ])
  assert.equal(ytd.unconvertibleLots, 0)
  // The single-rate reading was -125,000 / 1,250 = -100.
  assert.equal(ytd.shortUsd, 100)
  assert.equal(ytd.longUsd, 0)
})

test('an acquisition older than the rate history is unconvertible rather than priced at today\'s rate', () => {
  const ytd = computedYtd([{ price_date: '2026-06-01', rate: 1250 }])
  assert.equal(ytd.unconvertibleLots, 1)
  assert.equal(ytd.shortUsd, 0)
})
