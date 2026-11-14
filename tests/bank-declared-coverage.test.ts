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
test('Hana and KB workbooks identify mapped accounts, deduplicate overlapping downloads, and retain declared periods', () => {
  const doc = extract({ 'hana-deposit-one.xls': 'a', 'hana-deposit-two.xls': 'b', 'kb-deposit-one.xls': 'c' }, [
    { institution: 'hana', kind: 'checking', accountNumber: '123-456', alias: 'Hana sample' },
    { institution: 'kb', kind: 'checking', accountNumber: '999-111', alias: 'KB sample' },
  ], `
hana=[['계좌번호','123-456','','예금종류','수신','','조회기간','2026-01-01 ~ 2026-11-14'],['거래일시','구분','적요','출금액','입금액','잔액'],['2026-10-01 12:00:00','대체','sample','0','10','20']]
kb=[['조회기간','2026-01-01 ~ 2026-11-14'],['계좌번호','999-111'],['거래일시','적요','보낸분/받는분','송금메모','출금액','입금액','잔액'],['2026-10-02 11:00:00','입금','sample','','0','5','25']]
def source_rows(p,f):
 global hana
 return (kb if p.name.startswith('kb-') else [hana[0],hana[1],[*hana[2][:2], 'sample  interest' if p.name.endswith('one.xls') else 'sample interest',*hana[2][3:]]]) + [['','','합 계','0','10','']]
m._xls_rows=source_rows
`)
  assert.deepEqual(doc.coverage.map((row: { account: string }) => row.account).sort(), ['Hana sample', 'Hana sample', 'KB sample'])
  assert.ok(doc.coverage.every((row: { periodEnd: string }) => row.periodEnd === '2026-11-14'))
  assert.deepEqual(doc.accounts.map((row: { balances: unknown[] }) => row.balances.length), [1, 1])
  assert.equal(doc.inflows.length, 2)
})
test('a bank export with missing transaction columns cannot certify coverage', () => {
  const doc = extract({ 'hana-deposit-invalid.xls': 'a' }, [
    { institution: 'hana', kind: 'checking', accountNumber: '123-456', alias: 'Hana sample' },
  ], `m._xls_rows=lambda p,f: [['계좌번호','123-456','','','','','조회기간','2026-01-01 ~ 2026-11-14'],['거래일시','적요','잔액']]`)
  assert.deepEqual(doc.coverage, [])
  assert.match(doc.findings.join(' '), /header|columns/)
})
test('unrecognized transaction rows and missing amounts cannot certify coverage', () => {
  for (const row of [['2026/10/01 12:00','sample','0','5','10'], ['2026-10-01 12:00','sample','','','10']]) {
    const doc = extract({ 'hana-deposit-invalid.xls': 'a' }, [
      { institution: 'hana', kind: 'checking', accountNumber: '123-456', alias: 'Hana sample' },
    ], `m._xls_rows=lambda p,f: [['계좌번호','123-456','','','','','조회기간','2026-01-01 ~ 2026-11-14'],['거래일시','적요','출금액','입금액','잔액'],${JSON.stringify(row)}]`)
    assert.deepEqual(doc.coverage, [])
    assert.match(doc.findings.join(' '), /could not be parsed/)
  }
})
test('overlapping bank files order same-day movements by time before selecting the closing balance', () => {
  const doc = extract({ 'hana-deposit-one.xls': 'a', 'hana-deposit-two.xls': 'b' }, [
    { institution: 'hana', kind: 'checking', accountNumber: '123-456', alias: 'Hana sample' },
  ], `
def source_rows(p,f):
 header=[['계좌번호','123-456','','','','','조회기간','2026-01-01 ~ 2026-11-14'],['거래일시','적요','출금액','입금액','잔액']]
 return header + ([['2026-10-01 18:00:00','late','0','10','30']] if p.name.endswith('one.xls') else [['2026-10-01 09:00:00','early','0','10','20']])
m._xls_rows=source_rows
`)
  assert.equal(doc.accounts[0].balances[0].balance, 30)
})
test('different overlapping transactions with ambiguous minute precision do not invent an order', () => {
  const doc = extract({ 'hana-deposit-one.xls': 'a', 'hana-deposit-two.xls': 'b' }, [
    { institution: 'hana', kind: 'checking', accountNumber: '123-456', alias: 'Hana sample' },
  ], `
def source_rows(p,f):
 header=[['계좌번호','123-456','','','','','조회기간','2026-01-01 ~ 2026-11-14'],['거래일시','적요','출금액','입금액','잔액']]
 return header + ([['2026-10-01 09:00','one','0','10','20']] if p.name.endswith('one.xls') else [['2026-10-01 09:00:12','two','0','10','30']])
m._xls_rows=source_rows
`)
  assert.deepEqual(doc.accounts, [])
  assert.deepEqual(doc.coverage, [])
  assert.match(doc.findings.join(' '), /ambiguous.*time/)
})
test('a named Toss transfer matches its opposite KB bank leg', () => {
  const output = execFileSync('python3', ['-c', `
import importlib.util, json
spec=importlib.util.spec_from_file_location('bank','scripts/extract-bank-statements.py'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
a={'date':'2026-10-01','seq':0,'amount':-100,'counterpartyInstitution':'국민은행','description':'transfer'}
b={'date':'2026-10-01','seq':0,'amount':100,'description':'transfer'}
m.estimate_closed_accounts([('tossbank','toss-1',[a]),('kb','kb-1',[b])],[],{},[])
print(json.dumps([a.get('ownTransfer',False),b.get('ownTransfer',False)]))
`], { cwd: root, encoding: 'utf8' })
  assert.deepEqual(JSON.parse(output), [true, true])
})
test('an unmatched KB transaction never creates an estimated Mirae account', () => {
  const output = execFileSync('python3', ['-c', `
import importlib.util, json
spec=importlib.util.spec_from_file_location('bank','scripts/extract-bank-statements.py'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.MIN_ESTIMATE_KRW=1
row={'date':'2026-10-01','seq':0,'amount':-100,'description':'대체'}
row2={'date':'2026-10-02','seq':1,'amount':100,'description':'대체'}
estimated,_=m.estimate_closed_accounts([('kb','kb-1',[row,row2])],[],{},[])
print(json.dumps(estimated))
`], { cwd: root, encoding: 'utf8' })
  assert.deepEqual(JSON.parse(output), [])
})
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
