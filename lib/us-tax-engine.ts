export type CapitalGainNetting = {
  netShortGainUsd: number
  netLongGainUsd: number
  taxableShortGainUsd: number
  taxableLongGainUsd: number
  netCapitalLossUsd: number
  ordinaryLossDeductionUsd: number
  projectedLossCarryforwardUsd: number
}

export type UsTaxEstimate = {
  year: number
  method: 'progressive-mfj' | 'screening-rate-fallback'
  ordinaryIncomeUsd: number
  federalTaxableIncomeBeforeGainsUsd: number
  netting: CapitalGainNetting
  federalShortTermTaxUsd: number
  federalLongTermTaxUsd: number
  federalRegularTaxUsd: number
  totalFederalRegularTaxLiabilityUsd: number
  niitTaxUsd: number
  stateTaxUsd: number
  taxBeforeForeignTaxCreditUsd: number
  foreignSourceIncomeUsd: number
  foreignTaxCreditLimitUsd: number
  foreignTaxCreditAvailableUsd: number
  foreignTaxCreditAllowedUsd: number
  taxAfterForeignTaxCreditUsd: number
  assumptions: {
    filingStatus: string
    federalStandardDeductionUsd: number
    californiaStandardDeductionUsd: number
    niitThresholdUsd: number
    federalBracketBasis: string
    californiaBracketBasis: string
  }
}

type ProgressiveBracket = { upTo: number; rate: number }

const FEDERAL_2026_MFJ: ProgressiveBracket[] = [
  { upTo: 24_800, rate: 0.1 },
  { upTo: 100_800, rate: 0.12 },
  { upTo: 211_400, rate: 0.22 },
  { upTo: 403_550, rate: 0.24 },
  { upTo: 512_450, rate: 0.32 },
  { upTo: 768_700, rate: 0.35 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.37 },
]

const CALIFORNIA_2025_MFJ: ProgressiveBracket[] = [
  { upTo: 22_158, rate: 0.01 },
  { upTo: 52_528, rate: 0.02 },
  { upTo: 82_904, rate: 0.04 },
  { upTo: 115_084, rate: 0.06 },
  { upTo: 145_448, rate: 0.08 },
  { upTo: 742_958, rate: 0.093 },
  { upTo: 891_542, rate: 0.103 },
  { upTo: 1_485_906, rate: 0.113 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.123 },
]

function nonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(value, 0) : 0
}

function inflationFactor(year: number, baseYear: number, annualPct: number) {
  return Math.pow(1 + Math.max(annualPct, -99) / 100, year - baseYear)
}

function inflateBrackets(brackets: ProgressiveBracket[], factor: number) {
  return brackets.map((bracket) => ({
    upTo: Number.isFinite(bracket.upTo) ? bracket.upTo * factor : bracket.upTo,
    rate: bracket.rate,
  }))
}

function progressiveTax(income: number, brackets: ProgressiveBracket[]) {
  const taxable = nonNegative(income)
  let previous = 0
  let tax = 0
  for (const bracket of brackets) {
    const amount = Math.max(Math.min(taxable, bracket.upTo) - previous, 0)
    tax += amount * bracket.rate
    if (taxable <= bracket.upTo) break
    previous = bracket.upTo
  }
  return tax
}

function incrementalProgressiveTax(baseIncome: number, additionalIncome: number, brackets: ProgressiveBracket[]) {
  if (additionalIncome <= 0) return 0
  return progressiveTax(baseIncome + additionalIncome, brackets) - progressiveTax(baseIncome, brackets)
}

export function netUsCapitalGains({
  shortGainUsd,
  longGainUsd,
  ytdShortGainUsd = 0,
  ytdLongGainUsd = 0,
  shortLossCarryoverUsd = 0,
  longLossCarryoverUsd = 0,
  ordinaryLossDeductionLimitUsd = 3_000,
}: {
  shortGainUsd: number
  longGainUsd: number
  ytdShortGainUsd?: number
  ytdLongGainUsd?: number
  shortLossCarryoverUsd?: number
  longLossCarryoverUsd?: number
  ordinaryLossDeductionLimitUsd?: number
}): CapitalGainNetting {
  const netShortGainUsd = shortGainUsd + ytdShortGainUsd - Math.abs(shortLossCarryoverUsd)
  const netLongGainUsd = longGainUsd + ytdLongGainUsd - Math.abs(longLossCarryoverUsd)
  let taxableShortGainUsd = Math.max(netShortGainUsd, 0)
  let taxableLongGainUsd = Math.max(netLongGainUsd, 0)

  if (netShortGainUsd > 0 && netLongGainUsd < 0) {
    taxableShortGainUsd = Math.max(netShortGainUsd + netLongGainUsd, 0)
    taxableLongGainUsd = 0
  } else if (netShortGainUsd < 0 && netLongGainUsd > 0) {
    taxableShortGainUsd = 0
    taxableLongGainUsd = Math.max(netShortGainUsd + netLongGainUsd, 0)
  }

  const netCapitalLossUsd = Math.max(-(netShortGainUsd + netLongGainUsd), 0)
  const ordinaryLossDeductionUsd = Math.min(netCapitalLossUsd, nonNegative(ordinaryLossDeductionLimitUsd))
  return {
    netShortGainUsd,
    netLongGainUsd,
    taxableShortGainUsd,
    taxableLongGainUsd,
    netCapitalLossUsd,
    ordinaryLossDeductionUsd,
    projectedLossCarryforwardUsd: Math.max(netCapitalLossUsd - ordinaryLossDeductionUsd, 0),
  }
}

function federalLongTermTax(baseTaxableIncomeUsd: number, longTermGainUsd: number, year: number, inflationPct: number) {
  if (longTermGainUsd <= 0) return 0
  const factor = inflationFactor(year, 2026, inflationPct)
  const zeroRateCeiling = 98_900 * factor
  const fifteenRateCeiling = 613_700 * factor
  const zeroRateAmount = Math.min(longTermGainUsd, Math.max(zeroRateCeiling - baseTaxableIncomeUsd, 0))
  const remainingAfterZero = longTermGainUsd - zeroRateAmount
  const fifteenRateAmount = Math.min(
    remainingAfterZero,
    Math.max(fifteenRateCeiling - Math.max(baseTaxableIncomeUsd, zeroRateCeiling), 0)
  )
  const twentyRateAmount = Math.max(remainingAfterZero - fifteenRateAmount, 0)
  return fifteenRateAmount * 0.15 + twentyRateAmount * 0.2
}

export function estimateUsCapitalGainTax({
  year,
  filingStatus,
  stateCode,
  ordinaryIncomeUsd,
  shortGainUsd,
  longGainUsd,
  ytdShortGainUsd = 0,
  ytdLongGainUsd = 0,
  shortLossCarryoverUsd = 0,
  longLossCarryoverUsd = 0,
  ordinaryLossDeductionLimitUsd = 3_000,
  federalBracketInflationPct = 2.5,
  californiaBracketInflationPct = 2.5,
  fallbackFederalShortRatePct = 24,
  fallbackFederalLongRatePct = 15,
  fallbackStateRatePct = 9.3,
  niitRatePct = 3.8,
  foreignSourceIncomeUsd = 0,
  foreignTaxPaidUsd = 0,
  foreignTaxCreditCarryoverUsd = 0,
}: {
  year: number
  filingStatus: string
  stateCode: string
  ordinaryIncomeUsd: number
  shortGainUsd: number
  longGainUsd: number
  ytdShortGainUsd?: number
  ytdLongGainUsd?: number
  shortLossCarryoverUsd?: number
  longLossCarryoverUsd?: number
  ordinaryLossDeductionLimitUsd?: number
  federalBracketInflationPct?: number
  californiaBracketInflationPct?: number
  fallbackFederalShortRatePct?: number
  fallbackFederalLongRatePct?: number
  fallbackStateRatePct?: number
  niitRatePct?: number
  foreignSourceIncomeUsd?: number
  foreignTaxPaidUsd?: number
  foreignTaxCreditCarryoverUsd?: number
}): UsTaxEstimate {
  const normalizedStatus = filingStatus.toUpperCase()
  const isMfj = normalizedStatus === 'MFJ' || normalizedStatus === 'MARRIED_FILING_JOINTLY'
  const federalFactor = inflationFactor(year, 2026, federalBracketInflationPct)
  const federalStandardDeductionUsd = 32_200 * federalFactor
  const californiaFactor = inflationFactor(year, 2025, californiaBracketInflationPct)
  const californiaStandardDeductionUsd = 11_412 * californiaFactor
  const federalTaxableIncomeBeforeGainsUsd = Math.max(ordinaryIncomeUsd - federalStandardDeductionUsd, 0)
  const netting = netUsCapitalGains({
    shortGainUsd,
    longGainUsd,
    ytdShortGainUsd,
    ytdLongGainUsd,
    shortLossCarryoverUsd,
    longLossCarryoverUsd,
    ordinaryLossDeductionLimitUsd,
  })

  const federalBrackets = inflateBrackets(FEDERAL_2026_MFJ, federalFactor)
  const federalShortTermTaxUsd = isMfj
    ? incrementalProgressiveTax(
        federalTaxableIncomeBeforeGainsUsd,
        netting.taxableShortGainUsd,
        federalBrackets
      )
    : netting.taxableShortGainUsd * (fallbackFederalShortRatePct / 100)
  const federalLongTermTaxUsd = isMfj
    ? federalLongTermTax(
        federalTaxableIncomeBeforeGainsUsd + netting.taxableShortGainUsd,
        netting.taxableLongGainUsd,
        year,
        federalBracketInflationPct
      )
    : netting.taxableLongGainUsd * (fallbackFederalLongRatePct / 100)
  const federalRegularTaxUsd = federalShortTermTaxUsd + federalLongTermTaxUsd
  const totalFederalRegularTaxLiabilityUsd =
    (isMfj
      ? progressiveTax(federalTaxableIncomeBeforeGainsUsd, federalBrackets)
      : federalTaxableIncomeBeforeGainsUsd * (fallbackFederalShortRatePct / 100)) + federalRegularTaxUsd
  const positiveInvestmentIncomeUsd = netting.taxableShortGainUsd + netting.taxableLongGainUsd
  const niitThresholdUsd = isMfj ? 250_000 : normalizedStatus === 'MFS' ? 125_000 : 200_000
  const niitTaxUsd =
    Math.min(positiveInvestmentIncomeUsd, Math.max(ordinaryIncomeUsd + positiveInvestmentIncomeUsd - niitThresholdUsd, 0)) *
    (niitRatePct / 100)

  const stateGainUsd = positiveInvestmentIncomeUsd
  let stateTaxUsd = stateGainUsd * (fallbackStateRatePct / 100)
  let californiaBracketBasis = 'Configured screening state rate'
  if (stateCode.toUpperCase() === 'CA' && isMfj) {
    const californiaTaxableIncomeBeforeGainsUsd = Math.max(ordinaryIncomeUsd - californiaStandardDeductionUsd, 0)
    const californiaBrackets = inflateBrackets(CALIFORNIA_2025_MFJ, californiaFactor)
    stateTaxUsd = incrementalProgressiveTax(californiaTaxableIncomeBeforeGainsUsd, stateGainUsd, californiaBrackets)
    const millionaireTaxBase = Math.max(californiaTaxableIncomeBeforeGainsUsd - 1_000_000, 0)
    const millionaireTaxWithGains = Math.max(californiaTaxableIncomeBeforeGainsUsd + stateGainUsd - 1_000_000, 0)
    stateTaxUsd += (millionaireTaxWithGains - millionaireTaxBase) * 0.01
    californiaBracketBasis = `2025 FTB MFJ schedule projected ${californiaBracketInflationPct.toFixed(2)}% annually`
  }

  const taxBeforeForeignTaxCreditUsd = federalRegularTaxUsd + niitTaxUsd + stateTaxUsd
  const totalTaxableIncomeUsd = federalTaxableIncomeBeforeGainsUsd + positiveInvestmentIncomeUsd
  const cappedForeignSourceIncomeUsd = Math.min(nonNegative(foreignSourceIncomeUsd), positiveInvestmentIncomeUsd)
  const foreignTaxCreditLimitUsd =
    totalTaxableIncomeUsd > 0
      ? totalFederalRegularTaxLiabilityUsd * Math.min(cappedForeignSourceIncomeUsd / totalTaxableIncomeUsd, 1)
      : 0
  const foreignTaxCreditAvailableUsd = nonNegative(foreignTaxPaidUsd) + nonNegative(foreignTaxCreditCarryoverUsd)
  const foreignTaxCreditAllowedUsd = Math.min(foreignTaxCreditAvailableUsd, foreignTaxCreditLimitUsd)

  return {
    year,
    method: isMfj ? 'progressive-mfj' : 'screening-rate-fallback',
    ordinaryIncomeUsd,
    federalTaxableIncomeBeforeGainsUsd,
    netting,
    federalShortTermTaxUsd,
    federalLongTermTaxUsd,
    federalRegularTaxUsd,
    totalFederalRegularTaxLiabilityUsd,
    niitTaxUsd,
    stateTaxUsd,
    taxBeforeForeignTaxCreditUsd,
    foreignSourceIncomeUsd: cappedForeignSourceIncomeUsd,
    foreignTaxCreditLimitUsd,
    foreignTaxCreditAvailableUsd,
    foreignTaxCreditAllowedUsd,
    taxAfterForeignTaxCreditUsd: Math.max(taxBeforeForeignTaxCreditUsd - foreignTaxCreditAllowedUsd, 0),
    assumptions: {
      filingStatus: normalizedStatus,
      federalStandardDeductionUsd,
      californiaStandardDeductionUsd,
      niitThresholdUsd,
      federalBracketBasis: isMfj
        ? `2026 IRS MFJ schedule projected ${federalBracketInflationPct.toFixed(2)}% annually after 2026`
        : 'Configured screening federal rates',
      californiaBracketBasis,
    },
  }
}
