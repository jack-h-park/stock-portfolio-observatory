import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { writeSheetPayloads } from './sheet-payloads'

// Two things the Robinhood transaction CSV was carrying that the ingest was not
// reading: the order of its rows, and the origin of each trade.
//
// Both were verified against `get_equity_orders` before being written — the
// broker's own order history, which for Mid-term matches these CSVs on all 702
// Buy/Sell rows. That comparison is what says the reversal below reconstructs a
// real sequence rather than merely a different one.

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

const CSV_HEADER =
  '"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"'

/** Robinhood writes newest-first. These fixtures do too — that is the point. */
function csv(rows: string[]) {
  return [CSV_HEADER, ...rows].join('\n') + '\n'
}

/** Run a real ingest over a scratch data dir holding only this CSV. */
function ingest(csvBody: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'rh-txn-'))
  mkdirSync(path.join(dir, 'us-transactions'), { recursive: true })
  writeFileSync(path.join(dir, 'us-transactions', 'robinhood-transactions-midterm-20260731.csv'), csvBody, 'utf8')
  writeSheetPayloads(dir)
  const repoData = mkdtempSync(path.join(tmpdir(), 'rh-data-'))
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
  return {
    // market matters: Robinhood Crypto rows share the brokerage name.
    trades: db
      .prepare(
        'select date, ticker, type, quantity, placed_agent from transactions ' +
          'where brokerage = ? and market = ? order by rowid'
      )
      .all('Robinhood', 'US') as Record<string, unknown>[],
    realized: db
      .prepare(
        'select ticker, acquired_date, sold_date, round(quantity_sold, 6) as q, round(native_realized_gl, 2) as gl ' +
          'from realized_lots where brokerage = ? and market = ? and basis = ? order by acquired_date, q'
      )
      .all('Robinhood', 'US', 'replay') as Record<string, unknown>[],
  }
}

test('same-day trades are replayed in the order they happened, not the order the file lists them', () => {
  // One lot bought outright, one dust lot from a reinvestment, both sold the
  // same day. Newest-first in the file, as Robinhood writes it.
  const { realized } = ingest(
    csv([
      '"10/22/2025","10/22/2025","10/24/2025","SGOV","iShares 0-3 Month Treasury Bond\nCUSIP: 46436E718","Sell","0.017224","$100.60","$1.73"',
      '"10/22/2025","10/22/2025","10/24/2025","SGOV","iShares 0-3 Month Treasury Bond\nCUSIP: 46436E718","Sell","5","$100.60","$503.02"',
      '"10/07/2025","10/07/2025","10/07/2025","SGOV","iShares 0-3 Month Treasury Bond\nCUSIP: 46436E718\nDividend Reinvestment","Buy","0.017224","$100.44","($1.73)"',
      '"12/09/2024","12/09/2024","12/11/2024","SGOV","iShares 0-3 Month Treasury Bond\nCUSIP: 46436E718","Buy","5","$100.41","($502.05)"',
    ])
  )
  // Each sale pairs with exactly the lot it came from. Walked backwards, the
  // dust sale ran first and sliced the whole 5-share lot into 0.017224 plus a
  // 4.982776 remainder — three rows for two lots, and a holding period on the
  // dust that belonged to the wrong purchase.
  assert.deepEqual(
    realized.map((r) => [r.acquired_date, r.q]),
    [
      ['2024-12-09', 5],
      ['2025-10-07', 0.017224],
    ]
  )
})

test('a buy and a sell on one day still net correctly whichever way the file lists them', () => {
  const { realized } = ingest(
    csv([
      '"03/10/2026","03/10/2026","03/12/2026","AAPL","Apple\nCUSIP: 037833100","Sell","1","$120.00","$120.00"',
      '"03/10/2026","03/10/2026","03/12/2026","AAPL","Apple\nCUSIP: 037833100","Buy","1","$100.00","($100.00)"',
    ])
  )
  // The replay ranks buys before sells within a day regardless, so this is here
  // to prove the reversal did not disturb that.
  assert.equal(realized.length, 1)
  assert.equal(realized[0].gl, 20)
})

test('placed_agent reads the trade origin the CSV appends after the CUSIP', () => {
  const { trades } = ingest(
    csv([
      '"09/16/2025","09/16/2025","09/17/2025","MSFT","Microsoft\nCUSIP: 594918104\nRecurring","Buy","0.019489","$500.00","($9.74)"',
      '"10/06/2025","10/06/2025","10/06/2025","JEPI","JPMorgan Equity Premium Income\nCUSIP: 46641Q332\nDividend Reinvestment","Buy","0.114155","$56.94","($6.50)"',
      '"09/06/2024","09/06/2024","09/09/2024","NVDA","NVIDIA\nCUSIP: 67066G104","Buy","0.949660","$105.30","($100.00)"',
    ])
  )
  const agent = (ticker: string) => trades.find((t) => t.ticker === ticker)?.placed_agent
  // The vocabulary matches get_equity_orders exactly on the real history:
  // 82 drip, 31 recurring, 589 user.
  assert.equal(agent('MSFT'), 'recurring')
  assert.equal(agent('JEPI'), 'drip')
  assert.equal(agent('NVDA'), 'user')
})

test('rows that nobody placed carry no origin', () => {
  const { trades } = ingest(
    csv([
      '"07/29/2026","07/29/2026","07/29/2026","SCHD","Cash Div: R/D 2026-07-21 P/D 2026-07-31 - 3 shares at 0.63","CDIV","","","$1.89"',
      '"07/28/2026","07/28/2026","07/28/2026","","Stock Lending","SLIP","","","$0.01"',
      '"07/27/2026","07/27/2026","07/27/2026","","ACH Deposit","ACH","","","$500.00"',
    ])
  )
  // A dividend was not "placed by the user"; giving it an origin would invite
  // reading one into it.
  for (const row of trades) assert.equal(row.placed_agent, null, `${row.type} should carry no origin`)
})
