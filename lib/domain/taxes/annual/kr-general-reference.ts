import { annualInputDigest, getAnnualComponentInputBlocker, validateAnnualEstimateInput } from './contracts'
import { getAnnualRulePack, type AnnualRulePackId } from './rules'

/** Exact schedule mathematics only: deliberately incompatible with AnnualEstimateResult. */
export type KoreanTaxReference = {
  schemaVersion: 1
  calculationScope: 'rate-schedule-reference'
  status: 'reference-only' | 'unknown' | 'unsupported'
  scenarioId: string; inputRevision: number; inputSha256: string
  taxYear: 2025; taxUnitId: string; authority: 'KR:national' | 'KR:local'; currency: 'KRW'; taxType: 'income'
  rulePackId: AnnualRulePackId; rulePackSha256: string
  componentId: 'kr.global.calculated' | 'kr.local.calculated'
  exactTaxKrw: { numerator: string; denominator: '10000' } | null
  roundingPolicy: 'unverified'
  reportedAmountMinor: null; annualTotal: null; comparisonEligible: false
  reason: string; sourceRefs: string[]; inputRefs: string[]; trace: { label: string }[]
}

/** No I/O, rounding, tax-base preparation, reported tax amount, composition or activation. */
export function calculateKoreanTaxReference(value: unknown): KoreanTaxReference {
  const input = validateAnnualEstimateInput(value)
  if (input.authority !== 'KR:national' && input.authority !== 'KR:local') throw new Error('Korean reference requires a Korean individual scenario')
  const national = input.authority === 'KR:national'
  const componentId = national ? 'kr.global.calculated' : 'kr.local.calculated'
  const pack = getAnnualRulePack(input.taxYear, input.rulePackId)
  const blocker = getAnnualComponentInputBlocker(input, componentId)
  const trace: { label: string }[] = []
  let exactTaxKrw: KoreanTaxReference['exactTaxKrw'] = null
  if (!blocker) {
    const amount = input.amounts.taxableBase!
    const base = BigInt(amount.minor)
    const rows = national ? pack.data.krGlobal : pack.data.krLocal
    const index = rows.findIndex(row => row.upToKrw === null || base <= BigInt(row.upToKrw))
    if (index < 0) throw new Error('Pinned Korean rate interval missing')
    const row = rows[index]
    const numerator = base * BigInt(row.rateBasisPoints) - BigInt(row.deductionKrw) * 10000n
    if (numerator < 0n) throw new Error('Negative Korean rate-reference result')
    exactTaxKrw = { numerator: String(numerator), denominator: '10000' }
    trace.push({ label: `Supplied form base: originalMinor=${amount.minor} KRW; origin=${amount.origin}; no base rounding or deduction construction` })
    trace.push({ label: `2025 ${input.authority} schedule: lowerExclusive=${index === 0 ? 'none' : rows[index - 1].upToKrw}; upperInclusive=${row.upToKrw ?? 'unbounded'}; rateBasisPoints=${row.rateBasisPoints}; deductionKrw=${row.deductionKrw}` })
    trace.push({ label: `Exact reference: (${amount.minor}*${row.rateBasisPoints}-${row.deductionKrw}*10000)/10000=${numerator}/10000 KRW; no quantization` })
    trace.push({ label: 'Calculated-tax-line quantization remains unverified; reported amount unavailable even when reference is an integer; no collection/payment rounding applied' })
  }
  return {
    schemaVersion: 1, calculationScope: 'rate-schedule-reference', status: blocker?.mode ?? 'reference-only',
    scenarioId: input.id, inputRevision: input.revision, inputSha256: annualInputDigest(input),
    taxYear: input.taxYear, taxUnitId: input.taxUnit.id, authority: input.authority, currency: 'KRW', taxType: 'income',
    rulePackId: input.rulePackId, rulePackSha256: pack.contentSha256, componentId, exactTaxKrw,
    roundingPolicy: 'unverified', reportedAmountMinor: null, annualTotal: null, comparisonEligible: false,
    reason: blocker?.reason ?? 'Exact rate-schedule reference only; general calculated-tax reporting policy remains unverified',
    sourceRefs: [...pack.readiness[componentId].sourceIds], inputRefs: input.amounts.taxableBase ? ['taxableBase'] : [], trace,
  }
}
