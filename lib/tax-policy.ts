import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/config'

export type FilingScenario = 'US_ONLY' | 'KR_ONLY' | 'US_AND_KR'

export type TaxYearProfile = {
  year: number
  filingScenario: FilingScenario
  status: 'assumed' | 'confirmed'
  jurisdictions: {
    code: 'US' | 'KR' | string
    filingRequired: boolean
    taxCalculationEnabled: boolean
  }[]
}

export type TaxPolicy = {
  version: number
  activeScenario: FilingScenario
  baseCurrency: string
  planningHorizonYears?: number
  annualFilingProfiles?: TaxYearProfile[]
  jurisdictions: {
    code: 'US' | 'KR' | string
    enabled: boolean
    filingCurrency: string
    manualAssumptions: Record<string, unknown>
  }[]
  manualAdjustments: {
    id: string
    enabled: boolean
    jurisdiction: string
    scope: string
    amount: number
    currency: string
    note: string
  }[]
}

export type TaxPolicyState = {
  policy: TaxPolicy
  path: string
  examplePath: string
  source: 'local' | 'example'
  exists: boolean
  updatedAt: string | null
}

function readJson(filePath: string) {
  return normalizeTaxPolicy(JSON.parse(fs.readFileSync(filePath, 'utf8')) as TaxPolicy)
}

function statIso(filePath: string) {
  try {
    return new Date(fs.statSync(filePath).mtimeMs).toISOString()
  } catch {
    return null
  }
}

export function getTaxPolicyState(): TaxPolicyState {
  const localExists = fs.existsSync(config.stockTaxPolicyPath)
  const sourcePath = localExists ? config.stockTaxPolicyPath : config.stockTaxPolicyExamplePath
  return {
    policy: readJson(sourcePath),
    path: config.stockTaxPolicyPath,
    examplePath: config.stockTaxPolicyExamplePath,
    source: localExists ? 'local' : 'example',
    exists: localExists,
    updatedAt: statIso(sourcePath),
  }
}

function setAssumption(policy: TaxPolicy, jurisdiction: string, key: string, value: unknown) {
  const target = policy.jurisdictions.find((item) => item.code === jurisdiction)
  if (!target) return
  target.manualAssumptions[key] = value
}

function numeric(value: FormDataEntryValue | null) {
  if (value == null || String(value).trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function bool(value: FormDataEntryValue | null) {
  return value === 'on' || value === 'true'
}

function validScenario(value: unknown, fallback: FilingScenario): FilingScenario {
  return value === 'US_ONLY' || value === 'KR_ONLY' || value === 'US_AND_KR' ? value : fallback
}

function scenarioFlags(scenario: FilingScenario) {
  return {
    US: scenario === 'US_ONLY' || scenario === 'US_AND_KR',
    KR: scenario === 'KR_ONLY' || scenario === 'US_AND_KR',
  }
}

function defaultScenarioForYear(year: number, activeScenario: FilingScenario, currentYear = new Date().getFullYear()) {
  if (activeScenario === 'US_AND_KR' && year >= currentYear + 2) return 'US_ONLY'
  return activeScenario
}

export function scenarioFromTaxYearProfile(profile: TaxYearProfile): FilingScenario {
  const us = profile.jurisdictions.find((item) => item.code === 'US')?.taxCalculationEnabled ?? false
  const kr = profile.jurisdictions.find((item) => item.code === 'KR')?.taxCalculationEnabled ?? false
  if (us && kr) return 'US_AND_KR'
  if (us) return 'US_ONLY'
  if (kr) return 'KR_ONLY'
  return profile.filingScenario
}

export function annualProfileForYear(policy: TaxPolicy, year: number): TaxYearProfile {
  const found = policy.annualFilingProfiles?.find((item) => item.year === year)
  if (found) return found
  const fallbackScenario = defaultScenarioForYear(year, policy.activeScenario)
  const flags = scenarioFlags(fallbackScenario)
  return {
    year,
    filingScenario: fallbackScenario,
    status: 'assumed',
    jurisdictions: [
      { code: 'US', filingRequired: flags.US, taxCalculationEnabled: flags.US },
      { code: 'KR', filingRequired: flags.KR, taxCalculationEnabled: flags.KR },
    ],
  }
}

export function annualProfiles(policy: TaxPolicy, horizonYears = policy.planningHorizonYears ?? 5): TaxYearProfile[] {
  const startYear = new Date().getFullYear()
  return Array.from({ length: Math.max(1, horizonYears) }, (_, idx) => annualProfileForYear(policy, startYear + idx))
}

function normalizeAnnualProfile(raw: Partial<TaxYearProfile>, fallbackScenario: FilingScenario): TaxYearProfile | null {
  const year = Number(raw.year)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null
  const filingScenario = validScenario(raw.filingScenario, fallbackScenario)
  const flags = scenarioFlags(filingScenario)
  const jurisdictions = ['US', 'KR'].map((code) => {
    const found = raw.jurisdictions?.find((item) => item.code === code)
    return {
      code,
      filingRequired: typeof found?.filingRequired === 'boolean' ? found.filingRequired : flags[code as 'US' | 'KR'],
      taxCalculationEnabled:
        typeof found?.taxCalculationEnabled === 'boolean' ? found.taxCalculationEnabled : flags[code as 'US' | 'KR'],
    }
  })
  return {
    year,
    filingScenario,
    status: raw.status === 'confirmed' ? 'confirmed' : 'assumed',
    jurisdictions,
  }
}

export function normalizeTaxPolicy(raw: TaxPolicy): TaxPolicy {
  const activeScenario = validScenario(raw.activeScenario, 'US_AND_KR')
  const horizon = Number.isInteger(raw.planningHorizonYears) ? Number(raw.planningHorizonYears) : 5
  const normalized: TaxPolicy = {
    ...raw,
    version: Math.max(Number(raw.version || 1), 3),
    activeScenario,
    baseCurrency: String(raw.baseCurrency || 'KRW').toUpperCase(),
    planningHorizonYears: Math.min(Math.max(horizon, 1), 10),
    annualFilingProfiles: [],
  }
  const profiles = Array.isArray(raw.annualFilingProfiles)
    ? raw.annualFilingProfiles
        .map((profile) => normalizeAnnualProfile(profile, activeScenario))
        .filter((profile): profile is TaxYearProfile => profile != null)
    : []
  normalized.annualFilingProfiles = profiles.length ? profiles : annualProfiles(normalized, normalized.planningHorizonYears)
  return normalized
}

export function policyFromFormData(formData: FormData): TaxPolicy {
  const current = getTaxPolicyState().policy
  const policy: TaxPolicy = JSON.parse(JSON.stringify(current))
  const scenario = String(formData.get('activeScenario') ?? policy.activeScenario)
  policy.version = Math.max(Number(policy.version || 1), 3)
  policy.activeScenario = validScenario(scenario, 'US_AND_KR')
  policy.baseCurrency = String(formData.get('baseCurrency') ?? (policy.baseCurrency || 'KRW')).toUpperCase()
  policy.planningHorizonYears = Math.min(Math.max(numeric(formData.get('planningHorizonYears')) ?? 5, 1), 10)

  setAssumption(policy, 'US', 'federalShortTermRatePct', numeric(formData.get('usFederalShortTermRatePct')))
  setAssumption(policy, 'US', 'federalLongTermRatePct', numeric(formData.get('usFederalLongTermRatePct')))
  setAssumption(policy, 'US', 'stateRatePct', numeric(formData.get('usStateRatePct')))
  setAssumption(policy, 'US', 'netInvestmentIncomeTaxRatePct', numeric(formData.get('usNiitRatePct')))
  setAssumption(policy, 'US', 'lossDeductionLimitUsd', numeric(formData.get('usLossDeductionLimitUsd')) ?? 3000)
  setAssumption(policy, 'US', 'washSaleWindowDaysBefore', numeric(formData.get('usWashSaleBefore')) ?? 30)
  setAssumption(policy, 'US', 'washSaleWindowDaysAfter', numeric(formData.get('usWashSaleAfter')) ?? 30)
  setAssumption(policy, 'US', 'filingStatus', String(formData.get('usFilingStatus') ?? 'MFJ'))
  setAssumption(policy, 'US', 'stateCode', String(formData.get('usStateCode') ?? 'CA').toUpperCase())
  setAssumption(policy, 'US', 'wageBaseYear', numeric(formData.get('usWageBaseYear')) ?? new Date().getFullYear() - 1)
  setAssumption(policy, 'US', 'wageBaseUsd', numeric(formData.get('usWageBaseUsd')) ?? 0)
  setAssumption(policy, 'US', 'annualIncomeGrowthPct', numeric(formData.get('usAnnualIncomeGrowthPct')) ?? 0)
  setAssumption(policy, 'US', 'federalBracketInflationPct', numeric(formData.get('usFederalBracketInflationPct')) ?? 2.5)
  setAssumption(policy, 'US', 'californiaBracketInflationPct', numeric(formData.get('usCaliforniaBracketInflationPct')) ?? 2.5)
  setAssumption(policy, 'US', 'planningUsdKrwRate', numeric(formData.get('usPlanningUsdKrwRate')))
  setAssumption(policy, 'US', 'taxInputYear', numeric(formData.get('usTaxInputYear')) ?? new Date().getFullYear())
  setAssumption(policy, 'US', 'ytdRealizedShortGainLossUsd', numeric(formData.get('usYtdRealizedShortGainLossUsd')) ?? 0)
  setAssumption(policy, 'US', 'ytdRealizedLongGainLossUsd', numeric(formData.get('usYtdRealizedLongGainLossUsd')) ?? 0)
  setAssumption(policy, 'US', 'shortTermCapitalLossCarryoverUsd', numeric(formData.get('usShortTermCapitalLossCarryoverUsd')) ?? 0)
  setAssumption(policy, 'US', 'longTermCapitalLossCarryoverUsd', numeric(formData.get('usLongTermCapitalLossCarryoverUsd')) ?? 0)
  setAssumption(policy, 'US', 'foreignTaxCreditCarryoverUsd', numeric(formData.get('usForeignTaxCreditCarryoverUsd')) ?? 0)
  setAssumption(policy, 'US', 'ftcForeignSourceGainPct', numeric(formData.get('usFtcForeignSourceGainPct')) ?? 0)

  setAssumption(policy, 'KR', 'stockBasicDeductionKrw', numeric(formData.get('krStockBasicDeductionKrw')) ?? 2500000)
  setAssumption(policy, 'KR', 'foreignStockFlatRatePct', numeric(formData.get('krForeignStockFlatRatePct')) ?? 22)
  setAssumption(policy, 'KR', 'domesticMajorShareholder', bool(formData.get('krDomesticMajorShareholder')))
  setAssumption(policy, 'KR', 'domesticListedOffMarketSale', bool(formData.get('krDomesticListedOffMarketSale')))
  setAssumption(policy, 'KR', 'foreignStockTaxableResidenceYearsThreshold', numeric(formData.get('krForeignStockTaxableResidenceYearsThreshold')) ?? 5)
  setAssumption(policy, 'KR', 'residentThroughYear', numeric(formData.get('krResidentThroughYear')))
  setAssumption(policy, 'KR', 'foreignTaxCreditMode', String(formData.get('krForeignTaxCreditMode') ?? 'manual'))

  const profileYears = formData
    .getAll('profileYear')
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 2000 && value <= 2100)
  policy.annualFilingProfiles = profileYears.map((year) => {
    const filingScenario = validScenario(formData.get(`filingScenario_${year}`), policy.activeScenario)
    return {
      year,
      filingScenario,
      status: formData.get(`status_${year}`) === 'confirmed' ? 'confirmed' : 'assumed',
      jurisdictions: [
        {
          code: 'US',
          filingRequired: bool(formData.get(`usFilingRequired_${year}`)),
          taxCalculationEnabled: bool(formData.get(`usTaxCalculationEnabled_${year}`)),
        },
        {
          code: 'KR',
          filingRequired: bool(formData.get(`krFilingRequired_${year}`)),
          taxCalculationEnabled: bool(formData.get(`krTaxCalculationEnabled_${year}`)),
        },
      ],
    }
  })

  return normalizeTaxPolicy(policy)
}

export function saveTaxPolicy(policy: TaxPolicy) {
  fs.mkdirSync(path.dirname(config.stockTaxPolicyPath), { recursive: true })
  fs.writeFileSync(config.stockTaxPolicyPath, `${JSON.stringify(policy, null, 2)}\n`)
}

export function assumptionNumber(policy: TaxPolicy, jurisdiction: string, key: string, fallback: number) {
  const raw = policy.jurisdictions.find((item) => item.code === jurisdiction)?.manualAssumptions[key]
  if (raw == null || raw === '') return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function assumptionBool(policy: TaxPolicy, jurisdiction: string, key: string, fallback: boolean) {
  const raw = policy.jurisdictions.find((item) => item.code === jurisdiction)?.manualAssumptions[key]
  return typeof raw === 'boolean' ? raw : fallback
}

export function assumptionString(policy: TaxPolicy, jurisdiction: string, key: string, fallback: string) {
  const raw = policy.jurisdictions.find((item) => item.code === jurisdiction)?.manualAssumptions[key]
  return typeof raw === 'string' ? raw : fallback
}

export function projectedWagesUsd(policy: TaxPolicy, year: number) {
  const baseYear = assumptionNumber(policy, 'US', 'wageBaseYear', year)
  const baseWages = assumptionNumber(policy, 'US', 'wageBaseUsd', 0)
  const growthRate = assumptionNumber(policy, 'US', 'annualIncomeGrowthPct', 0) / 100
  return baseWages * Math.pow(1 + growthRate, Math.max(year - baseYear, 0))
}
