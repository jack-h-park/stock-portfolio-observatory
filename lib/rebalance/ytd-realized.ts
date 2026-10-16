import { krTaxable } from '@/lib/tax-planning'
import type { TaxPolicy } from '@/lib/tax-policy'

export type RealizedLotRow = {
  market: string
  sold_date: string
  tax_term: string | null
  realized_gl_krw: number | null
  native_realized_gl: number | null
  currency: string
  account_wrapper: string | null
  superseded_by: number | null
}

export type YtdRealized = {
  year: number
  krTaxableGainKrw: number
  usShortUsd: number
  usLongUsd: number
  lotCount: number
}

export type YtdComparison = {
  derived: YtdRealized
  manual: { krTaxableGainKrw: number | null; usShortUsd: number | null; usLongUsd: number | null }
}

function num(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Sums the tax year's realized gains from realized lots: taxable wrapper only
 * (null counts as taxable), superseded rows excluded. The US short/long totals
 * are worldwide (a US taxpayer): every market's lots, in USD. The KR pool
 * (krTaxableGainKrw) is limited to lots krTaxable accepts; without a policy
 * the domestic-stock flags are off, so only US-market lots feed it.
 */
export function deriveYtdRealized(rows: RealizedLotRow[], year: number, usdKrwRate: number): YtdRealized {
  let krTaxableGainKrw = 0
  let usShortUsd = 0
  let usLongUsd = 0
  let lotCount = 0
  for (const row of rows) {
    if (row.superseded_by != null) continue
    if ((row.account_wrapper ?? 'taxable') !== 'taxable') continue
    if (Number(String(row.sold_date).slice(0, 4)) !== year) continue
    lotCount += 1
    if (krTaxable(row)) krTaxableGainKrw += num(row.realized_gl_krw)
    const usd =
      row.currency === 'USD'
        ? num(row.native_realized_gl)
        : usdKrwRate > 0
          ? num(row.realized_gl_krw) / usdKrwRate
          : 0
    if (/long/i.test(row.tax_term ?? '')) usLongUsd += usd
    else usShortUsd += usd
  }
  return { year, krTaxableGainKrw, usShortUsd, usLongUsd, lotCount }
}

function manualValue(policy: TaxPolicy, jurisdiction: string, key: string): number | null {
  const raw = policy.jurisdictions.find((item) => item.code === jurisdiction)?.manualAssumptions[key]
  if (raw == null || raw === '') return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

export function compareWithPolicy(derived: YtdRealized, policy: TaxPolicy): YtdComparison {
  return {
    derived,
    manual: {
      krTaxableGainKrw: manualValue(policy, 'KR', 'ytdRealizedTaxableGainKrw'),
      usShortUsd: manualValue(policy, 'US', 'ytdRealizedShortGainLossUsd'),
      usLongUsd: manualValue(policy, 'US', 'ytdRealizedLongGainLossUsd'),
    },
  }
}

/** Returns a deep copy of the policy with the derived YTD figures written over the manual ones. */
export function withDerivedYtd(policy: TaxPolicy, derived: YtdRealized): TaxPolicy {
  const copy = structuredClone(policy)
  const set = (code: string, key: string, value: number) => {
    let target = copy.jurisdictions.find((item) => item.code === code)
    if (!target) {
      target = { code, enabled: true, filingCurrency: code === 'US' ? 'USD' : 'KRW', manualAssumptions: {} }
      copy.jurisdictions.push(target)
    }
    if (!target.manualAssumptions || typeof target.manualAssumptions !== 'object') target.manualAssumptions = {}
    target.manualAssumptions[key] = value
  }
  set('KR', 'ytdRealizedTaxableGainKrw', derived.krTaxableGainKrw)
  set('US', 'ytdRealizedShortGainLossUsd', derived.usShortUsd)
  set('US', 'ytdRealizedLongGainLossUsd', derived.usLongUsd)
  set('US', 'taxInputYear', derived.year)
  return copy
}
