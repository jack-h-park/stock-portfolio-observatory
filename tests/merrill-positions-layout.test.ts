import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'
import { readUsHoldingTickers } from '../scripts/source-files.mjs'

// Merrill's 2026-08-11 export heads the same flat positions table with
// `Positions` instead of `Symbol`, spells the basis `Total client investment`
// rather than `Total Client Investment`, splits the one
// `Unrealized Gain/Loss $ Chg % Chg` cell into `($)` and `(%)` columns, and
// quotes the `Exported on:` line the older files left bare. Nothing about the
// table changed — only what it calls itself.
//
// Every one of those is silent. An unrecognised header reads as "no positions
// at all", and the file is still the newest, so `pick: 'latest'` still selects
// it and the account empties with nothing to say why. The quoted first line was
// enough on its own to make the filer refuse to name the file.
//
// Read by TWO readers, and both are asserted here: the ingest builds the
// holdings from it, and `readUsHoldingTickers` feeds the price fetch, which runs
// FIRST and fails the whole refresh before the ingest can disagree with it.
// That divergence is what took the pipeline down on 2026-08-11.

// The real export's shape, trimmed to three positions and its cash sweep.
const MERRILL_2026_08 = [
  '"Exported on: 08/11/2026 03:29 PM ET"',
  '',
  '"Selected account(s): CMA-Edge 73S-98Y50"',
  '',
  '"CMA-Edge 73S-98Y50","Account Value","Day\'s Value Change","Unrealized Gain/Loss","","","","","","",""',
  '"CMA-Edge 73S-98Y50","$39,910.35","+$26.01 +0.07%","+$2,458.66 +6.57%","","","","","","",""',
  '"Cash balance","Pending activity","","","","","","","","",""',
  '"$0.48","$0.00","","","","","","","","",""',
  '"","","","","","","","","","",""',
  '"Positions","Quantity","Price","Day\'s price change ($)","Day\'s price change (%)","Value",' +
    '"Cumulative investment return ($)","Day\'s value change ($)","Total client investment",' +
    '"Unrealized gain/loss ($)","Unrealized gain/loss (%)"',
  // The cash sweep. Its label starts with digits, so it is not a ticker.
  '"990156937 ML DIRECT DEPOSIT PROGRM","28","$1.00 08/10/2026","$0.00","0.00%","$28.00","--","$0.00","--","--","--"',
  '"JEPI JPMORGAN EQUITY PREMIUM INCOME ETF","123.2894","$57.7950 03:27 PM ET","+$0.1550","+0.27%",' +
    '"$7,125.53","+$248.35","+$19.11","$6,877.18","+$62.24","+0.88%"',
  '"JEPQ JPM NASDAQ EQUITY PREMIUM","322.0797","$59.62 03:27 PM ET","-$0.06","-0.10%",' +
    '"$19,202.39","+$1,215.30","-$19.33","$17,987.09","+$431.62","+2.30%"',
  // The `Total` row sits in the same table and carries the account's whole
  // value. Booking it would add the account to itself.
  '"Total","","","","","$39,909.87","","+$26.01","","+$2,458.66","+6.57%"',
].join('\n') + '\n'

function writeExport(dir: string) {
  mkdirSync(path.join(dir, 'us-holdings'), { recursive: true })
  const filename = path.join(dir, 'us-holdings', 'merrill-holdings-20260811.csv')
  writeFileSync(filename, MERRILL_2026_08, 'utf8')
  return filename
}

test('the price fetch reads the renamed header, and asks for no cash sweep', () => {
  const filename = writeExport(mkdtempSync(path.join(tmpdir(), 'merrill-tickers-')))

  // Four tickers and nothing else. Before this, `Positions` matched no header,
  // the reader fell through to the tax-lot branch, and Merrill contributed
  // nothing at all — no price, and no complaint.
  assert.deepEqual(readUsHoldingTickers([{ brokerage: 'Merrill', filename }]), ['JEPI', 'JEPQ'])
})

test('the ingest builds positions from it, with the basis under its new spelling', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'merrill-ingest-'))
  writeExport(dir)
  writeSheetPayloads(dir)

  const dbPath = runIngest(dir, { allowFailure: true })

  const db = new Database(dbPath, { readonly: true })
  const rows = db
    .prepare(
      'select ticker, quantity, native_cost, native_market_value, native_unrealized_gl ' +
        'from holdings where brokerage = ? order by ticker'
    )
    .all('Merrill') as {
      ticker: string
      quantity: number
      native_cost: number
      native_market_value: number
      native_unrealized_gl: number
    }[]

  assert.deepEqual(rows.map((r) => r.ticker), ['JEPI', 'JEPQ'])

  const jepi = rows[0]
  assert.equal(jepi.quantity, 123.2894)
  assert.equal(jepi.native_market_value, 7125.53)
  // `Total client investment`, not the `Cumulative investment return ($)` column
  // beside it — reading the wrong one books a $248 basis on a $6,877 position.
  assert.equal(jepi.native_cost, 6877.18)
  // The `($)` half of what used to be one combined cell.
  assert.equal(jepi.native_unrealized_gl, 62.24)

  // The as-of comes from the quoted `Exported on:` line.
  const asOf = db.prepare('select distinct as_of_date from holdings where brokerage = ?').get('Merrill') as
    | { as_of_date: string }
    | undefined
  assert.equal(asOf?.as_of_date, '2026-08-11')
})
