import assert from 'node:assert/strict'
import test from 'node:test'
import { portfolioDate, valuePortfolio } from '../scripts/portfolio-snapshot.mjs'

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
