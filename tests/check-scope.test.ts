import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { config } from '@/config'
import type { TaxPolicy } from '@/lib/tax-policy'
import { runIngestWithOutput } from './ingest-harness'
import { writeScenario } from './pension-fixtures'

// Supplementary data (deposits, pensions, physical gold) is checked like
// everything else, but its checks carry scope 'supplementary' and stay off the
// stock surfaces: the printed `Validation:` line the refresh cron greps, and the
// Overview's failed-check count. Invented fixtures throughout; the repository is
// public.

function validationLine(stdout: string, label: 'Validation' | 'Supplementary') {
  return stdout.split('\n').find((line) => line.startsWith(`${label}: `))
}

function ingestPair() {
  const dir = mkdtempSync(path.join(tmpdir(), 'check-scope-'))
  const baseEnv = writeScenario(dir, { withPensions: false })
  const base = runIngestWithOutput(dir, { env: { ...baseEnv, STOCK_DB_PATH: path.join(dir, 'base.db') }, allowFailure: true })
  // The pension and gold inputs, with the gold price file pointed at nothing:
  // gold_priced fails.
  const fullEnv = writeScenario(dir, { withPensions: true })
  const full = runIngestWithOutput(dir, {
    env: {
      ...fullEnv,
      STOCK_GOLD_PRICES_PATH: path.join(dir, 'absent', 'gold-prices.json'),
      STOCK_DB_PATH: path.join(dir, 'full.db'),
    },
    allowFailure: true,
  })
  return { dir, base, full }
}

const pair = ingestPair()

test('a failing supplementary check is stored with its scope and kept off the Validation line', async () => {
  const { base, full } = pair
  const ro = new Database(full.dbPath, { readonly: true })
  const gold = ro.prepare("select status, scope from validation_checks where name = 'gold_priced'").get() as {
    status: string
    scope: string
  }
  const guards = ro
    .prepare("select name, scope from validation_checks where name in ('wrapper_assigned', 'non_stock_wrappers_absent') order by name")
    .all()
  ro.close()
  assert.deepEqual(gold, { status: 'fail', scope: 'supplementary' })
  // The two checks that guard the stock view stay stock.
  assert.deepEqual(guards, [
    { name: 'non_stock_wrappers_absent', scope: 'stock' },
    { name: 'wrapper_assigned', scope: 'stock' },
  ])

  const baseLine = validationLine(base.stdout, 'Validation')
  assert.ok(baseLine, base.stdout)
  assert.equal(validationLine(full.stdout, 'Validation'), baseLine)

  const supplementary = validationLine(full.stdout, 'Supplementary')
  assert.ok(supplementary, full.stdout)
  const [passing, total] = supplementary!.match(/(\d+)\/(\d+)/)!.slice(1).map(Number)
  assert.ok(total > 0 && passing < total, supplementary)

  const { getOverview } = await import('../lib/adapters/portfolio-db')
  config.stockDbPath = base.dbPath
  const baseFailed = getOverview().failedChecks
  config.stockDbPath = full.dbPath
  assert.equal(getOverview().failedChecks, baseFailed)
})

test('getValidationChecks reads the scope, and defaults it to stock on an older database', async () => {
  const { dir, full } = pair
  const { getValidationChecks } = await import('../lib/adapters/portfolio-db')
  config.stockDbPath = full.dbPath
  const rows = getValidationChecks()
  assert.equal(rows.find((row) => row.name === 'gold_priced')?.scope, 'supplementary')
  assert.equal(rows.find((row) => row.name === 'wrapper_assigned')?.scope, 'stock')

  const oldPath = path.join(dir, 'old.db')
  const old = new Database(oldPath)
  old.exec(`create table validation_checks (id integer primary key, name text not null, status text not null, detail text not null, severity text not null);
    insert into validation_checks (name, status, detail, severity) values ('x', 'pass', 'ok', 'error');`)
  old.close()
  config.stockDbPath = oldPath
  assert.deepEqual(
    getValidationChecks().map((row) => row.scope),
    ['stock']
  )
})

test('getTaxPlanningLots follows the US treatment of isa: undecided removes the ISA lots', async () => {
  const { base } = pair
  const rw = new Database(base.dbPath)
  rw.prepare(
    `insert into tax_lots_all (market, currency, base_currency, fx_rate_to_base, brokerage, account, ticker, name,
       acquired_date, open_quantity, native_cost_basis, native_market_value, native_unrealized_gl, cost_basis_krw,
       holding_days, tax_term, asset_class, account_wrapper, owner)
     values ('KR', 'KRW', 'KRW', 1, 'Example Securities', 'Example Securities(ISA)', '069500', 'Example 200 ETF', '2025-01-02', 5, 150000,
       180000, 30000, 150000, 600, 'Long-term', 'security', 'isa', 'self')`
  ).run()
  rw.close()

  const { getTaxPlanningLots } = await import('../lib/adapters/portfolio-db')
  config.stockDbPath = base.dbPath
  const policy = (us: Record<string, string> = {}) =>
    ({ version: 3, activeScenario: 'US_ONLY', baseCurrency: 'KRW', jurisdictions: [], manualAdjustments: [], wrapperTreatment: { US: us } }) as unknown as TaxPolicy
  const taxable = getTaxPlanningLots(5000, policy())
  assert.equal(taxable.filter((row) => row.account_wrapper === 'isa').length, 1)
  const undecided = getTaxPlanningLots(5000, policy({ isa: 'undecided' }))
  assert.equal(undecided.filter((row) => row.account_wrapper === 'isa').length, 0)
  assert.equal(undecided.length, taxable.length - 1)
})

test('hasSupplementaryAssets: false on a stock-only database, true once a cash balance is filed', async () => {
  const { base } = pair
  const { hasSupplementaryAssets } = await import('../lib/adapters/portfolio-db')
  config.stockDbPath = base.dbPath
  assert.equal(hasSupplementaryAssets(), false)
  const rw = new Database(base.dbPath)
  rw.prepare(
    `insert into cash_balances (institution, account, kind, currency, as_of_date, balance, source)
     values ('Example Bank', 'Example Bank 0000', 'deposit', 'KRW', '2026-09-30', 1000000, 'example.pdf')`
  ).run()
  rw.close()
  assert.equal(hasSupplementaryAssets(), true)
})

test('hasSupplementaryAssets: true when holdings_all holds a pension or gold row', async () => {
  const { full } = pair
  const { hasSupplementaryAssets } = await import('../lib/adapters/portfolio-db')
  config.stockDbPath = full.dbPath
  assert.equal(hasSupplementaryAssets(), true)
})
