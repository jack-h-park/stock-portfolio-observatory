import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { REPO_ROOT, ingestEnv, runIngestWithOutput } from './ingest-harness'
import { GOLD_PRICES, writeScenario } from './pension-fixtures'

// Freshness of the supplementary assets (deposits, pensions, physical gold and
// its price): how far each one's files reach, for the weekly reminder. Invented
// institutions, labels and account numbers throughout; the repository is public.

const daysAgo = (days: number) => {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

const dir = mkdtempSync(path.join(tmpdir(), 'supplementary-coverage-'))
const dbPath = path.join(dir, 'portfolio.db')
const mapPath = path.join(dir, 'accounts.local.json')

const db = new Database(dbPath)
db.exec(`
create table cash_balances (id integer primary key, institution text, account text, owner text, kind text, currency text, as_of_date text, balance real, source text, derived integer);
create table holdings_all (id integer primary key, account text, account_wrapper text, asset_class text, as_of_date text, base_market_value real);
create table transactions_all (id integer primary key, account text, account_wrapper text, asset_class text, type text, date text);
create table gold_prices (id integer primary key, date text, price real, source text);
create table validation_checks (id integer primary key, name text, status text, detail text, severity text, scope text);
`)
const cash = db.prepare('insert into cash_balances (institution, account, owner, kind, currency, as_of_date, balance, source, derived) values (?, ?, ?, ?, ?, ?, ?, ?, 0)')
cash.run('Example Bank', '••1234', 'self', 'deposit', 'KRW', daysAgo(200), 1, 'x')
cash.run('Example Bank', '••1234', 'self', 'deposit', 'KRW', daysAgo(100), 2, 'x')
cash.run('Sample Securities', 'CMA ••5678', 'self', 'cma', 'KRW', daysAgo(10), 3, 'x')
const holding = db.prepare('insert into holdings_all (account, account_wrapper, asset_class, as_of_date, base_market_value) values (?, ?, ?, ?, ?)')
holding.run('Sample(IRP)', 'irp', 'security', daysAgo(200), 1)
holding.run('Sample(IRP)', 'irp', 'security', daysAgo(200), 1)
holding.run('Sample(금현물)', 'taxable', 'gold', daysAgo(2), 1)
const transaction = db.prepare('insert into transactions_all (account, account_wrapper, asset_class, type, date) values (?, ?, ?, ?, ?)')
transaction.run('Sample(금현물)', 'taxable', 'gold', 'BUY', daysAgo(120))
transaction.run('Sample(금현물)', 'taxable', 'gold', 'FEE', daysAgo(30))
// Not gold: never the gold date.
transaction.run('Sample(종합)', 'taxable', 'security', 'BUY', daysAgo(1))
const price = db.prepare('insert into gold_prices (date, price, source) values (?, ?, ?)')
price.run(daysAgo(3), 1, 'x')
price.run(daysAgo(2), 1, 'x')
const checkRow = db.prepare("insert into validation_checks (name, status, detail, severity, scope) values (?, ?, '', 'warning', ?)")
checkRow.run('cash_balance_continuity', 'fail', 'supplementary')
checkRow.run('gold_priced', 'pass', 'supplementary')
checkRow.run('toss_positions_fresh', 'fail', 'stock')
db.close()

writeFileSync(
  mapPath,
  JSON.stringify({
    accounts: {},
    pensionAccounts: [
      { token: 'irp', account: 'Sample(IRP)', wrapper: 'irp', institution: 'Sample' },
      // Listed in the map, nothing filed yet.
      { token: 'pension-savings', account: 'Other(연금저축)', wrapper: 'pension_savings', institution: 'Other' },
    ],
  })
)

process.env.STOCK_DB_PATH = dbPath
process.env.STOCK_ACCOUNT_MAP_PATH = mapPath

test('one row per cash account, pension token, gold account and the gold price, each with its date, threshold and action', async () => {
  const { getSupplementaryCoverage } = await import('../lib/adapters/portfolio-db')
  const { rows, failingChecks } = getSupplementaryCoverage()
  const byLabel = Object.fromEntries(rows.map((row) => [row.label, row]))

  assert.deepEqual(byLabel['Example Bank ••1234'], {
    kind: 'deposit',
    label: 'Example Bank ••1234',
    latestDate: daysAgo(100),
    lagDays: 100,
    maxLagDays: 90,
    status: 'action_needed',
    action: `Example Bank ••1234 거래내역을 ${daysAgo(100)}부터 받아 inbox에 넣으세요`,
  })
  assert.equal(byLabel['Sample Securities CMA ••5678'].kind, 'cma')
  assert.equal(byLabel['Sample Securities CMA ••5678'].status, 'current')

  assert.deepEqual(byLabel['Sample(IRP)'], {
    kind: 'pension',
    label: 'Sample(IRP)',
    latestDate: daysAgo(200),
    lagDays: 200,
    maxLagDays: 180,
    status: 'action_needed',
    action: 'Sample(IRP) 보유 현황을 캡처해 pension/irp-holdings-YYYYMMDD.csv로 넣으세요',
  })
  assert.equal(byLabel['Other(연금저축)'].status, 'missing')
  assert.equal(byLabel['Other(연금저축)'].latestDate, null)
  assert.match(byLabel['Other(연금저축)'].action, /pension\/pension-savings-holdings-YYYYMMDD\.csv/)

  const gold = rows.find((row) => row.kind === 'gold')!
  assert.equal(gold.label, 'Sample(금현물)')
  assert.equal(gold.latestDate, daysAgo(30))
  assert.equal(gold.maxLagDays, 90)
  assert.equal(gold.status, 'current')
  assert.match(gold.action, /금현물/)

  const goldPrice = rows.find((row) => row.kind === 'gold_price')!
  assert.equal(goldPrice.latestDate, daysAgo(2))
  assert.equal(goldPrice.maxLagDays, 7)
  assert.equal(goldPrice.status, 'current')

  assert.equal(rows.length, 6)
  // Supplementary checks only.
  assert.deepEqual(failingChecks, ['cash_balance_continuity'])
})

test('an empty or older database gives no rows rather than an error', async () => {
  const empty = path.join(dir, 'empty.db')
  new Database(empty).close()
  const { config } = await import('@/config')
  const { getSupplementaryCoverage } = await import('../lib/adapters/portfolio-db')
  const saved = { db: config.stockDbPath, map: config.stockAccountMapPath }
  config.stockDbPath = empty
  config.stockAccountMapPath = path.join(dir, 'absent.json')
  try {
    assert.deepEqual(getSupplementaryCoverage(), { rows: [], failingChecks: [] })
  } finally {
    config.stockDbPath = saved.db
    config.stockAccountMapPath = saved.map
  }
})

// The same thing end to end: an ingest whose gold price is eight days old, then
// the summary written from it.
const scenarioDir = mkdtempSync(path.join(tmpdir(), 'supplementary-ingest-'))
const scenarioEnv = writeScenario(scenarioDir, { withPensions: true })
const stalePrice = daysAgo(8)
writeFileSync(
  path.join(scenarioDir, 'gold-prices.json'),
  JSON.stringify({ ...GOLD_PRICES, latest: { date: stalePrice, price: 160000 }, history: [{ date: stalePrice, price: 160000 }] })
)
const ingested = runIngestWithOutput(scenarioDir, { env: { ...scenarioEnv, STOCK_DB_PATH: path.join(scenarioDir, 'out.db') }, allowFailure: true })

test('gold_price_fresh fails, as a supplementary warning, when the gold price is eight days old', () => {
  const ro = new Database(ingested.dbPath, { readonly: true })
  const row = ro.prepare("select status, severity, scope, detail from validation_checks where name = 'gold_price_fresh'").get() as {
    status: string
    severity: string
    scope: string
    detail: string
  }
  ro.close()
  assert.equal(row.status, 'fail')
  assert.equal(row.severity, 'warning')
  assert.equal(row.scope, 'supplementary')
  assert.match(row.detail, new RegExp(stalePrice))
})

test('gold_price_fresh passes with a recent price, and with no gold holding at all', () => {
  const fresh = mkdtempSync(path.join(tmpdir(), 'supplementary-fresh-'))
  const env = writeScenario(fresh, { withPensions: true })
  writeFileSync(path.join(fresh, 'gold-prices.json'), JSON.stringify({ ...GOLD_PRICES, latest: { date: daysAgo(7), price: 160000 } }))
  const withGold = runIngestWithOutput(fresh, { env, allowFailure: true }).dbPath
  const noGold = mkdtempSync(path.join(tmpdir(), 'supplementary-nogold-'))
  const noGoldDb = runIngestWithOutput(noGold, { env: writeScenario(noGold, { withPensions: false }), allowFailure: true }).dbPath
  for (const file of [withGold, noGoldDb]) {
    const ro = new Database(file, { readonly: true })
    const row = ro.prepare("select status from validation_checks where name = 'gold_price_fresh'").get() as { status: string }
    ro.close()
    assert.equal(row.status, 'pass', file)
  }
})

test('the pension CSVs, the pension evidence and the gold price file are fingerprinted', () => {
  const ro = new Database(ingested.dbPath, { readonly: true })
  const names = (ro.prepare('select name from source_files').all() as { name: string }[]).map((row) => row.name)
  ro.close()
  assert.ok(names.includes('pension:irp-holdings-20261008.csv'), names.join(', '))
  assert.ok(names.includes('pension_evidence'), names.join(', '))
  assert.ok(names.includes('gold_prices'), names.join(', '))
})

test('the summary carries a supplementaryCoverage block of dates, labels and status, and no supplementary drift in health.issues', async () => {
  // Drift in every supplementary source after the ingest.
  writeFileSync(path.join(scenarioDir, 'gold-prices.json'), JSON.stringify({ ...GOLD_PRICES, fetchedAt: 'changed' }))
  writeFileSync(path.join(scenarioDir, 'pension-evidence.json'), JSON.stringify({ certificates: [], findings: ['changed'] }))
  writeFileSync(path.join(scenarioDir, 'pension', 'irp-holdings-20261008.csv'), 'type,name,ticker,quantity,cost_krw,value_krw\n')
  // The drift is real: /health sees it.
  const { config } = await import('@/config')
  const { getOperationalHealth } = await import('../lib/adapters/portfolio-db')
  const savedDb = config.stockDbPath
  config.stockDbPath = ingested.dbPath
  try {
    const drifted = getOperationalHealth().items.filter((item) => item.status === 'drift').map((item) => item.key)
    for (const key of ['source:gold_prices', 'source:pension_evidence', 'source:pension:irp-holdings-20261008.csv']) {
      assert.ok(drifted.includes(key), `${key} not in ${drifted.join(', ')}`)
    }
  } finally {
    config.stockDbPath = savedDb
  }
  const env = ingestEnv(scenarioDir, { ...scenarioEnv, STOCK_DB_PATH: ingested.dbPath })
  const out = execFileSync(process.execPath, ['--import', 'tsx', path.join(REPO_ROOT, 'scripts/write-briefing-summary.ts'), '--stdout'], {
    cwd: REPO_ROOT,
    env: env as NodeJS.ProcessEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const summary = JSON.parse(out)
  const block = summary.supplementaryCoverage
  assert.ok(block && Array.isArray(block.rows) && block.rows.length > 0, out.slice(0, 500))
  for (const row of block.rows) {
    assert.deepEqual(Object.keys(row).sort(), ['action', 'kind', 'label', 'lagDays', 'latestDate', 'maxLagDays', 'status'])
    // Only the two day counts are numbers; no amount, balance or value travels.
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'number') assert.ok(key === 'lagDays' || key === 'maxLagDays', key)
    }
  }
  assert.ok(block.failingChecks.includes('gold_price_fresh'))
  const issueKeys = summary.health.issues.map((issue: { key: string }) => issue.key)
  for (const key of issueKeys) {
    assert.ok(!/^source:(pension|gold_prices|bank_balances)/.test(key), key)
    assert.notEqual(key, 'validation:gold_price_fresh')
  }
})

test('/data-map keeps bank statements, pension snapshots and pension evidence as active originals, .xls included', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'supplementary-datamap-'))
  for (const sub of ['bank-statements', 'pension/evidence']) mkdirSync(path.join(dataDir, sub), { recursive: true })
  writeFileSync(path.join(dataDir, 'bank-statements', 'example-bank-20260101-20260630.xls'), 'x')
  writeFileSync(path.join(dataDir, 'pension', 'irp-holdings-20261001.csv'), 'x')
  writeFileSync(path.join(dataDir, 'pension', 'evidence', 'irp-balance-certificate-20251231.pdf'), 'x')
  const inventoryDb = path.join(dataDir, 'inventory.db')
  const conn = new Database(inventoryDb)
  conn.exec(`
create table meta (key text primary key, value text not null);
create table source_files (name text primary key, filename text not null, path text not null, bytes integer not null, mtime_ms integer not null, sha256 text not null, row_count integer not null);
`)
  conn.prepare("insert into meta (key, value) values ('data_dir', ?)").run(dataDir)
  conn.close()

  const { config } = await import('@/config')
  const { getSourceInventory } = await import('../lib/adapters/portfolio-db')
  const saved = config.stockDbPath
  config.stockDbPath = inventoryDb
  try {
    const byPath = Object.fromEntries(getSourceInventory().items.map((item) => [item.relativePath, item]))
    for (const rel of [
      'bank-statements/example-bank-20260101-20260630.xls',
      'pension/irp-holdings-20261001.csv',
      'pension/evidence/irp-balance-certificate-20251231.pdf',
    ]) {
      assert.ok(byPath[rel], `${rel} not discovered: ${Object.keys(byPath).join(', ')}`)
      assert.equal(byPath[rel].retention, 'active', rel)
    }
    assert.notEqual(
      byPath['pension/evidence/irp-balance-certificate-20251231.pdf'].retentionReason,
      byPath['pension/irp-holdings-20261001.csv'].retentionReason
    )
  } finally {
    config.stockDbPath = saved
  }
})
