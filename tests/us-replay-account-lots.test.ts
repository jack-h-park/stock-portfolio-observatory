import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

// A sale draws its basis from the account that made it.
//
// The replay used to pool open lots per BROKERAGE, so a sale in one Robinhood
// account could consume a purchase made in another. It did, on 2026-08-13: an
// AMZN sale in `Robinhood Agentic` — an account funded in June 2026, whose only
// AMZN buys were that summer — reported a 2025-07-16 acquisition, 393 holding
// days and a long-term gain, all of it belonging to `Robinhood Mid-term`. The
// brokerage-level totals were right the whole time, which is why nothing else
// noticed: the basis, the holding period and the tax term were the only wrong
// figures, and the Mid-term lot it ate would have gone missing from Mid-term's
// own later sales.

const CSV_HEADER =
  '"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"'

/** Robinhood writes newest-first. These fixtures do too. */
function csv(rows: string[]) {
  return [CSV_HEADER, ...rows].join('\n') + '\n'
}

/** Run a real ingest over a scratch data dir holding one CSV per account. */
function ingest(accounts: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'rh-account-lots-'))
  mkdirSync(path.join(dir, 'us-transactions'), { recursive: true })
  for (const [account, body] of Object.entries(accounts)) {
    writeFileSync(path.join(dir, 'us-transactions', `robinhood-transactions-${account}-20260831.csv`), body, 'utf8')
  }
  writeSheetPayloads(dir)

  // The invariant check below fails loudly by design, and a failing check exits
  // non-zero with the database still written — which is the thing to assert on.
  const dbPath = runIngest(dir, { allowFailure: true })

  const db = new Database(dbPath, { readonly: true })
  return {
    realized: db
      .prepare(
        'select account, ticker, acquired_date, sold_date, holding_days, tax_term, ' +
          'round(quantity_sold, 6) as q, round(native_cost_basis, 2) as basis, ' +
          'round(native_realized_gl, 2) as gl from realized_lots ' +
          'where brokerage = ? and market = ? and source_system = ? order by sold_date, acquired_date'
      )
      .all('Robinhood', 'US', 'us_transaction_replay') as Record<string, unknown>[],
    check: (name: string) =>
      db.prepare('select status, detail from validation_checks where name = ?').get(name) as
        | { status: string; detail: string }
        | undefined,
  }
}

test('a sale takes its basis from its own account, not from a sibling at the same broker', () => {
  const { realized, check } = ingest({
    // Bought first, and cheaper, so pooling would hand this lot to the sale
    // below: FIFO across the pool reaches for the oldest purchase there is.
    midterm: csv([
      '"07/16/2025","07/16/2025","07/18/2025","AMZN","Amazon\nCUSIP: 023135106","Buy","1","$100.00","($100.00)"',
    ]),
    agentic: csv([
      '"08/13/2026","08/13/2026","08/17/2026","AMZN","Amazon\nCUSIP: 023135106","Sell","0.5","$300.00","$150.00"',
      '"06/23/2026","06/23/2026","06/25/2026","AMZN","Amazon\nCUSIP: 023135106","Buy","1","$200.00","($200.00)"',
    ]),
  })

  // One sale, one realized lot, and every figure on it drawn from Agentic's own
  // 2026 purchase. Pooled, this row read 2025-07-16 / 393 days / Long-term,
  // with a $50 basis and a $100 gain.
  assert.equal(realized.length, 1)
  assert.deepEqual(realized[0], {
    account: 'Robinhood Agentic',
    ticker: 'AMZN',
    acquired_date: '2026-06-23',
    sold_date: '2026-08-13',
    holding_days: 51,
    tax_term: 'Short-term',
    q: 0.5,
    basis: 100,
    gl: 50,
  })

  // The Mid-term lot is still whole: nothing sold it, so nothing consumed it.
  assert.equal(check('us_realized_lots_predate_no_account')?.status, 'pass')
})

test('a sale with no lot in its own account is reported, not settled from a sibling', () => {
  // The other half of the same change, and the one that costs something: a
  // sale the account has no purchase behind. Pooled, it quietly took Mid-term's
  // lot and produced a confident wrong answer. Now there is nothing to take, so
  // it surfaces as the gap it is — `us_realized_replay_lots_matched` is the
  // check that exists for exactly this, and it says which disposal and how much.
  const { realized, check } = ingest({
    midterm: csv([
      '"07/16/2025","07/16/2025","07/18/2025","AMZN","Amazon\nCUSIP: 023135106","Buy","1","$100.00","($100.00)"',
    ]),
    agentic: csv([
      '"08/13/2026","08/13/2026","08/17/2026","AMZN","Amazon\nCUSIP: 023135106","Sell","0.5","$300.00","$150.00"',
    ]),
  })

  assert.equal(realized.length, 0)
  const matched = check('us_realized_replay_lots_matched')
  assert.equal(matched?.status, 'fail')
  assert.match(String(matched?.detail), /Robinhood AMZN: 0\.5 unit\(s\) disposed with no matching open lot/)
})

test('shares moved between two accounts at one broker carry their cost and their acquisition date', () => {
  // Robinhood books the move as a pair sharing a date and a ticker: the
  // receiving leg carries the quantity, the delivering leg carries an empty
  // quantity column. The lot has to make the trip intact — a transfer between
  // your own accounts realizes nothing and restarts no holding period — so the
  // sale a year later is long-term on the 2025 purchase, not short-term on the
  // 2026 arrival, and its basis is what Mid-term paid.
  const { realized, check } = ingest({
    midterm: csv([
      '"01/28/2026","01/28/2026","01/28/2026","AMZN","Amazon\nCUSIP: 023135106","ITRF","","",""',
      '"07/16/2025","07/16/2025","07/18/2025","AMZN","Amazon\nCUSIP: 023135106","Buy","1","$100.00","($100.00)"',
    ]),
    longterm: csv([
      '"08/13/2026","08/13/2026","08/17/2026","AMZN","Amazon\nCUSIP: 023135106","Sell","1","$300.00","$300.00"',
      '"01/28/2026","01/28/2026","01/28/2026","AMZN","Amazon\nCUSIP: 023135106","ITRF","1","",""',
    ]),
  })

  assert.equal(realized.length, 1)
  assert.deepEqual(realized[0], {
    account: 'Robinhood Long-term',
    ticker: 'AMZN',
    acquired_date: '2025-07-16',
    sold_date: '2026-08-13',
    holding_days: 393,
    tax_term: 'Long-term',
    q: 1,
    basis: 100,
    gl: 200,
  })

  // Older than the receiving account's first transaction, and legitimately so:
  // the ticker arrived by transfer, which is the exclusion the check carries.
  assert.equal(check('us_realized_lots_predate_no_account')?.status, 'pass')
})
