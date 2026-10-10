import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

// An ingest over empty inputs fails some unrelated checks and exits non-zero
// while still writing the database, so allowFailure is set and the tests read
// the tables and checks they care about. The sheet payloads (headers only) are
// written first because the ingest reads them unconditionally.
function ingest(env: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cash-ingest-'))
  writeSheetPayloads(dir)
  return new Database(runIngest(dir, { env, allowFailure: true }), { readonly: true })
}

test('securities tables carry account_wrapper and owner; holdings carry asset_class', () => {
  const db = ingest()
  for (const table of ['holdings', 'tax_lots', 'realized_lots', 'transactions', 'dividends']) {
    const cols = (db.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
    assert.ok(cols.includes('account_wrapper'), `${table}.account_wrapper`)
    assert.ok(cols.includes('owner'), `${table}.owner`)
  }
  const holdingCols = (db.prepare('pragma table_info(holdings)').all() as { name: string }[]).map((c) => c.name)
  assert.ok(holdingCols.includes('asset_class'))
  const check = db.prepare("select status, severity from validation_checks where name = 'wrapper_assigned'").get() as any
  assert.equal(check.status, 'pass')
  assert.equal(check.severity, 'warning')
})

const TRANSACTION_COLUMNS = [
  'Date', 'Account', 'Type', 'Raw Type', 'Ticker', 'Name', 'Quantity',
  'Currency', 'Native Amount', 'FX Rate',
  'Amount (KRW)', 'Settlement (KRW)', 'Unit Price', 'Fee', 'Tax', 'Balance',
  'Source', 'Page',
]

function txRow(account: string) {
  return {
    Date: '2022-08-09', Account: account, Type: 'SHARE_REWARD', 'Raw Type': 'reward',
    Ticker: 'AAA', Name: 'Invented Corp', Quantity: 1, Currency: 'KRW',
    'Native Amount': 1000, 'FX Rate': 1300, 'Amount (KRW)': 1000, 'Settlement (KRW)': 0,
    'Unit Price': 1000, Fee: 0, Tax: 0, Balance: 1, Source: 'invented.pdf', Page: 1,
  } as Record<string, string | number>
}

// Three invented accounts through the real transactions path, with a map that
// sets one of them and says nothing about the other two.
function ingestAccounts(map: unknown) {
  const dir = mkdtempSync(path.join(tmpdir(), 'wrapper-ingest-'))
  writeSheetPayloads(dir)
  const kr = path.join(dir, 'kr-statements')
  mkdirSync(kr, { recursive: true })
  const rows = ['Alpha Pension Acct', 'Beta Broker (ISA)', 'Gamma Ordinary'].map(txRow)
  writeFileSync(
    path.join(kr, 'transactions.tsv'),
    [TRANSACTION_COLUMNS.join('\t'), ...rows.map((r) => TRANSACTION_COLUMNS.map((c) => String(r[c] ?? '')).join('\t'))].join('\n') + '\n',
    'utf8'
  )
  const mapPath = path.join(dir, 'map.json')
  writeFileSync(mapPath, JSON.stringify(map), 'utf8')
  const dbPath = runIngest(dir, {
    env: { STOCK_KR_STATEMENTS_DIR: kr, STOCK_ACCOUNT_MAP_PATH: mapPath },
    allowFailure: true,
  })
  return new Database(dbPath, { readonly: true })
}

test('the account map and the label rule decide the wrapper stored on ingested rows', () => {
  const db = ingestAccounts({ accounts: { 'Alpha Pension Acct': { wrapper: 'irp' } } })
  const wrapperOf = (account: string) =>
    (db.prepare('select account_wrapper as w, owner from transactions_all where account = ?').get(account) as any)
  assert.equal(wrapperOf('Alpha Pension Acct')?.w, 'irp')
  assert.equal(wrapperOf('Beta Broker (ISA)')?.w, 'isa')
  assert.equal(wrapperOf('Gamma Ordinary')?.w, 'taxable')
  assert.equal(wrapperOf('Alpha Pension Acct')?.owner, 'self')
  const check = db.prepare("select status from validation_checks where name = 'wrapper_assigned'").get() as any
  assert.equal(check.status, 'pass')
})

test('wrapper_assigned fails, as a warning, on a wrapper the map misspells', () => {
  const db = ingestAccounts({ accounts: { 'Alpha Pension Acct': { wrapper: 'irpp' } } })
  const check = db
    .prepare("select status, severity, detail from validation_checks where name = 'wrapper_assigned'")
    .get() as any
  assert.equal(check.status, 'fail')
  assert.equal(check.severity, 'warning')
  assert.match(check.detail, /transactions/)
  assert.match(check.detail, /irpp/)
  assert.match(check.detail, /1 row/)
})

test('bank balances and the Hana USD balances land in cash_balances; findings become warnings', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cash-src-'))
  const file = path.join(dir, 'bank-balances.json')
  writeFileSync(file, JSON.stringify({
    accounts: [
      { institution: 'chase', account: 'Chase checking', kind: 'checking', currency: 'USD', owner: 'self', derived: false,
        sources: ['chase-checking-x.csv'], balances: [{ date: '2026-10-01', balance: 945 }], continuityBreaks: ['2026-09-20: gap'] },
    ],
    findings: ['Robinhood checking: no anchor balance in the account map; balances not derived'],
  }))
  const db = ingest({ STOCK_BANK_BALANCES_PATH: file })
  const rows = db.prepare('select account, kind, currency, as_of_date, balance, derived from cash_balances').all()
  assert.deepEqual(rows, [{ account: 'Chase checking', kind: 'checking', currency: 'USD', as_of_date: '2026-10-01', balance: 945, derived: 0 }])
  const checks = Object.fromEntries((db.prepare("select name, status, severity from validation_checks where name like 'cash_%'").all() as any[]).map((c) => [c.name, c]))
  assert.equal(checks.cash_balance_continuity.status, 'fail')
  assert.equal(checks.cash_balance_continuity.severity, 'warning')
  assert.equal(checks.cash_anchor_present.status, 'fail')
})

test('estimated accounts land in cash_estimates, never in cash_balances', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cash-src-'))
  const file = path.join(dir, 'bank-balances.json')
  writeFileSync(file, JSON.stringify({
    accounts: [],
    estimatedAccounts: [
      { institution: 'tossbank', account: 'Parking', currency: 'KRW', anchored: false,
        balances: [{ date: '2026-01-02', balance: 300 }, { date: '2026-03-02', balance: 0 }] },
      { institution: 'x', account: 'Bad', currency: 'USD', balances: [] },
    ],
    findings: [],
  }))
  const db = ingest({ STOCK_BANK_BALANCES_PATH: file })
  assert.equal((db.prepare('select count(*) as n from cash_balances').get() as any).n, 0)
  assert.deepEqual(db.prepare('select institution, account, as_of_date, balance, anchored from cash_estimates order by as_of_date').all(), [
    { institution: 'tossbank', account: 'Parking', as_of_date: '2026-01-02', balance: 300, anchored: 0 },
    { institution: 'tossbank', account: 'Parking', as_of_date: '2026-03-02', balance: 0, anchored: 0 },
  ])
  const check = db.prepare("select status, detail from validation_checks where name = 'cash_balances_readable'").get() as any
  assert.match(check.detail, /estimatedAccounts\[1\]/)
})

test('an unusable anchor also fails cash_anchor_present, but a parse failure does not', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cash-src-'))
  const file = path.join(dir, 'bank-balances.json')
  writeFileSync(file, JSON.stringify({
    accounts: [],
    findings: ['Chase checking: anchor is unusable (ValueError: bad date); balances not derived'],
  }))
  assert.equal(
    (ingest({ STOCK_BANK_BALANCES_PATH: file }).prepare("select status from validation_checks where name = 'cash_anchor_present'").get() as any).status,
    'fail'
  )
  writeFileSync(file, JSON.stringify({ accounts: [], findings: ['x.csv could not be parsed'] }))
  assert.equal(
    (ingest({ STOCK_BANK_BALANCES_PATH: file }).prepare("select status from validation_checks where name = 'cash_anchor_present'").get() as any).status,
    'pass'
  )
})

test('no bank-balances file is an empty table and passing checks', () => {
  const db = ingest()
  assert.equal((db.prepare('select count(*) as n from cash_balances').get() as any).n, 0)
  const statuses = (db.prepare("select status from validation_checks where name like 'cash_%'").all() as any[]).map((c) => c.status)
  assert.deepEqual(statuses, ['pass', 'pass', 'pass', 'pass'])
})

for (const [label, content] of [
  ['truncated JSON', '{"accounts": [{"institution": "chase"'],
  ['accounts that is not an array', JSON.stringify({ accounts: 'x', findings: [] })],
] as const) {
  test(`a bank-balances file with ${label} does not abort the ingest`, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cash-bad-'))
    const file = path.join(dir, 'bank-balances.json')
    writeFileSync(file, content)
    const db = ingest({ STOCK_BANK_BALANCES_PATH: file })
    assert.equal((db.prepare('select count(*) as n from cash_balances').get() as any).n, 0)
    const check = db.prepare("select status, severity, detail from validation_checks where name = 'cash_balances_readable'").get() as any
    assert.equal(check.status, 'fail')
    assert.equal(check.severity, 'warning')
    assert.match(check.detail, /bank-balances\.json/)
  })
}

test('an account whose balances is not an array is skipped', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cash-bad-'))
  const file = path.join(dir, 'bank-balances.json')
  writeFileSync(file, JSON.stringify({ accounts: [{ institution: 'x', account: 'Bad', kind: 'checking', currency: 'USD', balances: 'nope' }], findings: [] }))
  const db = ingest({ STOCK_BANK_BALANCES_PATH: file })
  assert.equal((db.prepare('select count(*) as n from cash_balances').get() as any).n, 0)
})

test('the FX ledger balances are copied into cash_balances as USD deposits', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cash-fx-'))
  const file = path.join(dir, 'fx-ledger.json')
  writeFileSync(file, JSON.stringify({
    events: [],
    sources: [],
    findings: [],
    balances: [{ institution: 'Sample Bank', account: 'Sample FX Account', as_of_date: '2026-02-03', balance_usd: 1234.5, source: 'invented.pdf' }],
  }))
  const db = ingest({ STOCK_FX_LEDGER_PATH: file })
  const row = db.prepare("select institution, account, owner, kind, currency, as_of_date, balance, derived from cash_balances").get() as any
  assert.deepEqual(row, { institution: 'Sample Bank', account: 'Sample FX Account', owner: 'self', kind: 'deposit', currency: 'USD', as_of_date: '2026-02-03', balance: 1234.5, derived: 0 })
})

const GOOD_ACCOUNT = { institution: 'chase', account: 'Chase checking', kind: 'checking', currency: 'USD', owner: 'self', derived: false,
  sources: ['a.csv'], balances: [{ date: '2026-10-01', balance: 10 }], continuityBreaks: [] }

function ingestBank(doc: unknown) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cash-norm-'))
  const file = path.join(dir, 'bank-balances.json')
  writeFileSync(file, JSON.stringify(doc))
  const db = ingest({ STOCK_BANK_BALANCES_PATH: file })
  const check = db.prepare("select status, severity, detail from validation_checks where name = 'cash_balances_readable'").get() as any
  const rows = db.prepare('select account, as_of_date, balance, source from cash_balances').all() as any[]
  return { check, rows }
}

for (const [label, doc, rows] of [
  ['findings: [null]', { accounts: [GOOD_ACCOUNT], findings: [null] }, 1],
  ['balances: [null]', { accounts: [{ ...GOOD_ACCOUNT, balances: [null, { date: '2026-10-01', balance: 10 }] }], findings: [] }, 1],
  ['sources: "x"', { accounts: [{ ...GOOD_ACCOUNT, sources: 'x' }], findings: [] }, 1],
  ['findings: null', { accounts: [GOOD_ACCOUNT], findings: null }, 1],
] as const) {
  test(`element-level damage (${label}) is dropped, the rest lands, and the check warns`, () => {
    const { check, rows: got } = ingestBank(doc)
    assert.equal(got.length, rows)
    assert.equal(got[0].balance, 10)
    assert.equal(check.status, 'fail')
    assert.equal(check.severity, 'warning')
    assert.match(check.detail, /bank-balances\.json/)
  })
}

test('cash_statements_parsed fails on extractor findings that are not anchor messages', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cash-src-'))
  const file = path.join(dir, 'bank-balances.json')
  const statusOf = () =>
    (ingest({ STOCK_BANK_BALANCES_PATH: file }).prepare("select status, severity, detail from validation_checks where name = 'cash_statements_parsed'").get() as any)
  for (const finding of [
    'x.csv could not be parsed',
    'y.xls parsed to zero rows',
    'no soffice binary; XLS statements skipped',
    'z.xls XLS conversion failed',
  ]) {
    writeFileSync(file, JSON.stringify({ accounts: [], findings: [finding] }))
    const check = statusOf()
    assert.equal(check.status, 'fail', finding)
    assert.equal(check.severity, 'warning')
    assert.ok(check.detail.includes(finding))
  }
  writeFileSync(file, JSON.stringify({ accounts: [], findings: ['Chase checking: no anchor balance in the account map; balances not derived'] }))
  assert.equal(statusOf().status, 'pass')
})

test('extractor notes are shown in cash_statements_parsed without making it fail', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cash-src-'))
  const file = path.join(dir, 'bank-balances.json')
  const note = 'tossbank-0000-a-b.xlsx: 4 row(s) printed no balance; each was taken as the previous balance plus its amount'
  writeFileSync(file, JSON.stringify({ accounts: [], findings: [], notes: [note] }))
  const db = ingest({ STOCK_BANK_BALANCES_PATH: file })
  const check = db.prepare("select status, detail from validation_checks where name = 'cash_statements_parsed'").get() as any
  assert.equal(check.status, 'pass')
  assert.ok(check.detail.includes(note))
  const readable = db.prepare("select status from validation_checks where name = 'cash_balances_readable'").get() as any
  assert.equal(readable.status, 'pass')
})

test('non_stock_wrappers_absent counts non-stock rows and passes while the stock views keep them out', () => {
  const pass = ingestAccounts({}).prepare("select status, severity, detail from validation_checks where name = 'non_stock_wrappers_absent'").get() as any
  assert.equal(pass.status, 'pass')
  assert.equal(pass.severity, 'warning')
  assert.match(pass.detail, /no row sits outside/)
  // Phase 2 put the filters in place, so rows under irp are expected now; the
  // check reports them and only fails if one reaches a stock view.
  const held = ingestAccounts({ accounts: { 'Alpha Pension Acct': { wrapper: 'irp' } } })
    .prepare("select status, severity, detail from validation_checks where name = 'non_stock_wrappers_absent'").get() as any
  assert.equal(held.status, 'pass')
  assert.equal(held.severity, 'warning')
  assert.match(held.detail, /transactions/)
  assert.match(held.detail, /kept out of the stock views/)
})

test('accounts with an unsupported currency or kind are dropped and reported', () => {
  const { check, rows } = ingestBank({
    accounts: [
      GOOD_ACCOUNT,
      { ...GOOD_ACCOUNT, account: 'Euro acct', currency: 'EUR' },
      { ...GOOD_ACCOUNT, account: 'Odd kind acct', kind: 'brokerage' },
    ],
    findings: [],
  })
  assert.deepEqual(rows.map((r) => r.account), ['Chase checking'])
  assert.equal(check.status, 'fail')
  assert.match(check.detail, /EUR|currency/)
})
