import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/config'

export type FilingScenario = 'US_ONLY' | 'KR_ONLY' | 'US_AND_KR'

export type TaxPolicy = {
  version: number
  activeScenario: FilingScenario
  baseCurrency: string
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
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as TaxPolicy
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

export function policyFromFormData(formData: FormData): TaxPolicy {
  const current = getTaxPolicyState().policy
  const policy: TaxPolicy = JSON.parse(JSON.stringify(current))
  const scenario = String(formData.get('activeScenario') ?? policy.activeScenario)
  policy.activeScenario = ['US_ONLY', 'KR_ONLY', 'US_AND_KR'].includes(scenario) ? (scenario as FilingScenario) : 'US_AND_KR'
  policy.baseCurrency = String(formData.get('baseCurrency') ?? (policy.baseCurrency || 'KRW')).toUpperCase()

  setAssumption(policy, 'US', 'federalShortTermRatePct', numeric(formData.get('usFederalShortTermRatePct')))
  setAssumption(policy, 'US', 'federalLongTermRatePct', numeric(formData.get('usFederalLongTermRatePct')))
  setAssumption(policy, 'US', 'stateRatePct', numeric(formData.get('usStateRatePct')))
  setAssumption(policy, 'US', 'netInvestmentIncomeTaxRatePct', numeric(formData.get('usNiitRatePct')))
  setAssumption(policy, 'US', 'lossDeductionLimitUsd', numeric(formData.get('usLossDeductionLimitUsd')) ?? 3000)
  setAssumption(policy, 'US', 'washSaleWindowDaysBefore', numeric(formData.get('usWashSaleBefore')) ?? 30)
  setAssumption(policy, 'US', 'washSaleWindowDaysAfter', numeric(formData.get('usWashSaleAfter')) ?? 30)

  setAssumption(policy, 'KR', 'stockBasicDeductionKrw', numeric(formData.get('krStockBasicDeductionKrw')) ?? 2500000)
  setAssumption(policy, 'KR', 'foreignStockFlatRatePct', numeric(formData.get('krForeignStockFlatRatePct')) ?? 22)
  setAssumption(policy, 'KR', 'domesticMajorShareholder', bool(formData.get('krDomesticMajorShareholder')))
  setAssumption(policy, 'KR', 'domesticListedOffMarketSale', bool(formData.get('krDomesticListedOffMarketSale')))
  setAssumption(policy, 'KR', 'foreignStockTaxableResidenceYearsThreshold', numeric(formData.get('krForeignStockTaxableResidenceYearsThreshold')) ?? 5)
  setAssumption(policy, 'KR', 'foreignTaxCreditMode', String(formData.get('krForeignTaxCreditMode') ?? 'manual'))

  return policy
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
