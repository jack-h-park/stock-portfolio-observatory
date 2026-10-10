import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

// Merrill transactions can now arrive as a WINDOW beside the full-history as-of
// exports already on disk, the way Chase and Fidelity do (see
// us-transaction-windows.test.ts for why windows exist at all).
//
// Two things have to hold for that to be safe. The window has to be READ — the
// 2026-10-09 export spells its symbol column `Symbol/ CUSIP` under a
// `Settlement date` header, a pairing no earlier export used, and a header the
// parser does not recognise yields zero rows from a file that was found. And the
// days it shares with the full history have to be read ONCE, which is the seam
// resolution `us_transaction_overlaps_resolved` reports on — it groups by
// account, so it must see Merrill's rows under one account label whichever
// layout they came from.

const ACCOUNT = 'CMA-Edge 00X-00000'

/** The older, full-history layout: `Trade Date` first, account on every row. */
function fullHistory(rows: [date: string, description: string, type: string, quantity: string, amount: string][]) {
  return [
    'Exported on: 08/11/2026 09:27 PM ET',
    '',
    `Selected account(s):${ACCOUNT}`,
    '',
    '"Trade Date" ,"Settlement Date" ,"Account" ,"Description" ,"Type" ,"Symbol/ CUSIP" ,"Quantity" ,"Price" ,"Amount" ," " ',
    ',',
    ...rows.map(
      ([date, description, type, quantity, amount]) =>
        `"${date}" ,"${date}" ,"${ACCOUNT}" ,"${description}" ,"${type}" ,"JEPI" ,"${quantity}" ,"$57.00" ,"${amount}" ,"" `
    ),
    ',',
  ].join('\r\n')
}

/**
 * The 2026-10-09 layout: `Settlement date`, `Symbol/ CUSIP`, a `Total` footer —
 * and a Type column respelled to match, `Trades/ Securities` with a space.
 */
function window(
  rows: [date: string, description: string, type: string, quantity: string, amount: string][],
  footer = 'Total Aug 2026 - Oct 2026'
) {
  return [
    '"Exported on: 10/09/2026 01:15 PM ET"',
    '',
    `"Selected account(s): ${ACCOUNT}"`,
    '',
    '"Settlement date","Description","Type","Symbol/ CUSIP","Quantity","Price","Amount"',
    ...rows.map(
      ([date, description, type, quantity, amount]) =>
        `"${date}","${description}","${type}","JEPI","${quantity}","$57.00","${amount}"`
    ),
    `"${footer}","","","","","","$0.00"`,
  ].join('\r\n')
}

const BUY = 'Purchase JPMORGAN EQUITY PREMIUM INCOME ETF'
const DIVIDEND = 'Dividend JPMORGAN EQUITY PREMIUM INCOME ETF'

function ingest(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'merrill-windows-'))
  mkdirSync(path.join(dir, 'us-transactions'), { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(dir, 'us-transactions', name), body + '\r\n', 'utf8')
  }
  writeSheetPayloads(dir)

  const dbPath = runIngest(dir, { allowFailure: true })

  const db = new Database(dbPath, { readonly: true })
  return {
    transactions: db
      .prepare(
        "select date, type, account, source, native_amount from transactions where brokerage = 'Merrill' order by date, native_amount"
      )
      .all() as { date: string; type: string; account: string; source: string; native_amount: number }[],
    check: (name: string) =>
      db.prepare('select status, severity, detail from validation_checks where name = ?').get(name) as
        | { status: string; severity: string; detail: string }
        | undefined,
  }
}

test('a Merrill window in the new header layout is read, footer and all', () => {
  const { transactions } = ingest({
    'merrill-transactions-20260805-20261005.csv': window([
      ['10/05/2026', DIVIDEND, 'Dividends/ Interest', '--', '+$44.92'],
      ['08/28/2026', BUY, 'Trades/ Securities', '4', '-$228.00'],
    ]),
  })

  // Two rows, not zero (an unrecognised header) and not three (the `Total` row).
  assert.deepEqual(
    transactions.map((t) => `${t.date} ${t.type} ${t.native_amount}`),
    ['2026-08-28 BUY -228', '2026-10-05 DIVIDEND 44.92']
  )
  assert.equal(transactions[0].account, `Merrill ${ACCOUNT}`)
})

test('a Merrill window beside the full history is read alongside it, and the seam day once', () => {
  const { transactions, check } = ingest({
    // The newest full-history as-of on disk, as the real ones are.
    'merrill-transactions-20260811.csv': fullHistory([
      ['08/05/2026', DIVIDEND, 'Dividends/ Interest', '', '$43.10'],
      ['03/30/2026', BUY, 'Trades/Securities', '100', '-$5,700.00'],
    ]),
    // The window starts on 08-05, which the as-of already holds.
    'merrill-transactions-20260805-20261005.csv': window([
      ['10/05/2026', DIVIDEND, 'Dividends/ Interest', '--', '+$44.92'],
      ['08/28/2026', BUY, 'Trades/ Securities', '4', '-$228.00'],
      ['08/05/2026', DIVIDEND, 'Dividends/ Interest', '--', '+$43.10'],
    ]),
  })

  // The full history was NOT replaced: its March purchase is still here.
  assert.deepEqual(
    transactions.map((t) => `${t.date} ${t.native_amount}`),
    ['2026-03-30 -5700', '2026-08-05 43.1', '2026-08-28 -228', '2026-10-05 44.92']
  )
  // One account, whichever layout the row came from — the seam resolution
  // groups by it, and two labels would mean two accounts that never overlap.
  assert.equal(new Set(transactions.map((t) => t.account)).size, 1)

  const overlap = check('us_transaction_overlaps_resolved')
  assert.equal(overlap?.status, 'pass')
  assert.match(overlap?.detail ?? '', /1 re-covered row\(s\) read once/)
  assert.equal(check('dividend_rows_match_transactions')?.status, 'pass')
})

test('two Merrill windows ending on the same day still read their shared days once', () => {
  // A window is named by its last ROW, not by when it was taken, so two
  // downloads with no trade between them end on the same day. Neither is then
  // "the later one", and the seam has to be resolved anyway — otherwise every
  // row they share is counted twice.
  const { transactions, check } = ingest({
    'merrill-transactions-20260805-20261005.csv': window([
      ['10/05/2026', DIVIDEND, 'Dividends/ Interest', '--', '+$44.92'],
      ['09/15/2026', BUY, 'Trades/ Securities', '4', '-$228.00'],
      ['08/05/2026', DIVIDEND, 'Dividends/ Interest', '--', '+$43.10'],
    ]),
    'merrill-transactions-20260915-20261005.csv': window([
      ['10/05/2026', DIVIDEND, 'Dividends/ Interest', '--', '+$44.92'],
      ['09/15/2026', BUY, 'Trades/ Securities', '4', '-$228.00'],
    ]),
  })

  assert.deepEqual(
    transactions.map((t) => `${t.date} ${t.native_amount}`),
    ['2026-08-05 43.1', '2026-09-15 -228', '2026-10-05 44.92']
  )
  assert.equal(check('us_transaction_overlaps_resolved')?.status, 'pass')
  assert.equal(check('dividend_rows_match_transactions')?.status, 'pass')
})

test('the respelled `Trades/ Securities` type still defers to the description', () => {
  // `Trades/Securities` is a bucket covering purchases, sales, reinvestments
  // and transfers alike, so the description decides. Spelled with a space it
  // was taken for a specific type instead, and a purchase — whose description
  // says neither "buy" nor "bought" — came out typed `TRADES/ SECURITIES`,
  // outside every quantity the replay counts.
  const { transactions } = ingest({
    'merrill-transactions-20260330-20261005.csv': window(
      [
        ['10/05/2026', 'Reinvestment Share(s) JPMORGAN EQUITY PREMIUM INCOME ETF REINV SHRS 0.7800', 'Trades/ Securities', '0.78', '-$44.92'],
        ['10/05/2026', 'Reinvestment Program JPMORGAN EQUITY PREMIUM INCOME ETF', 'Other', '--', '-$44.92'],
        ['06/22/2026', 'Fractional Share Sale JPMORGAN EQUITY PREMIUM INCOME ETF SALE PRICE $57.00000 QTY SOLD .0067', 'Trades/ Securities', '-0.0067', '+$0.38'],
        ['03/30/2026', BUY, 'Trades/ Securities', '100', '-$5,700.00'],
      ],
      'Total Mar 2026 - Oct 2026'
    ),
  })

  assert.deepEqual(
    transactions.map((t) => `${t.date} ${t.type}`),
    ['2026-03-30 BUY', '2026-06-22 SELL', '2026-10-05 REINVEST', '2026-10-05 REINVEST']
  )
})

test('a cash offer under `Dividends/ Interest` is other income, not a dividend', () => {
  // `Dividends/Interest` is a bucket like `Trades/Securities`: Merrill files a
  // brokerage sign-up bonus under it, beside the real distributions. Read as a
  // specific type, its label matched `dividend` before the description was
  // consulted, so the bonus was booked as a dividend — income category
  // `dividend`, the 1099-DIV bucket, for money that is no payout on any
  // position. The older layout left Type empty and typed the same row
  // OTHER_INCOME from its description. Both spellings of the bucket are covered.
  for (const bucket of ['Dividends/ Interest', 'Dividends/Interest']) {
    const dir = mkdtempSync(path.join(tmpdir(), 'merrill-income-'))
    mkdirSync(path.join(dir, 'us-transactions'), { recursive: true })
    writeFileSync(
      path.join(dir, 'us-transactions', 'merrill-transactions-20260706-20260805.csv'),
      window([
        ['08/05/2026', DIVIDEND, bucket, '--', '+$43.10'],
        ['07/06/2026', 'Other Income Merrill Edge Offer Cash Offer', bucket, '--', '+$125.00'],
      ]) + '\r\n',
      'utf8'
    )
    writeSheetPayloads(dir)
    const db = new Database(runIngest(dir, { allowFailure: true }), { readonly: true })

    const types = db
      .prepare("select date, type from transactions where brokerage = 'Merrill' order by date")
      .all() as { date: string; type: string }[]
    assert.deepEqual(
      types.map((t) => `${t.date} ${t.type}`),
      ['2026-07-06 OTHER_INCOME', '2026-08-05 DIVIDEND'],
      bucket
    )

    const categories = db
      .prepare("select date, income_category from dividends where brokerage = 'Merrill' order by date")
      .all() as { date: string; income_category: string }[]
    assert.deepEqual(
      categories.map((c) => `${c.date} ${c.income_category}`),
      ['2026-07-06 other', '2026-08-05 dividend'],
      bucket
    )
  }
})
