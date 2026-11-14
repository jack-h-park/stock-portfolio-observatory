import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
function extract(files: Record<string, string>, bankAccounts: object[] = [], setup = '') {
  const dir = mkdtempSync(path.join(tmpdir(), 'bank-declared-'))
  try {
    mkdirSync(path.join(dir, 'bank-statements'))
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, 'bank-statements', name), body)
    writeFileSync(path.join(dir, 'map.json'), JSON.stringify({ bankAccounts }))
    execFileSync('python3', ['-c', `
import importlib.util
spec=importlib.util.spec_from_file_location('bank', 'scripts/extract-bank-statements.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
${setup}
m.main()
`], { cwd: root, env: { ...process.env, STOCK_DATA_DIR: dir, STOCK_BANK_BALANCES_PATH: path.join(dir, 'out.json'), STOCK_ACCOUNT_MAP_PATH: path.join(dir, 'map.json') }, encoding: 'utf8' })
    return JSON.parse(readFileSync(path.join(dir, 'out.json'), 'utf8'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

const boa = 'Description,,Summary Amt.\nBeginning balance as of 01/01/2026,,10\nEnding balance as of 11/13/2026,,10\nDate,Description,Amount,Running Bal.\n'
test('an empty mapped BoA statement advances declared coverage without inventing a balance, using content rather than its name', () => {
  const name = 'boa-checking-20260101-20260102.csv'
  const doc = extract({ [name]: boa }, [{ institution: 'boa', kind: 'checking', alias: 'Sample bank' }])
  assert.deepEqual(doc.coverage, [{ institution: 'boa', account: 'Sample bank', source: name, periodStart: '2026-01-01', periodEnd: '2026-11-13', basis: 'declared-period', sha256: createHash('sha256').update(boa).digest('hex') }])
  assert.deepEqual(doc.accounts, [])
})

test('row-only exports never claim their filename dates as query coverage', () => {
  const doc = extract({ 'chase-checking-20260101-20261113.csv': 'Details,Posting Date,Description,Amount,Type,Balance\nCREDIT,01/02/2026,Sample,1,ACH,10\n' })
  assert.deepEqual(doc.coverage, [])
  assert.equal(doc.accounts[0].balances[0].date, '2026-01-02')
})

test('an empty statement with ambiguous map identity has no coverage and explains the ambiguity', () => {
  const doc = extract({ 'boa-checking-20260101-20261113.csv': boa }, [
    { institution: 'boa', kind: 'checking', alias: 'One' }, { institution: 'boa', kind: 'checking', alias: 'Two' },
  ])
  assert.deepEqual(doc.coverage, [])
  assert.match(doc.findings.join(' '), /ambiguous.*coverage|coverage.*ambiguous/)
})

test('a mapped empty Toss FX statement records one account period without fabricating currency balances', () => {
  const body = '계좌번호 0000-0000-0001\n조회기간 2026-01-01 ~ 2026-11-13\n미국달러(USD)\n'
  const doc = extract({ 'tossbank-fx-0001-20260101-20260102.pdf': body }, [
    { institution: 'tossbank', kind: 'fx', accountNumber: '0000-0000-0001', alias: 'Sample FX', multiCurrency: true },
  ], 'm._pdf_lines=lambda p: p.read_text().splitlines()')
  assert.equal(doc.coverage.length, 1)
  assert.equal(doc.coverage[0].account, 'Sample FX')
  assert.equal(doc.coverage[0].periodEnd, '2026-11-13')
  assert.deepEqual(doc.accounts, [])
})

test('a quiet BoA balance remains on its observed date while coverage reaches the declared end', () => {
  const doc = extract({ 'boa-checking-20260101-20260102.csv': boa + '01/02/2026,Sample,0,10\n' }, [{ institution: 'boa', kind: 'checking', alias: 'Sample bank' }])
  assert.equal(doc.coverage[0].periodEnd, '2026-11-13')
  assert.deepEqual(doc.accounts[0].balances, [{ date: '2026-01-02', balance: 10 }])
})

test('reversed or invalid document periods never claim coverage', () => {
  for (const invalid of [boa.replace('11/13/2026', '02/30/2026'), boa.replace('01/01/2026', '12/01/2026')]) {
    const doc = extract({ 'boa-checking-20260101-20261113.csv': invalid }, [{ institution: 'boa', kind: 'checking', alias: 'Sample bank' }])
    assert.deepEqual(doc.coverage, [])
    assert.match(doc.findings.join(' '), /invalid declared coverage/)
  }
})

test('a mapped empty Toss parking statement keeps its Korean declared period', () => {
  const doc = extract({ 'tossbank-parking-0001-20260101-20260102.pdf': '계좌번호 0000-0000-0001\n조회기간 2026년 1월 1일 ~ 2026년 11월 13일\n' }, [
    { institution: 'tossbank', kind: 'parking', accountNumber: '0000-0000-0001', alias: 'Sample parking' },
  ], 'm._pdf_lines=lambda p: p.read_text().splitlines()')
  assert.equal(doc.coverage[0].periodStart, '2026-01-01')
  assert.equal(doc.coverage[0].periodEnd, '2026-11-13')
  assert.deepEqual(doc.accounts, [])
})

test('MG coverage reads the workbook declared query window rather than transaction or filename dates', () => {
  // The legacy binary workbook stores its header strings in UTF-16; row conversion is an external reader.
  const doc = extract({ 'mg-deposit-20260101-20260102.xls': 'placeholder' }, [{ institution: 'mg', kind: 'deposit', alias: 'Sample MG' }], `
p=m.SOURCE_DIR/'mg-deposit-20260101-20260102.xls'
p.write_bytes('조회기간 : 2026.01.01 ~ 2026.11.13'.encode('utf-16-le'))
m._mg_deposit_groups=lambda paths, account_map, findings: {'Sample MG':paths}
m._xls_rows=lambda p,f: [['번호','거래일자','거래시간','적요','출금액','입금액','잔액']]
`)
  assert.equal(doc.coverage[0].account, 'Sample MG')
  assert.equal(doc.coverage[0].periodEnd, '2026-11-13')
  assert.deepEqual(doc.accounts, [])
})

test('AMEX checking derives coverage from its validated printed balance period', () => {
  const body = [
    'Account Ending: 0001', 'Beginning Balance as of 01/01/2026 $10.00',
    'Ending Balance as of 11/13/2026 $10.00', 'Total Credits This Period $0.00',
    'Total Debits This Period $0.00', 'Interest Earned This Period $0.00',
    'Date Description Credits Debits Balance', '01/01/2026 Beginning Balance $10.00',
    '11/13/2026 Ending Balance $10.00',
  ].join('\n')
  const doc = extract({ 'amex-checking-0001-20260101-20260102.pdf': body }, [
    { institution: 'amex', kind: 'checking', last4: '0001', alias: 'Sample AMEX' },
  ], 'm._pdf_lines=lambda p: p.read_text().splitlines()')
  assert.equal(doc.coverage[0].periodEnd, '2026-11-13')
  assert.equal(doc.coverage[0].account, 'Sample AMEX')
})

test('a Toss workbook keeps its actual header window even with no movements', () => {
  // Replace only the unavailable spreadsheet reader; exercise the real row and coverage parsers.
  const doc = extract({ 'tossbank-0001-20260101-20260102.xlsx': 'workbook' }, [
    { institution: 'tossbank', kind: 'checking', last4: '0001', alias: 'Sample Toss' },
  ], `
import sys,types
rows=[['계좌번호','0000-0000-0001'],['조회기간','2026.01.01 ~ 2026.11.13'],['거래 일시','거래 금액','거래 후 잔액']]
sheet=types.SimpleNamespace(iter_rows=lambda **kwargs: iter(rows[:kwargs.get('max_row',len(rows))]))
sys.modules['openpyxl']=types.SimpleNamespace(load_workbook=lambda *args,**kwargs: types.SimpleNamespace(worksheets=[sheet],close=lambda:None))
`)
  assert.equal(doc.coverage[0].periodEnd, '2026-11-13')
  assert.equal(doc.coverage[0].account, 'Sample Toss')
  assert.deepEqual(doc.accounts, [])
})

test('legacy MG grouping without a numbered map must not claim an ambiguous empty account', () => {
  const doc = extract({ 'mg-deposit-20260101-20260102.xls': 'placeholder' }, [
    { institution: 'mg', kind: 'deposit', alias: 'One' }, { institution: 'mg', kind: 'deposit', alias: 'Two' },
  ], `
p=m.SOURCE_DIR/'mg-deposit-20260101-20260102.xls'
p.write_bytes('조회기간 : 2026.01.01 ~ 2026.11.13'.encode('utf-16-le'))
m._xls_rows=lambda p,f: [['번호','거래일자','거래시간','적요','출금액','입금액','잔액']]
`)
  assert.deepEqual(doc.coverage, [])
})

test('a mapped empty Mirae transcription keeps its certificate period without creating a balance', () => {
  const body = [
    '미래에셋증권 거래내역서 전사본', '계좌번호: 000-000000001 (종합(CMA))',
    '조회기간(거래일자): 2026/01/01 ~ 2026/11/13', '거래구분: 전체 / 증권종류구분: 전체',
    '', '[거래내역]',
    '거래일자|거래번호|거래종류|원번호|거래수량|단가|종목코드|종목명|수수료|제세금합|거래금액|입출금액|예수금잔액|유가잔고|외화거래금액|외화입출금액|외화예수금|외화유가잔고|통화코드|미수총잔고|미수발생금액|미수변제금액',
    '', '--- 01/01쪽 ---',
  ].join('\n')
  const doc = extract({ 'mirae-cma-20260101-20260102.txt': body }, [
    { institution: 'mirae', kind: 'cma', accountNumber: '000-000000001', alias: 'Sample Mirae' },
  ])
  assert.equal(doc.coverage[0].periodEnd, '2026-11-13')
  assert.equal(doc.coverage[0].account, 'Sample Mirae')
  assert.deepEqual(doc.accounts, [])
})
