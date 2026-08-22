import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

// Chase and Fidelity transaction exports can now be WINDOWS rather than
// year-to-date snapshots, so a download picks up where the last one stopped
// instead of re-fetching January every time.
//
// What that buys and what it costs are the same fact. An as-of name claims
// "everything up to this date" and lets `pick: 'latest'` drop whatever it
// supersedes — which is how a 12-row export covering 07-15…08-05 replaced 146
// rows of year-to-date on 2026-08-11 and took eight checks down with it. A
// window claims only the days it holds, so it can supersede nothing.
//
// What it can do instead is OVERLAP its neighbour — and it HAS TO. An export
// ends at the instant it was taken, not at a closing bell, so a window ending
// 08-05 holds 08-05 only up to 15:29 or whenever it was pulled. The next
// download must start on 08-05 again or every fill after that instant is lost
// silently and permanently. Re-covering the seam day is correct behaviour.
//
// So the overlap is resolved rather than refused: the export taken later wins
// the shared days, its earlier neighbour's copies of those rows are read once,
// and anything only the earlier one has is kept and reported.

const CHASE_HEADER =
  'Trade Date,Post Date,Settlement Date,Account Name,Account Number,Account Type,Type,Description,' +
  'Cusip,Ticker,Security Type,Local Currency,Price USD,Price Local,Quantity,G/L Short USD,' +
  'G/L Short Local,G/L Long USDs,G/L Long Local,Amount USD,Amount Local,Income USD,Income Local,' +
  'Balance,Commissions USD,Commissions Local,Tran Code,Tran Code Description,Broker,Check Number,Tax Withheld'

function chaseBuy(date: string, ticker: string, quantity: string, amount: string) {
  const cells = [
    date, date, date, 'Self-Directed', '...6000', 'Brokerage', 'Buy', `${ticker} SHARES`,
    '46641Q332', ticker, 'Stock', 'USD', '50.00', '50.00', quantity,
    '', '', '', '', amount, amount, '', '', '0', '', '', '0', 'Buy', '', '0', '0',
  ]
  return cells.map((c) => `"${c}"`).join(',')
}

function chaseDividend(date: string, ticker: string, amount: string) {
  const cells = [
    date, date, date, 'Self-Directed', '...6000', 'Brokerage', 'Dividend',
    `${ticker} CASH DIV ON 48 SHS REC 08/03/26 PAY ${date}`,
    '46654Q203', ticker, 'Stock', 'USD', '0', '0', '',
    '', '', '', '', amount, amount, amount, amount, '0', '', '', '0', 'Dividend', '', '0', '0',
  ]
  return cells.map((c) => `"${c}"`).join(',')
}

function ingest(files: Record<string, string[]>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'us-windows-'))
  mkdirSync(path.join(dir, 'us-transactions'), { recursive: true })
  for (const [name, rows] of Object.entries(files)) {
    writeFileSync(
      path.join(dir, 'us-transactions', name),
      [CHASE_HEADER, ...rows].join('\n') + '\n',
      'utf8'
    )
  }
  writeSheetPayloads(dir)

  const dbPath = runIngest(dir, { allowFailure: true })

  const db = new Database(dbPath, { readonly: true })
  return {
    transactions: db
      .prepare('select date, ticker, source, native_amount from transactions where market = ? order by date, native_amount')
      .all('US') as { date: string; ticker: string; source: string; native_amount: number }[],
    check: (name: string) =>
      db.prepare('select status, severity, detail from validation_checks where name = ?').get(name) as
        | { status: string; severity: string; detail: string }
        | undefined,
  }
}

test('two windows that pick up where the other stopped are both read, and both counted once', () => {
  const { transactions, check } = ingest({
    'chase-transactions-20260801-20260805.csv': [
      chaseBuy('8/1/2026', 'JEPQ', '10', '-500.00'),
      chaseBuy('8/5/2026', 'JEPQ', '4', '-200.00'),
    ],
    'chase-transactions-20260806-20260810.csv': [chaseBuy('8/10/2026', 'SCHD', '6', '-300.00')],
  })

  // Both files reached the ingest — the window shape is a spec, not a name that
  // matches nothing and is silently skipped.
  assert.deepEqual(
    transactions.map((t) => `${t.date} ${t.ticker}`),
    ['2026-08-01 JEPQ', '2026-08-05 JEPQ', '2026-08-10 SCHD']
  )
  assert.equal(new Set(transactions.map((t) => t.source)).size, 2)

  assert.equal(check('us_transaction_overlaps_resolved')?.status, 'pass')
})

test('the seam day is re-covered on purpose, and its trades are read once', () => {
  const { transactions, check } = ingest({
    'chase-transactions-20260801-20260805.csv': [
      chaseBuy('8/1/2026', 'JEPQ', '10', '-500.00'),
      chaseBuy('8/5/2026', 'JEPQ', '4', '-200.00'),
    ],
    // Started on 08-05 rather than 08-06, which is the only safe way to do it:
    // the earlier export was taken partway through 08-05 and cannot have held
    // the rest of that day. It also picks up a fill the first file missed.
    'chase-transactions-20260805-20260810.csv': [
      chaseBuy('8/5/2026', 'JEPQ', '4', '-200.00'),
      chaseBuy('8/5/2026', 'JEPQ', '7', '-350.00'),
      chaseBuy('8/10/2026', 'SCHD', '6', '-300.00'),
    ],
  })

  // Once each. The 4-share fill is in both files and is read once; the 7-share
  // fill exists only in the later one and is the reason the seam is re-covered
  // at all.
  assert.deepEqual(
    transactions.filter((t) => t.date === '2026-08-05').map((t) => t.native_amount),
    [-350, -200]
  )
  assert.equal(transactions.length, 4)

  const overlap = check('us_transaction_overlaps_resolved')
  assert.equal(overlap?.status, 'pass')
  assert.match(overlap?.detail ?? '', /1 day\(s\) covered by two exports/)
})

test('two identical fills on a re-covered day both survive', () => {
  // The seam resolves by multiset, not by "have I seen this row shape". Two
  // genuine identical fills are two trades, and collapsing them would quietly
  // halve the position.
  const { transactions } = ingest({
    'chase-transactions-20260801-20260805.csv': [
      chaseBuy('8/5/2026', 'JEPQ', '4', '-200.00'),
      chaseBuy('8/5/2026', 'JEPQ', '4', '-200.00'),
    ],
    'chase-transactions-20260805-20260810.csv': [
      chaseBuy('8/5/2026', 'JEPQ', '4', '-200.00'),
      chaseBuy('8/5/2026', 'JEPQ', '4', '-200.00'),
    ],
  })

  assert.equal(transactions.filter((t) => t.date === '2026-08-05').length, 2)
})

test('a trade the re-download no longer has is kept, and said out loud', () => {
  // A cancelled trade drops out of a re-download, and so does a whole account
  // if the export was filtered. Either way the row is kept — the books stay
  // complete — and the disagreement is reported rather than absorbed.
  const { transactions, check } = ingest({
    'chase-transactions-20260801-20260805.csv': [
      chaseBuy('8/4/2026', 'JEPQ', '4', '-200.00'),
      chaseBuy('8/5/2026', 'VOO', '1', '-700.00'),
    ],
    'chase-transactions-20260804-20260810.csv': [chaseBuy('8/4/2026', 'JEPQ', '4', '-200.00')],
  })

  // Kept: nothing silently vanishes on the strength of a later download.
  assert.ok(transactions.some((t) => t.ticker === 'VOO'))

  const overlap = check('us_transaction_overlaps_resolved')
  assert.equal(overlap?.status, 'fail')
  assert.equal(overlap?.severity, 'warning')
  assert.match(overlap?.detail ?? '', /VOO/)
  assert.match(overlap?.detail ?? '', /kept rather than dropped/)
})

test('a quiet stretch between two windows is not a fault', () => {
  // 08-06…08-09 is in neither file. That is indistinguishable from four days
  // with no trades, so it must not fire — a check that fails on every quiet
  // week is one that gets scrolled past when it means something.
  const { check } = ingest({
    'chase-transactions-20260801-20260805.csv': [chaseBuy('8/1/2026', 'JEPQ', '10', '-500.00')],
    'chase-transactions-20260810-20260815.csv': [chaseBuy('8/15/2026', 'SCHD', '6', '-300.00')],
  })

  assert.equal(check('us_transaction_overlaps_resolved')?.status, 'pass')
})

test('a dividend on a re-covered day is dropped from BOTH tables it lives in', () => {
  // An income row is two rows: the US parsers push it onto `transactions` and
  // onto `dividends`, and `dividend_rows_match_transactions` asserts the two
  // agree in number. Resolving the seam on one side only fails that check with
  // an off-by-N that reads as a Korea problem — it shipped once as
  // `1522 transaction dividends vs 1523 dividend rows`.
  const { check } = ingest({
    'chase-transactions-20260801-20260805.csv': [
      chaseBuy('8/1/2026', 'JEPQ', '10', '-500.00'),
      chaseDividend('8/5/2026', 'JEPQ', '31.20'),
    ],
    'chase-transactions-20260805-20260810.csv': [
      chaseDividend('8/5/2026', 'JEPQ', '31.20'),
      chaseBuy('8/10/2026', 'SCHD', '6', '-300.00'),
    ],
  })

  assert.equal(check('us_transaction_overlaps_resolved')?.status, 'pass')
  assert.equal(check('dividend_rows_match_transactions')?.status, 'pass')
})
