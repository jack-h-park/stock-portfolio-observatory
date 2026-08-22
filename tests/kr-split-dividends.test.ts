import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

// Apple's 2020-08-31 4-for-1, as 미래에셋 books it: an 액면분할출고 for the shares
// held and an 액면분할입고 for the shares that replace them. Reading those two
// legs as a transfer out followed by a transfer in closed the lot bought
// 2020-03-30 and reopened it dated 2020-08-31, which lost the acquisition date —
// so the two dividends paid BEFORE the split had no lot window to land in and
// `kr_realized_dividends_attributed` failed on them. NVDA's 2024-06-10 10-for-1
// did the same to three of 토스's.
//
// The lot walk restates the position in place instead. That fixes the date and
// creates a UNIT MISMATCH the attribution has to answer for: the lot is now
// stated in post-split shares while the position timeline, read at a date before
// the split, is still in pre-split ones. Dividing ₩1,012 by 1 held share and
// paying it onto a 4-share lot books ₩4,048 — a payment the account never
// received. Both halves are asserted here, because either alone is wrong.

const TRANSACTION_COLUMNS = [
  'Date', 'Account', 'Type', 'Raw Type', 'Ticker', 'Name', 'Quantity',
  'Currency', 'Native Amount', 'FX Rate',
  'Amount (KRW)', 'Settlement (KRW)', 'Unit Price', 'Fee', 'Tax', 'Balance',
  'Source', 'Page',
]
const DIVIDEND_COLUMNS = [
  'Date', 'Account', 'Symbol', 'Name', 'Currency', 'Native Amount', 'FX Rate',
  'Amount (KRW)', 'Type', 'Source', 'Page',
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
const SOURCE = 'mirae-certificate-2020.pdf'

const txn = (row: Record<string, string | number>) => ({
  Account: ACCOUNT, Ticker: 'APL', Name: '애플', Currency: 'KRW', 'FX Rate': 1,
  'Native Amount': 0, 'Amount (KRW)': 0, 'Settlement (KRW)': 0, 'Unit Price': 0,
  Fee: 0, Tax: 0, Balance: 0, Source: SOURCE, Page: 1, ...row,
})

// One share bought, split into four, all four sold. The whole position is
// realized, so every payment along the way belongs to the one lot.
const BUY = txn({
  Date: '2020-03-30', Type: 'BUY', 'Raw Type': '해외주식매수입고', Quantity: 1,
  'Native Amount': 400000, 'Amount (KRW)': 400000, 'Unit Price': 400000,
})
const SPLIT_OUT = txn({ Date: '2020-08-31', Type: 'STOCK_SPLIT', 'Raw Type': '액면분할출고(해외)', Quantity: 1 })
const SPLIT_IN = txn({ Date: '2020-08-31', Type: 'STOCK_SPLIT', 'Raw Type': '액면분할입고(해외)', Quantity: 4 })
const SELL = txn({
  Date: '2021-09-01', Type: 'SELL', 'Raw Type': '해외주식매도', Quantity: 4,
  'Native Amount': 600000, 'Amount (KRW)': 600000, 'Unit Price': 150000,
})

// Paid on the single pre-split share, four months before the split.
const PRE_SPLIT_PAYMENT = 1012
const DIVIDEND = {
  Date: '2020-05-15', Account: ACCOUNT, Symbol: 'APL', Name: '애플', Currency: 'KRW',
  'Native Amount': PRE_SPLIT_PAYMENT, 'FX Rate': 1, 'Amount (KRW)': PRE_SPLIT_PAYMENT,
  Type: '배당금외화입금', Source: SOURCE, Page: 1,
}

// What the restating lot walk produces for the transactions above: ONE lot,
// keeping its 2020-03-30 acquisition date, stated in post-split shares.
const REALIZED_LOT = {
  Account: ACCOUNT, Ticker: 'APL', Name: '애플',
  'Acquired Date': '2020-03-30', 'Sold Date': '2021-09-01', 'Quantity Sold': 4,
  Currency: 'KRW', 'Native Cost Basis': 400000, 'Native Proceeds': 600000,
  'Cost Basis (KRW)': 400000, 'Proceeds (KRW)': 600000, 'Realized G/L (KRW)': 200000,
  'Holding Days': 520, 'Tax Term': 'Long-term', Source: SOURCE,
}

function ingest(realized: Record<string, string | number>[]) {
  const dir = mkdtempSync(path.join(tmpdir(), 'kr-split-'))
  writeSheetPayloads(dir)
  const kr = path.join(dir, 'kr-statements')
  mkdirSync(kr, { recursive: true })
  writeFileSync(path.join(kr, 'transactions.tsv'), tsv(TRANSACTION_COLUMNS, [BUY, SPLIT_OUT, SPLIT_IN, SELL]), 'utf8')
  writeFileSync(path.join(kr, 'dividends.tsv'), tsv(DIVIDEND_COLUMNS, [DIVIDEND]), 'utf8')
  writeFileSync(path.join(kr, 'realized.tsv'), tsv(REALIZED_COLUMNS, realized), 'utf8')

  // A failing check exits non-zero and still writes the database, which is
  // the state one of these tests is asserting on.
  const dbPath = runIngest(dir, { env: { STOCK_KR_STATEMENTS_DIR: kr }, allowFailure: true })

  const db = new Database(dbPath, { readonly: true })
  return {
    lots: db
      .prepare('select acquired_date, quantity_sold, dividends_krw from realized_lots where ticker = ? order by acquired_date')
      .all('APL') as { acquired_date: string; quantity_sold: number; dividends_krw: number }[],
    check: (name: string) =>
      db.prepare('select status, detail from validation_checks where name = ?').get(name) as
        | { status: string; detail: string }
        | undefined,
  }
}

test('a dividend paid before a split lands on the lot that earned it, undivided and unmultiplied', () => {
  const { lots, check } = ingest([REALIZED_LOT])

  assert.equal(lots.length, 1)
  assert.equal(lots[0].acquired_date, '2020-03-30')

  // The whole payment, once. Dividing ₩1,012 by the single share held on the
  // pay date and paying it onto the 4-share lot is the 4x this guards against;
  // dividing by 4 without converting the denominator is the 1/4 on the other
  // side of it.
  assert.equal(lots[0].dividends_krw, PRE_SPLIT_PAYMENT)

  assert.equal(check('kr_realized_dividends_attributed')?.status, 'pass')
})

test('the check can still fail, so the pass above is worth something', () => {
  // The same fixture with the pre-split acquisition date thrown away — exactly
  // what the out-and-in reading produced. The payment then falls inside a closed
  // position's life with no lot window, which is the failure that was reported.
  const stale = ingest([{ ...REALIZED_LOT, 'Acquired Date': '2020-08-31', 'Holding Days': 366 }])

  assert.equal(stale.lots[0].dividends_krw, 0)
  const check = stale.check('kr_realized_dividends_attributed')
  assert.equal(check?.status, 'fail')
  assert.match(check?.detail ?? '', /2020-05-15/)
})
