import { annualInputDigest, getAnnualRequiredAmounts, getAnnualComponentBlocker, validateAnnualEstimateInput, validateAnnualEstimateResult, type AnnualComponentResult, type AnnualEstimateResult } from './contracts'
import { getAnnualRulePack } from './rules'
import { calculateFederalComponent } from './us-federal'

/** Pure component preview: no state, evidence reads, persistence, annual composition or comparison. */
export function calculateAnnualComponents(value: unknown): AnnualEstimateResult {
  const input = validateAnnualEstimateInput(value)
  const pack = getAnnualRulePack(input.taxYear, input.rulePackId)
  const components: AnnualComponentResult[] = input.requestedComponents.map(id => {
    if (input.authority === 'US:federal' && (id === 'us.regular.ordinary' || id === 'us.regular.qdcg' || id === 'us.niit')) return calculateFederalComponent(input, id)
    const blocker = getAnnualComponentBlocker(input, id) ?? { mode: 'unsupported' as const, reason: 'Component calculator is not implemented' }
    return {
      id, ...blocker, amountMinor: null,
      sourceRefs: [...pack.readiness[id].sourceIds],
      inputRefs: getAnnualRequiredAmounts(input, id).filter(key => input.amounts[key]), trace: [],
    }
  })
  return validateAnnualEstimateResult({
    schemaVersion: 1, rulePackId: pack.id, rulePackSha256: pack.contentSha256,
    scenarioId: input.id, inputRevision: input.revision, inputSha256: annualInputDigest(input),
    taxYear: input.taxYear, taxUnitId: input.taxUnit.id, authority: input.authority, currency: input.currency, taxType: input.taxType,
    calculationScope: 'component', status: components.some(component => component.mode === 'computed') ? 'components-only' : 'blocked',
    annualTotal: null, comparisonEligible: false, components,
  }, input)
}
