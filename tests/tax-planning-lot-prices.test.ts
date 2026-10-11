import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { config } from '@/config'
import type { TaxPolicy } from '@/lib/tax-policy'
import { runIngest } from './ingest-harness'
import { writeScenario } from './pension-fixtures'

// A lot without its own market value is priced from its holding. The holding's
// `current_price` is in the base currency for some sources — crypto stores KRW
// there for a coin quoted in USD — so reading it as the lot's price, then
// converting the lot at its FX rate, counted the exchange rate twice: 0.22 BTC
// planned as ₩330억. `native_price` is in the lot's own currency everywhere.
// Invented figures; the repository is public.

const policy: TaxPolicy = {
  version: 3,
  activeScenario: 'US_ONLY',
  baseCurrency: 'KRW',
  planningHorizonYears: 1,
  annualFilingProfiles: [],
  jurisdictions: [
    { code: 'US', enabled: true, filingCurrency: 'USD', manualAssumptions: {} },
    { code: 'KR', enabled: true, filingCurrency: 'KRW', manualAssumptions: {} },
  ],
  manualAdjustments: [],
}

test('a USD lot priced from its holding uses the native price, not the base-currency one', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lot-prices-'))
  const env = writeScenario(dir, { withPensions: false })
  const dbPath = runIngest(dir, { env, allowFailure: true })

  const rw = new Database(dbPath)
  const account = 'Example Crypto'
  rw.prepare(
    `insert into holdings_all (market, currency, base_currency, fx_rate_to_base, brokerage, account, ticker, name,
       quantity, native_cost, native_price, native_market_value, total_cost_krw, current_price, asset_class,
       account_wrapper, owner)
     values ('CRYPTO', 'USD', 'KRW', 1300, 'Example Broker', ?, 'COIN', 'Example Coin',
       0.5, 30000, 80000, 40000, 39000000, 104000000, 'security', 'taxable', 'self')`
  ).run(account)
  rw.prepare(
    `insert into tax_lots_all (market, currency, base_currency, fx_rate_to_base, brokerage, account, ticker, name,
       acquired_date, open_quantity, native_cost_basis, native_market_value, native_unrealized_gl, cost_basis_krw,
       holding_days, tax_term, asset_class, account_wrapper, owner)
     values ('CRYPTO', 'USD', 'KRW', 1300, 'Example Broker', ?, 'COIN', 'Example Coin', '2025-01-02', 0.5, 30000,
       null, null, 39000000, 600, 'Long-term', 'security', 'taxable', 'self')`
  ).run(account)
  rw.close()

  config.stockDbPath = dbPath
  const { getTaxPlanningLots } = await import('../lib/adapters/portfolio-db')
  const [coin] = getTaxPlanningLots(5000, policy).filter((lot) => lot.ticker === 'COIN')
  assert.ok(coin)
  assert.equal(coin.native_market_value, 40_000)
  assert.equal(coin.native_unrealized_gl, 10_000)
})
