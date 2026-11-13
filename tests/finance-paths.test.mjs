import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveFinancePaths, resolveFinanceFile, financeFile, financeEnvironment } from '../scripts/finance-paths.mjs'

const cwd = '/synthetic/workspace'
test('connector roots select private mode and cannot leak into samples', () => {
  for (const key of ['FINANCE_CONNECTOR_EXPORT_DIR', 'STOCK_CONNECTOR_EXPORT_DIR', 'FINANCE_CONNECTOR_RECORDS_DIR']) {
    assert.equal(resolveFinancePaths({ [key]: '/private/connector' }, cwd).mode, 'private')
    assert.throws(() => resolveFinancePaths({ FINANCE_MODE: 'sample', [key]: '/private/connector' }, cwd), /sample/i)
  }
})
test('fresh and operational-flag-only environments use isolated samples', () => {
  for (const env of [{}, { STOCK_ALLOW_NO_ACCOUNT_MAP: '1' }]) {
    assert.deepEqual(resolveFinancePaths(env, cwd), {
      mode: 'sample',
      recordsDir: `${cwd}/private-data/personal-finance-sample/records`,
      taxDir: `${cwd}/private-data/personal-finance-sample/tax`,
      stateDir: `${cwd}/private-data/personal-finance-sample/state`,
      runtimeDir: `${cwd}/private-data/personal-finance-sample/runtime`,
      dbPath: `${cwd}/private-data/personal-finance-sample/runtime/observatory.db`,
      stateWritable: true,
    })
  }
})
test('legacy-only private roots preserve database and explicit file overrides', () => {
  const env = { STOCK_DATA_DIR: '/private/records', STOCK_FX_RATES_PATH: './custom/fx.json' }
  const p = resolveFinancePaths(env, cwd)
  assert.equal(p.mode, 'private')
  assert.equal(p.taxDir, null)
  assert.equal(p.dbPath, '/private/records/outputs/stock-portfolio-observatory/stock-portfolio-observatory.db')
  assert.equal(p.stateWritable, false)
  assert.equal(financeFile('STOCK_FX_RATES_PATH', env, cwd), `${cwd}/custom/fx.json`)
})
test('new roots do not override an explicit legacy file path', () => {
  const env = {
    FINANCE_RECORDS_DIR: '/new/records',
    FINANCE_RUNTIME_DIR: '/new/runtime',
    STOCK_DB_PATH: '/legacy/portfolio.db',
  }
  assert.equal(resolveFinancePaths(env, cwd).dbPath, '/legacy/portfolio.db')
  assert.equal(resolveFinancePaths(env, cwd).runtimeDir, '/new/runtime')
  assert.equal(financeFile('STOCK_DB_PATH', env, cwd), '/legacy/portfolio.db')
})
test('a runtime root never relocates pension source files or briefing archives', () => {
  const env = { FINANCE_RECORDS_DIR: '/records', FINANCE_RUNTIME_DIR: '/runtime' }
  assert.equal(financeFile('STOCK_PENSION_DIR', env, cwd), '/records/pension')
  assert.equal(financeFile('STOCK_BRIEFING_ARCHIVE_DIR', env, cwd), `${cwd}/private-data/briefing-archive`)
  assert.equal(financeFile('STOCK_US_SHEET_RECEIPT_PATH', env, cwd), '/runtime/us-sheet-publish.json')
})
test('equivalent aliases normalize relative paths and reject conflicts without values', () => {
  assert.equal(
    resolveFinanceFile(
      { FINANCE_DB_PATH: './portfolio.db', STOCK_DB_PATH: `${cwd}/portfolio.db` },
      { currentName: 'FINANCE_DB_PATH', legacyName: 'STOCK_DB_PATH', fallback: 'fallback.db', cwd },
    ),
    `${cwd}/portfolio.db`,
  )
  assert.throws(
    () => resolveFinancePaths({ FINANCE_RECORDS_DIR: '/sensitive/new', STOCK_DATA_DIR: '/sensitive/old' }, cwd),
    (error) => {
      assert.match(error.message, /FINANCE_RECORDS_DIR.*STOCK_DATA_DIR/)
      assert.doesNotMatch(error.message, /sensitive/)
      return true
    },
  )
  assert.equal(
    resolveFinancePaths({ FINANCE_RECORDS_DIR: ' ', STOCK_DATA_DIR: './records' }, cwd).recordsDir,
    `${cwd}/records`,
  )
})
test('invalid mode and private overrides cannot enter sample mode', () => {
  assert.throws(() => resolveFinancePaths({ FINANCE_MODE: 'invalid' }, cwd), /FINANCE_MODE/)
  for (const key of ['STOCK_DB_PATH', 'STOCK_DATA_DIR', 'FINANCE_STATE_DIR', 'FINANCE_FX_RATES_PATH']) {
    assert.throws(() => resolveFinancePaths({ FINANCE_MODE: 'sample', [key]: '/private/untouched' }, cwd), /sample/i)
  }
})
test('write authority requires an explicit valid setting privately', () => {
  assert.equal(resolveFinancePaths({ FINANCE_MODE: 'private', FINANCE_STATE_WRITABLE: '1' }, cwd).stateWritable, true)
  assert.equal(resolveFinancePaths({ FINANCE_MODE: 'private', FINANCE_STATE_WRITABLE: '0' }, cwd).stateWritable, false)
  assert.throws(() => resolveFinancePaths({ FINANCE_STATE_WRITABLE: 'yes' }, cwd), /FINANCE_STATE_WRITABLE/)
})
test('Python handoff carries resolved paths without mutating the caller', () => {
  const env = {
    FINANCE_RECORDS_DIR: '/records',
    FINANCE_TAX_DIR: '/tax',
    FINANCE_BANK_BALANCES_PATH: '/runtime/banks.json',
    STOCK_ALLOW_NO_ACCOUNT_MAP: '1',
  }
  const handoff = financeEnvironment(env, cwd)
  assert.equal(handoff.STOCK_DATA_DIR, '/records')
  assert.equal(handoff.STOCK_BANK_BALANCES_PATH, '/runtime/banks.json')
  assert.equal(handoff.STOCK_ALLOW_NO_ACCOUNT_MAP, '1')
  assert.equal(env.STOCK_DATA_DIR, undefined)
})
