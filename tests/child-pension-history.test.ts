import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { config } from '@/config'
import { replayPensionHistory } from '../scripts/pension-replay.mjs'
import { runIngest } from './ingest-harness'
import { CHILD_OWNER, CHILD_PENSION, writeScenario } from './pension-fixtures'

// A child's 연금저축 certificate carries its history from the first deposit, and
// the trend shows it before the snapshot: the trades replayed and valued at each
// day's close, or failing a price history, the cumulative net contributions.
// Both are flagged derived; the maintainer's own figures do not move. Every
// account, label and amount here is invented; the repository is public.

function scenario(options: { withChildren: boolean; childHistory?: boolean; childPrices?: boolean; childBuyUnits?: number }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'child-history-'))
  const env = writeScenario(dir, { withPensions: true, ...options })
  return { dbPath: runIngest(dir, { env, allowFailure: true }), mapPath: env.STOCK_ACCOUNT_MAP_PATH }
}

const without = scenario({ withChildren: false })
const replayed = scenario({ withChildren: true, childHistory: true })
const unpriced = scenario({ withChildren: true, childHistory: true, childPrices: false })
const shortUnits = scenario({ withChildren: true, childHistory: true, childBuyUnits: 4 })

async function adapter(which: { dbPath: string; mapPath: string }) {
  config.stockDbPath = which.dbPath
  config.stockAccountMapPath = which.mapPath
  return import('../lib/adapters/portfolio-db')
}

test('the child history is replayed from the certificate and meets the snapshot', () => {
  const db = new Database(replayed.dbPath, { readonly: true })
  const points = db
    .prepare('select date, value_krw as v, derivation from pension_points where account = ? order by date')
    .all(CHILD_PENSION) as { date: string; v: number; derivation: string | null }[]
  assert.deepEqual(points, [
    { date: '2026-04-01', v: 160_000, derivation: 'replay' },
    // 5 x 30,000 + (160,000 - 150,000 - 100) cash
    { date: '2026-04-02', v: 159_900, derivation: 'replay' },
    // 5 x 32,000 + 20,000
    { date: '2026-06-01', v: 180_000, derivation: 'replay' },
    { date: '2026-10-07', v: 190_000, derivation: 'replay' },
    { date: '2026-10-08', v: 190_000, derivation: null },
  ])
  const flows = db.prepare('select owner, kind, amount_krw as amount from pension_flows where account = ?').all(CHILD_PENSION)
  assert.deepEqual(flows, [{ owner: CHILD_OWNER, kind: 'contribution', amount: 160_000 }])
  const check = db.prepare("select status, detail from validation_checks where name = 'pension_history_replay'").get() as { status: string; detail: string }
  assert.equal(check.status, 'pass', check.detail)
  assert.match(check.detail, /units and cash agree/)
  // Only the child's account is replayed: the maintainer's IRP (trust products)
  // and 삼성 연금저축 (untickered funds) keep no derived point.
  const derivedAccounts = db.prepare('select distinct account from pension_points where derivation is not null').all()
  assert.deepEqual(derivedAccounts, [{ account: CHILD_PENSION }])
  db.close()
})

test('a replay that leaves different units from the snapshot is a warning that names the ETF', () => {
  const db = new Database(shortUnits.dbPath, { readonly: true })
  const check = db.prepare("select status, severity, detail from validation_checks where name = 'pension_history_replay'").get() as { status: string; severity: string; detail: string }
  assert.equal(check.status, 'fail')
  assert.equal(check.severity, 'warning')
  assert.match(check.detail, /069500 replay 4 vs snapshot 5/)
  db.close()
})

test('without a price history the child history falls back to net contributions, flagged', () => {
  const db = new Database(unpriced.dbPath, { readonly: true })
  const points = db
    .prepare('select date, value_krw as v, derivation from pension_points where account = ? order by date')
    .all(CHILD_PENSION) as { date: string; v: number; derivation: string | null }[]
  assert.deepEqual(points, [
    { date: '2026-04-01', v: 160_000, derivation: 'contributions' },
    { date: '2026-10-08', v: 190_000, derivation: null },
  ])
  const check = db.prepare("select status, detail from validation_checks where name = 'pension_history_replay'").get() as { status: string; detail: string }
  assert.equal(check.status, 'pass')
  assert.match(check.detail, /cumulative net contributions/)
  db.close()
})

test('the child series starts at the first deposit, and the owner says how it was derived', async () => {
  const kids = await adapter(replayed)
  const children = kids.getChildAssets(['2026-03-31', '2026-04-01', '2026-06-15', '2026-10-08'])
  assert.deepEqual(children.points.map((point) => point.total), [null, 160_000, 180_000, 190_000])
  const owner = children.owners.find((entry) => entry.owner === CHILD_OWNER)!
  assert.equal(owner.derivation, 'replay')
  assert.equal(owner.derivedFrom, '2026-04-01')
  assert.equal(owner.derivedUntil, '2026-10-07')

  const fallback = await adapter(unpriced)
  assert.equal(fallback.getChildAssets(['2026-04-01']).owners[0].derivation, 'contributions')
})

test('self totals, the trend, FBAR, stock pages and stock checks are unchanged by the child history', async () => {
  const base = await adapter(without)
  const beforeWorth = base.getNetWorth()
  const beforeSeries = base.getTotalAssetsSeries(['2026-03-31', '2026-04-02', '2026-06-01', '2026-10-07'], beforeWorth)
  const beforeFbar = base.getForeignAccountMaxima(2026)
  const beforeOverview = base.getOverview().totals
  const beforeChecks = base.getValidationChecks().map((check) => [check.name, check.status])
  const beforeTaxLots = base.getTaxPlanningLots()

  const kids = await adapter(replayed)
  const worth = kids.getNetWorth()
  assert.equal(worth.totalKrw, beforeWorth.totalKrw)
  assert.deepEqual(worth.byClass, beforeWorth.byClass)
  const series = kids.getTotalAssetsSeries(['2026-03-31', '2026-04-02', '2026-06-01', '2026-10-07'], worth)
  assert.deepEqual(series.points.slice(0, -1), beforeSeries.points.slice(0, -1))
  assert.deepEqual(kids.getForeignAccountMaxima(2026).rows, beforeFbar.rows)
  assert.deepEqual(kids.getOverview().totals, beforeOverview)
  assert.ok(!kids.getHoldings().some((row) => row.account === CHILD_PENSION))
  assert.deepEqual(kids.getTaxPlanningLots(), beforeTaxLots)
  assert.ok(!JSON.stringify(kids.getPortfolioReview()).includes(CHILD_PENSION))
  const checks = kids.getValidationChecks()
  assert.deepEqual(
    checks.filter((check) => !check.name.startsWith('pension_')).map((check) => [check.name, check.status]),
    beforeChecks.filter(([name]) => !String(name).startsWith('pension_'))
  )
  for (const check of checks.filter((check) => !check.name.startsWith('pension_'))) {
    assert.ok(!String(check.detail ?? '').includes(CHILD_PENSION), `${check.name} names the child account`)
  }
})

test('the replay leaves alone what it cannot value, and prefers the printed cash', () => {
  const prices = new Map([['111111', [{ date: '2026-01-02', close: 1000 }]]])
  const deposit = { date: '2026-01-01', type: 'DEPOSIT', amount_krw: 5000 }
  const buy = { date: '2026-01-02', type: 'BUY', ticker: '111111', quantity: 3, amount_krw: 3000, fee: 0 }
  // An IRP's trust product: no derived point.
  assert.equal(replayPensionHistory({ rows: [deposit, { date: '2026-01-02', type: 'TRUST_OUT', amount_krw: 5000 }], firstPointDate: '2026-02-01', prices }).method, null)
  // A fund with no ticker: no derived point.
  assert.equal(replayPensionHistory({ rows: [deposit, { ...buy, ticker: '' }], firstPointDate: '2026-02-01', prices }).method, null)
  // Nothing before the first point: nothing to derive.
  assert.equal(replayPensionHistory({ rows: [{ ...deposit, date: '2026-03-01' }], firstPointDate: '2026-02-01', prices }).method, null)
  // The won balance the statement prints wins over the running sum.
  const printed = replayPensionHistory({ rows: [deposit, buy], firstPointDate: '2026-02-01', prices, cash: [{ date: '2026-01-02', balance: 1500 }] })
  assert.equal(printed.method, 'replay')
  assert.deepEqual(printed.points, [
    { date: '2026-01-01', value: 5000 },
    { date: '2026-01-02', value: 4500 },
  ])
  assert.deepEqual([...printed.atFirstPoint!.quantities], [['111111', 3]])
})

// The extractor side: the children's certificates are found, opened with the
// map's per-account password and typed as pension contributions. No PDF is read;
// the harness calls the helpers with an invented map.
const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const PY = process.env.STOCK_PYTHON_BIN || 'python3'
const HARNESS = `
import importlib.util, json, sys, types
from pathlib import Path
sys.modules.setdefault("pdfplumber", types.ModuleType("pdfplumber"))
spec = importlib.util.spec_from_file_location("kr_extract", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
account_map = json.loads(sys.argv[3])
print(json.dumps({
    "paths": [p.name for p in mod.mirae_statement_paths(Path(sys.argv[2]))],
    "types": {label: types for label, types in mod.account_type_map(account_map).items()},
    "passwords": len(mod.mirae_accounts.pdf_passwords(account_map)),
}))
`

test('the extractor reads the children’s certificates and types a 계좌대체입금 as a contribution', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'child-extract-'))
  const statements = path.join(dir, 'kr-statements')
  mkdirSync(statements)
  for (const name of [
    'mirae-isa-transactions-2025.pdf',
    'child-example-pension-savings-mirae-transactions-20240101-20261008.pdf',
    'child-example-pension-savings-holdings-20261008.csv',
    'toss-transactions-2025.pdf',
  ]) {
    writeFileSync(path.join(statements, name), '', 'utf8')
  }
  const map = {
    pensionAccounts: [
      { token: 'child-example-pension-savings', account: CHILD_PENSION, wrapper: 'pension_savings', institution: '미래에셋증권', accountNumber: '900-0000-0000-1', owner: CHILD_OWNER, pdfPassword: 'invented' },
    ],
  }
  const harness = path.join(dir, 'harness.py')
  writeFileSync(harness, HARNESS, 'utf8')
  const out = execFileSync(PY, [harness, path.join(REPO_ROOT, 'scripts/extract-kr-statements.py'), statements, JSON.stringify(map)], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const result = JSON.parse(out.trim().split('\n').at(-1) ?? '') as { paths: string[]; types: Record<string, Record<string, string>>; passwords: number }
  assert.deepEqual(result.paths, ['child-example-pension-savings-mirae-transactions-20240101-20261008.pdf', 'mirae-isa-transactions-2025.pdf'])
  assert.equal(result.types[CHILD_PENSION]?.['계좌대체입금'], 'DEPOSIT')
  assert.equal(result.types['미래에셋증권(IRP)']?.['계좌대체입금'], 'DEPOSIT')
  assert.equal(result.passwords, 1)
})
