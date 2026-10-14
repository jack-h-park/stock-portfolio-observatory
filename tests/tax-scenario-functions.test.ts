import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  buildTaxPlan,
  estimateSaleSet,
  harvestFrontier,
  longTermEligibleOn,
  repriceForSaleDate,
  summarizeTaxCandidates,
  type TaxPlanCandidate,
  type TaxPlanningLot,
} from '@/lib/tax-planning'
import { normalizeTaxPolicy, type TaxPolicy } from '@/lib/tax-policy'

// Synthetic tickers and amounts only.

function policy(planningUsdKrwRate: number | null, creditMode = 'estimated-us-source'): TaxPolicy {
  const raw = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'data/tax-policy.example.json'), 'utf8'))
  for (const j of raw.jurisdictions) {
    if (j.code === 'US') Object.assign(j.manualAssumptions, { planningUsdKrwRate, stateCode: 'NONE', wageBaseYear: 2026, wageBaseUsd: 250_000, taxInputYear: 2026 })
    if (j.code === 'KR') Object.assign(j.manualAssumptions, { foreignTaxCreditMode: creditMode, ytdRealizedTaxableGainKrw: 3_000_000 })
  }
  return normalizeTaxPolicy(raw)
}

// A dollar lot bought when the won was strong (1100), held today at 1400, sold on a day at 1300.
const LOT: TaxPlanningLot = {
  id: 1,
  market: 'US',
  currency: 'USD',
  brokerage: 'Example Broker',
  account: 'Example Taxable',
  ticker: 'AAA',
  name: 'Synthetic AAA',
  acquired_date: '2025-01-10',
  fx_rate_to_base: 1400,
  open_quantity: 10,
  native_cost_basis: 1000,
  native_market_value: 2000,
  native_unrealized_gl: 1000,
  cost_basis_krw: 1_400_000,
  acquisition_cost_krw: 1_100_000,
  acquisition_cost_usd: 1000,
  holding_days: 400,
  tax_term: 'Long Term',
  account_wrapper: 'taxable',
}

test('the long-term date is the day after the first anniversary', () => {
  assert.equal(longTermEligibleOn('2025-01-10'), '2026-01-11')
  assert.equal(longTermEligibleOn('2024-02-29'), '2025-03-02')
  const [onDay] = repriceForSaleDate([{ ...LOT, acquired_date: '2025-06-15' }], { saleDate: '2026-06-16', usdKrwRate: 1300 })
  const [dayBefore] = repriceForSaleDate([{ ...LOT, acquired_date: '2025-06-15' }], { saleDate: '2026-06-15', usdKrwRate: 1300 })
  assert.equal(onDay.holdingBucket, 'long')
  assert.equal(dayBefore.holdingBucket, 'short')
})

test('the Korea gain uses the sale-date rate against the acquisition-date cost, not the planner shortcut', () => {
  const [repriced] = repriceForSaleDate([LOT], { saleDate: '2026-06-15', usdKrwRate: 1300 })
  // proceeds $2000 at the sale-date rate, less the won cost at the acquisition-date rate.
  assert.equal(repriced.gainKrw, 2000 * 1300 - 1_100_000)
  assert.equal(repriced.gainNative, 1000)
  // The single-rate shortcut would have been the dollar gain at one rate.
  assert.notEqual(repriced.gainKrw, 1000 * 1300)

  // lotsUsdKrwRate path (buildTaxPlan): the lot's current rate values the proceeds, and the
  // configured planning rate stands in for every conversion.
  const shortcut = buildTaxPlan({ lots: [LOT], policy: policy(1350) }).candidates[0]
  assert.equal(shortcut.gainKrw, 2000 * 1400 - 1_100_000)
  assert.equal(shortcut.usdKrwRate, 1350)
  assert.equal(Number(repriced.gainKrw) - Number(shortcut.gainKrw), 2000 * (1300 - 1400))
  assert.equal(repriced.usdKrwRate, 1300)
})

test('estimateSaleSet pins the conversion to the sale-date rate; candidateUsdKrwRate would use the configured one', () => {
  const configured = policy(1350)
  const candidates = repriceForSaleDate([LOT], { saleDate: '2026-06-15', usdKrwRate: 1300 })
  const viaShortcut = summarizeTaxCandidates({ candidates, policy: configured, scenario: 'US_AND_KR', year: 2026 })
  assert.equal(viaShortcut.usdKrwRate, 1350, 'candidateUsdKrwRate takes the configured planning rate')

  const pinned = estimateSaleSet({ candidates, policy: configured, scenario: 'US_AND_KR', year: 2026, usdKrwRate: 1300 })
  // Korea's tax in won is the same either way; it is the dollar figure that moves.
  assert.ok(pinned.krTaxKrw > 0)
  assert.equal(pinned.krTaxKrw, viaShortcut.krTaxKrw)
  const krInDollarsShortcut = viaShortcut.krTaxKrw / 1350
  const krInDollarsPinned = pinned.krTaxKrw / 1300
  assert.notEqual(krInDollarsPinned, krInDollarsShortcut)
  assert.ok(Math.abs(pinned.totalUsd - (pinned.usTotalUsd + krInDollarsPinned - pinned.krCreditUsd)) < 1e-6)
  // The policy object passed in is not modified.
  assert.equal(configured.jurisdictions.find((j) => j.code === 'US')?.manualAssumptions.planningUsdKrwRate, 1350)
})

test('the credit follows the policy mode', () => {
  const candidates = repriceForSaleDate([LOT], { saleDate: '2026-06-15', usdKrwRate: 1300 })
  const credited = estimateSaleSet({ candidates, policy: policy(null, 'estimated-us-source'), scenario: 'US_AND_KR', year: 2026, usdKrwRate: 1300 })
  const manual = estimateSaleSet({ candidates, policy: policy(null, 'manual'), scenario: 'US_AND_KR', year: 2026, usdKrwRate: 1300 })
  assert.ok(credited.krCreditUsd > 0)
  assert.equal(manual.krCreditUsd, 0)
  assert.ok(credited.totalUsd < manual.totalUsd)
  const usOnly = estimateSaleSet({ candidates, policy: policy(null), scenario: 'US_ONLY', year: 2026, usdKrwRate: 1300 })
  assert.equal(usOnly.krTaxKrw, 0)
  assert.equal(usOnly.krCreditUsd, 0)
})

test('a quoted price replaces the stored one; a lot with neither has no proceeds', () => {
  const [quoted] = repriceForSaleDate([LOT], { saleDate: '2026-06-15', usdKrwRate: 1300, pricesUsd: { AAA: 250 } })
  assert.equal(quoted.proceedsNative, 2500)
  const [unpriced] = repriceForSaleDate([{ ...LOT, native_market_value: null }], { saleDate: '2026-06-15', usdKrwRate: 1300 })
  assert.equal(unpriced.proceedsNative, null)
  assert.equal(unpriced.gainKrw, null)
})

function candidate(id: number, ticker: string, gainNative: number): TaxPlanCandidate {
  return {
    ...LOT,
    id,
    ticker,
    usdKrwRate: 1300,
    proceedsNative: 100,
    proceedsKrw: 130_000,
    gainNative,
    gainKrw: gainNative * 1300,
    holdingBucket: 'short',
    usTaxUsd: 0,
    usTaxKrw: 0,
    krTaxKrw: 0,
    estimatedTaxKrw: 0,
    estimatedAfterTaxKrw: 130_000,
    warnings: [],
  }
}

test('the harvest frontier takes the best saving per dollar first, and savings sum to the whole', () => {
  // Toy estimator: 1000 of gains taxed at 20%, then nothing. The first dollars of loss save 0.2
  // each; once the gains are used up, more loss saves nothing.
  const estimate = (rows: TaxPlanCandidate[]) => 0.2 * Math.max(0, 1000 + rows.reduce((sum, row) => sum + Number(row.gainNative), 0))
  const rows = [candidate(1, 'BBB', -500), candidate(2, 'AAA', -800), candidate(3, 'CCC', 200), candidate(4, 'DDD', -100)]
  const steps = harvestFrontier({ candidates: rows, estimateTotalUsd: estimate })
  assert.deepEqual(
    steps.map((s) => s.ticker),
    ['AAA', 'DDD', 'BBB'],
    'ties at 0.2 go to the larger loss; gain lots never join'
  )
  for (let i = 1; i < steps.length; i += 1) assert.ok(steps[i].savingPerDollar <= steps[i - 1].savingPerDollar)
  assert.ok(Math.abs(steps[0].savingPerDollar - 0.2) < 1e-12)
  // AAA uses 800 of the 1000, DDD 100 more; BBB's 500 finds only 100 left to offset.
  assert.ok(Math.abs(Number(steps.at(-1)?.taxSavedUsd) - 20) < 1e-9)
  assert.ok(Math.abs(Number(steps.at(-1)?.savingPerDollar) - 0.04) < 1e-12)
  assert.equal(steps.at(-1)?.cumulativeLossUsd, -1400)
  assert.ok(Math.abs(Number(steps.at(-1)?.cumulativeSavedUsd) - (estimate([]) - estimate(rows.filter((r) => Number(r.gainNative) < 0)))) < 1e-9)
})

test('the harvest frontier with the real engine is ordered by marginal saving', () => {
  const lots: TaxPlanningLot[] = [
    { ...LOT, id: 1, ticker: 'AAA', native_market_value: 2000, native_cost_basis: 1000 },
    { ...LOT, id: 2, ticker: 'BBB', native_market_value: 500, native_cost_basis: 1500, acquired_date: '2026-03-01' },
    { ...LOT, id: 3, ticker: 'DDD', native_market_value: 3000, native_cost_basis: 3600 },
  ]
  const p = policy(null)
  const candidates = repriceForSaleDate(lots, { saleDate: '2026-06-15', usdKrwRate: 1300 })
  const steps = harvestFrontier({
    candidates,
    estimateTotalUsd: (rows) => estimateSaleSet({ candidates: rows, policy: p, scenario: 'US_AND_KR', year: 2026, usdKrwRate: 1300 }).totalUsd,
  })
  assert.deepEqual(new Set(steps.map((s) => s.ticker)), new Set(['BBB', 'DDD']))
  for (let i = 1; i < steps.length; i += 1) assert.ok(steps[i].savingPerDollar <= steps[i - 1].savingPerDollar + 1e-12)
})
