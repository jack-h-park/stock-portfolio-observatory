import {
  annualProfileForYear,
  annualProfiles,
  assumptionBool,
  assumptionNumber,
  assumptionString,
  projectedWagesUsd,
  scenarioFromTaxYearProfile,
  type FilingScenario,
  type TaxPolicy,
  type TaxYearProfile,
} from '@/lib/tax-policy'
import { estimateUsCapitalGainTax } from '@/lib/us-tax-engine'

export type TaxPlanningLot = {
  id: number
  market: string
  currency: string
  brokerage: string | null
  account: string
  ticker: string
  name: string
  acquired_date: string
  fx_rate_to_base?: number | null
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
  usFederalShortTermTaxKrw: number
  usFederalLongTermTaxKrw: number
  usNiitTaxKrw: number
  usStateTaxKrw: number
  usForeignTaxCreditLimitKrw: number
  usForeignTaxCreditKrw: number
  krForeignTaxCreditKrw: number
  taxCalculationMethod: string
  krTaxKrw: number
  estimatedTaxBeforeCreditsKrw: number
  estimatedCrossBorderTaxCreditKrw: number
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

export type TaxCandidateAggregate = {
  year: number
  usdKrwRate: number
  pricedLotCount: number
  totalProceedsKrw: number
  grossGainKrw: number
  grossLossKrw: number
  netGainKrw: number
  lossLotProceedsKrw: number
  lossHarvestKrw: number
  shortLossHarvestKrw: number
  longLossHarvestKrw: number
  netShortGainKrw: number
  netLongGainKrw: number
  usTaxKrw: number
  usTaxAfterForeignTaxCreditKrw: number
  usFederalShortTermTaxKrw: number
  usFederalLongTermTaxKrw: number
  usNiitTaxKrw: number
  usStateTaxKrw: number
  usTaxableShortGainKrw: number
  usTaxableLongGainKrw: number
  usOrdinaryIncomeUsd: number
  usForeignTaxCreditLimitKrw: number
  usForeignTaxCreditKrw: number
  krForeignTaxCreditKrw: number
  taxCalculationMethod: string
  usFederalTaxOnUsMarketGainKrw: number
  krNetTaxableGainBeforeDeductionKrw: number
  krDeductionAppliedKrw: number
  krTaxableGainAfterDeductionKrw: number
  krTaxRatePct: number
  krTaxKrw: number
  combinedTaxBeforeCreditsKrw: number
  estimatedCrossBorderTaxCreditKrw: number
  incrementalKrTaxAfterCreditKrw: number
  combinedTaxAfterCreditsKrw: number
}

export type MultiYearStrategyKey = 'KR_FIRST' | 'US_FIRST' | 'BALANCED' | 'LOSS_FIRST'

export type MarketSalePlan = {
  market: string
  targetKrw: number
  proceedsKrw: number
  gainKrw: number
  taxKrw: number
  afterTaxKrw: number
  lotCount: number
}

export type TaxYearPlan = {
  year: number
  filingScenario: FilingScenario
  profile: TaxYearProfile
  targetCashKrw: number
  proceedsKrw: number
  gainKrw: number
  taxKrw: number
  afterTaxKrw: number
  effectiveTaxRatePct: number | null
  markets: MarketSalePlan[]
  lots: TaxPlanCandidate[]
  warnings: string[]
}

export type MultiYearTaxScenario = {
  key: MultiYearStrategyKey
  label: string
  description: string
  years: TaxYearPlan[]
  summary: {
    proceedsKrw: number
    gainKrw: number
    taxKrw: number
    afterTaxKrw: number
    peakYearTaxKrw: number
    effectiveTaxRatePct: number | null
    lotCount: number
    warnings: string[]
  }
}

export type MultiYearTaxPlan = {
  horizonYears: number
  annualTargetCashKrw: number
  profiles: TaxYearProfile[]
  scenarios: MultiYearTaxScenario[]
  bestScenario: MultiYearTaxScenario | null
  marketSnapshot: MarketSalePlan[]
}

export type MasterPlanStrategyKey = 'EARLIEST_LT' | 'STAGED' | 'WAIT_US_ONLY' | 'ACCELERATE_LOSSES'

export type MasterPlanInstruction = {
  id: string
  lotId: number
  plannedDate: string
  yearMonth: string
  year: number
  market: string
  currency: string
  brokerage: string | null
  account: string
  ticker: string
  name: string
  acquiredDate: string
  longTermEligibleDate: string
  quantity: number
  proceedsKrw: number
  gainKrw: number
  holdingBucket: 'short' | 'long'
  role: 'gain' | 'loss' | 'neutral'
  reason: string
  washSaleRisk: boolean
  washSaleMatches: number
  washSaleNote: string
}

export type MasterPlanMonth = {
  yearMonth: string
  year: number
  label: string
  proceedsKrw: number
  gainKrw: number
  lossKrw: number
  instructionCount: number
  positionCount: number
  instructions: MasterPlanInstruction[]
}

export type MasterPlanYear = {
  year: number
  filingScenario: FilingScenario
  proceedsKrw: number
  gainKrw: number
  grossLossKrw: number
  estimatedTaxKrw: number
  usFederalShortTermTaxKrw: number
  usFederalLongTermTaxKrw: number
  usNiitTaxKrw: number
  usStateTaxKrw: number
  usGrossTaxKrw: number
  krGrossTaxKrw: number
  usForeignTaxCreditLimitKrw: number
  usForeignTaxCreditKrw: number
  krForeignTaxCreditKrw: number
  estimatedCrossBorderTaxCreditKrw: number
  incrementalKrTaxAfterCreditKrw: number
  afterTaxKrw: number
  instructionCount: number
}

export type MonthlySaleMasterPlan = {
  strategy: MasterPlanStrategyKey
  label: string
  description: string
  executionMonths: number
  months: MasterPlanMonth[]
  years: MasterPlanYear[]
  instructions: MasterPlanInstruction[]
  summary: {
    startDate: string | null
    endDate: string | null
    proceedsKrw: number
    gainKrw: number
    grossLossKrw: number
    estimatedTaxKrw: number
    estimatedCrossBorderTaxCreditKrw: number
    incrementalKrTaxAfterCreditKrw: number
    afterTaxKrw: number
    lotCount: number
    instructionCount: number
    longTermSalePct: number
    shortTermSaleCount: number
    averageWaitDays: number
  }
}

export type MonthlySalePlanSet = {
  asOfDate: string
  executionMonths: number
  selectedStrategy: MasterPlanStrategyKey
  selectedPlan: MonthlySaleMasterPlan
  scenarios: MonthlySaleMasterPlan[]
  firstUsOnlyYear: number | null
  coverage: {
    pricedLotCount: number
    missingValuationCount: number
    modeledProceedsKrw: number
  }
  timing: {
    alreadyLongLotCount: number
    waitingLotCount: number
    waitingProceedsKrw: number
    nextLongTermDate: string | null
    estimatedFederalTaxAvoidedKrw: number
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

function scenarioLabel(key: MultiYearStrategyKey) {
  if (key === 'KR_FIRST') return 'KR-market first'
  if (key === 'US_FIRST') return 'US-market first'
  if (key === 'LOSS_FIRST') return 'Loss first'
  return 'Balanced'
}

function scenarioDescription(key: MultiYearStrategyKey) {
  if (key === 'KR_FIRST') return 'Realize Korea-listed holdings earlier in the planning horizon; this is not a filing-order assumption.'
  if (key === 'US_FIRST') return 'Realize US-listed holdings earlier in the planning horizon; this is not a filing-order assumption.'
  if (key === 'LOSS_FIRST') return 'Use loss lots first across markets before raising the remaining cash target.'
  return 'Split each year across Korea and US market exposure based on available value.'
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

function netCapitalGainBuckets(netShortGainKrw: number, netLongGainKrw: number) {
  if (netShortGainKrw > 0 && netLongGainKrw < 0) {
    return { taxableShortKrw: Math.max(netShortGainKrw + netLongGainKrw, 0), taxableLongKrw: 0 }
  }
  if (netShortGainKrw < 0 && netLongGainKrw > 0) {
    return { taxableShortKrw: 0, taxableLongKrw: Math.max(netShortGainKrw + netLongGainKrw, 0) }
  }
  return {
    taxableShortKrw: Math.max(netShortGainKrw, 0),
    taxableLongKrw: Math.max(netLongGainKrw, 0),
  }
}

function candidateUsdKrwRate(candidates: TaxPlanCandidate[], policy: TaxPolicy) {
  const configured = assumptionNumber(policy, 'US', 'planningUsdKrwRate', 0)
  if (configured > 0) return configured
  const rates = candidates
    .filter((row) => row.currency === 'USD' && Number(row.proceedsNative ?? 0) > 0 && Number(row.proceedsKrw ?? 0) > 0)
    .map((row) => Number(row.proceedsKrw) / Number(row.proceedsNative))
    .filter((rate) => Number.isFinite(rate) && rate > 0)
    .sort((a, b) => a - b)
  if (!rates.length) return 1_350
  const middle = Math.floor(rates.length / 2)
  return rates.length % 2 ? rates[middle] : (rates[middle - 1] + rates[middle]) / 2
}

export function summarizeTaxCandidates({
  candidates,
  policy,
  scenario,
  year = new Date().getFullYear(),
}: {
  candidates: TaxPlanCandidate[]
  policy: TaxPolicy
  scenario: FilingScenario
  year?: number
}): TaxCandidateAggregate {
  const priced = candidates.filter((row) => row.proceedsKrw != null && row.gainKrw != null)
  const shortRows = priced.filter((row) => row.holdingBucket === 'short')
  const longRows = priced.filter((row) => row.holdingBucket === 'long')
  const sumGain = (rows: TaxPlanCandidate[]) => rows.reduce((sum, row) => sum + Number(row.gainKrw ?? 0), 0)
  const lossRows = priced.filter((row) => Number(row.gainKrw) < 0)
  const netShortGainKrw = sumGain(shortRows)
  const netLongGainKrw = sumGain(longRows)
  const usdKrwRate = candidateUsdKrwRate(priced, policy)
  const inputYear = assumptionNumber(policy, 'US', 'taxInputYear', new Date().getFullYear())
  const yearInput = year === inputYear
  const filingStatus = assumptionString(policy, 'US', 'filingStatus', 'MFJ')
  const stateCode = assumptionString(policy, 'US', 'stateCode', 'CA')
  const ordinaryIncomeUsd = projectedWagesUsd(policy, year)
  const federalBracketInflationPct = assumptionNumber(policy, 'US', 'federalBracketInflationPct', 2.5)
  const californiaBracketInflationPct = assumptionNumber(policy, 'US', 'californiaBracketInflationPct', 2.5)
  const engineInput = {
    year,
    filingStatus,
    stateCode,
    ordinaryIncomeUsd,
    shortGainUsd: netShortGainKrw / usdKrwRate,
    longGainUsd: netLongGainKrw / usdKrwRate,
    ytdShortGainUsd: yearInput ? assumptionNumber(policy, 'US', 'ytdRealizedShortGainLossUsd', 0) : 0,
    ytdLongGainUsd: yearInput ? assumptionNumber(policy, 'US', 'ytdRealizedLongGainLossUsd', 0) : 0,
    shortLossCarryoverUsd: yearInput ? assumptionNumber(policy, 'US', 'shortTermCapitalLossCarryoverUsd', 0) : 0,
    longLossCarryoverUsd: yearInput ? assumptionNumber(policy, 'US', 'longTermCapitalLossCarryoverUsd', 0) : 0,
    ordinaryLossDeductionLimitUsd: assumptionNumber(policy, 'US', 'lossDeductionLimitUsd', 3_000),
    federalBracketInflationPct,
    californiaBracketInflationPct,
    fallbackFederalShortRatePct: assumptionNumber(policy, 'US', 'federalShortTermRatePct', 24),
    fallbackFederalLongRatePct: assumptionNumber(policy, 'US', 'federalLongTermRatePct', 15),
    fallbackStateRatePct: assumptionNumber(policy, 'US', 'stateRatePct', 9.3),
    niitRatePct: assumptionNumber(policy, 'US', 'netInvestmentIncomeTaxRatePct', 3.8),
  }
  const baseUsEstimate = estimateUsCapitalGainTax(engineInput)
  const baseUsTaxKrw = isScenarioEnabled(scenario, 'US')
    ? baseUsEstimate.taxBeforeForeignTaxCreditUsd * usdKrwRate
    : 0

  const usMarketRows = priced.filter((row) => row.market === 'US')
  const usMarketNetShortGainKrw = sumGain(usMarketRows.filter((row) => row.holdingBucket === 'short'))
  const usMarketNetLongGainKrw = sumGain(usMarketRows.filter((row) => row.holdingBucket === 'long'))
  const usMarketTaxable = netCapitalGainBuckets(usMarketNetShortGainKrw, usMarketNetLongGainKrw)
  const usMarketEstimate = estimateUsCapitalGainTax({
    ...engineInput,
    shortGainUsd: usMarketTaxable.taxableShortKrw / usdKrwRate,
    longGainUsd: usMarketTaxable.taxableLongKrw / usdKrwRate,
    ytdShortGainUsd: 0,
    ytdLongGainUsd: 0,
    shortLossCarryoverUsd: 0,
    longLossCarryoverUsd: 0,
  })
  const usFederalTaxOnUsMarketGainKrw = isScenarioEnabled(scenario, 'US')
    ? usMarketEstimate.federalRegularTaxUsd * usdKrwRate
    : 0

  const krNetTaxableGainKrw = sumGain(priced.filter((row) => krTaxable(row, policy)))
  const krDeductionKrw = assumptionNumber(policy, 'KR', 'stockBasicDeductionKrw', 2500000)
  const krTaxRatePct = assumptionNumber(policy, 'KR', 'foreignStockFlatRatePct', 22)
  const krRate = pctRate(krTaxRatePct)
  const krNetTaxableGainBeforeDeductionKrw = Math.max(krNetTaxableGainKrw, 0)
  const krDeductionAppliedKrw = isScenarioEnabled(scenario, 'KR')
    ? Math.min(krNetTaxableGainBeforeDeductionKrw, krDeductionKrw)
    : 0
  const krTaxableGainAfterDeductionKrw = isScenarioEnabled(scenario, 'KR')
    ? Math.max(krNetTaxableGainBeforeDeductionKrw - krDeductionAppliedKrw, 0)
    : 0
  const krTaxKrw = isScenarioEnabled(scenario, 'KR')
    ? krTaxableGainAfterDeductionKrw * krRate
    : 0
  const creditMode = assumptionString(policy, 'KR', 'foreignTaxCreditMode', 'manual')
  const krForeignTaxCreditKrw =
    creditMode === 'estimated-us-source' && isScenarioEnabled(scenario, 'US') && isScenarioEnabled(scenario, 'KR')
      ? Math.min(krTaxKrw, usFederalTaxOnUsMarketGainKrw, baseUsTaxKrw)
      : 0
  const ftcForeignSourceGainPct = Math.min(
    Math.max(assumptionNumber(policy, 'US', 'ftcForeignSourceGainPct', 0), 0),
    100
  )
  const usEstimate = estimateUsCapitalGainTax({
    ...engineInput,
    foreignSourceIncomeUsd:
      creditMode === 'estimated-us-ftc'
        ? (krNetTaxableGainBeforeDeductionKrw / usdKrwRate) * (ftcForeignSourceGainPct / 100)
        : 0,
    foreignTaxPaidUsd: creditMode === 'estimated-us-ftc' ? krTaxKrw / usdKrwRate : 0,
    foreignTaxCreditCarryoverUsd:
      creditMode === 'estimated-us-ftc' && yearInput
        ? assumptionNumber(policy, 'US', 'foreignTaxCreditCarryoverUsd', 0)
        : 0,
  })
  const usTaxKrw = isScenarioEnabled(scenario, 'US') ? usEstimate.taxBeforeForeignTaxCreditUsd * usdKrwRate : 0
  const usForeignTaxCreditKrw = isScenarioEnabled(scenario, 'US')
    ? usEstimate.foreignTaxCreditAllowedUsd * usdKrwRate
    : 0
  const estimatedCrossBorderTaxCreditKrw = krForeignTaxCreditKrw + usForeignTaxCreditKrw
  const incrementalKrTaxAfterCreditKrw = Math.max(krTaxKrw - krForeignTaxCreditKrw, 0)
  const combinedTaxBeforeCreditsKrw = usTaxKrw + krTaxKrw
  const combinedTaxAfterCreditsKrw = Math.max(combinedTaxBeforeCreditsKrw - estimatedCrossBorderTaxCreditKrw, 0)

  const grossGainKrw = priced.reduce((sum, row) => sum + Math.max(Number(row.gainKrw), 0), 0)
  const grossLossKrw = priced.reduce((sum, row) => sum + Math.min(Number(row.gainKrw), 0), 0)
  const lossHarvestKrw = Math.abs(grossLossKrw)
  return {
    year,
    usdKrwRate,
    pricedLotCount: priced.length,
    totalProceedsKrw: priced.reduce((sum, row) => sum + Number(row.proceedsKrw), 0),
    grossGainKrw,
    grossLossKrw,
    netGainKrw: grossGainKrw + grossLossKrw,
    lossLotProceedsKrw: lossRows.reduce((sum, row) => sum + Number(row.proceedsKrw), 0),
    lossHarvestKrw,
    shortLossHarvestKrw: Math.abs(Math.min(sumGain(shortRows.filter((row) => Number(row.gainKrw) < 0)), 0)),
    longLossHarvestKrw: Math.abs(Math.min(sumGain(longRows.filter((row) => Number(row.gainKrw) < 0)), 0)),
    netShortGainKrw,
    netLongGainKrw,
    usTaxKrw,
    usTaxAfterForeignTaxCreditKrw: Math.max(usTaxKrw - usForeignTaxCreditKrw, 0),
    usFederalShortTermTaxKrw: usEstimate.federalShortTermTaxUsd * usdKrwRate,
    usFederalLongTermTaxKrw: usEstimate.federalLongTermTaxUsd * usdKrwRate,
    usNiitTaxKrw: usEstimate.niitTaxUsd * usdKrwRate,
    usStateTaxKrw: usEstimate.stateTaxUsd * usdKrwRate,
    usTaxableShortGainKrw: usEstimate.netting.taxableShortGainUsd * usdKrwRate,
    usTaxableLongGainKrw: usEstimate.netting.taxableLongGainUsd * usdKrwRate,
    usOrdinaryIncomeUsd: ordinaryIncomeUsd,
    usForeignTaxCreditLimitKrw: usEstimate.foreignTaxCreditLimitUsd * usdKrwRate,
    usForeignTaxCreditKrw,
    krForeignTaxCreditKrw,
    taxCalculationMethod: usEstimate.method,
    usFederalTaxOnUsMarketGainKrw,
    krNetTaxableGainBeforeDeductionKrw,
    krDeductionAppliedKrw,
    krTaxableGainAfterDeductionKrw,
    krTaxRatePct,
    krTaxKrw,
    combinedTaxBeforeCreditsKrw,
    estimatedCrossBorderTaxCreditKrw,
    incrementalKrTaxAfterCreditKrw,
    combinedTaxAfterCreditsKrw,
  }
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
    const explicitFxRate = Number(lot.fx_rate_to_base ?? 0)
    const basisFxRate = lot.currency === 'USD' && lot.native_cost_basis > 0 ? lot.cost_basis_krw / lot.native_cost_basis : 0
    const fxRateToBase = lot.currency === 'KRW' ? 1 : explicitFxRate || basisFxRate
    const normalizedProceedsKrw = proceedsNative == null ? null : proceedsNative * fxRateToBase
    const gainNative = lot.native_unrealized_gl == null ? (proceedsNative == null ? null : proceedsNative - Number(lot.native_cost_basis ?? 0)) : Number(lot.native_unrealized_gl)
    const gainKrw = normalizedProceedsKrw == null ? null : normalizedProceedsKrw - Number(lot.cost_basis_krw ?? 0)
    const holdingBucket = isLongTerm(lot) ? 'long' : 'short'

    const usApplies = isScenarioEnabled(scenario, 'US') && gainKrw != null && gainKrw > 0
    const usRate = pctRate((holdingBucket === 'long' ? usLongRatePct : usShortRatePct) + usStateRatePct + usNiitRatePct)
    const usTaxKrw = usApplies ? gainKrw * usRate : 0
    const usTaxUsd = usApplies && lot.currency === 'USD' && gainNative != null ? gainNative * usRate : 0
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
      warnings: [
        ...warningForLot(lot, policy, normalizedProceedsKrw, gainKrw),
        ...(lot.currency !== 'KRW' && !explicitFxRate && basisFxRate
          ? ['KRW estimate uses cost-basis FX because current FX is missing on the tax lot.']
          : []),
        ...(lot.market !== 'US' && isScenarioEnabled(scenario, 'US') && gainKrw != null && gainKrw > 0
          ? ['US tax estimate includes non-US market gains because US citizens/residents generally report worldwide income.']
          : []),
      ],
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
  const aggregate = summarizeTaxCandidates({ candidates: active, policy, scenario })
  const usTaxKrw = aggregate.usTaxKrw
  const usTaxUsd = aggregate.usdKrwRate > 0 ? usTaxKrw / aggregate.usdKrwRate : 0
  const krTaxKrw = aggregate.krTaxKrw
  const estimatedTaxBeforeCreditsKrw = aggregate.combinedTaxBeforeCreditsKrw
  const estimatedCrossBorderTaxCreditKrw = aggregate.estimatedCrossBorderTaxCreditKrw
  const estimatedTaxKrw = aggregate.combinedTaxAfterCreditsKrw

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
      usFederalShortTermTaxKrw: aggregate.usFederalShortTermTaxKrw,
      usFederalLongTermTaxKrw: aggregate.usFederalLongTermTaxKrw,
      usNiitTaxKrw: aggregate.usNiitTaxKrw,
      usStateTaxKrw: aggregate.usStateTaxKrw,
      usForeignTaxCreditLimitKrw: aggregate.usForeignTaxCreditLimitKrw,
      usForeignTaxCreditKrw: aggregate.usForeignTaxCreditKrw,
      krForeignTaxCreditKrw: aggregate.krForeignTaxCreditKrw,
      taxCalculationMethod: aggregate.taxCalculationMethod,
      krTaxKrw,
      estimatedTaxBeforeCreditsKrw,
      estimatedCrossBorderTaxCreditKrw,
      estimatedTaxKrw,
      estimatedAfterTaxKrw: grossProceedsKrw - estimatedTaxKrw,
      remainingKrDeductionKrw: Math.max(krBasicDeductionKrw - Math.max(grossGainKrw + grossLossKrw, 0), 0),
      warnings: Array.from(new Set(active.flatMap((row) => row.warnings))),
    },
  }
}

function cloneLots(lots: TaxPlanningLot[]) {
  return lots.map((lot) => ({ ...lot }))
}

function availableValueByMarket(lots: TaxPlanningLot[]) {
  return lots.reduce<Record<string, number>>((acc, lot) => {
    const fxRate = lot.currency === 'KRW' ? 1 : Number(lot.fx_rate_to_base ?? 0) || (lot.native_cost_basis > 0 ? lot.cost_basis_krw / lot.native_cost_basis : 0)
    const value = lot.native_market_value == null ? 0 : Number(lot.native_market_value) * fxRate
    acc[lot.market] = (acc[lot.market] ?? 0) + value
    return acc
  }, {})
}

function marketTargetsForStrategy(
  key: MultiYearStrategyKey,
  yearIndex: number,
  annualTargetCashKrw: number,
  remainingLots: TaxPlanningLot[]
) {
  const marketValues = availableValueByMarket(remainingLots)
  const total = Object.values(marketValues).reduce((sum, value) => sum + value, 0)
  if (annualTargetCashKrw <= 0) return marketValues

  if (key === 'KR_FIRST') {
    return yearIndex === 0 ? { KR: annualTargetCashKrw } : { KR: annualTargetCashKrw * 0.35, US: annualTargetCashKrw * 0.65 }
  }
  if (key === 'US_FIRST') {
    return yearIndex === 0 ? { US: annualTargetCashKrw } : { US: annualTargetCashKrw * 0.35, KR: annualTargetCashKrw * 0.65 }
  }
  if (key === 'BALANCED') {
    return Object.fromEntries(
      Object.entries(marketValues).map(([market, value]) => [market, total > 0 ? annualTargetCashKrw * (value / total) : 0])
    )
  }
  return marketValues
}

function summarizeMarkets(rows: TaxPlanCandidate[]) {
  const groups = rows.reduce<Record<string, MarketSalePlan>>((acc, row) => {
    const market = row.market
    acc[market] ??= {
      market,
      targetKrw: 0,
      proceedsKrw: 0,
      gainKrw: 0,
      taxKrw: 0,
      afterTaxKrw: 0,
      lotCount: 0,
    }
    acc[market].proceedsKrw += Number(row.proceedsKrw ?? 0)
    acc[market].gainKrw += Number(row.gainKrw ?? 0)
    acc[market].taxKrw += Number(row.estimatedTaxKrw ?? 0)
    acc[market].afterTaxKrw += Number(row.estimatedAfterTaxKrw ?? 0)
    acc[market].lotCount += 1
    return acc
  }, {})
  return Object.values(groups).sort((a, b) => b.proceedsKrw - a.proceedsKrw)
}

function allocateYear({
  lots,
  policy,
  profile,
  objective,
  annualTargetCashKrw,
  strategy,
  yearIndex,
}: {
  lots: TaxPlanningLot[]
  policy: TaxPolicy
  profile: TaxYearProfile
  objective: string
  annualTargetCashKrw: number
  strategy: MultiYearStrategyKey
  yearIndex: number
}) {
  const scenario = scenarioFromTaxYearProfile(profile)
  if (strategy === 'LOSS_FIRST') {
    const plan = buildTaxPlan({ lots, policy, scenario, objective: 'harvest-loss', targetCashKrw: 0 })
    const lossRows = plan.recommended.filter((row) => Number(row.gainKrw ?? 0) < 0)
    if (annualTargetCashKrw <= 0 || lossRows.reduce((sum, row) => sum + Number(row.proceedsKrw ?? 0), 0) >= annualTargetCashKrw) {
      return lossRows
    }
    const selectedIds = new Set(lossRows.map((row) => row.id))
    const supplemental = buildTaxPlan({
      lots: lots.filter((lot) => !selectedIds.has(lot.id)),
      policy,
      scenario,
      objective: 'minimize-tax',
      targetCashKrw: annualTargetCashKrw - lossRows.reduce((sum, row) => sum + Number(row.proceedsKrw ?? 0), 0),
    }).recommended
    return [...lossRows, ...supplemental]
  }

  const marketTargets = marketTargetsForStrategy(strategy, yearIndex, annualTargetCashKrw, lots)
  const selected: TaxPlanCandidate[] = []
  const selectedIds = new Set<number>()

  for (const [market, targetKrw] of Object.entries(marketTargets)) {
    const marketPlan = buildTaxPlan({
      lots: lots.filter((lot) => lot.market === market && !selectedIds.has(lot.id)),
      policy,
      scenario,
      objective,
      targetCashKrw: annualTargetCashKrw > 0 ? targetKrw : 0,
    })
    for (const row of marketPlan.recommended) {
      selected.push(row)
      selectedIds.add(row.id)
    }
  }

  if (annualTargetCashKrw > 0) {
    const raised = selected.reduce((sum, row) => sum + Number(row.proceedsKrw ?? 0), 0)
    if (raised < annualTargetCashKrw) {
      const supplemental = buildTaxPlan({
        lots: lots.filter((lot) => !selectedIds.has(lot.id)),
        policy,
        scenario,
        objective,
        targetCashKrw: annualTargetCashKrw - raised,
      }).recommended
      selected.push(...supplemental)
    }
  }

  return selected
}

export function buildMultiYearTaxPlan({
  lots,
  policy,
  horizonYears = policy.planningHorizonYears ?? 5,
  annualTargetCashKrw = 0,
  objective = 'minimize-tax',
}: {
  lots: TaxPlanningLot[]
  policy: TaxPolicy
  horizonYears?: number
  annualTargetCashKrw?: number
  objective?: string
}): MultiYearTaxPlan {
  const profiles = annualProfiles(policy, horizonYears)
  const strategies: MultiYearStrategyKey[] = ['KR_FIRST', 'US_FIRST', 'BALANCED', 'LOSS_FIRST']
  const scenarios = strategies.map((strategy) => {
    let remainingLots = cloneLots(lots)
    const years = profiles.map((profile, yearIndex) => {
      const selected = allocateYear({
        lots: remainingLots,
        policy,
        profile,
        objective,
        annualTargetCashKrw,
        strategy,
        yearIndex,
      })
      const selectedIds = new Set(selected.map((row) => row.id))
      remainingLots = remainingLots.filter((lot) => !selectedIds.has(lot.id))
      const markets = summarizeMarkets(selected)
      const targetMap = marketTargetsForStrategy(strategy, yearIndex, annualTargetCashKrw, remainingLots)
      for (const market of markets) market.targetKrw = Number(targetMap[market.market] ?? 0)
      const proceedsKrw = selected.reduce((sum, row) => sum + Number(row.proceedsKrw ?? 0), 0)
      const gainKrw = selected.reduce((sum, row) => sum + Number(row.gainKrw ?? 0), 0)
      const yearScenario = scenarioFromTaxYearProfile(profile)
      const aggregate = summarizeTaxCandidates({ candidates: selected, policy, scenario: yearScenario, year: profile.year })
      const taxKrw = aggregate.combinedTaxAfterCreditsKrw
      const afterTaxKrw = proceedsKrw - taxKrw
      const rawTaxKrw = selected.reduce((sum, row) => sum + Number(row.estimatedTaxKrw ?? 0), 0)
      const marketTaxRatio = rawTaxKrw > 0 ? taxKrw / rawTaxKrw : 1
      for (const market of markets) {
        market.taxKrw *= marketTaxRatio
        market.afterTaxKrw = market.proceedsKrw - market.taxKrw
      }
      return {
        year: profile.year,
        filingScenario: yearScenario,
        profile,
        targetCashKrw: annualTargetCashKrw,
        proceedsKrw,
        gainKrw,
        taxKrw,
        afterTaxKrw,
        effectiveTaxRatePct: proceedsKrw > 0 ? (taxKrw / proceedsKrw) * 100 : null,
        markets,
        lots: selected,
        warnings: Array.from(new Set(selected.flatMap((row) => row.warnings))),
      } satisfies TaxYearPlan
    })
    const proceedsKrw = years.reduce((sum, year) => sum + year.proceedsKrw, 0)
    const gainKrw = years.reduce((sum, year) => sum + year.gainKrw, 0)
    const taxKrw = years.reduce((sum, year) => sum + year.taxKrw, 0)
    const afterTaxKrw = years.reduce((sum, year) => sum + year.afterTaxKrw, 0)
    return {
      key: strategy,
      label: scenarioLabel(strategy),
      description: scenarioDescription(strategy),
      years,
      summary: {
        proceedsKrw,
        gainKrw,
        taxKrw,
        afterTaxKrw,
        peakYearTaxKrw: Math.max(...years.map((year) => year.taxKrw), 0),
        effectiveTaxRatePct: proceedsKrw > 0 ? (taxKrw / proceedsKrw) * 100 : null,
        lotCount: years.reduce((sum, year) => sum + year.lots.length, 0),
        warnings: Array.from(new Set(years.flatMap((year) => year.warnings))),
      },
    } satisfies MultiYearTaxScenario
  })
  const eligible = scenarios.filter((item) => item.summary.proceedsKrw > 0)
  return {
    horizonYears,
    annualTargetCashKrw,
    profiles,
    scenarios,
    bestScenario: eligible.sort((a, b) => a.summary.taxKrw - b.summary.taxKrw || b.summary.afterTaxKrw - a.summary.afterTaxKrw)[0] ?? null,
    marketSnapshot: summarizeMarkets(buildTaxPlan({ lots, policy, scenario: policy.activeScenario, objective: 'raise-cash', targetCashKrw: 0 }).candidates),
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

function parseDateOnly(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(year, Math.max(month - 1, 0), day || 1))
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10)
}

function localDateOnly(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function monthKey(value: Date) {
  return value.toISOString().slice(0, 7)
}

function monthStart(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1))
}

function monthEnd(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0))
}

function addMonths(value: Date, months: number) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1))
}

function laterDate(a: Date, b: Date) {
  return a.getTime() >= b.getTime() ? a : b
}

function longTermEligibleDate(acquiredDate: string) {
  const acquired = parseDateOnly(acquiredDate)
  const anniversary = new Date(acquired.getTime())
  anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1)
  return new Date(anniversary.getTime() + DAY_MS)
}

function firstUsOnlyYear(policy: TaxPolicy, horizonYears: number) {
  return annualProfiles(policy, horizonYears)
    .filter((profile) => scenarioFromTaxYearProfile(profile) === 'US_ONLY')
    .map((profile) => profile.year)
    .sort((a, b) => a - b)[0] ?? null
}

function masterStrategyLabel(strategy: MasterPlanStrategyKey, executionMonths: number) {
  if (strategy === 'EARLIEST_LT') return 'Sell at long-term eligibility'
  if (strategy === 'WAIT_US_ONLY') return 'Wait for US-only filing'
  if (strategy === 'ACCELERATE_LOSSES') return 'Accelerate loss harvesting'
  return `Stage sales over ${executionMonths} months`
}

function masterStrategyDescription(strategy: MasterPlanStrategyKey, executionMonths: number) {
  if (strategy === 'EARLIEST_LT') {
    return 'Sell each priced lot on the first available date after it becomes long-term for US tax purposes.'
  }
  if (strategy === 'WAIT_US_ONLY') {
    return 'Move both gain and loss lots to the first US-only filing year so the comparison preserves same-year loss netting.'
  }
  if (strategy === 'ACCELERATE_LOSSES') {
    return 'Make loss lots available now for same-year offset planning while waiting for gain lots to become long-term.'
  }
  return `Spread priced lots across ${executionMonths} months, prioritizing eligible loss and lower-gain lots within the monthly capacity.`
}

type ScheduleSlice = {
  candidate: TaxPlanCandidate
  eligibleDate: Date
  remainingFraction: number
}

function instructionFromSlice({
  slice,
  fraction,
  plannedDate,
  sequence,
  strategy,
}: {
  slice: ScheduleSlice
  fraction: number
  plannedDate: Date
  sequence: number
  strategy: MasterPlanStrategyKey
}): MasterPlanInstruction {
  const candidate = slice.candidate
  const gainKrw = Number(candidate.gainKrw ?? 0) * fraction
  const eligible = longTermEligibleDate(candidate.acquired_date)
  const longTerm = plannedDate.getTime() >= eligible.getTime()
  const role = gainKrw > 0 ? 'gain' : gainKrw < 0 ? 'loss' : 'neutral'
  const reason =
    strategy === 'WAIT_US_ONLY'
      ? 'Held for long-term treatment and same-year netting in the first US-only filing year'
      : strategy === 'ACCELERATE_LOSSES' && role === 'loss' && !longTerm
        ? 'Early loss candidate for same-year gain offset; wash-sale review required'
        : role === 'loss'
          ? 'Loss inventory scheduled with the annual realization plan'
          : longTerm
            ? 'First permitted window after long-term eligibility'
            : 'Short-term sale under the selected scenario'
  return {
    id: `${candidate.id}:${dateOnly(plannedDate)}:${sequence}`,
    lotId: candidate.id,
    plannedDate: dateOnly(plannedDate),
    yearMonth: monthKey(plannedDate),
    year: plannedDate.getUTCFullYear(),
    market: candidate.market,
    currency: candidate.currency,
    brokerage: candidate.brokerage,
    account: candidate.account,
    ticker: candidate.ticker,
    name: candidate.name,
    acquiredDate: candidate.acquired_date,
    longTermEligibleDate: dateOnly(eligible),
    quantity: Number(candidate.open_quantity) * fraction,
    proceedsKrw: Number(candidate.proceedsKrw ?? 0) * fraction,
    gainKrw,
    holdingBucket: longTerm ? 'long' : 'short',
    role,
    reason,
    washSaleRisk: false,
    washSaleMatches: 0,
    washSaleNote: '',
  }
}

function annotateWashSaleRisk(
  instructions: MasterPlanInstruction[],
  candidates: TaxPlanCandidate[],
  policy: TaxPolicy
) {
  const beforeDays = assumptionNumber(policy, 'US', 'washSaleWindowDaysBefore', 30)
  const afterDays = assumptionNumber(policy, 'US', 'washSaleWindowDaysAfter', 30)
  return instructions.map((instruction) => {
    if (instruction.gainKrw >= 0) return instruction
    const scenario = scenarioFromTaxYearProfile(annualProfileForYear(policy, instruction.year))
    if (!isScenarioEnabled(scenario, 'US')) return instruction
    const saleTime = parseDateOnly(instruction.plannedDate).getTime()
    const matches = candidates.filter((candidate) => {
      if (candidate.id === instruction.lotId) return false
      if (candidate.market !== instruction.market || candidate.ticker !== instruction.ticker) return false
      const purchaseTime = parseDateOnly(candidate.acquired_date).getTime()
      const dayDelta = (purchaseTime - saleTime) / DAY_MS
      return dayDelta >= -beforeDays && dayDelta <= afterDays
    })
    if (!matches.length) return instruction
    return {
      ...instruction,
      washSaleRisk: true,
      washSaleMatches: matches.length,
      washSaleNote: `${matches.length} open lot acquisition(s) for the same ticker fall inside the configured ${beforeDays}d before / ${afterDays}d after window. Future purchases and substantially identical securities are not modeled.`,
    }
  })
}

function scheduleImmediate(
  slices: ScheduleSlice[],
  asOf: Date,
  strategy: MasterPlanStrategyKey,
  usOnlyYear: number | null
) {
  const instructions: MasterPlanInstruction[] = []
  let sequence = 0
  for (const slice of slices) {
    const gain = Number(slice.candidate.gainKrw ?? 0)
    let plannedDate = laterDate(asOf, slice.eligibleDate)
    if (strategy === 'WAIT_US_ONLY' && usOnlyYear != null) {
      plannedDate = laterDate(plannedDate, new Date(Date.UTC(usOnlyYear, 0, 2)))
    }
    if (strategy === 'ACCELERATE_LOSSES' && gain < 0) plannedDate = asOf
    instructions.push(instructionFromSlice({ slice, fraction: 1, plannedDate, sequence: sequence++, strategy }))
  }
  return instructions.sort((a, b) => a.plannedDate.localeCompare(b.plannedDate) || a.ticker.localeCompare(b.ticker))
}

function scheduleStaged(slices: ScheduleSlice[], asOf: Date, executionMonths: number) {
  const instructions: MasterPlanInstruction[] = []
  const totalProceedsKrw = slices.reduce((sum, slice) => sum + Number(slice.candidate.proceedsKrw ?? 0), 0)
  const monthlyCapacityKrw = executionMonths > 0 ? totalProceedsKrw / executionMonths : totalProceedsKrw
  let sequence = 0
  let cursor = monthStart(asOf)
  const maxMonths = Math.max(executionMonths + 36, 60)

  for (let monthIndex = 0; monthIndex < maxMonths && slices.some((slice) => slice.remainingFraction > 1e-8); monthIndex += 1) {
    const end = monthEnd(cursor)
    let capacity = monthlyCapacityKrw
    const eligible = slices
      .filter((slice) => slice.remainingFraction > 1e-8 && slice.eligibleDate.getTime() <= end.getTime())
      .sort((a, b) => {
        const gainA = Number(a.candidate.gainKrw ?? 0)
        const gainB = Number(b.candidate.gainKrw ?? 0)
        const gainRatioA = Number(a.candidate.proceedsKrw ?? 0) > 0 ? gainA / Number(a.candidate.proceedsKrw) : 0
        const gainRatioB = Number(b.candidate.proceedsKrw ?? 0) > 0 ? gainB / Number(b.candidate.proceedsKrw) : 0
        return gainRatioA - gainRatioB || a.eligibleDate.getTime() - b.eligibleDate.getTime()
      })

    const losses = eligible.filter((slice) => Number(slice.candidate.gainKrw ?? 0) < 0)
    const gains = eligible.filter((slice) => Number(slice.candidate.gainKrw ?? 0) >= 0)
    const remainingLossProceeds = losses.reduce(
      (sum, slice) => sum + Number(slice.candidate.proceedsKrw ?? 0) * slice.remainingFraction,
      0
    )
    const remainingGainProceeds = gains.reduce(
      (sum, slice) => sum + Number(slice.candidate.proceedsKrw ?? 0) * slice.remainingFraction,
      0
    )
    const eligibleProceeds = remainingLossProceeds + remainingGainProceeds
    const lossBudget = eligibleProceeds > 0 ? capacity * (remainingLossProceeds / eligibleProceeds) : 0

    const allocate = (rows: ScheduleSlice[], budget: number) => {
      let remainingBudget = budget
      for (const slice of rows) {
        if (remainingBudget <= 0) break
        const remainingProceeds = Number(slice.candidate.proceedsKrw ?? 0) * slice.remainingFraction
        if (remainingProceeds <= 0) {
          slice.remainingFraction = 0
          continue
        }
        const saleProceeds = Math.min(remainingProceeds, remainingBudget)
        const fraction = saleProceeds / Number(slice.candidate.proceedsKrw)
        const preferredDay = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 15))
        const plannedDate = laterDate(laterDate(asOf, slice.eligibleDate), preferredDay)
        instructions.push(
          instructionFromSlice({ slice, fraction, plannedDate, sequence: sequence++, strategy: 'STAGED' })
        )
        slice.remainingFraction = Math.max(slice.remainingFraction - fraction, 0)
        remainingBudget -= saleProceeds
      }
      return budget - remainingBudget
    }

    const usedLoss = allocate(losses, lossBudget)
    const usedGain = allocate(gains, capacity - usedLoss)
    capacity -= usedLoss + usedGain
    if (capacity > 0) allocate([...losses, ...gains], capacity)
    cursor = addMonths(cursor, 1)
  }

  return instructions.sort((a, b) => a.plannedDate.localeCompare(b.plannedDate) || a.ticker.localeCompare(b.ticker))
}

function scheduledCandidate(
  instruction: MasterPlanInstruction,
  candidates: Map<number, TaxPlanCandidate>
): TaxPlanCandidate | null {
  const original = candidates.get(instruction.lotId)
  if (!original || original.proceedsKrw == null || original.gainKrw == null || original.open_quantity <= 0) return null
  const fraction = instruction.quantity / original.open_quantity
  return {
    ...original,
    open_quantity: instruction.quantity,
    native_cost_basis: original.native_cost_basis * fraction,
    native_market_value: original.native_market_value == null ? null : original.native_market_value * fraction,
    native_unrealized_gl: original.native_unrealized_gl == null ? null : original.native_unrealized_gl * fraction,
    cost_basis_krw: original.cost_basis_krw * fraction,
    proceedsNative: original.proceedsNative == null ? null : original.proceedsNative * fraction,
    proceedsKrw: instruction.proceedsKrw,
    gainNative: original.gainNative == null ? null : original.gainNative * fraction,
    gainKrw: instruction.gainKrw,
    holdingBucket: instruction.holdingBucket,
    usTaxUsd: 0,
    usTaxKrw: 0,
    krTaxKrw: 0,
    estimatedTaxKrw: 0,
    estimatedAfterTaxKrw: instruction.proceedsKrw,
  }
}

function assembleMasterPlan({
  instructions,
  candidates,
  policy,
  strategy,
  executionMonths,
  asOf,
}: {
  instructions: MasterPlanInstruction[]
  candidates: TaxPlanCandidate[]
  policy: TaxPolicy
  strategy: MasterPlanStrategyKey
  executionMonths: number
  asOf: Date
}): MonthlySaleMasterPlan {
  const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const years = Array.from(new Set(instructions.map((instruction) => instruction.year)))
    .sort((a, b) => a - b)
    .map((year) => {
      const yearInstructions = instructions.filter((instruction) => instruction.year === year)
      const yearCandidates = yearInstructions
        .map((instruction) => scheduledCandidate(instruction, candidateMap))
        .filter((candidate): candidate is TaxPlanCandidate => candidate != null)
      const filingScenario = scenarioFromTaxYearProfile(annualProfileForYear(policy, year))
      const aggregate = summarizeTaxCandidates({ candidates: yearCandidates, policy, scenario: filingScenario, year })
      return {
        year,
        filingScenario,
        proceedsKrw: aggregate.totalProceedsKrw,
        gainKrw: aggregate.netGainKrw,
        grossLossKrw: aggregate.grossLossKrw,
        estimatedTaxKrw: aggregate.combinedTaxAfterCreditsKrw,
        usFederalShortTermTaxKrw: aggregate.usFederalShortTermTaxKrw,
        usFederalLongTermTaxKrw: aggregate.usFederalLongTermTaxKrw,
        usNiitTaxKrw: aggregate.usNiitTaxKrw,
        usStateTaxKrw: aggregate.usStateTaxKrw,
        usGrossTaxKrw: aggregate.usTaxKrw,
        krGrossTaxKrw: aggregate.krTaxKrw,
        usForeignTaxCreditLimitKrw: aggregate.usForeignTaxCreditLimitKrw,
        usForeignTaxCreditKrw: aggregate.usForeignTaxCreditKrw,
        krForeignTaxCreditKrw: aggregate.krForeignTaxCreditKrw,
        estimatedCrossBorderTaxCreditKrw: aggregate.estimatedCrossBorderTaxCreditKrw,
        incrementalKrTaxAfterCreditKrw: aggregate.incrementalKrTaxAfterCreditKrw,
        afterTaxKrw: aggregate.totalProceedsKrw - aggregate.combinedTaxAfterCreditsKrw,
        instructionCount: yearInstructions.length,
      } satisfies MasterPlanYear
    })
  const months = Array.from(new Set(instructions.map((instruction) => instruction.yearMonth)))
    .sort()
    .map((key) => {
      const rows = instructions.filter((instruction) => instruction.yearMonth === key)
      const gainKrw = rows.reduce((sum, row) => sum + row.gainKrw, 0)
      return {
        yearMonth: key,
        year: Number(key.slice(0, 4)),
        label: new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
          parseDateOnly(`${key}-01`)
        ),
        proceedsKrw: rows.reduce((sum, row) => sum + row.proceedsKrw, 0),
        gainKrw,
        lossKrw: Math.abs(rows.reduce((sum, row) => sum + Math.min(row.gainKrw, 0), 0)),
        instructionCount: rows.length,
        positionCount: new Set(rows.map((row) => `${row.market}:${row.ticker}`)).size,
        instructions: rows,
      } satisfies MasterPlanMonth
    })
  const totalProceeds = instructions.reduce((sum, row) => sum + row.proceedsKrw, 0)
  const longTermProceeds = instructions
    .filter((row) => row.holdingBucket === 'long')
    .reduce((sum, row) => sum + row.proceedsKrw, 0)
  const weightedWaitDays = instructions.reduce((sum, row) => {
    const waitDays = Math.max((parseDateOnly(row.plannedDate).getTime() - asOf.getTime()) / DAY_MS, 0)
    return sum + waitDays * row.proceedsKrw
  }, 0)
  return {
    strategy,
    label: masterStrategyLabel(strategy, executionMonths),
    description: masterStrategyDescription(strategy, executionMonths),
    executionMonths,
    months,
    years,
    instructions,
    summary: {
      startDate: instructions[0]?.plannedDate ?? null,
      endDate: instructions[instructions.length - 1]?.plannedDate ?? null,
      proceedsKrw: totalProceeds,
      gainKrw: instructions.reduce((sum, row) => sum + row.gainKrw, 0),
      grossLossKrw: instructions.reduce((sum, row) => sum + Math.min(row.gainKrw, 0), 0),
      estimatedTaxKrw: years.reduce((sum, year) => sum + year.estimatedTaxKrw, 0),
      estimatedCrossBorderTaxCreditKrw: years.reduce(
        (sum, year) => sum + year.estimatedCrossBorderTaxCreditKrw,
        0
      ),
      incrementalKrTaxAfterCreditKrw: years.reduce(
        (sum, year) => sum + year.incrementalKrTaxAfterCreditKrw,
        0
      ),
      afterTaxKrw: years.reduce((sum, year) => sum + year.afterTaxKrw, 0),
      lotCount: new Set(instructions.map((row) => row.lotId)).size,
      instructionCount: instructions.length,
      longTermSalePct: totalProceeds > 0 ? (longTermProceeds / totalProceeds) * 100 : 0,
      shortTermSaleCount: instructions.filter((row) => row.holdingBucket === 'short').length,
      averageWaitDays: totalProceeds > 0 ? weightedWaitDays / totalProceeds : 0,
    },
  }
}

export function buildMonthlySalePlanSet({
  lots,
  policy,
  horizonYears = policy.planningHorizonYears ?? 5,
  executionMonths = 24,
  selectedStrategy = 'STAGED',
  asOfDate = localDateOnly(new Date()),
}: {
  lots: TaxPlanningLot[]
  policy: TaxPolicy
  horizonYears?: number
  executionMonths?: number
  selectedStrategy?: MasterPlanStrategyKey
  asOfDate?: string
}): MonthlySalePlanSet {
  const asOf = parseDateOnly(asOfDate)
  const normalizedExecutionMonths = Math.min(Math.max(Math.round(executionMonths), 1), 60)
  const currentPlan = buildTaxPlan({
    lots,
    policy,
    scenario: scenarioFromTaxYearProfile(annualProfileForYear(policy, asOf.getUTCFullYear())),
    objective: 'raise-cash',
    targetCashKrw: 0,
  })
  const candidates = currentPlan.candidates.filter(
    (candidate) => candidate.proceedsKrw != null && candidate.gainKrw != null && Number(candidate.proceedsKrw) > 0
  )
  const makeSlices = () =>
    candidates.map((candidate) => ({
      candidate,
      eligibleDate: longTermEligibleDate(candidate.acquired_date),
      remainingFraction: 1,
    }))
  const usOnlyYear = firstUsOnlyYear(policy, horizonYears)
  const strategies: MasterPlanStrategyKey[] = ['EARLIEST_LT', 'STAGED', 'WAIT_US_ONLY', 'ACCELERATE_LOSSES']
  const scenarios = strategies.map((strategy) => {
    const slices = makeSlices()
    const rawInstructions =
      strategy === 'STAGED'
        ? scheduleStaged(slices, asOf, normalizedExecutionMonths)
        : scheduleImmediate(slices, asOf, strategy, usOnlyYear)
    const instructions = annotateWashSaleRisk(rawInstructions, candidates, policy)
    return assembleMasterPlan({
      instructions,
      candidates,
      policy,
      strategy,
      executionMonths: normalizedExecutionMonths,
      asOf,
    })
  })
  const selectedPlan =
    scenarios.find((item) => item.strategy === selectedStrategy) ??
    scenarios.find((item) => item.strategy === 'STAGED') ??
    scenarios[0]
  const waiting = candidates.filter((candidate) => longTermEligibleDate(candidate.acquired_date).getTime() > asOf.getTime())
  const usShortRate = assumptionNumber(policy, 'US', 'federalShortTermRatePct', 37)
  const usLongRate = assumptionNumber(policy, 'US', 'federalLongTermRatePct', 20)
  return {
    asOfDate: dateOnly(asOf),
    executionMonths: normalizedExecutionMonths,
    selectedStrategy,
    selectedPlan,
    scenarios,
    firstUsOnlyYear: usOnlyYear,
    coverage: {
      pricedLotCount: candidates.length,
      missingValuationCount: currentPlan.candidates.length - candidates.length,
      modeledProceedsKrw: candidates.reduce((sum, candidate) => sum + Number(candidate.proceedsKrw), 0),
    },
    timing: {
      alreadyLongLotCount: candidates.length - waiting.length,
      waitingLotCount: waiting.length,
      waitingProceedsKrw: waiting.reduce((sum, candidate) => sum + Number(candidate.proceedsKrw), 0),
      nextLongTermDate:
        waiting
          .map((candidate) => dateOnly(longTermEligibleDate(candidate.acquired_date)))
          .sort()[0] ?? null,
      estimatedFederalTaxAvoidedKrw: waiting.reduce(
        (sum, candidate) =>
          sum + Math.max(Number(candidate.gainKrw), 0) * pctRate(Math.max(usShortRate - usLongRate, 0)),
        0
      ),
    },
  }
}
