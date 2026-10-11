import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

// Closed 새마을금고 term deposits (정기예탁금): the filer names a 해지계좌
// 거래내역조회 by its full 계좌번호 in the account map, and the extractor turns
// each into a deposit balance whose principal is matched from the 월급통장's
// 인터넷신규 outflow on the 개설일. Every number, name and amount here is invented.

const ROOT = path.resolve(import.meta.dirname, '..')
const PY = process.env.STOCK_PYTHON_BIN || 'python3'

const SALARY = '9999-0000-0000-1'
const TERM_A = '9999-0000-1234-5' // 7,000,000 opened 2023-05-09
const TERM_B = '9999-0000-5678-9' // 70,000,000 opened the same day
const TERM_C = '9999-0000-4321-0' // opened before the 월급통장 export reaches
const TERM_D = '9999-0000-2468-1' // its opening outflow is outside the 1% window

const MAP = {
  bankAccounts: [
    { institution: 'mg', kind: 'deposit', currency: 'KRW', accountNumber: TERM_A, alias: '새마을금고 정기예금 …1234-5', openedOn: '2023-05-09', retiredOn: '2024-05-09' },
    { institution: 'mg', kind: 'deposit', currency: 'KRW', accountNumber: TERM_B, alias: '새마을금고 정기예금 …5678-9', openedOn: '2023-05-09', retiredOn: '2024-05-09' },
    { institution: 'mg', kind: 'deposit', currency: 'KRW', accountNumber: TERM_C, alias: '새마을금고 정기예금 …4321-0', openedOn: '2022-03-02', retiredOn: '2023-03-02' },
    { institution: 'mg', kind: 'deposit', currency: 'KRW', accountNumber: TERM_D, alias: '새마을금고 정기예금 …2468-1', openedOn: '2023-08-01', retiredOn: '2024-08-01' },
    { institution: 'mg', kind: 'deposit', currency: 'KRW', accountNumber: SALARY, alias: '새마을금고 자립예탁금' },
  ],
}

// --- the filer -------------------------------------------------------------

function fileDownloads(files: Record<string, Buffer>, map?: object) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'mg-term-inbox-'))
  mkdirSync(path.join(dataDir, 'inbox'), { recursive: true })
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dataDir, 'inbox', name), body)
  const mapPath = path.join(dataDir, map ? 'map.json' : 'no-map.json')
  if (map) writeFileSync(mapPath, JSON.stringify(map))
  const result = spawnSync(PY, ['scripts/file-downloads.py', '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, STOCK_DATA_DIR: dataDir, STOCK_ACCOUNT_MAP_PATH: mapPath },
  })
  assert.equal(result.status, 0, `filer exited ${result.status}: ${result.stderr}`)
  return result.stdout
}

// A legacy .xls as the filer sees it: the CFB magic, then the shared strings as
// UTF-16, each behind a few bytes of record header. The odd padding puts the run
// on an odd offset, as the real exports do.
function xls(strings: string[]) {
  const parts = [Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(505)]
  for (const s of strings) parts.push(Buffer.from([s.length & 0xff, 0, 1]), Buffer.from(s, 'utf16le'))
  return Buffer.concat(parts)
}

const termXls = (number: string, opened = '2023.05.09', closed = '2024.05.09', queryEnd = '2025.01.10') =>
  xls([
    '해지계좌 거래내역조회', '요약정보', '통장(상품)명', '계좌번호', '개설일', '해지일', '예금주명', '총수령액',
    '거래내역', `조회기간  2023.01.10 ~ ${queryEnd}`, '순번', '거래일자', '거래구분', '거래내용', '금액', '잔액', '지점코드',
    '정기예탁금', number, opened, closed, '홍길동', '-', '해지', '이자', '0000-000',
  ])

const salaryXls = (number: string) =>
  xls(['거래내역조회', '요약정보', '예금주명', '통장(상품)명', '계좌번호', '상태', '조회기간 : 2022.02.01 ~ 2025.02.01',
    '거래일자', '거래시간', '거래구분', '거래내용/메모', '출금액', '입금액', '잔액', '홍길동', '온라인자립예탁금', number, '정상'])

test('a 해지계좌 거래내역조회 files under its last four digits, 개설일 and 해지일', () => {
  const out = fileDownloads({ 'report.xls': termXls(TERM_A) }, MAP)
  assert.match(out, /report\.xls → bank-statements\/mg-term-2345-20230509-20240509\.xls/)
  assert.doesNotMatch(out, /claimed by more than one detector/)
})

test('the name takes four digits including the check digit, and never prints the full number', () => {
  const out = fileDownloads({ 'report.xls': termXls(TERM_A) }, MAP)
  assert.ok(!out.includes(TERM_A) && !out.includes(TERM_A.replace(/-/g, '')), 'the full number must not be printed')
})

test('a term deposit the account map does not list is refused, naming its last four digits only', () => {
  const unmapped = '9999-0000-7777-3'
  const out = fileDownloads({ 'report.xls': termXls(unmapped) }, MAP)
  assert.match(out, /recognised but not filed[\s\S]*report\.xls — 새마을금고 해지계좌 거래내역조회: 계좌번호 \S*7773 is not in the account map/)
  assert.ok(!out.includes(unmapped) && !out.includes(unmapped.replace(/-/g, '')))
  assert.doesNotMatch(out, /→ bank-statements/)
})

test('with no account map a term deposit is refused rather than filed', () => {
  const out = fileDownloads({ 'report.xls': termXls(TERM_A) })
  assert.match(out, /recognised but not filed[\s\S]*새마을금고 해지계좌 거래내역조회: the account map/)
})

test('dates the account map pins must agree with the file', () => {
  const out = fileDownloads({ 'report.xls': termXls(TERM_A, '2023.05.08') }, MAP)
  assert.match(out, /recognised but not filed[\s\S]*개설일 2023-05-08[\s\S]*openedOn 2023-05-09/)
})

test('a 해지일 later than the 조회기간 end is refused: the latest date is not the closing day then', () => {
  const out = fileDownloads({ 'report.xls': termXls(TERM_A, '2023.05.09', '2024.05.09', '2024.05.08') }, MAP)
  assert.match(out, /recognised but not filed[\s\S]*해지일 2024-05-09 is after the 조회기간 end 2024-05-08/)
  assert.doesNotMatch(out, /→ bank-statements/)
})

test('the 월급통장 detector does not claim a 해지계좌 거래내역조회', () => {
  const r = JSON.parse(
    execFileSync(PY, ['-c', `
import importlib.util, json, sys, pathlib
spec = importlib.util.spec_from_file_location('fd', 'scripts/file-downloads.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
path = pathlib.Path(sys.argv[1])
print(json.dumps({"deposit": m.detect_mg_deposit(m.Document(path)) is None, "term": type(m.detect_mg_term(m.Document(path))).__name__}))
`, writeTemp('report.xls', termXls(TERM_A))], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, STOCK_ACCOUNT_MAP_PATH: writeTemp('map.json', JSON.stringify(MAP)) } })
  )
  assert.deepEqual(r, { deposit: true, term: 'Plan' })
})

test('a 월급통장 export resolves its account by full number when a map is present', () => {
  assert.match(fileDownloads({ 'export.xls': salaryXls(SALARY) }, MAP),
    /→ bank-statements\/mg-deposit-20220201-20250201\.xls[\s\S]*계좌번호 \S*0001 is 새마을금고 자립예탁금/)
  const refused = fileDownloads({ 'export.xls': salaryXls('9999-0000-8888-2') }, MAP)
  assert.match(refused, /recognised but not filed[\s\S]*새마을금고 거래내역조회: 계좌번호 \S*8882 is not in the account map/)
  // No map: filed by its 조회기간 as before.
  assert.match(fileDownloads({ 'export.xls': salaryXls(SALARY) }), /→ bank-statements\/mg-deposit-20220201-20250201\.xls/)
})

function writeTemp(name: string, body: string | Buffer) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mg-term-file-'))
  const file = path.join(dir, name)
  writeFileSync(file, body)
  return file
}

// --- the extractor ---------------------------------------------------------

// The CSV soffice makes of a 해지계좌 거래내역조회: cells spread over columns,
// and the 이자 row with its 거래내용 empty. Newest first, as printed.
function termRows(number: string, opened: string, closed: string, payout: number, interest: number) {
  return [
    ['', '해지계좌 거래내역조회', '', '', '', '', '', '', '', '', '', '', ''],
    ['', '요약정보', '', '', '', '', '', '', '', '', '', '', ''],
    ['', '통장(상품)명', '', '정기예탁금', '', '', '계좌번호', '', '', '', number, '', ''],
    ['', '개설일', '', opened, '', '', '해지일', '', '', '', closed, '', ''],
    ['', '예금주명', '', '홍길동', '', '', '총수령액', '', '', '', String(payout), '', ''],
    ['', '거래내역', '', '', '', '', '', '', '', '', '', '', ''],
    ['', `조회기간  2023.01.10 ~ 2025.01.10`, '', '', '', '', '', '', '', '', '', '', ''],
    ['', '순번', '거래일자', '', '거래구분', '거래내용', '', '', '금액', '', '', '잔액', '지점코드'],
    ['', '-', closed, '', '해지', '홍길동', '', '', String(-payout), '', '', '0', '0000-000'],
    ['', '-', closed, '', '이자', '', '', '', String(interest), '', '', String(payout), '0000-000'],
    ['', '고객상담전화  0000-0000', '', '', '', '', '', '', '', '', '', '', ''],
  ]
}

// principal + 이자 × (1 − 0.154) = 총수령액, so each principal is recoverable to the won.
const A = termRows(TERM_A, '2023.05.09', '2024.05.09', 7_207_270, 245_000)
const B = termRows(TERM_B, '2023.05.09', '2024.05.09', 72_072_700, 2_450_000)
const C = termRows(TERM_C, '2022.03.02', '2023.03.02', 5_084_600, 100_000)

// The 월급통장: two 인터넷신규 outflows on 2023-05-09, the larger one FIRST, so
// taking the first outflow of the day would give each deposit the other's.
const SALARY_ROWS = [
  ['', '거래내역조회', '', '', '', '', '', '', '', '', '', ''],
  ['', '요약정보', '', '', '', '', '', '', '', '', '', ''],
  ['', '예금주명', '', '홍길동', '', '', '통장(상품)명', '', '', '온라인자립예탁금', '', ''],
  ['', '계좌번호', '', SALARY, '', '', '상태', '', '', '정상', '', ''],
  ['', '조회기간 : 2022.02.01 ~ 2025.02.01', '', '', '', '', '', '', '', '', '', ''],
  ['', '거래일자', '거래시간', '', '거래구분', '거래내용/메모', '', '출금액', '', '', '입금액', '잔액'],
  ['', '2023.05.01', '09:00:00', '', '입금', '급여', '', '0', '', '', '90000000', '90000000'],
  ['', '2023.05.09', '10:00:00', '', '스마트뱅킹', '인터넷신규', '', '70000000', '', '', '0', '20000000'],
  ['', '2023.05.09', '10:05:00', '', '스마트뱅킹', '인터넷신규(정기)', '', '7000000', '', '', '0', '13000000'],
  ['', '2024.05.09', '00:10:00', '', '대체', '예적금만기 자동이체', '', '0', '', '', '7207270', '20207270'],
  ['', '2024.05.09', '00:11:00', '', '대체', '예적금만기 자동이체', '', '0', '', '', '72072700', '92279970'],
]

const EXTRACT = `
import importlib.util, json, os, sys
spec = importlib.util.spec_from_file_location('bank', 'scripts/extract-bank-statements.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
fixtures = json.loads(sys.argv[1])
m._xls_rows = lambda path, findings: fixtures[path.name]
m.MIN_ESTIMATE_KRW = 1
m.main()
`

function extract(fixtures: Record<string, string[][]>, map: object | null = MAP) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mg-term-extract-'))
  mkdirSync(path.join(dir, 'bank-statements'))
  for (const name of Object.keys(fixtures)) writeFileSync(path.join(dir, 'bank-statements', name), 'not read: _xls_rows is replaced')
  const mapPath = path.join(dir, map ? 'map.json' : 'none.json')
  if (map) writeFileSync(mapPath, JSON.stringify(map))
  const out = path.join(dir, 'out.json')
  execFileSync(PY, ['-c', EXTRACT, JSON.stringify(fixtures)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, STOCK_DATA_DIR: dir, STOCK_BANK_BALANCES_PATH: out, STOCK_ACCOUNT_MAP_PATH: mapPath },
  })
  return JSON.parse(readFileSync(out, 'utf8'))
}

const account = (doc: any, alias: string) => doc.accounts.find((a: any) => a.account === alias)

test('a closed term deposit holds its matched principal from 개설일 and closes at zero on 해지일', () => {
  const doc = extract({
    'mg-deposit-20220201-20250201.xls': SALARY_ROWS,
    'mg-term-2345-20230509-20240509.xls': A,
  })
  const a = account(doc, '새마을금고 정기예금 …1234-5')
  assert.ok(a, `no account: ${JSON.stringify(doc.accounts.map((x: any) => x.account))}`)
  assert.equal(a.institution, 'mg')
  assert.equal(a.kind, 'deposit')
  assert.equal(a.currency, 'KRW')
  assert.equal(a.derived, true)
  assert.equal(a.principal, 'matched')
  assert.deepEqual(a.sources, ['mg-term-2345-20230509-20240509.xls'])
  assert.deepEqual(a.balances, [{ date: '2023-05-09', balance: 7_000_000 }, { date: '2024-05-09', balance: 0 }])
  assert.deepEqual(a.continuityBreaks, [])
  assert.deepEqual(doc.findings, [])
})

test('two same-day openings are paired with their deposits by 총수령액 and 이자, not by order', () => {
  const doc = extract({
    'mg-deposit-20220201-20250201.xls': SALARY_ROWS,
    'mg-term-2345-20230509-20240509.xls': A,
    'mg-term-6789-20230509-20240509.xls': B,
  })
  assert.equal(account(doc, '새마을금고 정기예금 …1234-5').balances[0].balance, 7_000_000)
  assert.equal(account(doc, '새마을금고 정기예금 …5678-9').balances[0].balance, 70_000_000)
  assert.ok(doc.accounts.every((a: any) => a.account.includes('자립예탁금') || a.principal === 'matched'))
})

test('the 월급통장 is named by its full number, not by the first mg entry in the map', () => {
  const doc = extract({ 'mg-deposit-20220201-20250201.xls': SALARY_ROWS, 'mg-term-2345-20230509-20240509.xls': A })
  const salary = account(doc, '새마을금고 자립예탁금')
  assert.ok(salary, `no salary account: ${JSON.stringify(doc.accounts.map((x: any) => x.account))}`)
  assert.equal(salary.derived, false)
})

test('with no matching outflow the principal is estimated from 총수령액 and 이자, with a note naming the account', () => {
  const doc = extract({
    'mg-deposit-20220201-20250201.xls': SALARY_ROWS,
    'mg-term-3210-20220302-20230302.xls': C,
  })
  const c = account(doc, '새마을금고 정기예금 …4321-0')
  assert.equal(c.principal, 'estimated')
  assert.equal(c.derived, true)
  // 5,084,600 − 100,000 × 0.846
  assert.deepEqual(c.balances, [{ date: '2022-03-02', balance: 5_000_000 }, { date: '2023-03-02', balance: 0 }])
  assert.equal(doc.findings.length, 0)
  const note = doc.notes.find((n: string) => n.includes('3210') && n.includes('estimated'))
  assert.ok(note, `no note: ${JSON.stringify(doc.notes)}`)
  assert.match(note, /5,000,000/)
  assert.ok(!note.includes(TERM_C) && !note.includes(TERM_C.replace(/-/g, '')))
})

test('a term file whose number the map does not list is a finding and is skipped', () => {
  const doc = extract({ 'mg-term-7773-20230509-20240509.xls': termRows('9999-0000-7777-3', '2023.05.09', '2024.05.09', 7_207_270, 245_000) })
  assert.equal(doc.accounts.length, 0)
  assert.match(doc.findings.join('\n'), /mg-term-7773-20230509-20240509\.xls: 계좌번호 \S*7773 is not in the account map; skipped/)
})

test('the matched opening and payout leave the 새마을금고 예적금 estimate, so the deposit is not counted twice', () => {
  const doc = extract({
    'mg-deposit-20220201-20250201.xls': SALARY_ROWS,
    'mg-term-2345-20230509-20240509.xls': A,
    'mg-term-6789-20230509-20240509.xls': B,
  })
  assert.deepEqual(doc.estimatedAccounts.filter((a: any) => a.account === '새마을금고 예적금'), [])
})

// D: principal 5,000,000 by the estimate, but the only 인터넷신규 that day is 4%
// off it, so the opening does not match while the payout does.
const D = termRows(TERM_D, '2023.08.01', '2024.08.01', 5_084_600, 100_000)
// Only D's legs, so any 새마을금고 예적금 estimate left would be D counted twice.
const SALARY_D = [
  ...SALARY_ROWS.slice(0, 6),
  ['', '2023.08.01', '09:00:00', '', '입금', '급여', '', '0', '', '', '6000000', '6000000'],
  ['', '2023.08.01', '10:00:00', '', '스마트뱅킹', '인터넷신규', '', '5200000', '', '', '0', '800000'],
  ['', '2024.08.01', '00:10:00', '', '대체', '예적금만기 자동이체', '', '0', '', '', '5084600', '5884600'],
]

test('an opening outside the 1% window: estimated principal, a finding, and the deposit counted once', () => {
  const doc = extract({ 'mg-deposit-20220201-20250201.xls': SALARY_D, 'mg-term-2468-20230801-20240801.xls': D })
  const d = account(doc, '새마을금고 정기예금 …2468-1')
  assert.equal(d.principal, 'estimated')
  assert.deepEqual(d.balances, [{ date: '2023-08-01', balance: 5_000_000 }, { date: '2024-08-01', balance: 0 }])
  const finding = doc.findings.find((f: string) => f.includes('2468'))
  assert.ok(finding, `no finding: ${JSON.stringify(doc.findings)}`)
  assert.match(finding, /paid out on 2024-08-01[\s\S]*no 인터넷신규 outflow on 2023-08-01 comes within 1%/)
  assert.ok(!finding.includes(TERM_D) && !finding.includes(TERM_D.replace(/-/g, '')))
  // The closest same-day 인터넷신규 and the payout both leave the estimate.
  assert.deepEqual(doc.estimatedAccounts.filter((a: any) => a.account === '새마을금고 예적금'), [])
})

test('a payout whose opening is not in the 월급통장 at all stays in the estimate', () => {
  // C opened before the export reaches; give it a payout on its 해지일.
  const salary = [...SALARY_ROWS, ['', '2023.03.02', '00:10:00', '', '대체', '예적금만기 자동이체', '', '0', '', '', '5084600', '5084600']]
  const doc = extract({ 'mg-deposit-20220201-20250201.xls': salary, 'mg-term-3210-20220302-20230302.xls': C })
  assert.equal(account(doc, '새마을금고 정기예금 …4321-0').principal, 'estimated')
  assert.match(doc.findings.join('\n'), /3210[\s\S]*paid out on 2023-03-02/)
})

test('the 예적금 bucket takes any 거래내용 that carries 인터넷신규, not only the bare word', () => {
  const r = JSON.parse(execFileSync(PY, ['-c', `
import importlib.util, json
spec = importlib.util.spec_from_file_location('bank', 'scripts/extract-bank-statements.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
flow = lambda memo: {"statement": "mg", "memo": memo, "counterpartyInstitution": ""}
print(json.dumps([m._bucket(flow("인터넷신규")), m._bucket(flow("인터넷신규(정기)")), m._bucket(flow("급여"))]))
`], { cwd: ROOT, encoding: 'utf8' }))
  assert.deepEqual(r, ['mg-savings', 'mg-savings', 'counterparty:급여|새마을금고 내역'])
})
