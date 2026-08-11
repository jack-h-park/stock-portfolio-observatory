import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readUsHoldingTickers } from '../scripts/source-files.mjs'

// The price fetch asks Yahoo for whatever this reader returns, and a miss exits
// non-zero and fails the WHOLE REFRESH before the ingest runs. So a row that is
// not a position must never reach it.
//
// Fidelity's 2026-08-11 export added `Pending activity` as a row of its own,
// under a real account number, with the label in the Symbol column and every
// numeric cell empty. The account-number guard passed it, `Pending activity`
// went out as a ticker, and the refresh died at 6/11 steps — three days of
// trades sat on the host unread while the only symptom was one missing price.
//
// The ingest's own Fidelity reader dropped that row correctly the whole time.
// The two readers disagreeing is the failure, which is why the quantity rule is
// asserted here for every layout rather than only for the one that broke.

const FIDELITY_HEADER =
  'Account number,Account name,Symbol,Description,Quantity,Last price,Current value,' +
  'Total gain/loss dollar,Total gain/loss percent,Cost basis total,Average cost basis,Type'

function fidelity(rows: string[]) {
  const dir = mkdtempSync(path.join(tmpdir(), 'us-tickers-'))
  const filename = path.join(dir, 'fidelity-holdings-20260811.csv')
  writeFileSync(filename, [FIDELITY_HEADER, ...rows].join('\n') + '\n', 'utf8')
  return readUsHoldingTickers([{ brokerage: 'Fidelity', filename }])
}

test('a Fidelity pending-activity row is not a ticker', () => {
  const tickers = fidelity([
    'Z37480490,[Fidelity] Individual - TOD,VTI,VANGUARD TOTAL STOCK MKT ETF,12,$380.65,"$4,567.80",$100.00,2.24%,"$4,467.80",$372.31,Cash',
    // The real row, verbatim in shape: real account number, label in the Symbol
    // column, every number blank except a dollar amount in the gain/loss column.
    'Z37480490,[Fidelity] Individual - TOD,Pending activity,,,,,-$1.33,,,,',
  ])

  assert.deepEqual(tickers, ['VTI'])
})

test('a blank quantity is not a quantity, which is what let the row through', () => {
  // The guard this replaces tested `Number.isFinite(Number(cell))`, and
  // `Number('')` is 0 — finite, so every empty cell passed. Asserted directly
  // because the distinction is invisible at a glance and easy to reintroduce.
  const tickers = fidelity([
    'Z37480490,[Fidelity] Individual - TOD,SPCX,SPAC AND NEW ISSUE ETF,,,,,,,,Cash',
  ])

  assert.deepEqual(tickers, [])
})

test('a zero quantity IS a quantity, so a closed position still gets priced', () => {
  // Zero is a number the broker stated, not an absent one. A position that went
  // to zero this week is still one the dashboard reports on.
  const tickers = fidelity([
    'Z37480490,[Fidelity] Individual - TOD,AAPL,APPLE INC,0,$230.00,$0.00,$0.00,0.00%,$0.00,$0.00,Cash',
  ])

  assert.deepEqual(tickers, ['AAPL'])
})

test('the disclaimer paragraphs at the end of the export are not tickers', () => {
  // Three single-cell paragraphs follow the table. They have no account number,
  // which is the guard that was already there and still does its job.
  const tickers = fidelity([
    'Z37480490,[Fidelity] Individual - TOD,VTI,VANGUARD TOTAL STOCK MKT ETF,12,$380.65,"$4,567.80",$100.00,2.24%,"$4,467.80",$372.31,Cash',
    '"Brokerage services are provided by Fidelity Brokerage Services LLC."',
  ])

  assert.deepEqual(tickers, ['VTI'])
})
