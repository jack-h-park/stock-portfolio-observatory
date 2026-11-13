import inputSchema from '@/schemas/annual-tax-estimate-input.v1.schema.json'
import resultSchema from '@/schemas/annual-tax-estimate-result.v1.schema.json'
import { annualJsonDigest, getAnnualRulePack, getAnnualRuleStatus, type AnnualComponentId } from './rules'
import { assertAnnualSchema } from './schema'

type Authority = 'US:federal' | 'KR:national' | 'KR:local'
type Currency = 'USD' | 'KRW'
type Provenance = { reason: string; sourceRefs: string[]; reviewedAt?: string }
export type AnnualAmount = Provenance & { minor: string; currency: Currency; origin: 'reviewed-input' | 'synthetic' | 'assumption' }
export type AnnualEstimateInput = {
  schemaVersion: 1; rulePackId: 'annual-2025-foundation-v1'; id: string; revision: number; taxYear: 2025
  taxUnit: { id: string; kind: 'individual' | 'joint'; ownerIds: string[] }
  authority: Authority; currency: Currency; taxType: 'income'; filingStatus: 'single' | 'mfj' | 'individual'
  requestedComponents: AnnualComponentId[]
  residency: Provenance & { state: 'reviewed-full-year' | 'unknown' | 'unsupported' }
  specialMethod: Provenance & { state: 'none-reviewed' | 'unknown' | 'unsupported' }
  regularTaxMethod: Provenance & { state: 'ordinary-reviewed' | 'qdcg-reviewed' | 'general-reviewed' | 'unknown' | 'unsupported' }
  sources: { id: string; sha256: string; locator: string }[]
  amounts: Partial<Record<AmountKey, AnnualAmount>>
}
type AmountKey = 'taxableIncome' | 'ordinaryDividends' | 'qualifiedDividends' | 'netLongTermGain' | 'netCapitalGain' | 'niitMagi' | 'netInvestmentIncome' | 'taxableBase'
export type AnnualComponentResult = Provenance & {
  id: AnnualComponentId; mode: 'computed' | 'reviewed-input' | 'not-applicable' | 'unknown' | 'unsupported'
  amountMinor: string | null; inputRefs: AmountKey[]; trace: { label: string }[]
}
export type AnnualEstimateResult = {
  schemaVersion: 1; rulePackId: 'annual-2025-foundation-v1'; rulePackSha256: string; scenarioId: string; inputRevision: number; inputSha256: string; taxYear: 2025
  taxUnitId: string; authority: Authority; currency: Currency; taxType: 'income'
  calculationScope: 'component'; status: 'components-only' | 'blocked'; annualTotal: null; comparisonEligible: false
  components: AnnualComponentResult[]
}
const requiredAmounts: Record<AnnualComponentId, AmountKey[]> = {
  'us.regular.ordinary': ['taxableIncome'],
  'us.regular.qdcg': ['taxableIncome', 'ordinaryDividends', 'qualifiedDividends', 'netLongTermGain', 'netCapitalGain'],
  'us.niit': ['niitMagi', 'netInvestmentIncome'],
  'kr.global.calculated': ['taxableBase'], 'kr.local.calculated': ['taxableBase'],
}
function requireCondition(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Invalid annual contract: ${message}`)
}
function checkDate(date: string | undefined) {
  requireCondition(date && /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date, 'review date must be a valid calendar date')
}
function provenance(value: Provenance, sources: Set<string>, reviewed: boolean) {
  requireCondition(value.sourceRefs.every(id => sources.has(id)), 'unresolved source reference')
  if (value.reviewedAt !== undefined) checkDate(value.reviewedAt)
  if (reviewed) { checkDate(value.reviewedAt); requireCondition(value.sourceRefs.length, 'reviewed facts require sources') }
}

/** Validates scope and provenance metadata only; never opens source files or infers missing amounts. */
export function validateAnnualEstimateInput(value: unknown): AnnualEstimateInput {
  assertAnnualSchema(value, inputSchema)
  const input = value as AnnualEstimateInput
  const us = input.authority === 'US:federal'
  requireCondition(input.currency === (us ? 'USD' : 'KRW'), 'authority/currency mismatch')
  requireCondition(us ? ['single', 'mfj'].includes(input.filingStatus) : input.filingStatus === 'individual', 'unsupported filing profile')
  const joint = input.filingStatus === 'mfj'
  requireCondition(input.taxUnit.kind === (joint ? 'joint' : 'individual') && input.taxUnit.ownerIds.length === (joint ? 2 : 1), 'tax-unit membership mismatch')
  const allowed = us ? ['us.regular.ordinary', 'us.regular.qdcg', 'us.niit'] : [input.authority === 'KR:national' ? 'kr.global.calculated' : 'kr.local.calculated']
  requireCondition(input.requestedComponents.every(id => allowed.includes(id)), 'authority/component mismatch')
  requireCondition(!(input.requestedComponents.includes('us.regular.ordinary') && input.requestedComponents.includes('us.regular.qdcg')), 'regular-tax methods are mutually exclusive')
  const sources = new Set(input.sources.map(source => source.id))
  requireCondition(sources.size === input.sources.length, 'duplicate source IDs')
  provenance(input.residency, sources, input.residency.state === 'reviewed-full-year')
  provenance(input.specialMethod, sources, input.specialMethod.state === 'none-reviewed')
  provenance(input.regularTaxMethod, sources, input.regularTaxMethod.state.endsWith('-reviewed'))
  requireCondition(us ? input.regularTaxMethod.state !== 'general-reviewed' : !['ordinary-reviewed', 'qdcg-reviewed'].includes(input.regularTaxMethod.state), 'authority/method mismatch')
  for (const [key, amount] of Object.entries(input.amounts)) {
    requireCondition(us ? key !== 'taxableBase' : key === 'taxableBase', 'authority/base mismatch')
    requireCondition(amount.currency === input.currency, 'amount currency mismatch')
    if (!['netLongTermGain', 'netCapitalGain', 'niitMagi'].includes(key)) requireCondition(BigInt(amount.minor) >= 0n, 'negative unsigned base')
    provenance(amount, sources, amount.origin === 'reviewed-input')
  }
  return structuredClone(input)
}

/** Identity binding, not evidence verification or certification of a component amount. */
export function annualInputDigest(input: AnnualEstimateInput): string {
  return annualJsonDigest(validateAnnualEstimateInput(input))
}

export function validateAnnualEstimateResult(value: unknown, inputValue: AnnualEstimateInput): AnnualEstimateResult {
  const input = validateAnnualEstimateInput(inputValue)
  assertAnnualSchema(value, resultSchema)
  const result = value as AnnualEstimateResult
  requireCondition(result.scenarioId === input.id && result.inputRevision === input.revision && result.inputSha256 === annualInputDigest(input), 'input identity/hash mismatch')
  requireCondition(result.taxYear === input.taxYear && result.taxUnitId === input.taxUnit.id && result.authority === input.authority && result.currency === input.currency && result.taxType === input.taxType, 'result scope mismatch')
  const ids = new Set(result.components.map(component => component.id))
  requireCondition(ids.size === result.components.length && ids.size === input.requestedComponents.length && input.requestedComponents.every(id => ids.has(id)), 'component set mismatch')
  const pack = getAnnualRulePack(input.taxYear)
  requireCondition(result.rulePackId === input.rulePackId && result.rulePackSha256 === pack.contentSha256, 'rule-pack identity mismatch')
  const publicIds = new Set(pack.sources.map(source => source.id))
  const inputSourceIds = new Set(input.sources.map(source => source.id))
  for (const component of result.components) {
    requireCondition(component.inputRefs.every(key => Object.hasOwn(input.amounts, key)), 'unresolved input reference')
    if (component.reviewedAt !== undefined) checkDate(component.reviewedAt)
    if (component.mode === 'unknown' || component.mode === 'unsupported') {
      requireCondition(component.amountMinor === null, 'unknown amounts must remain null')
      provenance(component, new Set([...publicIds, ...inputSourceIds]), false)
      continue
    }
    requireCondition(component.amountMinor !== null && BigInt(component.amountMinor) >= 0n, 'known component requires nonnegative amount')
    if (component.mode === 'computed') {
      const readiness = getAnnualRuleStatus(input.taxYear, component.id)
      requireCondition(readiness.status === 'reference-ready', 'component rules blocked')
      requireCondition(input.residency.state === 'reviewed-full-year' && input.specialMethod.state === 'none-reviewed', 'unreviewed/unsupported calculation profile')
      if (component.id !== 'us.niit') {
        const method = component.id === 'us.regular.ordinary' ? 'ordinary-reviewed' : component.id === 'us.regular.qdcg' ? 'qdcg-reviewed' : 'general-reviewed'
        requireCondition(input.regularTaxMethod.state === method, 'unreviewed/unsupported regular-tax method')
      }
      if (component.id === 'us.regular.ordinary') {
        requireCondition(['qualifiedDividends', 'netLongTermGain', 'netCapitalGain'].every(key => !input.amounts[key as AmountKey] || BigInt(input.amounts[key as AmountKey]!.minor) <= 0n), 'preferential-income amount contradicts ordinary-only scope')
      }
      requireCondition(requiredAmounts[component.id].every(key => input.amounts[key] && component.inputRefs.includes(key)), 'missing calculation base/trace input')
      requireCondition(component.trace.length && component.sourceRefs.length && component.sourceRefs.some(id => (readiness.sourceIds as string[]).includes(id)), 'computed component requires rule trace')
      provenance(component, publicIds, false)
    } else {
      provenance(component, inputSourceIds, true)
      if (component.mode === 'not-applicable') requireCondition(component.amountMinor === '0', 'not-applicable component must explicitly be zero')
    }
  }
  const known = result.components.some(component => !['unknown', 'unsupported'].includes(component.mode))
  requireCondition(result.status === (known ? 'components-only' : 'blocked'), 'result status mismatch')
  return structuredClone(result)
}
