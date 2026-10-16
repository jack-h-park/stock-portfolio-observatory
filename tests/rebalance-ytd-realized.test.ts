import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compareWithPolicy,
  deriveYtdRealized,
  withDerivedYtd,
  type RealizedLotRow,
  type YtdRealized,
} from '../lib/rebalance/ytd-realized'
import type { TaxPolicy } from '../lib/tax-policy'

function row(over: Partial<RealizedLotRow> = {}): RealizedLotRow {
  return {
    market: 'US',
    sold_date: '2026-03-10',
    tax_term: 'short',
    realized_gl_krw: 1_000_000,
    native_realized_gl: 1000,
    currency: 'USD',
    account_wrapper: 'taxable',
    superseded_by: null,
    ...over,
  }
}

function policy(): TaxPolicy {
  return {
    version: 1,
    activeScenario: 'US_AND_KR',
    baseCurrency: 'KRW',
    jurisdictions: [
      { code: 'US', enabled: true, filingCurrency: 'USD', manualAssumptions: { ytdRealizedShortGainLossUsd: 5, taxInputYear: 2025 } },
      { code: 'KR', enabled: true, filingCurrency: 'KRW', manualAssumptions: {} },
    ],
    manualAdjustments: [],
  } as TaxPolicy
}

test('sums only the tax year, taxable wrapper, non-superseded rows', () => {
  const rows = [
    row(),
    row({ account_wrapper: null }),
    row({ account_wrapper: 'isa' }),
    row({ sold_date: '2025-12-31' }),
    row({ superseded_by: 7 }),
  ]
  const out = deriveYtdRealized(rows, 2026, 1400)
  assert.equal(out.lotCount, 2)
  assert.equal(out.usShortUsd, 2000)
})

test('KR taxable gain is the KRW gain of US-market lots', () => {
  const rows = [
    row({ market: 'US', realized_gl_krw: 2_000_000 }),
    row({ market: 'KR', currency: 'KRW', realized_gl_krw: 9_000_000, native_realized_gl: 9_000_000 }),
  ]
  const out = deriveYtdRealized(rows, 2026, 1400)
  assert.equal(out.krTaxableGainKrw, 2_000_000)
  assert.equal(out.lotCount, 2)
  // The KR lot is outside the KR pool but still counts in the worldwide US totals.
  assert.equal(out.usShortUsd, 1000 + 9_000_000 / 1400)
})

test('US totals are worldwide: KRW-denominated KR and crypto lots convert at the rate', () => {
  const rows = [
    row({ market: 'KR', currency: 'KRW', realized_gl_krw: 14_000_000, native_realized_gl: 14_000_000, tax_term: 'short' }),
    row({ market: 'CRYPTO', currency: 'KRW', realized_gl_krw: -2_800_000, native_realized_gl: null, tax_term: 'long' }),
  ]
  const out = deriveYtdRealized(rows, 2026, 1400)
  assert.equal(out.usShortUsd, 10_000)
  assert.equal(out.usLongUsd, -2000)
  assert.equal(out.krTaxableGainKrw, 0)
})

test('US short and long split by tax_term, measured in USD', () => {
  const rows = [
    row({ tax_term: 'Short-term', native_realized_gl: 100 }),
    row({ tax_term: 'LONG_TERM', native_realized_gl: 300 }),
    row({ tax_term: null, native_realized_gl: 50 }),
    row({ tax_term: 'long', currency: 'KRW', native_realized_gl: 1, realized_gl_krw: 1_400_000 }),
  ]
  const out = deriveYtdRealized(rows, 2026, 1400)
  assert.equal(out.usShortUsd, 150)
  assert.equal(out.usLongUsd, 1300)
})

test('withDerivedYtd overwrites the three manual assumptions and taxInputYear', () => {
  const input = policy()
  const snapshot = structuredClone(input)
  const derived: YtdRealized = { year: 2026, krTaxableGainKrw: 123, usShortUsd: 4, usLongUsd: 5, lotCount: 3 }
  const out = withDerivedYtd(input, derived)
  assert.deepEqual(input, snapshot)
  const kr = out.jurisdictions.find((j) => j.code === 'KR')!.manualAssumptions
  const us = out.jurisdictions.find((j) => j.code === 'US')!.manualAssumptions
  assert.equal(kr.ytdRealizedTaxableGainKrw, 123)
  assert.equal(us.ytdRealizedShortGainLossUsd, 4)
  assert.equal(us.ytdRealizedLongGainLossUsd, 5)
  assert.equal(us.taxInputYear, 2026)
})

test('compareWithPolicy reports manual values where present, null where absent', () => {
  const derived: YtdRealized = { year: 2026, krTaxableGainKrw: 1, usShortUsd: 2, usLongUsd: 3, lotCount: 1 }
  const cmp = compareWithPolicy(derived, policy())
  assert.equal(cmp.derived, derived)
  assert.deepEqual(cmp.manual, { krTaxableGainKrw: null, usShortUsd: 5, usLongUsd: null })
})

test('withDerivedYtd creates a missing jurisdiction or assumptions bag without mutating input', () => {
  const derived: YtdRealized = { year: 2026, krTaxableGainKrw: 7, usShortUsd: 8, usLongUsd: 9, lotCount: 1 }
  const input = policy()
  input.jurisdictions = input.jurisdictions.filter((j) => j.code === 'US')
  const snapshot = structuredClone(input)
  const out = withDerivedYtd(input, derived)
  assert.deepEqual(input, snapshot)
  const kr = out.jurisdictions.find((j) => j.code === 'KR')!
  assert.equal(kr.filingCurrency, 'KRW')
  assert.equal(kr.manualAssumptions.ytdRealizedTaxableGainKrw, 7)

  const empty = { ...policy(), jurisdictions: [] }
  const out2 = withDerivedYtd(empty, derived)
  assert.equal(empty.jurisdictions.length, 0)
  const us = out2.jurisdictions.find((j) => j.code === 'US')!
  assert.equal(us.filingCurrency, 'USD')
  assert.equal(us.manualAssumptions.taxInputYear, 2026)
  assert.equal(us.manualAssumptions.ytdRealizedLongGainLossUsd, 9)
})

test('a non-USD lot with a USD acquisition cost: US gain = proceeds_krw / rate - acquisition_cost_usd', () => {
  // Proceeds 2,100,000 KRW at 1,400 = 1,500 USD, less a 1,200 USD cost: 300 USD (the KRW gain / rate would say 500).
  const out = deriveYtdRealized(
    [row({ market: 'KR', currency: 'KRW', realized_gl_krw: 700_000, native_realized_gl: 700_000, proceeds_krw: 2_100_000, acquisition_cost_usd: 1_200 })],
    2026,
    1400
  )
  assert.equal(out.usShortUsd, 300)
})

test('a non-USD lot without a USD acquisition cost falls back to realized_gl_krw / rate', () => {
  const out = deriveYtdRealized(
    [
      row({ market: 'KR', currency: 'KRW', realized_gl_krw: 700_000, native_realized_gl: 700_000, proceeds_krw: 2_100_000, acquisition_cost_usd: null }),
      row({ market: 'KR', currency: 'KRW', tax_term: 'long', realized_gl_krw: 140_000, native_realized_gl: 140_000 }),
    ],
    2026,
    1400
  )
  assert.equal(out.usShortUsd, 500)
  assert.equal(out.usLongUsd, 100)
})
