// A 거래내역증명서 that exists only as photos of a monitor is transcribed to a
// `.txt` (docs/data-sources.md, "Transcribed statements"). The extractors read it
// through the page/table interface a PDF has, so the account map, the period and
// the parsers need no second path. These cases pin the three things that differ:
//
// - a PDF always wins the days a transcription shares with it;
// - a CMA that sweeps into RP, and a 종합 account that sweeps its dollars into
//   외화RP, still show their whole balance;
// - the closing row is a marker, not a transaction.
//
// Every account number and amount below is invented.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')
const PY = process.env.STOCK_PYTHON_BIN || 'python3'

const CMA = '000-000000001'
const GENERAL = '000-000000002'

const COLUMNS = '거래일자|거래번호|거래종류|원번호|거래수량|단가|종목코드|종목명|수수료|제세금합|거래금액|입출금액|예수금잔액|유가잔고|외화거래금액|외화입출금액|외화예수금|외화유가잔고|통화코드|미수총잔고|미수발생금액|미수변제금액'

type Row = Partial<{
  qty: string
  fee: string
  tax: string
  amount: string
  io: string
  cash: string
  sec: string
  fxAmount: string
  fxIo: string
  fxCash: string
  cur: string
}>

/** One transcribed line; the 22 fields in the order the file prints them. */
function line(date: string, no: number, kind: string, r: Row = {}) {
  return [
    date, String(no), kind, '0', r.qty ?? '', '', '', '', r.fee ?? '', r.tax ?? '', r.amount ?? '', r.io ?? '',
    r.cash ?? '', r.sec ?? '', r.fxAmount ?? '', r.fxIo ?? '', r.fxCash ?? '', '', r.cur ?? '', '', '', '',
  ].join('|')
}

function transcript(opts: { account: string; label: string; period: string; pages: string[][] }) {
  const out = [
    '미래에셋증권 거래내역서 전사본',
    `계좌번호: ${opts.account} (${opts.label})`,
    `조회기간(거래일자): ${opts.period}`,
    '거래구분: 전체 / 증권종류구분: 전체',
    '',
    '[거래내역]',
    COLUMNS,
  ]
  opts.pages.forEach((rows, i) => {
    out.push('', `--- ${String(i + 1).padStart(2, '0')}/${String(opts.pages.length).padStart(2, '0')}쪽 ---`, ...rows)
  })
  return out.join('\n') + '\n'
}

function dataDir(files: Record<string, Record<string, string>>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mirae-transcribed-'))
  for (const [sub, byName] of Object.entries(files)) {
    mkdirSync(path.join(dir, sub), { recursive: true })
    for (const [name, body] of Object.entries(byName)) writeFileSync(path.join(dir, sub, name), body, 'utf8')
  }
  return dir
}

// --- the bank extractor: a CMA that sweeps into RP --------------------------------

const CMA_ROWS = [
  line('2024/01/02', 1, '계좌대체입금', { amount: '1,000,000', io: '1,000,000', cash: '1,000,000' }),
  line('2024/01/02', 2, '마감후 CMA조건부매수', { amount: '1,000,000', io: '1,000,000', sec: '1,000,000' }),
  line('2024/01/05', 1, 'CMA-RP환매도', { qty: '1,000,000', amount: '1,000,300', tax: '40', io: '1,000,260', cash: '1,000,260' }),
  line('2024/01/05', 2, '계좌대체출금', { amount: '400,000', io: '400,000', cash: '600,260' }),
  line('2024/01/05', 3, '마감후 CMA조건부매수', { amount: '600,260', io: '600,260', sec: '600,260' }),
  line('2024/01/09', 1, 'CMA-RP환매도', { qty: '600,260', amount: '600,400', io: '600,400', cash: '600,400' }),
  line('2024/01/09', 2, '계좌대체출금', { amount: '600,400', io: '600,400' }),
  line('2024/01/09', 3, '계좌폐쇄'),
]

function runBank(dir: string, map: object) {
  const mapPath = path.join(dir, 'map.json')
  const out = path.join(dir, 'out.json')
  writeFileSync(mapPath, JSON.stringify(map))
  execFileSync(PY, ['scripts/extract-bank-statements.py'], {
    cwd: ROOT,
    env: { ...process.env, STOCK_DATA_DIR: dir, STOCK_BANK_BALANCES_PATH: out, STOCK_ACCOUNT_MAP_PATH: mapPath },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return JSON.parse(readFileSync(out, 'utf8'))
}

const CMA_MAP = { bankAccounts: [{ institution: 'mirae', kind: 'cma', accountNumber: CMA, currency: 'KRW', alias: '예시 RP CMA' }] }

test('a transcribed CMA that sweeps into RP reads its whole balance and closes at zero', () => {
  const dir = dataDir({
    'bank-statements': {
      'mirae-cma-20240102-20240109-1.txt': transcript({ account: CMA, label: '종합(CMA)', period: '2024/01/02 ~ 2024/01/09', pages: [CMA_ROWS] }),
    },
  })
  const doc = runBank(dir, CMA_MAP)
  assert.deepEqual(doc.findings, [])
  assert.equal(doc.accounts.length, 1)
  const a = doc.accounts[0]
  assert.deepEqual([a.institution, a.account, a.kind, a.derived], ['mirae', '예시 RP CMA', 'cma', false])
  // A buy moves cash into RP and changes nothing; a sell adds only the net interest.
  assert.deepEqual(a.balances, [
    { date: '2024-01-02', balance: 1_000_000 },
    { date: '2024-01-05', balance: 600_260, dayMax: 1_000_260 },
    { date: '2024-01-09', balance: 0, dayMax: 600_400 },
  ])
  assert.deepEqual(a.continuityBreaks, [])
})

test('a blank 예수금잔액 beside a 입출금액 is a zero, so an emptying transfer ends the day at zero', () => {
  const rows = [
    line('2024/03/01', 1, '이체입금', { amount: '500,000', io: '500,000', cash: '500,000' }),
    line('2024/03/01', 2, '이체송금', { amount: '500,000', io: '500,000' }),
  ]
  const dir = dataDir({
    'bank-statements': { 'mirae-cma-20240301-20240301-2.txt': transcript({ account: CMA, label: '종합(CMA)', period: '2024/03/01 ~ 2024/03/01', pages: [rows] }) },
  })
  const a = runBank(dir, CMA_MAP).accounts[0]
  assert.deepEqual(a.balances, [{ date: '2024-03-01', balance: 0, dayMax: 500_000 }])
})

test('a transcription whose 계좌번호 the map lacks is skipped with a finding, never read under another name', () => {
  const dir = dataDir({
    'bank-statements': { 'mirae-cma-20240102-20240109-1.txt': transcript({ account: '999-000000009', label: '종합(CMA)', period: '2024/01/02 ~ 2024/01/09', pages: [CMA_ROWS] }) },
  })
  const doc = runBank(dir, CMA_MAP)
  assert.equal(doc.accounts.length, 0)
  assert.match(doc.findings.join('\n'), /not in the account map/)
})

test('a transfer between two CMAs finds its other leg, so neither is money held elsewhere', () => {
  const OTHER = '000-000000003'
  const a = [
    line('2024/04/01', 1, '이체입금', { amount: '500,000', io: '500,000', cash: '500,000' }),
    line('2024/04/01', 2, '계좌대체출금', { amount: '300,000', io: '300,000', cash: '200,000' }),
  ]
  const b = [line('2024/04/01', 1, '계좌대체입금', { amount: '300,000', io: '300,000', cash: '300,000' })]
  const dir = dataDir({
    'bank-statements': {
      'mirae-cma-20240401-20240401-1.txt': transcript({ account: CMA, label: '종합(CMA)', period: '2024/04/01 ~ 2024/04/01', pages: [a] }),
      'mirae-cma-20240401-20240401-2.txt': transcript({ account: OTHER, label: '종합(CMA)', period: '2024/04/01 ~ 2024/04/01', pages: [b] }),
    },
  })
  const doc = runBank(dir, {
    bankAccounts: [
      { institution: 'mirae', kind: 'cma', accountNumber: CMA, currency: 'KRW', alias: '예시 CMA 가' },
      { institution: 'mirae', kind: 'cma', accountNumber: OTHER, currency: 'KRW', alias: '예시 CMA 나' },
    ],
  })
  assert.deepEqual(doc.findings, [])
  const received = doc.inflows.find((i: { account: string; description: string }) => i.account === '예시 CMA 나')
  assert.equal(received.ownTransfer, true)
  assert.deepEqual(
    doc.estimatedAccounts.filter((e: { balances: { balance: number }[] }) => e.balances.some((x) => x.balance > 0)),
    []
  )
})

// --- the KR extractor: 외화RP, the closing row, and the PDF taking precedence -----

function runKr(dir: string, map: object) {
  const mapPath = path.join(dir, 'map.json')
  const out = path.join(dir, 'out')
  writeFileSync(mapPath, JSON.stringify(map))
  execFileSync(PY, ['scripts/extract-kr-statements.py'], {
    cwd: ROOT,
    env: { ...process.env, STOCK_DATA_DIR: dir, STOCK_KR_STATEMENTS_DIR: out, STOCK_ACCOUNT_MAP_PATH: mapPath },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const tsv = (name: string) =>
    readFileSync(path.join(out, name), 'utf8')
      .trim()
      .split('\n')
      .map((l) => l.split('\t'))
  const table = (name: string) => {
    const [head, ...rows] = tsv(name)
    return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])))
  }
  return { cash: table('cash.tsv'), transactions: table('transactions.tsv'), report: JSON.parse(readFileSync(path.join(out, 'extract-report.json'), 'utf8')) }
}

const GENERAL_MAP = { brokerageAccounts: [{ institution: 'mirae', accountNumber: GENERAL, kind: 'general', label: '미래에셋증권(종합2)' }] }

const USD_ROWS = [
  line('2024/02/01', 1, '외화매수외화입금', { fxAmount: '100.00', fxIo: '100.00', fxCash: '100.00', cur: 'USD' }),
  line('2024/02/01', 2, '외화RP매수', { fxAmount: '100.00', fxIo: '100.00', cur: 'USD' }),
  line('2024/02/02', 1, '외화RP환매도', { fxAmount: '100.05', fxIo: '100.05', fxCash: '100.05', cur: 'USD' }),
  line('2024/02/02', 2, '외화출금', { fxAmount: '100.05', fxIo: '100.05', cur: 'USD' }),
  line('2024/02/02', 3, '계좌폐쇄'),
]

test('dollars swept into 외화RP stay in the pool, and the sweep and the closing row are not transactions', () => {
  const dir = dataDir({
    'kr-statements': {
      'mirae-general-transactions-20240201-20240202-1.txt': transcript({ account: GENERAL, label: '종합', period: '2024/02/01 ~ 2024/02/02', pages: [USD_ROWS] }),
    },
  })
  const { cash, transactions, report } = runKr(dir, GENERAL_MAP)
  const usd = cash.filter((r) => r.Account === '미래에셋증권(종합2)' && r.Pool === 'USD')
  // Read alone the pool is $0 each evening: the 외화RP매수 prints no 외화예수금.
  assert.deepEqual(usd.map((r) => [r.Date, Number(r.Balance)]), [['2024-02-01', 100], ['2024-02-02', 0]])
  assert.deepEqual(transactions.map((t) => t['Raw Type']), ['외화매수외화입금', '외화출금'])
  const kinds = (report.findings as { kind: string }[]).map((f) => f.kind)
  assert.equal(kinds.includes('mirae-unmapped-type'), false, 'the sweep and the closing row are known types')
})

// --- which of a PDF and a transcription is read -----------------------------------

const HARNESS = `
import importlib.util, json, sys, types
from pathlib import Path
sys.modules.setdefault("pdfplumber", types.ModuleType("pdfplumber"))
spec = importlib.util.spec_from_file_location("kr_extract", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
docs = json.loads(sys.argv[2])
probes = json.loads(sys.argv[3])
mod.statement_coverage = lambda path, report: tuple(docs[path.name]["period"])
mod.statement_account_number = lambda path: docs[path.name].get("account")
findings = []
plan = mod.statements_to_read([Path(f"/fixture/{name}") for name in docs], lambda k, d: findings.append(k))
print(json.dumps({
    "read": sorted(p.name for p in plan),
    "cedes": {f"{name}@{day}": plan.cedes(Path(f"/fixture/{name}"), day) for name, day in probes},
    "findings": findings,
}))
`

function plan(docs: Record<string, { period: [string, string]; account: string }>, probes: [string, string][] = []) {
  const harness = path.join(mkdtempSync(path.join(tmpdir(), 'mirae-precedence-')), 'harness.py')
  writeFileSync(harness, HARNESS, 'utf8')
  const out = execFileSync(PY, [harness, path.join(ROOT, 'scripts/extract-kr-statements.py'), JSON.stringify(docs), JSON.stringify(probes)], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return JSON.parse(out.trim().split('\n').at(-1) ?? '') as { read: string[]; cedes: Record<string, boolean>; findings: string[] }
}

const PDF = 'mirae-general-transactions-2024-2025-1.pdf'
const TXT = 'mirae-general-transactions-20250101-20260420-2.txt'

test('a transcription never supersedes a PDF: the PDF is read, and the transcription leaves it the shared days', () => {
  // The transcription is the later-ending document. Between two PDFs that would
  // hand it the shared days; against a PDF it must not.
  const result = plan(
    { [PDF]: { period: ['2024-01-01', '2025-12-31'], account: GENERAL }, [TXT]: { period: ['2025-01-01', '2026-04-20'], account: GENERAL } },
    [[TXT, '2024-06-01'], [TXT, '2025-06-01'], [TXT, '2026-02-01'], [PDF, '2025-06-01']]
  )
  assert.deepEqual(result.read, [PDF, TXT])
  assert.deepEqual(result.cedes, {
    [`${TXT}@2024-06-01`]: false, // outside the PDF's window: nothing to leave
    [`${TXT}@2025-06-01`]: true,
    [`${TXT}@2026-02-01`]: false, // after the PDF ends, the transcription is the only source
    [`${PDF}@2025-06-01`]: false,
  })
  assert.deepEqual(result.findings, [])
})

test('a transcription wholly inside a PDF is not read, and a PDF inside a transcription is still read', () => {
  const inside = plan({
    [PDF]: { period: ['2024-01-01', '2025-12-31'], account: GENERAL },
    'mirae-general-transactions-20250301-20250630-3.txt': { period: ['2025-03-01', '2025-06-30'], account: GENERAL },
  })
  assert.deepEqual(inside.read, [PDF])

  const around = plan({
    'mirae-general-transactions-20260101-20260716-4.pdf': { period: ['2026-01-01', '2026-07-16'], account: GENERAL },
    'mirae-general-transactions-20180101-20261231-5.txt': { period: ['2018-01-01', '2026-12-31'], account: GENERAL },
  }, [['mirae-general-transactions-20180101-20261231-5.txt', '2026-03-01'], ['mirae-general-transactions-20180101-20261231-5.txt', '2025-03-01']])
  assert.deepEqual(around.read, ['mirae-general-transactions-20180101-20261231-5.txt', 'mirae-general-transactions-20260101-20260716-4.pdf'])
  assert.deepEqual(around.cedes, {
    'mirae-general-transactions-20180101-20261231-5.txt@2026-03-01': true,
    'mirae-general-transactions-20180101-20261231-5.txt@2025-03-01': false,
  })
})
