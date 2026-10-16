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
