import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

// The uninvested cash in a Korean brokerage account, as the statements print
// it: 미래에셋 예수금잔액 and 외화예수금, Toss 잔액 per section, 삼성 현금잔액.
// Invented rows and figures throughout; the repository is public. Nothing here
// reads a PDF: the harness calls the extractor's pure helpers directly.

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const PY = process.env.STOCK_PYTHON_BIN || 'python3'

const HARNESS = `
import importlib.util, json, sys, types
sys.modules.setdefault("pdfplumber", types.ModuleType("pdfplumber"))
sys.path.insert(0, sys.argv[2])
spec = importlib.util.spec_from_file_location("kr_extract", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
case = json.loads(sys.argv[3])
if case["fn"] == "mirae":
    out = [list(p) for p in mod.mirae_cash_points(case["a"], case["b"])]
elif case["fn"] == "toss":
    point = mod.toss_cash_point(case["row"])
    out = list(point) if point else None
elif case["fn"] == "samsung":
    point = mod.samsung_cash_point(case["row"])
    out = list(point) if point else None
elif case["fn"] == "coverage":
    declared = {tuple(k.split("|")): tuple(v) for k, v in case["declared"].items()}
    out = mod.cash_coverage(case["points"], declared)
else:
    out = mod.end_of_day_cash(case["points"])
print(json.dumps(out, ensure_ascii=False))
`

function call(input: Record<string, unknown>) {
  const harness = path.join(mkdtempSync(path.join(tmpdir(), 'brokerage-cash-')), 'harness.py')
  writeFileSync(harness, HARNESS, 'utf8')
  const out = execFileSync(PY, [harness, path.join(REPO_ROOT, 'scripts/extract-kr-statements.py'), path.join(REPO_ROOT, 'scripts'), JSON.stringify(input)], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return JSON.parse(out.trim().split('\n').at(-1) ?? 'null')
}

// Twelve columns per physical row, as the certificate prints them.
const row = (cells: Record<number, string>) => Array.from({ length: 12 }, (_, i) => cells[i] ?? '')

test('a 미래에셋 record gives its printed 예수금잔액, and 외화예수금 under its 통화코드', () => {
  assert.deepEqual(call({ fn: 'mirae', a: row({ 0: '2024/03/04', 1: '예탁금이용료입금', 7: '1,234' }), b: row({}) }), [['KRW', 'KRW', 1234]])
  assert.deepEqual(
    call({ fn: 'mirae', a: row({ 0: '2024/03/05', 1: '해외주식매수출금', 7: '500', 9: '12.34' }), b: row({ 10: 'USD' }) }),
    [
      ['KRW', 'KRW', 500],
      ['USD', 'USD', 12.34],
    ]
  )
  // A securities leg prints no balance: nothing, rather than a zero.
  assert.deepEqual(call({ fn: 'mirae', a: row({ 0: '2024/03/05', 1: '주식매수입고' }), b: row({}) }), [])
  // A printed zero is a balance.
  assert.deepEqual(call({ fn: 'mirae', a: row({ 0: '2024/03/06', 1: '이체출금', 7: '0' }), b: row({}) }), [['KRW', 'KRW', 0]])
})

test('a 미래에셋 line that moved cash and prints no balance emptied the pool', () => {
  // A 외화출금 that sends every dollar out leaves 외화예수금 blank: the pool is at zero.
  assert.deepEqual(
    call({ fn: 'mirae', a: row({ 0: '2024/05/07', 1: '외화출금', 8: '700.5' }), b: row({ 8: '700.5', 10: 'USD' }) }),
    [['USD', 'USD', 0]]
  )
  // A won line that runs the account into 미수 prints no 예수금잔액 either.
  assert.deepEqual(
    call({ fn: 'mirae', a: row({ 0: '2024/07/10', 1: '외화예탁금세금출금', 6: '240', 10: '240', 11: '240' }), b: row({ 5: '240', 6: '240' }) }),
    [['KRW', 'KRW', 0]]
  )
  // Without a 통화코드 a foreign amount names no pool, so it gives nothing.
  assert.deepEqual(call({ fn: 'mirae', a: row({ 0: '2024/05/07', 1: '외화출금' }), b: row({ 8: '700.5' }) }), [])
})

test('a Toss line gives its 잔액 in won, pooled by section; a blank 잔액 gives nothing', () => {
  assert.deepEqual(call({ fn: 'toss', row: { section: '원화 거래내역', cash_balance: 1000, cash_printed: true } }), ['KRW', 'KRW', 1000])
  // A won figure: never pooled as USD, which in cash.tsv means real dollars.
  assert.deepEqual(call({ fn: 'toss', row: { section: '달러 거래내역', cash_balance: 2000, cash_printed: true } }), ['KRW_dollar_section', 'KRW', 2000])
  assert.equal(call({ fn: 'toss', row: { section: '원화 거래내역', cash_balance: 0, cash_printed: false } }), null)
})

test('a 삼성 line gives its 현금잔액 when one is printed', () => {
  assert.deepEqual(call({ fn: 'samsung', row: { cash_balance: 300, cash_printed: true } }), ['KRW', 'KRW', 300])
  assert.equal(call({ fn: 'samsung', row: { cash_balance: 0, cash_printed: false } }), null)
})

const point = (Date: string, Account: string, Pool: string, Balance: number, Page: number, Source = 's.pdf') => ({ Date, Account, Pool, Currency: 'KRW', Balance, Source, Page })

test('end_of_day_cash keeps the last balance per account, pool and date', () => {
  const out = call({
    fn: 'eod',
    points: [
      point('2024-01-02', 'A', 'KRW', 10, 1),
      point('2024-01-02', 'A', 'KRW', 7, 1),
      point('2024-01-02', 'A', 'KRW_dollar_section', 1, 1),
      point('2024-01-05', 'A', 'KRW', 3, 2),
      point('2024-01-03', 'B', 'KRW', 9, 1),
    ],
  })
  assert.deepEqual(
    out.map((p: any) => [p.Account, p.Pool, p.Date, p.Balance]),
    [
      ['A', 'KRW', '2024-01-02', 7],
      ['A', 'KRW', '2024-01-05', 3],
      ['A', 'KRW_dollar_section', '2024-01-02', 1],
      ['B', 'KRW', '2024-01-03', 9],
    ]
  )
})

test('cash_coverage gives each statement read its declared period, or its own first and last cash dates without one', () => {
  const out = call({
    fn: 'coverage',
    declared: {
      'A|a-2022.pdf': ['2022-01-01', '2022-12-31'],
      // A quiet statement: no cash line, still a period the balance stood through.
      'A|a-2023.pdf': ['2023-01-01', '2023-12-31'],
      'B|b.pdf': [null, null],
    },
    points: [point('2022-03-01', 'A', 'KRW', 1, 1, 'a-2022.pdf'), point('2024-02-01', 'B', 'KRW', 1, 1, 'b.pdf'), point('2024-05-01', 'B', 'KRW', 1, 2, 'b.pdf')],
  })
  assert.deepEqual(
    out.map((r: any) => [r.Account, r.Source, r['Period Start'], r['Period End']]),
    [
      ['A', 'a-2022.pdf', '2022-01-01', '2022-12-31'],
      ['A', 'a-2023.pdf', '2023-01-01', '2023-12-31'],
      ['B', 'b.pdf', '2024-02-01', '2024-05-01'],
    ]
  )
})

const CASH_COLUMNS = ['Date', 'Account', 'Pool', 'Currency', 'Balance', 'Source', 'Page']

test('the ingest files cash.tsv in brokerage_cash, with the institution, wrapper and asset class of each account', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'brokerage-cash-ingest-'))
  writeSheetPayloads(dir)
  const kr = path.join(dir, 'kr-statements')
  mkdirSync(kr, { recursive: true })
  const rows = [
    ['2024-01-02', 'Example Broker(종합)', 'KRW', 'KRW', '1000', 'a.pdf', '1'],
    ['2024-01-02', 'Example Broker(종합)', 'USD', 'USD', '12.5', 'a.pdf', '1'],
    ['2024-01-03', 'Example Broker(IRP)', 'KRW', 'KRW', '5', 'b.pdf', '2'],
  ]
  writeFileSync(path.join(kr, 'cash.tsv'), [CASH_COLUMNS.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n') + '\n', 'utf8')
  writeFileSync(
    path.join(kr, 'cash-coverage.tsv'),
    ['Account\tSource\tPeriod Start\tPeriod End', 'Example Broker(종합)\ta.pdf\t2024-01-01\t2024-12-31'].join('\n') + '\n',
    'utf8'
  )
  const db = new Database(runIngest(dir, { env: { STOCK_KR_STATEMENTS_DIR: kr }, allowFailure: true }), { readonly: true })
  assert.deepEqual(
    db.prepare('select institution, account, pool, currency, as_of_date, balance, source, account_wrapper, asset_class from brokerage_cash order by id').all(),
    [
      { institution: 'Example Broker', account: 'Example Broker(종합)', pool: 'KRW', currency: 'KRW', as_of_date: '2024-01-02', balance: 1000, source: 'a.pdf', account_wrapper: 'taxable', asset_class: 'security' },
      { institution: 'Example Broker', account: 'Example Broker(종합)', pool: 'USD', currency: 'USD', as_of_date: '2024-01-02', balance: 12.5, source: 'a.pdf', account_wrapper: 'taxable', asset_class: 'security' },
      { institution: 'Example Broker', account: 'Example Broker(IRP)', pool: 'KRW', currency: 'KRW', as_of_date: '2024-01-03', balance: 5, source: 'b.pdf', account_wrapper: 'irp', asset_class: 'security' },
    ]
  )
  assert.deepEqual(db.prepare('select institution, account, source, period_start, period_end from brokerage_cash_coverage').all(), [
    { institution: 'Example Broker', account: 'Example Broker(종합)', source: 'a.pdf', period_start: '2024-01-01', period_end: '2024-12-31' },
  ])
})

test('no cash.tsv is an empty brokerage_cash table', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'brokerage-cash-ingest-'))
  writeSheetPayloads(dir)
  const db = new Database(runIngest(dir, { allowFailure: true }), { readonly: true })
  assert.equal((db.prepare('select count(*) as n from brokerage_cash').get() as { n: number }).n, 0)
  assert.equal((db.prepare('select count(*) as n from brokerage_cash_coverage').get() as { n: number }).n, 0)
})
