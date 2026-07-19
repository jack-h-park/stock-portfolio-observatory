import {
  annualProfiles,
  assumptionBool,
  assumptionNumber,
  assumptionString,
  scenarioFromTaxYearProfile,
  type FilingScenario,
  type TaxPolicy,
  type TaxYearProfile,
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

    const usApplies = isScenarioEnabled(scenario, 'US') && lot.market === 'US' && gainNative != null && gainNative > 0
    const usRate = pctRate((holdingBucket === 'long' ? usLongRatePct : usShortRatePct) + usStateRatePct + usNiitRatePct)
    const usTaxUsd = usApplies ? gainNative * usRate : 0
    const usdToKrw = lot.currency === 'USD' ? fxRateToBase : 0
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
      warnings: [
        ...warningForLot(lot, policy, normalizedProceedsKrw, gainKrw),
        ...(lot.currency !== 'KRW' && !explicitFxRate && basisFxRate
          ? ['KRW estimate uses cost-basis FX because current FX is missing on the tax lot.']
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
      const grossGainKrw = selected.reduce((sum, row) => sum + Math.max(Number(row.gainKrw ?? 0), 0), 0)
      const grossLossKrw = selected.reduce((sum, row) => sum + Math.min(Number(row.gainKrw ?? 0), 0), 0)
      const krRate = pctRate(assumptionNumber(policy, 'KR', 'foreignStockFlatRatePct', 22))
      const krDeduction = assumptionNumber(policy, 'KR', 'stockBasicDeductionKrw', 2500000)
      const rawKrTax = selected.reduce((sum, row) => sum + row.krTaxKrw, 0)
      const adjustedKrTax = isScenarioEnabled(scenarioFromTaxYearProfile(profile), 'KR')
        ? Math.max(rawKrTax - Math.max(rawKrTax - Math.max(grossGainKrw + grossLossKrw - krDeduction, 0) * krRate, 0), 0)
        : 0
      const taxKrw = selected.reduce((sum, row) => sum + row.usTaxKrw, 0) + adjustedKrTax
      const afterTaxKrw = proceedsKrw - taxKrw
      const rawTaxKrw = selected.reduce((sum, row) => sum + Number(row.estimatedTaxKrw ?? 0), 0)
      const marketTaxRatio = rawTaxKrw > 0 ? taxKrw / rawTaxKrw : 1
      for (const market of markets) {
        market.taxKrw *= marketTaxRatio
        market.afterTaxKrw = market.proceedsKrw - market.taxKrw
      }
      return {
        year: profile.year,
        filingScenario: scenarioFromTaxYearProfile(profile),
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
