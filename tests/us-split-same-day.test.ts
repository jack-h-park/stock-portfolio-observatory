import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

// A split restates the shares held BEFORE it, never a purchase made the same day.
//
// A split takes effect at the open of its date, so anything bought that day is
// bought at the post-split price and is already stated in post-split shares. The
// replay used to walk the day's purchases first and the split after them, so the
// split's added shares were spread across the new purchase as well: a 2-for-1
// over 148 held plus 10 bought that morning came out as a factor of 306/158
// instead of 2. Every pre-split lot then came out short by about 3%, and the new
// lot nearly doubled.
//
// Nothing that checks totals could see it: the position still summed to the
// right share count, and every lot kept its own cost. Only the quantity on each
// acquisition date was wrong, which moves proceeds between lots, and with them
// gain between the long-term and short-term buckets.
//
// The fixture has the same shape as the case that surfaced this: bought in one
// account, split with a same-day purchase, moved to a sibling account by an
// internal transfer, and sold there.

const CSV_HEADER =
  '"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"'

/** Robinhood writes newest-first. These fixtures do too. */
function csv(rows: string[]) {
  return [CSV_HEADER, ...rows].join('\n') + '\n'
}

const row = (date: string, code: string, qty: string, price: string, amount: string, ticker = 'XYZ') =>
  `"${date}","${date}","${date}","${ticker}","Example Fund\nCUSIP: 000000000","${code}","${qty}","${price}","${amount}"`

function ingest(accounts: Record<string, string>, ticker = 'XYZ') {
  const dir = mkdtempSync(path.join(tmpdir(), 'us-split-same-day-'))
  mkdirSync(path.join(dir, 'us-transactions'), { recursive: true })
  for (const [account, body] of Object.entries(accounts)) {
    writeFileSync(path.join(dir, 'us-transactions', `robinhood-transactions-${account}-20261009.csv`), body, 'utf8')
  }
  writeSheetPayloads(dir)

  const dbPath = runIngest(dir, { allowFailure: true })

  const db = new Database(dbPath, { readonly: true })
  return db
    .prepare(
      'select account, acquired_date, tax_term, round(quantity_sold, 6) as q, ' +
        'round(native_cost_basis, 2) as basis from realized_lots ' +
        'where market = ? and basis = ? and ticker = ? order by acquired_date'
    )
    .all('US', 'replay', ticker) as Record<string, unknown>[]
}

test('a split does not restate a purchase made on its own date', () => {
  const lots = ingest({
    midterm: csv([
      row('1/28/2026', 'ITRF', '', '', ''),
      // A 2-for-1: Robinhood books the 5 shares ADDED, on the same date as a
      // purchase made at the post-split price.
      row('11/20/2025', 'Buy', '1', '$50.00', '($50.00)'),
      row('11/20/2025', 'SPL', '5', '', ''),
      row('10/10/2025', 'Buy', '2', '$100.00', '($200.00)'),
      row('6/25/2025', 'Buy', '3', '$100.00', '($300.00)'),
    ]),
    longterm: csv([
      row('10/9/2026', 'Sell', '11', '$80.00', '$880.00'),
      row('1/28/2026', 'ITRF', '11', '', ''),
    ]),
  })

  // Each lot doubled by the split, and the same-day purchase left as bought.
  // Walked in the old order, the first two came out as 5.5 and 3.666667 shares
  // and the last as 1.833333.
  assert.deepEqual(lots, [
    { account: 'Robinhood Long-term', acquired_date: '2025-06-25', tax_term: 'Long-term', q: 6, basis: 300 },
    { account: 'Robinhood Long-term', acquired_date: '2025-10-10', tax_term: 'Short-term', q: 4, basis: 200 },
    { account: 'Robinhood Long-term', acquired_date: '2025-11-20', tax_term: 'Short-term', q: 1, basis: 50 },
  ])
})

test('a reverse split booked as a corporate action does not absorb a same-day purchase', () => {
  // The paired form: a blank-quantity leg for the old shares and a quantity leg
  // carrying the RESULT. Restating to that result after the purchase was walked
  // would fold the new share into the 1-for-10 as well.
  const lots = ingest(
    {
      midterm: csv([
        row('10/9/2026', 'Sell', '2', '$40.00', '$80.00', 'ABC'),
        row('9/2/2025', 'Buy', '1', '$30.00', '($30.00)', 'ABC'),
        row('9/2/2025', 'SXCH', '1', '', '', 'ABC'),
        row('9/2/2025', 'SXCH', '', '', '', 'ABC'),
        row('6/25/2025', 'Buy', '10', '$3.00', '($30.00)', 'ABC'),
      ]),
    },
    'ABC'
  )

  assert.deepEqual(lots, [
    { account: 'Robinhood Mid-term', acquired_date: '2025-06-25', tax_term: 'Long-term', q: 1, basis: 30 },
    { account: 'Robinhood Mid-term', acquired_date: '2025-09-02', tax_term: 'Long-term', q: 1, basis: 30 },
  ])
})
