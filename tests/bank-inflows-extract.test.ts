import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

// The bank extractor keeps incoming transactions in `inflows`, marking the ones that
// are only money moving between the holder's own accounts. Every name, number and
// amount here is invented.

const ROOT = path.resolve(import.meta.dirname, '..')
const PY = process.env.STOCK_PYTHON_BIN || 'python3'
const HAVE_OPENPYXL = spawnSync(PY, ['-c', 'import openpyxl']).status === 0

const SALARY = '9999-0000-0000-1'
const MAP = {
  bankAccounts: [{ institution: 'mg', kind: 'deposit', currency: 'KRW', accountNumber: SALARY, alias: '새마을금고 자립예탁금' }],
}

const mgHead = (): string[][] => [
  ['', '거래내역조회', '', '', '', '', '', '', '', '', '', ''],
  ['', '요약정보', '', '', '', '', '', '', '', '', '', ''],
  ['', '예금주명', '', '홍길동', '', '', '통장(상품)명', '', '', '온라인자립예탁금', '', ''],
  ['', '계좌번호', '', SALARY, '', '', '상태', '', '', '정상', '', ''],
  ['', '조회기간 : 2023.01.01 ~ 2023.12.31', '', '', '', '', '', '', '', '', '', ''],
  ['', '거래일자', '거래시간', '', '거래구분', '거래내용/메모', '', '출금액', '', '', '입금액', '잔액'],
]
const mgRow = (date: string, time: string, memo: string, amount: number, balance: number) =>
  ['', date, time, '', '입금', memo, '', '0', '', '', String(amount), String(balance)]

const MG_ROWS = [
  ...mgHead(),
  mgRow('2023.05.01', '09:00:00', '급여', 3000000, 3000000),
  mgRow('2023.06.01', '09:00:00', '예적금만기 자동이체', 5050000, 8050000),
]
const MG_WITH_TRANSFER_IN = [...mgHead(), mgRow('2023.04.04', '09:00:00', '이체', 700000, 700000)]

// A 토스뱅크 workbook, newest first: [stamp, 적요, 거래 기관, 거래 금액, 거래 후 잔액]
type TossRow = [string, string, string, number, number]
function writeToss(file: string, rows: TossRow[]) {
  const script = [
    'import json, sys, openpyxl',
    'file, rows = sys.argv[1], json.loads(sys.argv[2])',
    'wb = openpyxl.Workbook(); ws = wb.active',
    'ws.append([None, "토스뱅크 거래내역"]); ws.append([None, "계좌번호", "****-****-1234"])',
    'for _ in range(4): ws.append([])',
    'ws.append([None, "거래 일시", "적요", "거래 유형", "거래 기관", "계좌번호", "거래 금액", "거래 후 잔액", "메모"])',
    'for r in rows: ws.append([None, r[0], r[1], "입금", r[2], "", r[3], r[4], ""])',
    'wb.save(file)',
  ].join('\n')
  execFileSync(PY, ['-c', script, file, JSON.stringify(rows)])
}

const EXTRACT = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('bank', 'scripts/extract-bank-statements.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
fixtures = json.loads(sys.argv[1])
real = m._xls_rows
m._xls_rows = lambda path, findings: fixtures[path.name] if path.name in fixtures else real(path, findings)
m.MIN_ESTIMATE_KRW = 1
m.main()
`

// pdfplumber replaced by a stub that reads page text from a JSON fixture, as in
// tossbank-pdf.test.ts, so the 토스뱅크 PDF statements can be built here.
const PDFPLUMBER_STUB = `
import builtins, json

class _Page:
    def __init__(self, data):
        self._data = data
    def extract_text(self):
        return self._data.get("text", "")
    def extract_tables(self):
        return []

class _Pdf:
    def __init__(self, data):
        self.pages = [_Page(p) for p in data["pages"]]
    def __enter__(self):
        return self
    def __exit__(self, *exc):
        return False
    def close(self):
        pass

def open(path, password=None):
    with builtins.open(path, encoding="utf-8") as fh:
        return _Pdf(json.load(fh))
`

function extract(xlsFixtures: Record<string, string[][]>, toss: TossRow[], { map = MAP, pdfs = {} as Record<string, string[]> } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'inflow-extract-'))
  mkdirSync(path.join(dir, 'bank-statements'))
  for (const name of Object.keys(xlsFixtures)) writeFileSync(path.join(dir, 'bank-statements', name), 'not read: _xls_rows is replaced')
  for (const [name, pages] of Object.entries(pdfs)) {
    writeFileSync(path.join(dir, 'bank-statements', name), JSON.stringify({ pages: pages.map((text) => ({ text })) }), 'utf8')
  }
  const stub = path.join(dir, 'stub')
  mkdirSync(stub)
  writeFileSync(path.join(stub, 'pdfplumber.py'), PDFPLUMBER_STUB, 'utf8')
  writeToss(path.join(dir, 'bank-statements', 'tossbank-1234-20230101-20231231.xlsx'), toss)
  const mapPath = path.join(dir, 'map.json')
  writeFileSync(mapPath, JSON.stringify(map))
  const out = path.join(dir, 'out.json')
  execFileSync(PY, ['-c', EXTRACT, JSON.stringify(xlsFixtures)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: stub, STOCK_DATA_DIR: dir, STOCK_BANK_BALANCES_PATH: out, STOCK_ACCOUNT_MAP_PATH: mapPath, STOCK_PDF_PASSWORD: '' },
  })
  return JSON.parse(readFileSync(out, 'utf8'))
}

const TOSS: TossRow[] = [
  ['2023.07.01 10:00:00', '파킹통장', '토스뱅크', 1000000, 1000000],
]
const TOSS_WITH_TRANSFER_OUT: TossRow[] = [
  ['2023.04.03 10:00:00', '이체', 'MG새마을금고', -700000, 300000],
  ['2023.04.01 10:00:00', '입금', '', 1000000, 1000000],
]

test('incoming rows are kept, and a return from a 예적금 or 파킹통장 is marked as an own transfer', { skip: !HAVE_OPENPYXL }, () => {
  const doc = extract({ 'mg-deposit-20230101-20231231.xls': MG_ROWS }, TOSS)
  const byDesc = Object.fromEntries(doc.inflows.map((f: any) => [f.description, f]))
  assert.equal(byDesc['급여'].amount, 3000000)
  assert.equal(byDesc['급여'].ownTransfer, false)
  assert.equal(byDesc['급여'].institution, 'mg')
  assert.equal(byDesc['급여'].date, '2023-05-01')
  assert.equal(byDesc['예적금만기 자동이체'].ownTransfer, true)
  assert.equal(doc.inflows.find((f: any) => f.counterparty === '파킹통장').ownTransfer, true)
  assert.ok(doc.inflows.every((f: any) => f.amount > 0))
  assert.ok(doc.inflows.every((f: any) => !('txn' in f)))
})

test('a 토스뱅크 → 새마을금고 transfer marks both legs, so the arriving leg is not income', { skip: !HAVE_OPENPYXL }, () => {
  const doc = extract({ 'mg-deposit-20230101-20231231.xls': MG_WITH_TRANSFER_IN }, TOSS_WITH_TRANSFER_OUT)
  const arrived = doc.inflows.find((f: any) => f.institution === 'mg' && f.amount === 700000)
  assert.equal(arrived.ownTransfer, true)
  const plain = doc.inflows.find((f: any) => f.institution === 'tossbank' && f.amount === 1000000)
  assert.equal(plain.ownTransfer, false)
})

// A 파킹통장 and a 외화통장 are read from 토스뱅크 PDF statements. Their incoming rows
// are inflows like any statement account's: the 채우기 legs and the 외화 exchanges
// are own transfers, the interest they pay is not.
const PARKING = '0000-1111-0001'
const FX = '0000-2222-0003'
const PDF_MAP = {
  bankAccounts: [
    ...MAP.bankAccounts,
    { institution: 'tossbank', kind: 'parking', currency: 'KRW', last4: '0001', accountNumber: PARKING, alias: '예시 파킹통장' },
    { institution: 'tossbank', kind: 'fx', currency: 'USD', multiCurrency: true, last4: '0003', accountNumber: FX, alias: '예시 외화통장' },
  ],
}
const parkingPages = (rows: string[]) => [
  ['거래내역서', `계좌번호 ${PARKING}`, '예금종류 토스뱅크 나눠모으기 통장', '조회기간 2023년 07월 01일 ~ 2023년 07월 31일',
    '거래일자 구분 거래금액 거래 후 잔액 거래내용', ...rows].join('\n'),
]
const fxPages = (rows: string[]) => [
  ['토스뱅크 외화예금 거래내역확인서', `예금주명 예시고객 계좌번호 ${FX}`, '조회기간 2023-07-01 ~ 2023-08-31', '거래내역',
    '미국 달러(USD)', '거래일시 구분 거래금액 거래후잔액 거래내용(적요)', ...rows].join('\n'),
]

test('a checking → 파킹통장 → checking round trip is own transfers on both arrivals, and 파킹통장 interest is not', { skip: !HAVE_OPENPYXL }, () => {
  const toss: TossRow[] = [
    ['2023.07.20 10:00:00', '파킹통장', '토스뱅크', 400000, 1400000],
    ['2023.07.01 10:00:00', '파킹통장', '토스뱅크', -1000000, 1000000],
    ['2023.06.30 10:00:00', '입금', '', 2000000, 2000000],
  ]
  const doc = extract({}, toss, {
    map: PDF_MAP,
    pdfs: {
      'tossbank-parking-0001-20230701-20230731.pdf': parkingPages([
        '2023-07-31 03:00:00 이자입금 1,234 601,234 자동 이자',
        '2023-07-25 09:00:00 입금 50,000 600,000 예시 송금인',
        '2023-07-20 10:00:00 출금 -400,000 550,000 꺼내기',
        '2023-07-01 10:00:00 입금 950,000 950,000 채우기',
        '2023-07-01 09:59:59 개설 0 0 예시고객',
      ]),
      'tossbank-fx-0003-20230701-20230831.pdf': fxPages([
        '2023-08-01 03:00:00 이자입금 0.50 100.50 이자',
        '2023-07-05 10:00:00 입금 100.00 100.00 외화 채우기',
      ]),
    },
  })
  assert.deepEqual(doc.findings, [])
  const toChecking = doc.inflows.find((f: any) => f.institution === 'tossbank' && f.counterparty === '파킹통장')
  assert.equal(toChecking.amount, 400000)
  assert.equal(toChecking.ownTransfer, true)
  const parking = doc.inflows.filter((f: any) => f.account === '예시 파킹통장')
  const byMemo = Object.fromEntries(parking.map((f: any) => [f.description, f]))
  // The 채우기 leg whose checking side (-1,000,000) does not match pairs with nothing,
  // and is still the holder's own money.
  assert.equal(byMemo['채우기'].ownTransfer, true)
  assert.equal(byMemo['자동 이자'].amount, 1234)
  assert.equal(byMemo['자동 이자'].ownTransfer, false)
  assert.match(byMemo['자동 이자'].description, /이자/) // the ingest's interest rule
  // Money paid in from outside is not hidden as a transfer: a rule must name it.
  assert.equal(byMemo['예시 송금인'].ownTransfer, false)
  assert.ok(!('개설' in byMemo), 'a zero-amount 개설 row is not an inflow')
  const fx = doc.inflows.filter((f: any) => f.account === '예시 외화통장 (USD)')
  assert.deepEqual(fx.map((f: any) => [f.currency, f.amount, f.ownTransfer]), [['USD', 100, true], ['USD', 0.5, false]])
  const plain = doc.inflows.find((f: any) => f.institution === 'tossbank' && f.amount === 2000000)
  assert.equal(plain.ownTransfer, false)
})

test('a 파킹통장 채우기 that matches its checking leg pairs, so both legs of the round trip are own transfers', { skip: !HAVE_OPENPYXL }, () => {
  const toss: TossRow[] = [
    ['2023.07.20 10:00:00', '파킹통장', '토스뱅크', 400000, 1400000],
    ['2023.07.01 10:00:00', '파킹통장', '토스뱅크', -1000000, 1000000],
    ['2023.06.30 10:00:00', '입금', '', 2000000, 2000000],
  ]
  const doc = extract({}, toss, {
    map: PDF_MAP,
    pdfs: {
      'tossbank-parking-0001-20230701-20230731.pdf': parkingPages([
        '2023-07-20 10:00:00 출금 -400,000 600,000 꺼내기',
        '2023-07-01 10:00:00 입금 1,000,000 1,000,000 채우기',
      ]),
    },
  })
  const arrivals = doc.inflows.filter((f: any) => f.description !== '입금')
  assert.deepEqual(arrivals.map((f: any) => [f.account, f.amount, f.ownTransfer]), [
    ['tossbank 1234', 400000, true],
    ['예시 파킹통장', 1000000, true],
  ])
  // Every transfer paired with a statement row, so no 파킹통장 estimate is left.
  assert.ok(!doc.estimatedAccounts.some((a: any) => a.account === '토스뱅크 파킹통장'), JSON.stringify(doc.estimatedAccounts))
})
