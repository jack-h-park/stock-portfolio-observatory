import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

// Korean 거래내역증명서 are requested for a period, so downloads overlap. The
// extractor used to resolve only one period strictly inside another; a partial
// overlap or a repeated period was reported as a warning and BOTH files were
// read, so the shared days were counted twice while the refresh still passed.
// A buy in the shared window became two identical lots.
//
// `statements_to_read` now resolves every overlap within one account, and tells
// accounts apart by the 계좌번호 printed in the document, not the filename.
// Nothing here reads a PDF: the harness replaces the two page-1 readers with
// fixed answers, so these cases pin the decision, not the parsing.

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const PY = process.env.STOCK_PYTHON_BIN || 'python3'

const HARNESS = `
import importlib.util, json, sys, types
from pathlib import Path
sys.modules.setdefault("pdfplumber", types.ModuleType("pdfplumber"))
spec = importlib.util.spec_from_file_location("kr_extract", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
docs = json.loads(sys.argv[2])
probes = json.loads(sys.argv[3])
mod.statement_coverage = lambda path, report: tuple(docs[path.stem]["period"])
mod.statement_account_number = lambda path: docs[path.stem].get("account")
findings = []
# An account map, when the case gives one, decides which numbers are distinct declared accounts.
distinct = mod.mapped_distinct_accounts(json.loads(sys.argv[4])) if len(sys.argv) > 4 else None
plan = mod.statements_to_read([Path(f"/fixture/{stem}.pdf") for stem in docs], lambda k, d: findings.append(k), distinct)
print(json.dumps({
    "read": [p.stem for p in plan],
    "cedes": {f"{stem}@{day}": plan.cedes(Path(f"/fixture/{stem}.pdf"), day) for stem, day in probes},
    "findings": findings,
}))
`

type Doc = { period: [string, string]; account?: string | null }

function plan(docs: Record<string, Doc>, probes: [string, string][] = [], map?: object) {
  const harness = path.join(mkdtempSync(path.join(tmpdir(), 'kr-overlap-')), 'harness.py')
  writeFileSync(harness, HARNESS, 'utf8')
  const out = execFileSync(
    PY,
    [harness, path.join(REPO_ROOT, 'scripts/extract-kr-statements.py'), JSON.stringify(docs), JSON.stringify(probes), ...(map ? [JSON.stringify(map)] : [])],
    { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  )
  // The extractor prints what it decided; the harness's answer is the last line.
  return JSON.parse(out.trim().split('\n').at(-1) ?? '') as { read: string[]; cedes: Record<string, boolean>; findings: string[] }
}

const ACCOUNT_A = '000-00-0000-01'
const ACCOUNT_B = '000-00-0000-02'

test('a partial overlap reads both, and the shared days come only from the later-ending statement', () => {
  const result = plan(
    {
      'mirae-isa-transactions-20260716': { period: ['2026-01-01', '2026-07-16'], account: ACCOUNT_A },
      'mirae-isa-transactions-20260701-20261010': { period: ['2026-07-01', '2026-10-10'], account: ACCOUNT_A },
    },
    [
      ['mirae-isa-transactions-20260716', '2026-06-30'],
      ['mirae-isa-transactions-20260716', '2026-07-01'],
      ['mirae-isa-transactions-20260716', '2026/07/09'],
      ['mirae-isa-transactions-20260716', '2026-07-16'],
      ['mirae-isa-transactions-20260701-20261010', '2026-07-09'],
    ]
  )
  assert.deepEqual(result.read.sort(), ['mirae-isa-transactions-20260701-20261010', 'mirae-isa-transactions-20260716'])
  assert.deepEqual(result.cedes, {
    'mirae-isa-transactions-20260716@2026-06-30': false,
    'mirae-isa-transactions-20260716@2026-07-01': true,
    'mirae-isa-transactions-20260716@2026/07/09': true,
    'mirae-isa-transactions-20260716@2026-07-16': true,
    'mirae-isa-transactions-20260701-20261010@2026-07-09': false,
  })
  assert.deepEqual(result.findings, [], 'a resolved overlap is not a finding')
})

test('the same period from the same account is read once', () => {
  const result = plan({
    'mirae-general-transactions-20230101-20261011-1111': { period: ['2023-01-01', '2026-10-11'], account: ACCOUNT_A },
    'mirae-general-transactions-20230101-20261011-1112': { period: ['2023-01-01', '2026-10-11'], account: ACCOUNT_A },
  })
  assert.deepEqual(result.read, ['mirae-general-transactions-20230101-20261011-1112'])
  assert.deepEqual(result.findings, [])
})

test('two accounts under one filename series are not deduplicated against each other, and that blocks', () => {
  const result = plan(
    {
      'mirae-general-transactions-2024-2025-2222': { period: ['2024-01-01', '2025-12-31'], account: ACCOUNT_A },
      'mirae-general-transactions-20230101-20261011-3333': { period: ['2023-01-01', '2026-10-11'], account: ACCOUNT_B },
    },
    [['mirae-general-transactions-2024-2025-2222', '2025-06-01']]
  )
  // Contained by period, but a different account: neither is dropped or trimmed.
  assert.equal(result.read.length, 2)
  assert.equal(result.cedes['mirae-general-transactions-2024-2025-2222@2025-06-01'], false)
  assert.deepEqual(result.findings, ['account-mismatch'])
})

// One account printed in two formats is still one account: the digits decide.
// The numbers are invented.
const SAME_DASHED = '900-000000077'
const SAME_REDASHED = '900-00-0000077'
const OVERLAPPING = {
  'mirae-general-transactions-2024-2025-4444': { period: ['2024-01-01', '2025-12-31'] as [string, string], account: SAME_DASHED },
  'mirae-general-transactions-20230101-20261011-5555': { period: ['2023-01-01', '2026-10-11'] as [string, string], account: SAME_REDASHED },
}
const GENERAL_MAP = (...numbers: string[]) => ({
  brokerageAccounts: numbers.map((accountNumber) => ({ institution: 'mirae', accountNumber, kind: 'general' })),
})

test('one account printed in two formats is one account: the contained statement is superseded', () => {
  for (const map of [undefined, GENERAL_MAP(SAME_DASHED)]) {
    const result = plan(OVERLAPPING, [], map)
    assert.deepEqual(result.read, ['mirae-general-transactions-20230101-20261011-5555'], JSON.stringify(map))
    assert.deepEqual(result.findings, [])
  }
})

test('two mapped accounts of the series kind are two accounts, read side by side without a mismatch', () => {
  const result = plan(
    {
      'mirae-general-transactions-2024-2025-2222': { period: ['2024-01-01', '2025-12-31'], account: ACCOUNT_A },
      'mirae-general-transactions-20230101-20261011-3333': { period: ['2023-01-01', '2026-10-11'], account: ACCOUNT_B },
    },
    [],
    GENERAL_MAP(ACCOUNT_A, ACCOUNT_B)
  )
  assert.equal(result.read.length, 2)
  assert.deepEqual(result.findings, [])
})

test('a mapped number of another kind in a general series is still an account-mismatch', () => {
  const result = plan(
    {
      'mirae-general-transactions-2024-2025-2222': { period: ['2024-01-01', '2025-12-31'], account: ACCOUNT_A },
      'mirae-general-transactions-20230101-20261011-3333': { period: ['2023-01-01', '2026-10-11'], account: ACCOUNT_B },
    },
    [],
    { ...GENERAL_MAP(ACCOUNT_A), bankAccounts: [{ institution: 'mirae', kind: 'cma', accountNumber: ACCOUNT_B, alias: '예시 CMA' }] }
  )
  assert.deepEqual(result.findings, ['account-mismatch'])
})

test('containment still drops the shorter statement, and a statement with no printed number is compared as before', () => {
  const result = plan({
    'toss-transactions-20260715': { period: ['2026-01-01', '2026-07-15'], account: null },
    'toss-transactions-20260801': { period: ['2026-01-01', '2026-08-01'], account: ACCOUNT_A },
  })
  assert.deepEqual(result.read, ['toss-transactions-20260801'])
})

test('the parts of one multi-part export are one document, not an overlap', () => {
  const result = plan(
    {
      'toss-transactions-2023-1of2': { period: ['2023-01-01', '2023-12-31'], account: ACCOUNT_A },
      'toss-transactions-2023-2of2': { period: ['2023-01-01', '2023-12-31'], account: ACCOUNT_A },
    },
    [['toss-transactions-2023-2of2', '2023-06-01']]
  )
  assert.deepEqual(result.read.sort(), ['toss-transactions-2023-1of2', 'toss-transactions-2023-2of2'])
  assert.equal(result.cedes['toss-transactions-2023-2of2@2023-06-01'], false)
})

// --- the ingest side: an account mismatch fails the refresh, it is not a note ---

function ingestChecks(findings: Record<string, unknown>[]) {
  const dir = mkdtempSync(path.join(tmpdir(), 'kr-blocking-'))
  writeSheetPayloads(dir)
  const kr = path.join(dir, 'kr-statements')
  mkdirSync(kr, { recursive: true })
  const header = (cols: string) => cols.split(',').join('\t') + '\n'
  writeFileSync(
    path.join(kr, 'transactions.tsv'),
    header('Date,Account,Type,Raw Type,Ticker,Name,Quantity,Currency,Native Amount,FX Rate,Amount (KRW),Settlement (KRW),Unit Price,Fee,Tax,Balance,Source,Page'),
    'utf8'
  )
  writeFileSync(
    path.join(kr, 'dividends.tsv'),
    header('Date,Account,Symbol,Name,Currency,Native Amount,FX Rate,Amount (KRW),Type,Source,Page'),
    'utf8'
  )
  writeFileSync(
    path.join(kr, 'extract-report.json'),
    JSON.stringify({ generatedAt: '2026-10-10T00:00:00Z', findings, lockedStatements: [] }),
    'utf8'
  )
  const db = new Database(runIngest(dir, { env: { STOCK_KR_STATEMENTS_DIR: kr }, allowFailure: true }), { readonly: true })
  const get = (name: string) =>
    db.prepare('select status, severity, detail from validation_checks where name = ?').get(name) as
      | { status: string; severity: string; detail: string }
      | undefined
  return { series: get('kr_statements_one_account_per_series'), notes: get('kr_statement_parse_notes') }
}

test('an account mismatch from the extractor fails an ERROR check instead of joining the notes', () => {
  assert.equal(ingestChecks([]).series?.status, 'pass')

  const { series, notes } = ingestChecks([
    {
      kind: 'account-mismatch',
      rows: 1,
      distinct: 1,
      drops_rows: false,
      blocking: true,
      samples: ['mirae-general-transactions-2024-2025-2222 and mirae-general-transactions-20230101-20261011-3333 share a filename series but print different 계좌번호'],
    },
  ])
  assert.equal(series?.status, 'fail')
  assert.equal(series?.severity, 'error')
  assert.match(String(series?.detail), /account-mismatch: mirae-general-transactions-2024-2025-2222/)
  assert.equal(notes?.status, 'pass', 'a blocking finding is not also listed as a note')
})
