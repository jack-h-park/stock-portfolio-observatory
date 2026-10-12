import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

const DIVIDEND_COLUMNS = [
  'Date', 'Account', 'Symbol', 'Name', 'Currency', 'Native Amount', 'FX Rate',
  'Amount (KRW)', 'Tax', 'Type', 'Source', 'Page',
]
const TRANSACTION_COLUMNS = [
  'Date', 'Account', 'Type', 'Raw Type', 'Ticker', 'Name', 'Quantity',
  'Currency', 'Native Amount', 'FX Rate',
  'Amount (KRW)', 'Settlement (KRW)', 'Unit Price', 'Fee', 'Tax', 'Balance',
  'Source', 'Page',
]

const ACCOUNT = 'Invented Broker(종합)'
const row = (over: Record<string, string | number>) => ({
  Date: '2024-03-15', Account: ACCOUNT, Symbol: 'AAA', Name: 'Invented Corp', Currency: 'KRW',
  'Native Amount': 50000, 'FX Rate': 1, 'Amount (KRW)': 50000, Tax: '',
  Type: '배당금입금', Source: 'invented.pdf', Page: 1, ...over,
})

function tsv(columns: string[], rows: Record<string, string | number>[]) {
  return [columns.join('\t'), ...rows.map((r) => columns.map((c) => String(r[c] ?? '')).join('\t'))].join('\n') + '\n'
}

function ingest(columns: string[], rows: Record<string, string | number>[]) {
  const dir = mkdtempSync(path.join(tmpdir(), 'kr-div-tax-'))
  writeSheetPayloads(dir)
  const kr = path.join(dir, 'kr-statements')
  mkdirSync(kr, { recursive: true })
  writeFileSync(path.join(kr, 'dividends.tsv'), tsv(columns, rows), 'utf8')
  // The statement dividends are read only for an account that has statement
  // transactions, and the ingest checks the two counts agree, so each dividend
  // has its transaction row, Tax included.
  const txns = rows.map((r) => ({
    Date: r.Date, Account: r.Account, Type: 'DIVIDEND', 'Raw Type': r.Type, Ticker: r.Symbol, Name: r.Name,
    Quantity: 0, Currency: r.Currency, 'Native Amount': r['Native Amount'], 'FX Rate': 1,
    'Amount (KRW)': r['Amount (KRW)'], 'Settlement (KRW)': 0, 'Unit Price': 0, Fee: 0, Tax: r.Tax,
    Balance: 0, Source: r.Source, Page: r.Page,
  }))
  writeFileSync(path.join(kr, 'transactions.tsv'), tsv(TRANSACTION_COLUMNS, txns), 'utf8')
  const dbPath = runIngest(dir, { env: { STOCK_KR_STATEMENTS_DIR: kr }, allowFailure: true })
  return new Database(dbPath, { readonly: true })
}

const taxes = (db: Database.Database) =>
  (db.prepare("select date, native_tax_withheld as t from dividends_all order by date").all() as
    { date: string; t: number | null }[])

test('a Korean dividend row carries its withholding, and null when the statement printed none', () => {
  const db = ingest(DIVIDEND_COLUMNS, [
    row({ Date: '2024-03-15', Tax: 7700 }),
    row({ Date: '2024-04-15', Tax: '' }),
  ])
  assert.deepEqual(taxes(db), [
    { date: '2024-03-15', t: 7700 },
    { date: '2024-04-15', t: null },
  ])
  // The gross amounts the rest of the app reads are untouched.
  const amounts = db.prepare("select native_amount as n, amount_krw as k from dividends_all where date = '2024-03-15'").get() as any
  assert.equal(amounts.n, 50000)
  assert.equal(amounts.k, 50000)
})

test('a dividends.tsv written before the Tax column still ingests, with null withholding', () => {
  const legacy = DIVIDEND_COLUMNS.filter((c) => c !== 'Tax')
  const db = ingest(legacy, [row({ Tax: 7700 })])
  assert.deepEqual(taxes(db), [{ date: '2024-03-15', t: null }])
})

test('the extractor declares Tax on the dividend rows, after Amount (KRW), and fills it on all three appends', () => {
  const py = spawnSync(
    process.env.STOCK_PYTHON_BIN || 'python3',
    ['-c', `import ast,sys
t=ast.parse(open(sys.argv[1],encoding='utf8').read())
cols=None; n=0
for node in ast.walk(t):
    if isinstance(node,ast.Assign) and getattr(node.targets[0],'id',None)=='DIVIDEND_COLUMNS':
        cols=[e.value for e in node.value.elts]
    if isinstance(node,ast.Call) and getattr(node.func,'attr',None)=='append' and getattr(node.func.value,'id',None)=='dividends' and isinstance(node.args[0],ast.Dict):
        d=node.args[0]
        for k,v in zip(d.keys,d.values):
            if k.value=='Tax' and isinstance(v,ast.Subscript) and v.slice.value=='Tax': n+=1
print(cols.index('Tax')-cols.index('Amount (KRW)'), n)`, path.join(__dirname, '..', 'scripts', 'extract-kr-statements.py')],
    { encoding: 'utf8' },
  )
  assert.equal(py.status, 0, py.stderr)
  assert.equal(py.stdout.trim(), '1 3')
})
