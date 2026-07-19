import {
  assumptionBool,
  assumptionNumber,
  assumptionString,
  type FilingScenario,
  type TaxPolicy,
} from '@/lib/tax-policy'

export type TaxPlanningLot = {
  id: number
  market: string
  currency: string
  brokerage: string | null
  account: string
  ticker: string
  name: string
  acquired_date: string
  open_quantity: number
  native_cost_basis: number
  native_market_value: number | null
  native_unrealized_gl: number | null
  cost_basis_krw: number
  holding_days: number | null
  tax_term: string | null
}

export type TaxPlanCandidate = TaxPlanningLot & {
  proceedsNative: number | null
  proceedsKrw: number | null
  gainNative: number | null
  gainKrw: number | null
  holdingBucket: 'short' | 'long'
  usTaxUsd: number
  usTaxKrw: number
  krTaxKrw: number
  estimatedTaxKrw: number
  estimatedAfterTaxKrw: number | null
  warnings: string[]
}

export type TaxPlanSummary = {
  scenario: FilingScenario
  objective: string
  targetCashKrw: number
  candidateCount: number
  missingValuationCount: number
  grossProceedsKrw: number
  grossGainKrw: number
  grossLossKrw: number
  usTaxUsd: number
  usTaxKrw: number
  krTaxKrw: number
  estimatedTaxKrw: number
  estimatedAfterTaxKrw: number
  remainingKrDeductionKrw: number
  warnings: string[]
}

export type TaxPlan = {
  candidates: TaxPlanCandidate[]
  recommended: TaxPlanCandidate[]
  summary: TaxPlanSummary
  assumptions: {
    scenario: FilingScenario
    usShortRatePct: number
    usLongRatePct: number
    usStateRatePct: number
    usNiitRatePct: number
    usLossDeductionLimitUsd: number
    krBasicDeductionKrw: number
    krForeignStockRatePct: number
    krDomesticTaxable: boolean
    krForeignTaxCreditMode: string
  }
}

function pctRate(value: number) {
  return value / 100
}

function isLongTerm(lot: TaxPlanningLot) {
  if (String(lot.tax_term ?? '').toLowerCase().includes('long')) return true
  return Number(lot.holding_days ?? 0) > 365
}

function isScenarioEnabled(scenario: FilingScenario, jurisdiction: 'US' | 'KR') {
  if (scenario === 'US_AND_KR') return true
  return scenario.startsWith(jurisdiction)
}

function krTaxable(lot: TaxPlanningLot, policy: TaxPolicy) {
  if (lot.market === 'US') return true
  if (lot.market !== 'KR') return false
  return (
    assumptionBool(policy, 'KR', 'domesticMajorShareholder', false) ||
    assumptionBool(policy, 'KR', 'domesticListedOffMarketSale', false)
  )
}

function warningForLot(lot: TaxPlanningLot, policy: TaxPolicy, proceedsKrw: number | null, gainKrw: number | null) {
  const warnings: string[] = []
  if (proceedsKrw == null || gainKrw == null) warnings.push('Missing valuation; refresh price snapshot before acting.')
  if (lot.market === 'US' && gainKrw != null && gainKrw < 0) {
    const before = assumptionNumber(policy, 'US', 'washSaleWindowDaysBefore', 30)
    const after = assumptionNumber(policy, 'US', 'washSaleWindowDaysAfter', 30)
    warnings.push(`Potential wash-sale review: ${before}d before / ${after}d after.`)
  }
  if (lot.market === 'KR' && !krTaxable(lot, policy)) warnings.push('KR domestic stock taxable scope is off by current assumptions.')
  if (lot.market !== 'KR' && lot.market !== 'US') warnings.push('No country module exists yet; treated as monitoring-only.')
  return warnings
}

export function buildTaxPlan({
  lots,
  policy,
  scenario = policy.activeScenario,
  objective = 'minimize-tax',
  targetCashKrw = 0,
}: {
  lots: TaxPlanningLot[]
  policy: TaxPolicy
  scenario?: FilingScenario
  objective?: string
  targetCashKrw?: number
}): TaxPlan {
  const usShortRatePct = assumptionNumber(policy, 'US', 'federalShortTermRatePct', 37)
  const usLongRatePct = assumptionNumber(policy, 'US', 'federalLongTermRatePct', 20)
  const usStateRatePct = assumptionNumber(policy, 'US', 'stateRatePct', 0)
  const usNiitRatePct = assumptionNumber(policy, 'US', 'netInvestmentIncomeTaxRatePct', 0)
  const usLossDeductionLimitUsd = assumptionNumber(policy, 'US', 'lossDeductionLimitUsd', 3000)
  const krBasicDeductionKrw = assumptionNumber(policy, 'KR', 'stockBasicDeductionKrw', 2500000)
  const krForeignStockRatePct = assumptionNumber(policy, 'KR', 'foreignStockFlatRatePct', 22)
  const krDomesticTaxable = assumptionBool(policy, 'KR', 'domesticMajorShareholder', false) || assumptionBool(policy, 'KR', 'domesticListedOffMarketSale', false)
  const krForeignTaxCreditMode = assumptionString(policy, 'KR', 'foreignTaxCreditMode', 'manual')

  const candidates = lots.map((lot) => {
    const proceedsNative = lot.native_market_value == null ? null : Number(lot.native_market_value)
    const proceedsKrw = lot.native_market_value == null ? null : Number(lot.native_market_value)
    const normalizedProceedsKrw = lot.currency === 'KRW' ? proceedsKrw : lot.native_market_value == null ? null : Number(lot.native_market_value) / Math.max(Number(lot.native_cost_basis || 0), 1) * Number(lot.cost_basis_krw || 0)
    const gainNative = lot.native_unrealized_gl == null ? (proceedsNative == null ? null : proceedsNative - Number(lot.native_cost_basis ?? 0)) : Number(lot.native_unrealized_gl)
    const gainKrw = normalizedProceedsKrw == null ? null : normalizedProceedsKrw - Number(lot.cost_basis_krw ?? 0)
    const holdingBucket = isLongTerm(lot) ? 'long' : 'short'

    const usApplies = isScenarioEnabled(scenario, 'US') && lot.market === 'US' && gainNative != null && gainNative > 0
    const usRate = pctRate((holdingBucket === 'long' ? usLongRatePct : usShortRatePct) + usStateRatePct + usNiitRatePct)
    const usTaxUsd = usApplies ? gainNative * usRate : 0
    const usdToKrw = lot.currency === 'USD' && lot.native_cost_basis > 0 ? lot.cost_basis_krw / lot.native_cost_basis : 0
    const usTaxKrw = usTaxUsd * usdToKrw
    const krApplies = isScenarioEnabled(scenario, 'KR') && krTaxable(lot, policy) && gainKrw != null && gainKrw > 0
    const krTaxKrw = krApplies ? gainKrw * pctRate(krForeignStockRatePct) : 0
    const estimatedTaxKrw = usTaxKrw + krTaxKrw
    return {
      ...lot,
      proceedsNative,
      proceedsKrw: normalizedProceedsKrw,
      gainNative,
      gainKrw,
      holdingBucket,
      usTaxUsd,
      usTaxKrw,
      krTaxKrw,
      estimatedTaxKrw,
      estimatedAfterTaxKrw: normalizedProceedsKrw == null ? null : normalizedProceedsKrw - estimatedTaxKrw,
      warnings: warningForLot(lot, policy, normalizedProceedsKrw, gainKrw),
    } satisfies TaxPlanCandidate
  })

  const ranked = [...candidates].sort((a, b) => {
    if (objective === 'harvest-loss') return Number(a.gainKrw ?? 0) - Number(b.gainKrw ?? 0)
    if (objective === 'use-deduction') return Number(a.estimatedTaxKrw) - Number(b.estimatedTaxKrw) || Number(b.gainKrw ?? 0) - Number(a.gainKrw ?? 0)
    if (objective === 'raise-cash') return Number(a.estimatedTaxKrw) - Number(b.estimatedTaxKrw) || Number(b.proceedsKrw ?? 0) - Number(a.proceedsKrw ?? 0)
    return Number(a.estimatedTaxKrw) - Number(b.estimatedTaxKrw) || Number(a.gainKrw ?? 0) - Number(b.gainKrw ?? 0)
  })

  const recommended: TaxPlanCandidate[] = []
  let raised = 0
  for (const candidate of ranked) {
    if (candidate.proceedsKrw == null) continue
    if (objective === 'harvest-loss' && Number(candidate.gainKrw ?? 0) >= 0) continue
    if (objective === 'use-deduction' && (Number(candidate.gainKrw ?? 0) <= 0 || Number(candidate.gainKrw ?? 0) > krBasicDeductionKrw)) continue
    recommended.push(candidate)
    raised += candidate.proceedsKrw
    if (targetCashKrw > 0 && raised >= targetCashKrw) break
    if (targetCashKrw <= 0 && recommended.length >= 10) break
  }

  const active = recommended.length ? recommended : ranked.filter((row) => row.proceedsKrw != null).slice(0, 10)
  const grossProceedsKrw = active.reduce((sum, row) => sum + Number(row.proceedsKrw ?? 0), 0)
  const grossGainKrw = active.reduce((sum, row) => sum + Math.max(Number(row.gainKrw ?? 0), 0), 0)
  const grossLossKrw = active.reduce((sum, row) => sum + Math.min(Number(row.gainKrw ?? 0), 0), 0)
  const krTaxableGainAfterDeduction = Math.max(grossGainKrw + grossLossKrw - krBasicDeductionKrw, 0)
  const krDeductionAdjustment = isScenarioEnabled(scenario, 'KR') ? Math.max(active.reduce((sum, row) => sum + row.krTaxKrw, 0) - krTaxableGainAfterDeduction * pctRate(krForeignStockRatePct), 0) : 0
  const usTaxUsd = active.reduce((sum, row) => sum + row.usTaxUsd, 0)
  const usTaxKrw = active.reduce((sum, row) => sum + row.usTaxKrw, 0)
  const krTaxKrw = Math.max(active.reduce((sum, row) => sum + row.krTaxKrw, 0) - krDeductionAdjustment, 0)
  const estimatedTaxKrw = usTaxKrw + krTaxKrw

  return {
    candidates,
    recommended: active,
    assumptions: {
      scenario,
      usShortRatePct,
      usLongRatePct,
      usStateRatePct,
      usNiitRatePct,
      usLossDeductionLimitUsd,
      krBasicDeductionKrw,
      krForeignStockRatePct,
      krDomesticTaxable,
      krForeignTaxCreditMode,
    },
    summary: {
      scenario,
      objective,
      targetCashKrw,
      candidateCount: candidates.length,
      missingValuationCount: candidates.filter((row) => row.proceedsKrw == null).length,
      grossProceedsKrw,
      grossGainKrw,
      grossLossKrw,
      usTaxUsd,
      usTaxKrw,
      krTaxKrw,
      estimatedTaxKrw,
      estimatedAfterTaxKrw: grossProceedsKrw - estimatedTaxKrw,
      remainingKrDeductionKrw: Math.max(krBasicDeductionKrw - Math.max(grossGainKrw + grossLossKrw, 0), 0),
      warnings: Array.from(new Set(active.flatMap((row) => row.warnings))),
    },
  }
}
