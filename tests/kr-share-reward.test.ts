import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

// Toss hands out shares for a 소수점 promotion and a stock quiz. They were typed
// REINVEST, which was never what they are — nothing was reinvested because no
// dividend was paid. REINVEST was standing in for "opens a lot", the only
// property the type was being used for, and the second half of a grant went
// missing with it: shares received for nothing are income at the value received,
// taxed on a different basis from the eventual capital gain.
//
// These are typed SHARE_REWARD now, which crosses a language boundary. The
// Python extractor decides what reaches `dividends.tsv`; the JavaScript ingest
// decides what `isIncomeType()` counts, and then ASSERTS THE TWO AGREE. A type
// added to one side and not the other fails the build — that check is the whole
// reason this test reads the contract from the TSV side rather than mocking it.

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

function tsv(columns: string[], rows: Record<string, string | number>[]) {
  return [columns.join('\t'), ...rows.map((r) => columns.map((c) => String(r[c] ?? '')).join('\t'))].join('\n') + '\n'
}

// The real 2022-08-09 row, with the value the extractor now fills in:
// 0.002731 × ₩365,761 = ₩998.89. Settlement stays zero — no money moved.
const GRANT = {
  Date: '2022-08-09', Account: '토스증권', Type: 'SHARE_REWARD', 'Raw Type': '소수점이벤트입고',
  Ticker: 'MSFT', Name: '마이크로소프트', Quantity: 0.002731, Currency: 'KRW',
  'Native Amount': 0.002731 * 365761, 'FX Rate': 1304.8,
  'Amount (KRW)': 0.002731 * 365761, 'Settlement (KRW)': 0, 'Unit Price': 365761,
  Fee: 0, Tax: 0, Balance: 0.013556, Source: 'toss-transactions-20220724-20221231.pdf', Page: 15,
}

function ingest(transactions: Record<string, string | number>[], dividends: Record<string, string | number>[]) {
  const dir = mkdtempSync(path.join(tmpdir(), 'kr-reward-'))
  writeSheetPayloads(dir)
  const kr = path.join(dir, 'kr-statements')
  mkdirSync(kr, { recursive: true })
  writeFileSync(path.join(kr, 'transactions.tsv'), tsv(TRANSACTION_COLUMNS, transactions), 'utf8')
  writeFileSync(path.join(kr, 'dividends.tsv'), tsv(DIVIDEND_COLUMNS, dividends), 'utf8')

  // A failing check exits non-zero, and two of the tests below deliberately
  // provoke one. The database is written either way — that is the point of the
  // checks table — so the exit status is recorded rather than thrown on.
  const dbPath = runIngest(dir, { env: { STOCK_KR_STATEMENTS_DIR: kr }, allowFailure: true })

  const db = new Database(dbPath, { readonly: true })
  return {
    transactions: db
      .prepare('select type, raw_type, ticker, quantity, native_amount, settlement_krw from transactions')
      .all() as Record<string, unknown>[],
    dividends: db
      .prepare('select ticker, type, native_amount, amount_krw, income_category from dividends')
      .all() as Record<string, unknown>[],
    check: (name: string) =>
      db.prepare('select status, detail from validation_checks where name = ?').get(name) as
        | { status: string; detail: string }
        | undefined,
  }
}

const AS_INCOME = {
  Date: GRANT.Date, Account: GRANT.Account, Symbol: GRANT.Ticker, Name: GRANT.Name,
  Currency: GRANT.Currency, 'Native Amount': GRANT['Native Amount'], 'FX Rate': GRANT['FX Rate'],
  'Amount (KRW)': GRANT['Amount (KRW)'], Type: GRANT['Raw Type'], Source: GRANT.Source, Page: GRANT.Page,
}

test('a granted share survives the ingest as a known type carrying its value', () => {
  const { transactions, dividends } = ingest([GRANT], [AS_INCOME])

  const row = transactions[0]
  assert.equal(row.type, 'SHARE_REWARD')
  assert.equal(row.raw_type, '소수점이벤트입고')
  // The value it was received at, which is both the income and the basis.
  assert.ok(Math.abs(Number(row.native_amount) - 998.89) < 0.01, `got ${row.native_amount}`)
  // A grant settles no cash, and the settlement columns are where money
  // movement is read. Filling this in would invent a ₩999 payment.
  assert.equal(row.settlement_krw, 0)

  // Income too, and categorised as ordinary rather than a payout on a position
  // already held — shares received for nothing are not a dividend.
  assert.equal(dividends.length, 1)
  assert.equal(dividends[0].income_category, 'other')
  assert.ok(Math.abs(Number(dividends[0].amount_krw) - 998.89) < 0.01)
})

test('an unknown type would be caught, so SHARE_REWARD passing means it is known', () => {
  // The guard behind the assertion above: this check lists every type the
  // pipeline accepts, so it is what would fail had SHARE_REWARD never been
  // added to it. Asserting the pass alone would prove nothing without knowing
  // the check can fail, so the same fixture is run with a type nobody maps.
  assert.equal(ingest([GRANT], [AS_INCOME]).check('transaction_types_mapped')?.status, 'pass')

  const bogus = ingest([{ ...GRANT, Type: 'NOT_A_REAL_TYPE' }], [])
  assert.equal(bogus.check('transaction_types_mapped')?.status, 'fail')
})

test('the income table and isIncomeType() must agree across the two languages', () => {
  // Python decides what reaches dividends.tsv, JavaScript decides what
  // isIncomeType() counts, and the ingest asserts the counts match. This is the
  // failure that a one-sided change produces: the grant is income to the JS
  // side and absent from the table the Python side wrote.
  const orphaned = ingest([GRANT], [])
  const counts = orphaned.check('dividend_rows_match_transactions')
  assert.equal(counts?.status, 'fail')
  assert.match(String(counts?.detail), /1 transaction dividends vs 0 dividend rows/)
})

// 배당주입고 is the share leg of a 주식배당 that conveys nothing: no quantity,
// no amount, and the position balance unchanged across all three of them. It is
// typed CORPORATE_ACTION on that evidence, which the lot walk ignores — so a
// bigger declaration that DID deposit whole shares would be ignored with it.
//
// The extractor reports such a row rather than letting the shares go quiet. That
// report is only worth writing if it arrives somewhere, which is what this
// pins: a finding that KEPT its row has to surface as `kr_statement_parse_notes`
// rather than being filed with the faults or silently counted as nothing.
function ingestWithFindings(findings: Record<string, unknown>[]) {
  const dir = mkdtempSync(path.join(tmpdir(), 'kr-findings-'))
  writeSheetPayloads(dir)
  const kr = path.join(dir, 'kr-statements')
  mkdirSync(kr, { recursive: true })
  writeFileSync(path.join(kr, 'transactions.tsv'), tsv(TRANSACTION_COLUMNS, []), 'utf8')
  writeFileSync(path.join(kr, 'dividends.tsv'), tsv(DIVIDEND_COLUMNS, []), 'utf8')
  writeFileSync(
    path.join(kr, 'extract-report.json'),
    JSON.stringify({ generatedAt: '2026-08-05T00:00:00Z', findings, lockedStatements: [] }),
    'utf8'
  )
  const dbPath = runIngest(dir, { env: { STOCK_KR_STATEMENTS_DIR: kr }, allowFailure: true })
  const db = new Database(dbPath, { readonly: true })
  return db.prepare('select status, detail from validation_checks where name = ?').get('kr_statement_parse_notes') as
    | { status: string; detail: string }
    | undefined
}

test('a parser finding that kept its row reaches a check instead of dying in stderr', () => {
  // Nothing to say.
  assert.equal(ingestWithFindings([])?.status, 'pass')

  // The shape the 배당주입고 guard emits. `drops_rows: false` because the row is
  // kept — the classification is what is in doubt, not the data.
  const raised = ingestWithFindings([
    {
      kind: 'shareless-type-carried-shares',
      rows: 1,
      distinct: 1,
      drops_rows: false,
      samples: ['배당주입고 096770 2027-04-26: 3.0 unit(s)'],
    },
  ])
  assert.equal(raised?.status, 'fail')
  assert.match(String(raised?.detail), /shareless-type-carried-shares: 1 row\(s\)/)
})
