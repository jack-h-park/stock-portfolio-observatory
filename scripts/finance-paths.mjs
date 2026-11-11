import path from 'node:path'

// This allowlist is also the private-mode inference contract. Operational flags
// and public example paths must never select private mode by their prefix alone.
export const FINANCE_FILES = Object.freeze({
  STOCK_DB_PATH: ['runtime', 'observatory.db'],
  STOCK_FX_RATES_PATH: ['runtime', 'fx-rates.json'],
  STOCK_KR_PRICES_PATH: ['runtime', 'kr-prices.json'],
  STOCK_US_PRICES_PATH: ['runtime', 'us-prices.json'],
  STOCK_GOLD_PRICES_PATH: ['runtime', 'gold-prices.json'],
  STOCK_HISTORICAL_PRICES_PATH: ['runtime', 'historical-prices.json'],
  STOCK_HISTORICAL_FX_RATES_PATH: ['runtime', 'historical-fx-rates.json'],
  STOCK_US_PDF_EVIDENCE_PATH: ['runtime', 'us-pdf-evidence.json'],
  STOCK_ROBINHOOD_SNAPSHOT_PATH: ['runtime', 'robinhood-snapshot.json'],
  STOCK_TOSS_SNAPSHOT_PATH: ['runtime', 'toss-snapshot.json'],
  STOCK_KR_STATEMENTS_DIR: ['runtime', 'kr-statements'],
  STOCK_CRYPTO_ACTIVITY_PATH: ['runtime', 'crypto-activity.json'],
  STOCK_CRYPTO_PRICES_PATH: ['runtime', 'crypto-prices.json'],
  STOCK_BANK_BALANCES_PATH: ['runtime', 'bank-balances.json'],
  STOCK_PENSION_EVIDENCE_PATH: ['runtime', 'pension-evidence.json'],
  STOCK_FX_LEDGER_PATH: ['runtime', 'fx-ledger.json'],
  STOCK_FX_RATE_OBSERVATIONS_PATH: ['state', 'fx-rate-observations.json'],
  STOCK_HANA_FX_SCREENSHOT_EVIDENCE_PATH: ['state', 'fx-hana-screenshot-evidence.json'],
  STOCK_REFRESH_RUNS_PATH: ['runtime', 'refresh-runs.json'],
  STOCK_REFRESH_LOCK_PATH: ['runtime', '.refresh.lock'],
  STOCK_MANUAL_MAPPINGS_PATH: ['state', 'manual-mappings.json'],
  STOCK_ACCOUNT_MAP_PATH: ['state', 'accounts.local.json'],
  STOCK_ASSET_EVENT_LABELS_PATH: ['state', 'asset-event-labels.local.json'],
  STOCK_TAX_POLICY_PATH: ['state', 'tax-policy.json'],
  STOCK_TAX_PLANS_PATH: ['state', 'tax-plans.json'],
  STOCK_REBALANCE_POLICY_PATH: ['state', 'rebalance-policy.json'],
  STOCK_ALLOCATION_POLICY_PATH: ['state', 'allocation-policy.json'],
  STOCK_INSTRUMENT_CLASSES_PATH: ['state', 'instrument-classes.json'],
  STOCK_REBALANCE_PROPOSALS_DIR: ['state', 'rebalance-proposals'],
  STOCK_REBALANCE_TRIGGER_STATE_PATH: ['state', 'rebalance-trigger-state.json'],
  STOCK_REBALANCE_NOTIFY_STATE_PATH: ['state', 'rebalance-notify-state.json'],
  STOCK_KR_SHEET_RECEIPT_PATH: ['runtime', 'kr-sheet-publish.json'],
  STOCK_US_SHEET_RECEIPT_PATH: ['runtime', 'us-sheet-publish.json'],
  STOCK_BRIEFING_SUMMARY_PATH: ['output', 'briefing-summary.json'],
  STOCK_BRIEFING_ARCHIVE_DIR: ['archive', 'briefing-archive'],
  STOCK_PENSION_DIR: ['records', 'pension'],
})
const text = (value) => typeof value === 'string' ? value.trim() : ''
const currentKey = (legacy) => legacy.replace(/^STOCK_/, 'FINANCE_')
const rootNames = ['FINANCE_RECORDS_DIR', 'FINANCE_TAX_DIR', 'FINANCE_STATE_DIR', 'FINANCE_RUNTIME_DIR', 'STOCK_DATA_DIR']
const privateNames = [...rootNames, ...Object.keys(FINANCE_FILES).flatMap(key => [key, currentKey(key)])]

export function resolveFinanceFile(env, { currentName, legacyName, fallback, cwd = process.cwd() }) {
  const current = text(env[currentName])
  const legacy = text(env[legacyName])
  const absolute = value => path.resolve(cwd, value)
  if (current && legacy && absolute(current) !== absolute(legacy)) {
    throw new Error(`Conflicting configuration: ${currentName} and ${legacyName}`)
  }
  return absolute(current || legacy || fallback)
}

export function resolveFinancePaths(env = process.env, cwd = process.cwd()) {
  const selected = text(env.FINANCE_MODE)
  if (selected && selected !== 'sample' && selected !== 'private') throw new Error('Invalid FINANCE_MODE')
  const hasPrivate = privateNames.some(key => text(env[key]))
  const mode = selected || (hasPrivate ? 'private' : 'sample')
  if (mode === 'sample' && hasPrivate) throw new Error('Sample mode refuses configured private roots or file overrides')
  const writable = text(env.FINANCE_STATE_WRITABLE)
  if (writable && writable !== '0' && writable !== '1') throw new Error('FINANCE_STATE_WRITABLE must be 0 or 1')
  const sample = path.resolve(cwd, 'private-data/personal-finance-sample')
  const recordsDir = mode === 'sample' ? path.join(sample, 'records') : resolveFinanceFile(env, {
    currentName: 'FINANCE_RECORDS_DIR', legacyName: 'STOCK_DATA_DIR', fallback: 'private-data', cwd,
  })
  const stateDir = mode === 'sample' ? path.join(sample, 'state') : path.resolve(cwd, text(env.FINANCE_STATE_DIR) || path.join(recordsDir, 'outputs/personal-finance-observatory/state'))
  const runtimeDir = mode === 'sample' ? path.join(sample, 'runtime') : path.resolve(cwd, text(env.FINANCE_RUNTIME_DIR) || path.join(recordsDir, 'outputs/personal-finance-observatory/runtime'))
  const taxDir = mode === 'sample' ? path.join(sample, 'tax') : text(env.FINANCE_TAX_DIR) ? path.resolve(cwd, text(env.FINANCE_TAX_DIR)) : null
  const dbPath = resolveFinanceFile(env, {
    currentName: 'FINANCE_DB_PATH', legacyName: 'STOCK_DB_PATH', cwd,
    fallback: mode === 'sample' ? path.join(runtimeDir, 'observatory.db') : text(env.FINANCE_RUNTIME_DIR)
      ? path.join(runtimeDir, 'observatory.db') : path.join(recordsDir, 'outputs/stock-portfolio-observatory/stock-portfolio-observatory.db'),
  })
  return { mode, recordsDir, taxDir, stateDir, runtimeDir, dbPath, stateWritable: mode === 'sample' ? true : writable === '1' }
}

export function financeFile(key, env = process.env, cwd = process.cwd()) {
  const roots = resolveFinancePaths(env, cwd)
  if (key === 'STOCK_DATA_DIR') return roots.recordsDir
  if (key === 'STOCK_DB_PATH') return roots.dbPath
  const spec = FINANCE_FILES[key]
  if (!spec) throw new Error(`Unknown finance file key: ${key}`)
  const [kind, basename] = spec
  let fallback
  if (roots.mode === 'sample' || (kind === 'state' && text(env.FINANCE_STATE_DIR)) ||
      (['runtime', 'output'].includes(kind) && text(env.FINANCE_RUNTIME_DIR))) {
    fallback = path.join(kind === 'state' ? roots.stateDir : roots.runtimeDir, basename)
  } else if (kind === 'records') fallback = path.join(roots.recordsDir, basename)
  else if (key === 'STOCK_FX_LEDGER_PATH') fallback = path.join(roots.recordsDir, 'outputs/stock-portfolio-observatory', basename)
  else if (kind === 'archive') fallback = path.resolve(cwd, 'private-data', basename)
  else if (kind === 'output') fallback = path.resolve(cwd, 'private-data/outputs/stock-portfolio-observatory', basename)
  else if (key === 'STOCK_REFRESH_LOCK_PATH') fallback = path.resolve(cwd, '.refresh.lock')
  else fallback = path.resolve(cwd, 'data', basename)
  if (roots.mode === 'sample' && kind === 'records') fallback = path.join(roots.recordsDir, basename)
  return resolveFinanceFile(env, { currentName: currentKey(key), legacyName: key, fallback, cwd })
}

// Python entry points retain their existing environment interface. Do not mutate
// process.env: subprocess inheritance must not turn a later sample resolution private.
export function financeEnvironment(env = process.env, cwd = process.cwd()) {
  const roots = resolveFinancePaths(env, cwd)
  return { ...env, FINANCE_MODE: 'private', STOCK_DATA_DIR: roots.recordsDir,
    ...Object.fromEntries(Object.keys(FINANCE_FILES).map(key => [key, financeFile(key, env, cwd)])) }
}
