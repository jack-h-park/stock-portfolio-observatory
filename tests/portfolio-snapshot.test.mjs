import assert from 'node:assert/strict'
import test from 'node:test'
import { portfolioDate, snapshotSeriesRows, valuePortfolio } from '../scripts/portfolio-snapshot.mjs'

test('coverage is cost-weighted rather than distorted by incompatible quantities', () => {
  const valuation = valuePortfolio([
    { market: 'KR', cost: 99_500_000, marketValue: 120_000_000, quantity: 10 },
    { market: 'KR', cost: 500_000, marketValue: null, quantity: 700_000 },
  ])

  assert.equal(valuation.global.costCoverage, 0.995)
  assert.equal(valuation.global.positionCoverage, 0.5)
  assert.equal(valuation.global.partialMarketValue, 120_000_000)
})

test('partial valuation keeps gain/loss algebraically tied to priced cost', () => {
  const valuation = valuePortfolio([
    { market: 'US', cost: 80, marketValue: 100 },
    { market: 'US', cost: 20, marketValue: null },
  ])

  assert.equal(valuation.global.totalCost, 100)
  assert.equal(valuation.global.pricedCost, 80)
  assert.equal(valuation.global.unrealizedGl, 20)
  assert.equal(valuation.global.returnPct, 25)
})

test('snapshot date uses the portfolio timezone instead of UTC day', () => {
  const afterPacificFivePm = new Date('2026-08-01T01:00:00.000Z')

  assert.equal(portfolioDate(afterPacificFivePm, 'America/Los_Angeles'), '2026-07-31')
  assert.equal(portfolioDate(afterPacificFivePm, 'UTC'), '2026-08-01')
})

test('hierarchical scopes reconcile the portfolio, asset classes, listings, and crypto venues', () => {
  const valuation = valuePortfolio([
    { market: 'KR', account: 'Korea account', brokerage: 'Korea broker', cost: 100, marketValue: 120 },
    { market: 'US', account: 'US account', brokerage: 'US broker', cost: 200, marketValue: 250 },
    { market: 'CRYPTO', account: 'Bithumb', brokerage: 'Bithumb', cost: 30, marketValue: 40 },
    { market: 'CRYPTO', account: 'Robinhood Crypto', brokerage: 'Robinhood', cost: 70, marketValue: 90 },
  ])

  assert.equal(valuation['portfolio:all'].totalCost, 400)
  assert.equal(valuation['portfolio:all'].totalCost, valuation['asset:securities'].totalCost + valuation['asset:crypto'].totalCost)
  assert.equal(valuation['asset:securities'].totalCost, valuation['listing:KR'].totalCost + valuation['listing:US'].totalCost)
  assert.equal(valuation['asset:crypto'].totalCost, valuation['venue:BITHUMB'].totalCost + valuation['venue:ROBINHOOD_CRYPTO'].totalCost)
  assert.equal(valuation.global.totalCost, valuation['portfolio:all'].totalCost)
  assert.equal(valuation.CRYPTO.totalCost, valuation['asset:crypto'].totalCost)

  const rows = snapshotSeriesRows('2026-08-01', '2026-08-01T12:00:00.000Z', valuation, {
    rate: 1443.61,
    asOfDate: '2026-07-31',
    source: 'Frankfurter API',
  })
  assert.equal(rows.length, 7)
  assert.equal(rows.find((row) => row.scope_key === 'venue:BITHUMB')?.market_value, 40)
  assert.equal(rows.find((row) => row.scope_key === 'venue:ROBINHOOD_CRYPTO')?.market_value, 90)
  assert.equal(rows.find((row) => row.scope_key === 'portfolio:all')?.fx_rate, 1443.61)
  assert.equal(rows.find((row) => row.scope_key === 'portfolio:all')?.fx_as_of_date, '2026-07-31')
})
