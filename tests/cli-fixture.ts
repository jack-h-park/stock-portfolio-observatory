import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { REPO_ROOT, runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

/**
 * A scratch database and policy for the read-only CLIs, with SYNTHETIC tickers
 * and amounts only. The schema is the real one (the ingest builds it from empty
 * payloads); the rows are inserted afterwards, so each figure a test asserts is
 * one it can derive by hand from the numbers below.
 *
 * The as-of day is 2026-06-15, a Monday.
 */
export const AS_OF = '2026-06-15'

/** USD/KRW: acquisition-date rates are on the lots; these are the sale-date rates. */
export const FX = [
  { price_date: '2025-01-02', rate: 1100 },
  { price_date: '2026-06-12', rate: 1300 },
  { price_date: '2026-06-30', rate: 1350 },
]

/** Today's rate on the lots (fx_rate_to_base), deliberately not a sale-date rate. */
export const LOT_RATE_TODAY = 1400

export const LOTS = [
  // Long-term gain. Acquisition-date rate 1100.
  { ticker: 'AAA', acquired: '2025-01-10', qty: 10, basis: 1000, value: 2000, acqKrw: 1_100_000 },
  // Short-term loss, long-term on 2027-01-21.
  { ticker: 'BBB', acquired: '2026-01-20', qty: 5, basis: 1500, value: 1000, acqKrw: 2_175_000 },
  // Short-term gain, long-term on 2026-09-02.
  { ticker: 'CCC', acquired: '2025-09-01', qty: 20, basis: 2000, value: 3000, acqKrw: 2_780_000 },
  // Long-term loss.
  { ticker: 'DDD', acquired: '2025-02-01', qty: 8, basis: 4000, value: 3200, acqKrw: 5_800_000 },
]

export const TAXABLE = 'Example Taxable'
export const CASH = 'Example Cash'

export type Fixture = {
  dir: string
  dbPath: string
  policyPath: string
  accountMapPath: string
  summaryPath: string
  lockPath: string
  env: Record<string, string>
}

function policy() {
  const example = JSON.parse(readFileSync(path.join(REPO_ROOT, 'data/tax-policy.example.json'), 'utf8'))
  for (const jurisdiction of example.jurisdictions) {
    if (jurisdiction.code === 'US') {
      Object.assign(jurisdiction.manualAssumptions, {
        filingStatus: 'MFJ',
        stateCode: 'NONE',
        stateRatePct: 0,
        wageBaseYear: 2026,
        wageBaseUsd: 300_000,
        annualIncomeGrowthPct: 0,
        taxInputYear: 2026,
        planningUsdKrwRate: null,
        // Gains already realized this year, so a harvested loss has something to offset.
        ytdRealizedShortGainLossUsd: 3000,
        ytdRealizedLongGainLossUsd: 1000,
      })
    }
    if (jurisdiction.code === 'KR') {
      Object.assign(jurisdiction.manualAssumptions, { foreignTaxCreditMode: 'estimated-us-source', ytdRealizedTaxableGainKrw: 4_000_000 })
    }
  }
  return example
}

/** Build the fixture. `accountMap: false` leaves the map out (settlement then reads unavailable). */
export function buildCliFixture({ accountMap = true }: { accountMap?: boolean } = {}): Fixture {
  const dir = mkdtempSync(path.join(tmpdir(), 'observatory-cli-'))
  writeSheetPayloads(dir)
  const dbPath = runIngest(dir, { allowFailure: true })

  const db = new Database(dbPath)
  for (const table of ['tax_lots_all', 'holdings_all', 'realized_lots_all', 'transactions_all', 'historical_fx_rates']) {
    db.prepare(`delete from ${table}`).run()
  }
  const fx = db.prepare('insert into historical_fx_rates (price_date, rate, source) values (?, ?, ?)')
  for (const row of FX) fx.run(row.price_date, row.rate, 'fixture')

  const lot = db.prepare(
    `insert into tax_lots_all (market, currency, base_currency, fx_rate_to_base, brokerage, account, ticker, name, acquired_date,
       open_quantity, native_cost_basis, native_market_value, native_unrealized_gl, cost_basis_krw, acquisition_cost_krw,
       acquisition_cost_usd, holding_days, tax_term, account_wrapper, asset_class)
     values ('US', 'USD', 'KRW', ?, 'Example Broker', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, null, 'taxable', 'security')`
  )
  for (const l of LOTS) {
    lot.run(LOT_RATE_TODAY, TAXABLE, l.ticker, `Synthetic ${l.ticker}`, l.acquired, l.qty, l.basis, l.value, l.value - l.basis, l.basis * LOT_RATE_TODAY, l.acqKrw, l.basis)
  }

  const realized = db.prepare(
    `insert into realized_lots_all (market, currency, base_currency, brokerage, account, ticker, name, acquired_date, sold_date,
       quantity_sold, native_cost_basis, native_proceeds, native_realized_gl, tax_term, basis, superseded_by, account_wrapper, asset_class)
     values (?, ?, 'KRW', 'Example Broker', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'taxable', 'security')`
  )
  // A loss sale whose wash-sale window is open on AS_OF.
  realized.run('US', 'USD', TAXABLE, 'EEE', 'Synthetic EEE', '2026-03-01', '2026-06-01', 3, 900, 600, -300, 'Short Term', 'replay', null)
  // A gain sale in range.
  realized.run('US', 'USD', TAXABLE, 'FFF', 'Synthetic FFF', '2025-01-05', '2026-02-10', 2, 100, 250, 150, 'Long Term', 'replay', null)
  // Superseded by a filed form: never listed.
  realized.run('US', 'USD', TAXABLE, 'FFF', 'Synthetic FFF', '2025-01-05', '2026-02-10', 2, 100, 250, 150, 'Long Term', 'replay', '1099b:2026')
  // A Korean sale: not a US security.
  realized.run('KR', 'KRW', 'Example KR Account', '000000', 'Synthetic KR', '2025-01-05', '2026-02-11', 1, 1000, 2000, 1000, null, 'replay', null)

  const tx = db.prepare(
    `insert into transactions_all (market, currency, base_currency, brokerage, date, account, type, ticker, name, quantity, placed_agent, account_wrapper, asset_class)
     values ('US', 'USD', 'KRW', 'Example Broker', ?, ?, ?, ?, ?, ?, ?, 'taxable', 'security')`
  )
  // A dividend reinvestment after the EEE loss sale: DRIP on, and a buy inside the window.
  tx.run('2026-06-05', TAXABLE, 'REINVEST', 'EEE', 'Synthetic EEE', 0.1, 'drip')
  // A cash-account sale on Friday settles Monday; a buy the same Friday is funded by it.
  tx.run('2026-06-12', CASH, 'SELL', 'GGG', 'Synthetic GGG', 4, 'user')
  tx.run('2026-06-12', CASH, 'BUY', 'HHH', 'Synthetic HHH', 2, 'user')
  // A buy on Monday, when the sale has settled: no constraint.
  tx.run(AS_OF, CASH, 'BUY', 'JJJ', 'Synthetic JJJ', 1, 'user')
  db.close()

  const policyPath = path.join(dir, 'tax-policy.json')
  writeFileSync(policyPath, `${JSON.stringify(policy(), null, 2)}\n`)
  const accountMapPath = path.join(dir, 'accounts.local.json')
  if (accountMap) {
    writeFileSync(accountMapPath, JSON.stringify({ accounts: { [CASH]: { wrapper: 'taxable', owner: 'self', cashAccount: true } } }))
  }

  // Sources on the receiving side, and the heartbeat of the last push.
  mkdirSync(path.join(dir, 'us-holdings'), { recursive: true })
  writeFileSync(path.join(dir, 'us-holdings', 'example-holdings-20260610.csv'), 'synthetic\n')
  mkdirSync(path.join(dir, 'bank-statements'), { recursive: true })
  writeFileSync(path.join(dir, 'bank-statements', 'example-checking-4321-20260501-20260531.pdf'), 'synthetic\n')
  writeFileSync(path.join(dir, '.push-sources-last-success'), '2026-06-15T10:00:00Z\n')

  const summaryPath = path.join(dir, 'briefing-summary.json')
  writeFileSync(
    summaryPath,
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: '2026-06-15T12:00:00Z',
      accountCoverage: {
        rows: [
          { brokerage: 'Example Broker', account: TAXABLE, status: 'action_needed', coveredThrough: '2026-04-30', lagDays: 46, maxLagDays: 35, downloadFrom: '2026-05-01', requiredArtifact: 'transactions CSV', method: 'inbox', destination: 'us-transactions/' },
          { brokerage: 'Example Broker', account: CASH, status: 'current', coveredThrough: '2026-06-12', lagDays: 3, maxLagDays: 35 },
        ],
      },
    })
  )

  const lockPath = path.join(dir, '.refresh.lock')
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith('STOCK_')) continue
    env[key] = value
  }
  Object.assign(env, {
    STOCK_DB_PATH: dbPath,
    STOCK_DATA_DIR: dir,
    STOCK_TAX_POLICY_PATH: policyPath,
    STOCK_TAX_POLICY_EXAMPLE_PATH: path.join(REPO_ROOT, 'data/tax-policy.example.json'),
    STOCK_ACCOUNT_MAP_PATH: accountMapPath,
    STOCK_BRIEFING_SUMMARY_PATH: summaryPath,
    STOCK_REFRESH_LOCK_PATH: lockPath,
    STOCK_TAX_PLANS_PATH: path.join(dir, 'absent', 'tax-plans.json'),
    STOCK_REBALANCE_POLICY_PATH: path.join(dir, 'absent', 'rebalance-policy.json'),
  })
  return { dir, dbPath, policyPath, accountMapPath, summaryPath, lockPath, env }
}

const TSX_CLI = path.join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs')
const CLI = path.join(REPO_ROOT, 'scripts/observatory-cli.mjs')

/**
 * Run one CLI the way `pnpm <name>` does, but from the fixture directory: no
 * `.env.local` is found there, so nothing but `env` reaches the command.
 */
export function runCli(fixture: Fixture, args: string[]) {
  const result = spawnSync(process.execPath, [TSX_CLI, '--tsconfig', path.join(REPO_ROOT, 'tsconfig.json'), CLI, ...args], {
    cwd: fixture.dir,
    env: fixture.env as NodeJS.ProcessEnv,
    encoding: 'utf8',
  })
  let json: any = null
  try {
    json = JSON.parse(result.stdout)
  } catch {
    json = null
  }
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, json }
}

