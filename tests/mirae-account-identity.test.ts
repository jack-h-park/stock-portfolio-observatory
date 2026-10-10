// A 미래에셋 account is identified by its FULL 계좌번호, looked up in the account map.
// Never by its last four digits (several 미래에셋 accounts share them) and never by
// the printed 계좌유형 alone (a second account of one type would merge into the
// first). 계좌유형 is only a consistency check against the map's kind.
//
// Every account number below is invented. The two 종합 numbers share their last
// four digits on purpose: that is the shape that went wrong once.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')
const PY = process.env.STOCK_PYTHON_BIN || 'python3'

const GENERAL_A = '111-000000042'
const GENERAL_B = '222-000000042' // same last four as GENERAL_A, a different account
const ISA = '333-000000017'
const CMA = '444-000000042'
const GOLD = '555-000000063'
const IRP = '666-000000071'

const MAP = {
  brokerageAccounts: [
    { institution: 'mirae', accountNumber: GENERAL_A, kind: 'general' },
    { institution: 'mirae', accountNumber: ISA, kind: 'isa' },
    { institution: 'mirae', accountNumber: GOLD, kind: 'gold' },
  ],
  bankAccounts: [{ institution: 'mirae', kind: 'cma', accountNumber: CMA, currency: 'KRW', alias: '예시 CMA' }],
  pensionAccounts: [{ token: 'irp', accountNumber: IRP, account: '미래에셋증권(IRP)', wrapper: 'irp', institution: '미래에셋증권' }],
}

// --- the filer -----------------------------------------------------------------

const cover = (window = '2024/01/01 ~ 2024/12/31') =>
  `미래에셋증권 거래내역 증 명 서\nN O. 2025-001-00001234\n제공내역 ${window}`
const page2 = (number: string, accountType: string) =>
  `계좌정보 페이지: 01/02\n계좌번호 ${number} 계좌유형 ${accountType} 고객명 예시고객`

/** Run one filer detector over a fake document under `map` (absent means no map file). */
function detect(detector: string, pages: string[], map?: object) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mirae-identity-'))
  const mapPath = path.join(dir, map === undefined ? 'no-map.json' : 'map.json')
  if (map !== undefined) writeFileSync(mapPath, JSON.stringify(map))
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
if isinstance(out, m.Plan):
    print(json.dumps({'plan': out.subdir + '/' + out.name, 'evidence': out.evidence}))
else:
    print(json.dumps({'reason': out.reason, 'remedy': out.remedy}))
`
  return JSON.parse(
    execFileSync(PY, ['-c', program, JSON.stringify(pages), detector], {
      cwd: ROOT,
      env: { ...process.env, STOCK_ACCOUNT_MAP_PATH: mapPath },
      encoding: 'utf8',
    })
  )
}

const said = (out: { reason?: string; remedy?: string; evidence?: string[] }) =>
  [out.reason, out.remedy, ...(out.evidence ?? [])].join('\n')

test('two 종합 certificates sharing their last four digits: only the mapped number files', () => {
  const mapped = detect('detect_mirae_transactions', [cover(), page2(GENERAL_A, '종합')], MAP)
  assert.equal(mapped.plan, 'kr-statements/mirae-general-transactions-2024-1234.pdf')

  const other = detect('detect_mirae_transactions', [cover(), page2(GENERAL_B, '종합')], MAP)
  assert.equal(other.plan, undefined, JSON.stringify(other))
  assert.match(other.reason, /\*\*\*-\*\*-\*\*\*\*0042/)
  assert.match(other.remedy, /brokerageAccounts/)
  assert.match(other.remedy, /"kind": "general"/)
  // Only the last four digits are ever shown.
  assert.doesNotMatch(said(other), /222-?000000042|222000000042/)
  assert.doesNotMatch(said(mapped), /111-?000000042|111000000042/)
})

test('a recognisable 계좌유형 does not file a certificate whose number the map lacks', () => {
  for (const map of [undefined, { brokerageAccounts: [] }]) {
    const out = detect('detect_mirae_transactions', [cover(), page2(GENERAL_A, '종합')], map)
    assert.equal(out.plan, undefined, JSON.stringify(out))
    assert.match(out.reason, /0042/)
  }
})

test('a 종합_CMA certificate whose number the map lists as the CMA files to bank-statements', () => {
  const out = detect('detect_mirae_transactions', [cover(), page2(CMA, '종합_CMA')], MAP)
  assert.equal(out.plan, 'bank-statements/mirae-cma-20240101-20241231.pdf')
})

test('the kind comes from the map: gold and the IRP (by its pensionAccounts entry)', () => {
  assert.equal(
    detect('detect_mirae_transactions', [cover('2026/01/01 ~ 2026/10/10'), page2(GOLD, '금현물')], MAP).plan,
    'kr-statements/mirae-gold-transactions-20260101-20261010.pdf'
  )
  assert.equal(
    detect('detect_mirae_transactions', [cover('2020/01/01 ~ 2026/10/10'), page2(IRP, '퇴직연금_개인IRP')], MAP).plan,
    'kr-statements/mirae-irp-transactions-20200101-20261010.pdf'
  )
})

test('a certificate whose 계좌유형 contradicts the map kind is refused, naming both', () => {
  const out = detect('detect_mirae_transactions', [cover(), page2(GENERAL_A, 'ISA')], MAP)
  assert.equal(out.plan, undefined, JSON.stringify(out))
  assert.match(out.reason, /ISA/)
  assert.match(out.reason, /general/)
  // The 종합_CMA certificate filed under the 종합 account is exactly this case.
  const cma = detect('detect_mirae_transactions', [cover(), page2(GENERAL_A, '종합_CMA')], MAP)
  assert.equal(cma.plan, undefined, JSON.stringify(cma))
})

test('pages that print different 계좌번호 are refused', () => {
  const out = detect('detect_mirae_transactions', [cover(), page2(GENERAL_A, '종합'), page2(ISA, '종합')], MAP)
  assert.equal(out.plan, undefined, JSON.stringify(out))
  assert.match(out.reason, /different 계좌번호/)
  assert.doesNotMatch(said(out), /111000000042|333000000017/)
})

test('a 잔고증명서 is identified by its full number too, never by a shared last four', () => {
  const balance = (number: string) => [
    `잔 고 증 명 서\n기준일자 발급일시 2024-12-31\n계좌번호 계좌명 부기명 실명확인번호 ${number} 예시고객\n발급번호: 2025-001-00001234`,
  ]
  assert.equal(detect('detect_mirae_balance', balance(GENERAL_A), MAP).plan, 'kr-statements/mirae-general-balance-20241231-1234.pdf')
  const other = detect('detect_mirae_balance', balance(GENERAL_B), MAP)
  assert.equal(other.plan, undefined, JSON.stringify(other))
  assert.match(other.reason, /\*\*\*\*0042/)
  // The CMA shares the 종합 account's last four; its balance has no destination here.
  assert.equal(detect('detect_mirae_balance', balance(CMA), MAP).plan, undefined)
})

// --- the extractors ----------------------------------------------------------
//
// pdfplumber is replaced by a stub that returns page text and tables from a JSON
// fixture, as in pension-extract.test.ts.

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

type Cell = string | null
type Table = Cell[][]
type Page = { text?: string; tables?: Table[] }

function stubDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'pdfplumber-stub-'))
  writeFileSync(path.join(dir, 'pdfplumber.py'), PDFPLUMBER_STUB, 'utf8')
  return dir
}

function writeDoc(file: string, pages: Page[]) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ pages }), 'utf8')
}

const HEADER: Table = [
  ['거래내역', ...Array(11).fill(null)],
  ['거래일자', '거래종류', null, null, '종목번호 / 기타', '수수료', '거래금액', '예수금잔액', '외화거래금액', '외화예수금', '미수총잔고', '미수발생금액'],
  ['거래번호', '원번호', '거래수량', '단가', '종목명', '제세금합', '입출금액', '유가잔고', '외화입출금액', '외화유가잔고', '통화코드', '미수변제금액'],
  ['상대금융기관', null, '상대계좌번호', null, '상대고객명', '(CD기)은행', null, '대출상환금액', '대출이자금액', '환율', '처리점', '처리시각'],
]

/** One deposit record (rows A, B, C) on `day`. */
function deposit(day: string, amount: string, type = '계좌대체입금'): Table {
  const a = Array<Cell>(12).fill(''), b = Array<Cell>(12).fill(''), c = Array<Cell>(12).fill('')
  a[0] = day; a[1] = type; a[6] = amount; a[7] = amount
  b[0] = '1'; b[1] = '0'; b[6] = amount
  c[10] = 'Direct0'; c[11] = '10:00:00'
  return [a, b, c]
}

function certificate(number: string, accountType: string, window: string, records: Table[], extra = ''): Page[] {
  return [
    { text: `거래내역 증 명 서\nN O. 2026-001-00000099\n제공내역(provided information)\n${window}\n미래에셋증권 대표이사 예시대표`, tables: [] },
    {
      text: `계좌정보 페이지: 01/01\n계좌번호 ${number} 계좌유형 ${accountType} 고객명 예시고객${extra ? `\n${extra}` : ''}`,
      tables: [
        [['계좌번호', number, '계좌유형', accountType, '고객명', '예시고객', '거래일자', '20240101 ~ 20241231', null, null, null]],
        [...HEADER, ...records.flat()],
      ],
    },
  ]
}

type Finding = { kind: string; rows: number; drops_rows: boolean; blocking?: boolean; samples: string[] }

function readTsv(file: string): Record<string, string>[] {
  const [head, ...lines] = readFileSync(file, 'utf8').trimEnd().split('\n')
  const cols = head.split('\t')
  return lines.map((line) => Object.fromEntries(line.split('\t').map((v, i) => [cols[i], v])))
}

/** Run the KR extractor over `files` (name → pages) with `map`, or with no map file at all. */
function runKr(files: Record<string, Page[]>, map?: object) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'mirae-identity-kr-'))
  const outDir = path.join(dataDir, 'out')
  for (const [name, pages] of Object.entries(files)) writeDoc(path.join(dataDir, 'kr-statements', name), pages)
  const mapPath = path.join(dataDir, map ? 'map.json' : 'no-map.json')
  if (map) writeFileSync(mapPath, JSON.stringify(map))
  const result = spawnSync(PY, ['scripts/extract-kr-statements.py'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONPATH: stubDir(),
      STOCK_DATA_DIR: dataDir,
      STOCK_KR_STATEMENTS_DIR: outDir,
      STOCK_TOSS_SNAPSHOT_PATH: path.join(dataDir, 'no-toss.json'),
      STOCK_ACCOUNT_MAP_PATH: mapPath,
      STOCK_PDF_PASSWORD: '',
      STOCK_KR_AS_OF: '',
    },
  })
  assert.equal(result.status, 0, `extractor exited ${result.status}: ${result.stderr}`)
  const report = JSON.parse(readFileSync(path.join(outDir, 'extract-report.json'), 'utf8'))
  const transactions = readTsv(path.join(outDir, 'transactions.tsv'))
  const finding = (kind: string): Finding | undefined => report.findings.find((f: Finding) => f.kind === kind)
  return { transactions, findings: report.findings as Finding[], finding, output: result.stdout + result.stderr }
}

const accounts = (rows: Record<string, string>[]) => [...new Set(rows.map((r) => r.Account))].sort()

const TWO_GENERALS = {
  'mirae-general-transactions-2024-1111.pdf': certificate(GENERAL_A, '종합', '2024/01/01 ~ 2024/12/31', [deposit('2024/03/04', '1,000')]),
  'mirae-general-transactions-2024-2222.pdf': certificate(GENERAL_B, '종합', '2024/01/01 ~ 2024/12/31', [deposit('2024/03/05', '2,000')]),
}

test('the extractor labels two mapped 종합 accounts apart when the map gives them distinct labels', () => {
  const map = {
    brokerageAccounts: [
      { institution: 'mirae', accountNumber: GENERAL_A, kind: 'general' },
      { institution: 'mirae', accountNumber: GENERAL_B, kind: 'general', label: '미래에셋증권(종합2)' },
    ],
  }
  const run = runKr(TWO_GENERALS, map)
  assert.deepEqual(accounts(run.transactions), ['미래에셋증권(종합)', '미래에셋증권(종합2)'])
  assert.deepEqual(run.transactions.find((r) => r.Account === '미래에셋증권(종합2)')?.Date, '2024-03-05')
  // Two mapped accounts under one filename series are two accounts, not a misfiled one.
  assert.equal(run.finding('account-mismatch'), undefined, JSON.stringify(run.findings))
  assert.doesNotMatch(run.output, /111-?000000042|222-?000000042/)
})

test('two mapped accounts of one kind without distinct labels are refused, not merged', () => {
  const map = {
    brokerageAccounts: [
      { institution: 'mirae', accountNumber: GENERAL_A, kind: 'general' },
      { institution: 'mirae', accountNumber: GENERAL_B, kind: 'general' },
    ],
  }
  const run = runKr(TWO_GENERALS, map)
  const collision = run.finding('mirae-account-label-collision')
  assert.ok(collision, JSON.stringify(run.findings))
  assert.equal(collision.blocking, true)
  assert.match(collision.samples.join('\n'), /미래에셋증권\(종합\)/)
  assert.match(collision.samples.join('\n'), /label/)
  assert.doesNotMatch(collision.samples.join('\n'), /111000000042|222000000042|111-000000042|222-000000042/)
  assert.deepEqual(run.transactions.filter((r) => r.Account.startsWith('미래에셋')), [])
})

test('a file whose number the map lacks is skipped with a finding, not labelled by its 계좌유형', () => {
  const map = { brokerageAccounts: [{ institution: 'mirae', accountNumber: GENERAL_A, kind: 'general' }] }
  const run = runKr(TWO_GENERALS, map)
  assert.deepEqual(accounts(run.transactions), ['미래에셋증권(종합)'])
  assert.equal(run.transactions.length, 1)
  const unmapped = run.finding('mirae-unmapped-account')
  assert.ok(unmapped, JSON.stringify(run.findings))
  assert.equal(unmapped.drops_rows, true)
  assert.match(unmapped.samples.join('\n'), /mirae-general-transactions-2024-2222\.pdf/)
  assert.match(unmapped.samples.join('\n'), /\*\*\*\*0042/)
  assert.doesNotMatch(unmapped.samples.join('\n'), /222000000042|222-000000042/)
})

test('a CMA certificate in kr-statements is skipped: the map says it is a bank account', () => {
  const run = runKr({ 'mirae-general-transactions-2024-1111.pdf': certificate(CMA, '종합_CMA', '2024/01/01 ~ 2024/12/31', [deposit('2024/03/04', '1,000')]) }, MAP)
  assert.deepEqual(run.transactions.filter((r) => r.Account.startsWith('미래에셋')), [])
  assert.match(run.finding('mirae-unmapped-account')?.samples.join('\n') ?? '', /cma/)
})

test('with no map at all the labels stay type-based, and a finding says so', () => {
  const run = runKr({
    ...TWO_GENERALS,
    'mirae-isa-transactions-2024.pdf': certificate(ISA, 'ISA', '2024/01/01 ~ 2024/12/31', [deposit('2024/03/06', '3,000')]),
  })
  // Today's behaviour: by 계좌유형, so the two 종합 numbers share one label.
  assert.deepEqual(accounts(run.transactions), ['미래에셋증권(ISA)', '미래에셋증권(종합)'])
  const note = run.finding('mirae-no-account-map')
  assert.ok(note, JSON.stringify(run.findings))
  assert.equal(note.drops_rows, false)
  assert.ok(!note.blocking)
})

/** Run the bank extractor over `files` with `map`, or with no map file at all. */
function runBank(files: Record<string, Page[]>, map?: object) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'mirae-identity-bank-'))
  for (const [name, pages] of Object.entries(files)) writeDoc(path.join(dataDir, 'bank-statements', name), pages)
  const mapPath = path.join(dataDir, map ? 'map.json' : 'no-map.json')
  if (map) writeFileSync(mapPath, JSON.stringify(map))
  const out = path.join(dataDir, 'bank-balances.json')
  const result = spawnSync(PY, ['scripts/extract-bank-statements.py'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: stubDir(), STOCK_DATA_DIR: dataDir, STOCK_BANK_BALANCES_PATH: out, STOCK_ACCOUNT_MAP_PATH: mapPath, STOCK_PDF_PASSWORD: '' },
  })
  assert.equal(result.status, 0, `bank extractor exited ${result.status}: ${result.stderr}`)
  return JSON.parse(readFileSync(out, 'utf8'))
}

const SWEPT = '거래구분 전체 상품구분 전체 종목구분 전체 CMARP/MMW포함 N'
const cmaDoc = (number: string, day: string) =>
  certificate(number, '종합_CMA', '2026/01/01 ~ 2026/10/10', [deposit(day, '1,000', '이체입금')], SWEPT)

test('the bank extractor names a 미래에셋 CMA by the map entry for its full number', () => {
  const doc = runBank({ 'mirae-cma-20260101-20261010.pdf': cmaDoc(CMA, '2026/01/02') }, MAP)
  assert.deepEqual(doc.findings, [])
  assert.deepEqual(doc.accounts.map((a: { account: string }) => a.account), ['예시 CMA'])
})

test('two CMA numbers with distinct aliases are two accounts; an unmapped one is skipped', () => {
  const OTHER = '777-000000042'
  const map = { bankAccounts: [...MAP.bankAccounts, { institution: 'mirae', kind: 'cma', accountNumber: OTHER, currency: 'KRW', alias: '예시 CMA 2' }] }
  const both = runBank({ 'mirae-cma-20260101-20261010.pdf': cmaDoc(CMA, '2026/01/02'), 'mirae-cma-20260101-20261011.pdf': cmaDoc(OTHER, '2026/01/03') }, map)
  assert.deepEqual(both.accounts.map((a: { account: string }) => a.account).sort(), ['예시 CMA', '예시 CMA 2'])

  const one = runBank({ 'mirae-cma-20260101-20261010.pdf': cmaDoc(CMA, '2026/01/02'), 'mirae-cma-20260101-20261011.pdf': cmaDoc(OTHER, '2026/01/03') }, MAP)
  assert.deepEqual(one.accounts.map((a: { account: string }) => a.account), ['예시 CMA'])
  assert.equal(one.findings.length, 1, JSON.stringify(one.findings))
  assert.match(one.findings[0], /mirae-cma-20260101-20261011\.pdf/)
  assert.match(one.findings[0], /\*\*\*\*0042/)
  assert.doesNotMatch(one.findings[0], /777000000042|777-000000042/)
})

test('two CMA entries sharing an alias are refused rather than merged', () => {
  const OTHER = '777-000000042'
  const map = { bankAccounts: [...MAP.bankAccounts, { institution: 'mirae', kind: 'cma', accountNumber: OTHER, currency: 'KRW', alias: '예시 CMA' }] }
  const doc = runBank({ 'mirae-cma-20260101-20261010.pdf': cmaDoc(CMA, '2026/01/02'), 'mirae-cma-20260101-20261011.pdf': cmaDoc(OTHER, '2026/01/03') }, map)
  assert.deepEqual(doc.accounts, [])
  assert.ok(doc.findings.some((f: string) => /예시 CMA/.test(f) && /label|alias/.test(f)), JSON.stringify(doc.findings))
})

test('with no map the CMA keeps its type-based name, and a note says so', () => {
  const doc = runBank({ 'mirae-cma-20260101-20261010.pdf': cmaDoc(CMA, '2026/01/02') })
  assert.deepEqual(doc.accounts.map((a: { account: string }) => a.account), ['미래에셋 CMA'])
  assert.deepEqual(doc.findings, [])
  assert.ok(doc.notes.some((n: string) => /no account map/.test(n)), JSON.stringify(doc.notes))
})
