import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { writeSheetPayloads } from './sheet-payloads'

// Two broker codes that were being read as something they are not.
//
// `REC` was mapped to REINVEST. It is a receipt of securities: Chase's two REC
// rows are whole positions arriving with no amount and no price, on the same
// day Fidelity booked an ACAT delivery of exactly those quantities out. Chase
// prints a separate `Reinvest` code for actual reinvestments, at the fractional
// quantities and negative amounts a reinvestment has, so the export itself
// distinguishes what the normalizer had collapsed.
//
// `ACH` was mapped to TRANSFER_OUT. It is a rail, not a direction — Robinhood
// files deposits and withdrawals under the one code and says which in the
// description — so 22 of the 25 ACH rows on the books were deposits recorded as
// withdrawals.
//
// The labels are asserted below, but so is what the pipeline DOES with them.
//
// The last test passes both before and after the retyping, and that is the
// point of it. The US replay dispatches on the ABSENCE of a cost on the row
// rather than on the type — BUY, REINVEST and TRANSFER_IN all enter the same
// arrival branch — which is exactly why REC could be relabelled without moving
// a lot, a holding period or a realized gain. It is here to hold that property
// down: dispatch the arrival branch on the type instead and a received position
// silently starts its clock on the transfer date, turning a long-term gain into
// a short-term one.

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

const CHASE_HEADER =
  'Trade Date,Post Date,Settlement Date,Account Name,Account Number,Account Type,Type,Description,' +
  'Cusip,Ticker,Security Type,Local Currency,Price USD,Price Local,Quantity,G/L Short USD,' +
  'G/L Short Local,G/L Long USDs,G/L Long Local,Amount USD,Amount Local,Income USD,Income Local,' +
  'Balance,Commissions USD,Commissions Local,Tran Code,Tran Code Description,Broker,Check Number,Tax Withheld'

/** One Chase row, in the column order above. Only the fields that matter are named. */
function chaseRow(o: {
  date: string
  type: string
  description: string
  cusip: string
  ticker: string
  price?: string
  quantity?: string
  amount?: string
}) {
  const cells = [
    o.date, o.date, o.date, 'Self-Directed', '...6000', 'Brokerage', o.type, o.description,
    o.cusip, o.ticker, 'Stock', 'USD', o.price ?? '0', o.price ?? '0', o.quantity ?? '',
    '', '', '', '', o.amount ?? '', o.amount ?? '', '', '', '0', '', '', '0', o.type, '', '0', '0',
  ]
  return cells.map((c) => `"${c}"`).join(',')
}

const FIDELITY_HEADER =
  'Run Date,Action,Symbol,Description,Type,Price ($),Quantity,Commission ($),Fees ($),' +
  'Accrued Interest ($),Amount ($),Cash Balance ($),Settlement Date'

const ROBINHOOD_HEADER =
  '"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"'

/** Run a real ingest over a scratch data dir holding only these files. */
function ingest(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'us-types-'))
  mkdirSync(path.join(dir, 'us-transactions'), { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(dir, 'us-transactions', name), body, 'utf8')
  }
  writeSheetPayloads(dir)
  const repoData = mkdtempSync(path.join(tmpdir(), 'us-types-data-'))
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
    transactions: db
      .prepare(
        'select brokerage, date, ticker, type, raw_type, quantity, native_amount ' +
          'from transactions where market = ? order by date, ticker, raw_type'
      )
      .all('US') as Record<string, unknown>[],
    realized: db
      .prepare(
        'select brokerage, ticker, acquired_date, sold_date, round(quantity_sold, 6) as qty, ' +
          'tax_term, holding_days from realized_lots where market = ? and basis = ? order by acquired_date'
      )
      .all('US', 'replay') as Record<string, unknown>[],
    check: (name: string) =>
      db.prepare('select status, detail from validation_checks where name = ?').get(name) as
        | { status: string; detail: string }
        | undefined,
  }
}

const CHASE_ONLY = {
  'chase-transactions-20260731.csv':
    [
      CHASE_HEADER,
      // The two real REC rows: whole positions, no price, no amount at all.
      chaseRow({
        date: '7/21/2026', type: 'REC', description: 'NEOS ETF TRUST NEOS NASDAQ 100 HIGH INCOME ETF',
        cusip: '78433H675', ticker: 'QQQI', quantity: '318',
      }),
      // Chase's own reinvestment code, on the same security, so the test fails
      // if the two are ever collapsed back together.
      chaseRow({
        date: '7/24/2026', type: 'Reinvest', description: 'NEOS ETF TRUST NEOS NASDAQ 100 HIGH INCOME ETF',
        cusip: '78433H675', ticker: 'QQQI', price: '53.18', quantity: '3.79462', amount: '-201.80',
      }),
    ].join('\n') + '\n',
}

test('a Chase REC is shares arriving, not a dividend reinvestment', () => {
  const { transactions } = ingest(CHASE_ONLY)
  const byRaw = (rawType: string) => transactions.find((r) => r.raw_type === rawType)

  assert.equal(byRaw('REC')?.type, 'TRANSFER_IN')
  // The broker's own word is kept: retyping must not overwrite what the source said.
  assert.equal(byRaw('REC')?.quantity, 318)
  assert.equal(byRaw('REC')?.native_amount, null)

  // And the code Chase actually uses for a reinvestment still reads as one.
  assert.equal(byRaw('Reinvest')?.type, 'REINVEST')
})

test('an ACH row takes its direction from the description, not from the code', () => {
  const { transactions } = ingest({
    'robinhood-transactions-midterm-20260731.csv':
      [
        ROBINHOOD_HEADER,
        '"07/27/2026","07/27/2026","07/27/2026","","ACH Deposit","ACH","","","$500.00"',
        '"07/26/2026","07/26/2026","07/26/2026","","ACH Withdrawal","ACH","","","($300.00)"',
        '"07/25/2026","07/25/2026","07/25/2026","","ACH CANCEL","ACH","","","($5.00)"',
      ].join('\n') + '\n',
  })
  const byDescription = (needle: string) =>
    transactions.find((r) => r.raw_type === 'ACH' && String(r.native_amount ?? '') === needle)

  // Money in. Reading the code alone made this a withdrawal, which is the row
  // this test exists for: 22 of 25 on the real books were deposits.
  assert.equal(byDescription('500')?.type, 'TRANSFER_IN')
  assert.equal(byDescription('-300')?.type, 'TRANSFER_OUT')
  // A cancel reverses a deposit, so it leaves the way a withdrawal does.
  assert.equal(byDescription('-5')?.type, 'TRANSFER_OUT')
})

test('a received position keeps the delivering broker holding period, not the transfer date', () => {
  // The real 2026-07-21 move, followed by a sale: Fidelity buys QQQI in 2025,
  // delivers 318 out by ACAT, Chase receives 318 the same day with nothing on
  // the row saying what they cost, and Chase sells them a week later.
  const { realized } = ingest({
    'chase-transactions-20260731.csv':
      [
        CHASE_HEADER,
        chaseRow({
          date: '7/28/2026', type: 'Sell', description: 'NEOS ETF TRUST NEOS NASDAQ 100 HIGH INCOME ETF',
          cusip: '78433H675', ticker: 'QQQI', price: '55.00', quantity: '318', amount: '17490.00',
        }),
        chaseRow({
          date: '7/21/2026', type: 'REC', description: 'NEOS ETF TRUST NEOS NASDAQ 100 HIGH INCOME ETF',
          cusip: '78433H675', ticker: 'QQQI', quantity: '318',
        }),
      ].join('\n') + '\n',
    'fidelity-transactions-20260731.csv':
      [
        FIDELITY_HEADER,
        '07/21/2026,TRANSFER OF ASSETS ACAT DELIVER NEOS ETF TRUST NASDAQ 100 HIGH (QQQI) (Cash),QQQI,' +
          'NEOS ETF TRUST NASDAQ 100 HIGH,Cash,"","-318","","","","-17563.14",0,""',
        '01/15/2025,YOU BOUGHT NEOS ETF TRUST NASDAQ 100 HIGH (QQQI) (Cash),QQQI,' +
          'NEOS ETF TRUST NASDAQ 100 HIGH,Cash,50.00,318,"","","","-15900.00",0,01/16/2025',
      ].join('\n') + '\n',
  })

  // The 2025 purchase date travels with the shares. Had the transfer date been
  // taken as the acquisition date, a 19-month holding would have become a
  // 7-day one and the gain would have moved to short-term.
  assert.equal(realized.length, 1)
  assert.equal(realized[0].acquired_date, '2025-01-15')
  assert.equal(realized[0].qty, 318)
  assert.equal(realized[0].tax_term, 'Long-term')
})

// The transfer pairing asks whether shares that left one account arrived in
// another. It read `r.quantity > 0` on both sides, but US brokers write an
// outbound quantity NEGATIVE while the Korean parsers write a magnitude and put
// the direction in the type — so every US outbound leg there has ever been was
// filtered out before the loop saw it, and the check reported "every outbound
// transfer lands in another account" over a set containing no US transfer at
// all.
//
// These fixtures are US-only, so on the old filter the loop ran over an empty
// set. Only the first test below catches that — the other two passed vacuously,
// which is precisely the shape of the bug: a check with nothing to check says
// the same word as a check that looked and found nothing wrong. They are kept
// as guards on the two ways the fix could be taken too far — dropping the
// pairing of a leg that IS matched, and admitting sweep-fund rows as securities.

const FIDELITY_DELIVERS_318 =
  [
    FIDELITY_HEADER,
    '07/21/2026,TRANSFER OF ASSETS ACAT DELIVER NEOS ETF TRUST NASDAQ 100 HIGH (QQQI) (Cash),QQQI,' +
      'NEOS ETF TRUST NASDAQ 100 HIGH,Cash,55.23,"-318","","","","-17563.14",0,""',
    '01/15/2025,YOU BOUGHT NEOS ETF TRUST NASDAQ 100 HIGH (QQQI) (Cash),QQQI,' +
      'NEOS ETF TRUST NASDAQ 100 HIGH,Cash,50.00,318,"","","","-15900.00",0,01/16/2025',
  ].join('\n') + '\n'

test('a US delivery that nothing received is reported, not filtered away', () => {
  // Fidelity delivers 318 QQQI out by ACAT and no account receives them. The
  // shares and the basis they carried have left this pipeline's sight, which is
  // the entire question this check exists to ask.
  const { check } = ingest({ 'fidelity-transactions-20260731.csv': FIDELITY_DELIVERS_318 })

  const paired = check('transfer_legs_pair_across_accounts')
  assert.equal(paired?.status, 'fail')
  assert.match(String(paired?.detail), /QQQI/)
  assert.match(String(paired?.detail), /318/)
})

test('a US delivery the other side received pairs across the two brokers', () => {
  // The real 2026-07-21 move, both legs present. Fidelity's `-318` and Chase's
  // `REC` of 318 are the same shares, and the check should say so.
  const { check } = ingest({
    'fidelity-transactions-20260731.csv': FIDELITY_DELIVERS_318,
    'chase-transactions-20260731.csv':
      [
        CHASE_HEADER,
        chaseRow({
          date: '7/21/2026', type: 'REC', description: 'NEOS ETF TRUST NEOS NASDAQ 100 HIGH INCOME ETF',
          cusip: '78433H675', ticker: 'QQQI', quantity: '318',
        }),
      ].join('\n') + '\n',
  })

  assert.equal(check('transfer_legs_pair_across_accounts')?.status, 'pass')
  // Paired against a real arrival, so the basis-carry — which writes a lot no
  // document asserts — must not have been reached.
  assert.equal(check('transfer_basis_carried_on_arrival')?.status, 'pass')
})

test('a sweep-fund withdrawal is spending, not securities leaving', () => {
  // `QACDS` is the Chase deposit sweep: the cash balance wearing a ticker. All
  // 51 of Chase's outbound rows carrying a ticker are these. Counting them as
  // departures would invent 51 unexplained ones and hand each to the basis-carry.
  const { check } = ingest({
    'chase-transactions-20260731.csv':
      [
        CHASE_HEADER,
        chaseRow({
          date: '7/21/2026', type: 'WDL', description: 'CHASE DEPOSIT SWEEP INTRA-DAY WITHDRWAL',
          cusip: '000000000', ticker: 'QACDS', quantity: '-804.21', amount: '804.21',
        }),
      ].join('\n') + '\n',
  })

  assert.equal(check('transfer_legs_pair_across_accounts')?.status, 'pass')
  assert.doesNotMatch(String(check('transfer_legs_pair_across_accounts')?.detail), /QACDS/)
})
