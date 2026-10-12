// 토스뱅크 PDF statements: the KRW 거래내역서 a 파킹통장 (나눠모으기 통장) prints, and
// the multi-currency 외화예금 거래내역확인서. Both print the balance after every
// row, so balances are read, not derived.
//
// Every account number, name and amount below is invented; the repository is public.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')
const PY = process.env.STOCK_PYTHON_BIN || 'python3'

const PARKING = '0000-1111-0001'
const PARKING_OLD = '0000-1111-0002'
const FX = '0000-2222-0003'
const UNMAPPED = '0000-3333-0004'

const MAP = {
  bankAccounts: [
    { institution: 'tossbank', kind: 'checking', currency: 'KRW', last4: '0009', accountNumber: '0000-9999-0009', alias: '예시 토스뱅크 통장' },
    { institution: 'tossbank', kind: 'parking', currency: 'KRW', last4: '0001', accountNumber: PARKING, alias: '예시 파킹통장 ••0001', openedOn: '2025-01-02' },
    { institution: 'tossbank', kind: 'parking', currency: 'KRW', last4: '0002', accountNumber: PARKING_OLD, alias: '예시 파킹통장 ••0002', openedOn: '2024-03-03', retiredOn: '2024-06-30' },
    { institution: 'tossbank', kind: 'fx', currency: 'USD', multiCurrency: true, last4: '0003', accountNumber: FX, alias: '예시 외화통장', openedOn: '2024-01-21', retiredOn: '2025-04-20' },
  ],
}

// --- fixtures: the text pdfplumber reads off each page --------------------------

function krwPages(number: string, window: string, rows: string[], { split = 0 } = {}): string[] {
  const head = ['거래내역서', '예시고객님의 계좌 거래내역을', '아래와 같이 확인합니다.', '예금주 예시고객', `계좌번호 ${number}`,
    '예금종류 토스뱅크 나눠모으기 통장', `조회기간 ${window}`, '단위: 원', '거래일자 구분 거래금액 거래 후 잔액 거래내용']
  const tail = ['발급일자 2026년 01월 01일 문서 진위확인 https://example.invalid/verify', '발급번호 0000-EXAM-PLE00000 고객센터 0000-0000']
  if (!split) return [[...head, ...rows, ...tail, '11 // 11'].join('\n')]
  // A statement across two pages, with the doubled-glyph footer the real one prints.
  return [[...head, ...rows.slice(0, split), '11 // 22'].join('\n'), [...rows.slice(split), ...tail, '22 // 22'].join('\n')]
}

// Newest first, as printed. Two rows on 2025-02-03: the later one sets the day's balance.
const PARKING_ROWS = [
  '2025-02-10 03:00:00 이자입금 12 1,000,012 자동 이자',
  '2025-02-03 15:00:00 출금 -500,000 1,000,000 꺼내기',
  '2025-02-03 09:00:00 입금 1,000,000 1,500,000 채우기',
  '2025-01-02 10:00:01 입금 500,000 500,000 채우기',
  '2025-01-02 10:00:00 개설 0 0 예시고객',
]

const OLD_ROWS = [
  '2024-07-15 03:00:00 해지 5 0 해지',
  '2024-06-30 10:00:00 이자입금 5 5 자동 이자',
  '2024-06-20 10:00:00 출금 -200,000 0 꺼내기',
  '2024-03-03 10:00:00 입금 200,000 200,000 채우기',
  '2024-03-03 10:00:00 개설 0 0 예시고객',
]

function fxPages(number: string, sections: Record<string, string[]>): string[] {
  const names: Record<string, string> = { USD: '미국 달러', JPY: '일본 엔', EUR: '유럽 유로', THB: '태국 바트' }
  const lines = ['토스뱅크 외화예금 거래내역확인서', '기본정보', `예금주명 예시고객 계좌번호 ${number}`,
    '예금종류 토스뱅크 외화 통장(외화보통예금) 발급일자 (계좌개설일) 2026-01-01 (2024-01-21)',
    '조회기간 2024-01-21 ~ 2025-04-20 증명서번호 0000-EXAM-PLE00000', '거래내역']
  for (const [code, rows] of Object.entries(sections)) {
    lines.push(`${names[code]}(${code})`, '거래일시 구분 거래금액 거래후잔액 거래내용(적요)', ...rows)
  }
  lines.push('본 거래내역확인서는 예시입니다.', '1 / 1')
  return [lines.join('\n')]
}

const FX_SECTIONS = {
  USD: [
    '2025-04-20 14:00:00 해지 300.00 0.00 외화예금 해지',
    '2025-03-01 10:00:00 입금 100.00 300.00 모으기',
    '2025-03-01 09:00:00 입금 50.00 200.00 모으기',
    '2024-09-20 00:00:51 입금 150.00 150.00 외화 채우기',
  ],
  // A currency the account never held: no series is written for it.
  EUR: ['2025-04-20 14:00:00 해지 0.00 0.00 외화예금 해지'],
  JPY: ['2025-04-20 14:00:00 해지 1,000.00 0.00 외화예금 해지', '2024-07-09 03:00:00 입금 1,000.00 1,000.00 JPY 사기'],
}

// --- parsing ------------------------------------------------------------------

const LOAD = `
import importlib.util, json, sys
spec=importlib.util.spec_from_file_location('bank', 'scripts/extract-bank-statements.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
pages = json.loads(sys.argv[1])
lines = [line for page in pages for line in page.split("\\n")]
`
const py = (pages: string[], body: string) =>
  JSON.parse(execFileSync(PY, ['-c', LOAD + body, JSON.stringify(pages)], { cwd: ROOT, encoding: 'utf8' }))

test('a 파킹통장 거래내역서 gives its number, its period and one end-of-day balance per day, across pages', () => {
  const r = py(krwPages(PARKING, '2025년 01월 02일 ~ 2025년 02월 10일', PARKING_ROWS, { split: 2 }), `
doc = m.parse_tossbank_krw_lines(lines)
print(json.dumps({"number": doc["number"], "period": doc["period"], "eod": m.end_of_day(doc["rows"]),
                  "breaks": m.continuity_breaks(doc["rows"]), "memos": [t["description"] for t in doc["rows"]]}))`)
  assert.equal(r.number, '000011110001')
  assert.deepEqual(r.period, ['2025-01-02', '2025-02-10'])
  assert.deepEqual(r.eod, [
    { date: '2025-01-02', balance: 500_000 },
    { date: '2025-02-03', balance: 1_000_000 },
    { date: '2025-02-10', balance: 1_000_012 },
  ])
  assert.deepEqual(r.breaks, [])
  // The 개설 row prints the holder's name as its 거래내용; it is never kept.
  assert.deepEqual(r.memos, ['개설', '채우기', '채우기', '꺼내기', '자동 이자'])
})

test('a 해지 row closes a 파킹통장 at zero, and a same-second 개설 row stays before the first deposit', () => {
  const r = py(krwPages(PARKING_OLD, '2024년 03월 03일 ~ 2024년 07월 15일', OLD_ROWS), `
doc = m.parse_tossbank_krw_lines(lines)
print(json.dumps({"eod": m.end_of_day(doc["rows"]), "breaks": m.continuity_breaks(doc["rows"])}))`)
  assert.deepEqual(r.eod, [
    { date: '2024-03-03', balance: 200_000 },
    { date: '2024-06-20', balance: 0 },
    { date: '2024-06-30', balance: 5 },
    { date: '2024-07-15', balance: 0 },
  ])
  assert.deepEqual(r.breaks, [])
})

test('an 외화예금 거래내역확인서 gives one row list per currency section, 해지 taking the balance out', () => {
  const r = py(fxPages(FX, FX_SECTIONS), `
doc = m.parse_tossbank_fx_lines(lines)
print(json.dumps({"number": doc["number"], "period": doc["period"],
                  "eod": {c: m.end_of_day(rows) for c, rows in doc["sections"].items()},
                  "breaks": {c: m.continuity_breaks(rows) for c, rows in doc["sections"].items()}}))`)
  assert.equal(r.number, '000022220003')
  assert.deepEqual(r.period, ['2024-01-21', '2025-04-20'])
  assert.deepEqual(Object.keys(r.eod).sort(), ['EUR', 'JPY', 'USD'])
  assert.deepEqual(r.eod.USD, [
    { date: '2024-09-20', balance: 150 },
    { date: '2025-03-01', balance: 300 },
    { date: '2025-04-20', balance: 0 },
  ])
  assert.deepEqual(r.eod.EUR, [{ date: '2025-04-20', balance: 0 }])
  assert.deepEqual(r.breaks, { USD: [], EUR: [], JPY: [] })
})

// --- the extractor, end to end over stubbed PDFs -----------------------------------
//
// pdfplumber is replaced by a stub that returns page text from a JSON fixture, as
// in mirae-account-identity.test.ts.

const PDFPLUMBER_STUB = `
import builtins, json

class _Page:
    def __init__(self, data):
        self._data = data
    def extract_text(self):
        return self._data.get("text", "")
    def extract_tables(self):
        return self._data.get("tables", [])

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

function runBank(files: Record<string, string[]>, map: object = MAP) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'tossbank-pdf-'))
  const stub = path.join(dataDir, 'stub')
  mkdirSync(stub)
  writeFileSync(path.join(stub, 'pdfplumber.py'), PDFPLUMBER_STUB, 'utf8')
  mkdirSync(path.join(dataDir, 'bank-statements'))
  for (const [name, pages] of Object.entries(files)) {
    writeFileSync(path.join(dataDir, 'bank-statements', name), JSON.stringify({ pages: pages.map((text) => ({ text })) }), 'utf8')
  }
  const mapPath = path.join(dataDir, 'map.json')
  writeFileSync(mapPath, JSON.stringify(map))
  const out = path.join(dataDir, 'bank-balances.json')
  const result = spawnSync(PY, ['scripts/extract-bank-statements.py'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: stub, STOCK_DATA_DIR: dataDir, STOCK_BANK_BALANCES_PATH: out, STOCK_ACCOUNT_MAP_PATH: mapPath, STOCK_ALLOW_NO_ACCOUNT_MAP: '', STOCK_PDF_PASSWORD: '' },
  })
  assert.equal(result.status, 0, `bank extractor exited ${result.status}: ${result.stderr}`)
  return JSON.parse(readFileSync(out, 'utf8'))
}

type Account = { institution: string; account: string; kind: string; currency: string; derived: boolean; balances: { date: string; balance: number }[]; continuityBreaks: string[] }

test('a 파킹통장 statement becomes a savings account named by its map entry, and the xlsx family leaves it alone', () => {
  const doc = runBank({ 'tossbank-parking-0001-20250102-20250210.pdf': krwPages(PARKING, '2025년 01월 02일 ~ 2025년 02월 10일', PARKING_ROWS) })
  assert.deepEqual(doc.findings, [])
  assert.equal(doc.accounts.length, 1)
  const a: Account = doc.accounts[0]
  assert.deepEqual([a.institution, a.account, a.kind, a.currency, a.derived], ['tossbank', '예시 파킹통장 ••0001', 'savings', 'KRW', false])
  assert.deepEqual(a.balances.at(-1), { date: '2025-02-10', balance: 1_000_012 })
  assert.deepEqual(a.continuityBreaks, [])
})

test('retiredOn ends a 파킹통장 series: nothing after it is written, and it closes at zero', () => {
  const doc = runBank({ 'tossbank-parking-0002-20240303-20240715.pdf': krwPages(PARKING_OLD, '2024년 03월 03일 ~ 2024년 07월 15일', OLD_ROWS) })
  const a: Account = doc.accounts[0]
  assert.deepEqual(a.balances, [
    { date: '2024-03-03', balance: 200_000 },
    { date: '2024-06-20', balance: 0 },
    { date: '2024-06-30', balance: 0 },
  ])
})

test('the 외화통장 is one series per currency it held, each named by the map alias and its currency', () => {
  const doc = runBank({ 'tossbank-fx-0003-20240121-20250420.pdf': fxPages(FX, FX_SECTIONS) })
  const accounts: Account[] = doc.accounts
  // EUR held nothing; JPY has no rate in this pipeline, so it is a note, not a series.
  assert.deepEqual(accounts.map((a) => [a.account, a.kind, a.currency]), [['예시 외화통장 (USD)', 'deposit', 'USD']])
  assert.deepEqual(accounts[0].balances, [
    { date: '2024-09-20', balance: 150 },
    { date: '2025-03-01', balance: 300 },
    { date: '2025-04-20', balance: 0 },
  ])
  assert.deepEqual(doc.findings, [])
  assert.ok(doc.notes.some((n: string) => /JPY/.test(n) && /예시 외화통장/.test(n)), JSON.stringify(doc.notes))
  assert.ok(!doc.notes.some((n: string) => /1,000|1000/.test(n)), 'a note names no amount')
})

test('a statement whose number the map lacks is skipped with a finding that shows the last four digits only', () => {
  const doc = runBank({ 'tossbank-parking-0004-20250102-20250210.pdf': krwPages(UNMAPPED, '2025년 01월 02일 ~ 2025년 02월 10일', PARKING_ROWS) })
  assert.deepEqual(doc.accounts, [])
  assert.equal(doc.findings.length, 1)
  assert.match(doc.findings[0], /\*\*\*\*0004/)
  assert.doesNotMatch(doc.findings[0], /000033330004|0000-3333-0004/)
})

// --- the estimates: a 파킹통장 on file is not estimated again ---------------------

test('transfers to a 파킹통장 on file pair with its 채우기/꺼내기 rows, and the 파킹통장 estimate goes away', () => {
  const r = py(krwPages(PARKING, '2025년 01월 02일 ~ 2025년 02월 10일', PARKING_ROWS), `
parking = m.parse_tossbank_krw_lines(lines)["rows"]
toss = [
 {"date": "2025-01-02", "seq": 0, "amount": -500000.0, "counterparty": "파킹통장", "counterpartyInstitution": "토스뱅크"},
 {"date": "2025-02-03", "seq": 1, "amount": -1000000.0, "counterparty": "파킹통장", "counterpartyInstitution": "토스뱅크"},
 {"date": "2025-02-03", "seq": 2, "amount": 500000.0, "counterparty": "파킹통장", "counterpartyInstitution": "토스뱅크"},
]
m.MIN_ESTIMATE_KRW = 1
anchors = {"anchors": [{"alias": "토스뱅크 파킹통장", "date": "2025-02-05", "balance": 1000000.0}]}
without = m.estimate_closed_accounts([("tossbank", "tossbank-0009", [dict(t) for t in toss])], [], anchors, [])
notes = []
withp = m.estimate_closed_accounts([("tossbank", "tossbank-0009", toss), ("tossbank", "tossbank-parking-0001", parking)], [], anchors, [], notes)
print(json.dumps({"without": [a["account"] for a in without], "with": [a["account"] for a in withp], "notes": notes}))`)
  // Without the statement the transfers are the estimate, as before.
  assert.deepEqual(r.without, ['토스뱅크 파킹통장'])
  // With it every transfer pairs, and the anchor (a date the statement covers) is not applied.
  assert.deepEqual(r.with, [])
  assert.ok(r.notes.some((n: string) => /토스뱅크 파킹통장/.test(n) && /anchor/.test(n)), JSON.stringify(r.notes))
})

// --- the filer ------------------------------------------------------------------

function detect(detector: string, pages: string[], map: object = MAP) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tossbank-pdf-filer-'))
  const mapPath = path.join(dir, 'map.json')
  writeFileSync(mapPath, JSON.stringify(map))
  const program = `
import importlib.util, json, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('filer', 'scripts/file-downloads.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
pages = json.loads(sys.argv[1])
class Doc:
    path = Path('statement.pdf')
    suffix = '.pdf'
    def page_text(self, i):
        return pages[i] if i < len(pages) else ''
out = getattr(m, sys.argv[2])(Doc())
if out is None:
    print(json.dumps(None))
elif isinstance(out, m.Plan):
    print(json.dumps({'plan': out.subdir + '/' + out.name, 'evidence': out.evidence}))
else:
    print(json.dumps({'reason': out.reason, 'remedy': out.remedy}))
`
  return JSON.parse(execFileSync(PY, ['-c', program, JSON.stringify(pages), detector], { cwd: ROOT, env: { ...process.env, STOCK_ACCOUNT_MAP_PATH: mapPath }, encoding: 'utf8' }))
}

test('the filer names a 파킹통장 거래내역서 by its map entry, its last four digits and its 조회기간', () => {
  const out = detect('detect_tossbank_pdf', krwPages(PARKING, '2025년 01월 02일 ~ 2025년 02월 10일', PARKING_ROWS))
  assert.equal(out.plan, 'bank-statements/tossbank-parking-0001-20250102-20250210.pdf')
  assert.doesNotMatch(JSON.stringify(out), /000011110001|0000-1111-0001/)
})

test('the filer names an 외화예금 거래내역확인서 tossbank-fx, and the 빗썸 detector does not claim it', () => {
  const pages = fxPages(FX, FX_SECTIONS)
  assert.equal(detect('detect_tossbank_pdf', pages).plan, 'bank-statements/tossbank-fx-0003-20240121-20250420.pdf')
  assert.equal(detect('detect_bithumb_statement', pages), null)
  assert.equal(detect('detect_toss_transactions', krwPages(PARKING, '2025년 01월 02일 ~ 2025년 02월 10일', PARKING_ROWS)), null)
})

test('the filer refuses a 토스뱅크 PDF whose number the map lacks, showing only the last four digits', () => {
  const out = detect('detect_tossbank_pdf', krwPages(UNMAPPED, '2025년 01월 02일 ~ 2025년 02월 10일', PARKING_ROWS))
  assert.equal(out.plan, undefined)
  assert.match(out.reason, /\*\*\*\*0004/)
  assert.match(out.remedy, /bankAccounts/)
  assert.doesNotMatch(JSON.stringify(out), /000033330004|0000-3333-0004/)
})

test('the filer refuses a 거래내역서 for a mapped account that is not a 파킹통장', () => {
  const out = detect('detect_tossbank_pdf', krwPages('0000-9999-0009', '2025년 01월 02일 ~ 2025년 02월 10일', PARKING_ROWS))
  assert.equal(out.plan, undefined)
  assert.match(out.reason, /checking/)
})

test('the xlsx 토스뱅크 family globs workbooks only, never a tossbank-parking or tossbank-fx PDF', () => {
  const r = JSON.parse(
    execFileSync(PY, ['-c', `
import importlib.util, json, tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('bank', 'scripts/extract-bank-statements.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
d = Path(tempfile.mkdtemp())
for name in ("tossbank-0001-20250101-20250201.xlsx", "tossbank-parking-0001-20250101-20250201.pdf", "tossbank-fx-0003-20250101-20250201.pdf"):
    (d / name).write_text("")
print(json.dumps({prefix: [p.name for p in m.family_files(d, prefix)] for prefix, *_ in m.FAMILIES if prefix.startswith("tossbank")}))
`], { cwd: ROOT, encoding: 'utf8' })
  )
  assert.deepEqual(r['tossbank-'], ['tossbank-0001-20250101-20250201.xlsx'])
  assert.deepEqual(r['tossbank-parking-'], ['tossbank-parking-0001-20250101-20250201.pdf'])
  assert.deepEqual(r['tossbank-fx-'], ['tossbank-fx-0003-20250101-20250201.pdf'])
})
