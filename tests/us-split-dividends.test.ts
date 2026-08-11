import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { writeSheetPayloads } from './sheet-payloads'

// The same defect #93 fixed on the Korea side, on the US one. The replay
// restates a split in place, so a lot keeps its acquisition date and ends up
// stated in POST-split shares — while the position timeline, read at a date
// before the split, is still in pre-split ones. Divide a payment by the smaller
// number, pay it onto the larger one, and it comes out multiplied by the split
// factor.
//
// No US lot on the books currently spans a split, so nothing is wrong today and
// no figure moves when this lands. That is exactly why it needs a test: the
// defect is latent, it costs nothing to hold down now, and the first lot to span
// a split would otherwise book a payment several times over with every check
// still green. The comment this replaces called the error "small and bounded",
// which it is not — it is the whole factor.

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

const ROBINHOOD_HEADER =
  '"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"'

const row = (date: string, ticker: string, description: string, code: string, qty: string, price: string, amount: string) =>
  `"${date}","${date}","${date}","${ticker}","${description}","${code}","${qty}","${price}","${amount}"`

// One share bought, one dividend paid on it, then a 4-for-1, then the lot sold
// whole. The payment predates the split, and the position is this lot and
// nothing else, so all of it belongs here.
const PAYMENT = 10.0
const SPLIT_FACTOR = 4

function ingest(rows: string[]) {
  const dir = mkdtempSync(path.join(tmpdir(), 'us-split-'))
  mkdirSync(path.join(dir, 'us-transactions'), { recursive: true })
  writeFileSync(
    path.join(dir, 'us-transactions', 'robinhood-transactions-midterm-20260731.csv'),
    [ROBINHOOD_HEADER, ...rows].join('\n') + '\n',
    'utf8'
  )
  writeSheetPayloads(dir)
  const repoData = mkdtempSync(path.join(tmpdir(), 'us-split-data-'))
  cpSync(path.join(REPO_ROOT, 'data'), repoData, { recursive: true })

  const dbPath = path.join(dir, 'out.db')
  execFileSync(process.execPath, ['scripts/ingest-stock-data.mjs'], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
    env: {
      ...process.env,
      STOCK_DATA_DIR: dir,
      STOCK_DB_PATH: dbPath,
      STOCK_ROBINHOOD_SNAPSHOT_PATH: path.join(repoData, 'no-snapshot.json'),
      STOCK_KR_STATEMENTS_DIR: path.join(dir, 'no-kr'),
      STOCK_US_PDF_EVIDENCE_PATH: path.join(dir, 'no-evidence.json'),
    },
  })

  const db = new Database(dbPath, { readonly: true })
  return db
    .prepare(
      'select acquired_date, round(quantity_sold, 6) as qty, round(dividends_native, 4) as dividends ' +
        'from realized_lots where market = ? and basis = ? and ticker = ? order by acquired_date'
    )
    .all('US', 'replay', 'AAPL') as { acquired_date: string; qty: number; dividends: number }[]
}

test('a US dividend paid before a split is not multiplied by the split factor', () => {
  const lots = ingest([
    row('3/30/2020', 'AAPL', 'Apple Inc.', 'Buy', '1', '$400.00', '($400.00)'),
    row('5/15/2020', 'AAPL', 'Cash Div: R/D 2020-05-08 P/D 2020-05-15', 'CDIV', '', '', `$${PAYMENT.toFixed(2)}`),
    // Robinhood books the shares ADDED by a split, not the resulting total.
    row('8/31/2020', 'AAPL', 'Apple Inc. Stock Split', 'SPL', String(SPLIT_FACTOR - 1), '', ''),
    row('9/1/2021', 'AAPL', 'Apple Inc.', 'Sell', String(SPLIT_FACTOR), '$150.00', '$600.00'),
  ])

  assert.equal(lots.length, 1)
  // The split restated the lot without replacing it: the buy date survives and
  // the quantity is the post-split one.
  assert.equal(lots[0].acquired_date, '2020-03-30')
  assert.equal(lots[0].qty, SPLIT_FACTOR)

  // The whole payment, once. Divided by the 1 share held on the pay date and
  // paid onto the 4-share lot, this is $40 — the failure being guarded.
  assert.equal(lots[0].dividends, PAYMENT)
})

test('a payment made after the split is unaffected, so the conversion is not applied twice', () => {
  const lots = ingest([
    row('3/30/2020', 'AAPL', 'Apple Inc.', 'Buy', '1', '$400.00', '($400.00)'),
    row('8/31/2020', 'AAPL', 'Apple Inc. Stock Split', 'SPL', String(SPLIT_FACTOR - 1), '', ''),
    row('11/13/2020', 'AAPL', 'Cash Div: R/D 2020-11-06 P/D 2020-11-13', 'CDIV', '', '', `$${PAYMENT.toFixed(2)}`),
    row('9/1/2021', 'AAPL', 'Apple Inc.', 'Sell', String(SPLIT_FACTOR), '$150.00', '$600.00'),
  ])

  // Held on the pay date and stated in the lot's units are the same 4 shares
  // here, so no factor applies and the lot still takes the payment whole. A
  // conversion reaching backwards past the split would divide this by 4.
  assert.equal(lots[0].dividends, PAYMENT)
})
