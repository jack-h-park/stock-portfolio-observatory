import { getAnnualRequiredAmounts, getAnnualComponentBlocker, validateAnnualEstimateInput, type AnnualComponentResult, type AnnualEstimateInput, type AmountKey } from './contracts'
import { getAnnualRulePack } from './rules'
import { formWholeDollars, nonnegativeWholeTax, ordinaryTaxNumerator } from './us-ordinary'
import { qualifiedGainTaxNumerator } from './us-qdcg'

export type FederalCalculatedComponent = 'us.regular.ordinary' | 'us.regular.qdcg' | 'us.niit'

/** Pure 2025 individual federal component calculation, with no return composition or I/O. */
export function calculateFederalComponent(value: AnnualEstimateInput, id: FederalCalculatedComponent): AnnualComponentResult {
  const input = validateAnnualEstimateInput(value)
  if (input.authority !== 'US:federal' || !input.requestedComponents.includes(id) || !['us.regular.ordinary', 'us.regular.qdcg', 'us.niit'].includes(id)) throw new Error('Federal component scope mismatch')
  const pack = getAnnualRulePack(input.taxYear, input.rulePackId)
  const inputRefs = getAnnualRequiredAmounts(input, id).filter(key => input.amounts[key])
  const sourceRefs = [...pack.readiness[id].sourceIds]
  const blocker = getAnnualComponentBlocker(input, id)
  if (blocker) return { id, ...blocker, amountMinor: null, sourceRefs, inputRefs, trace: [] }

  const trace: { label: string }[] = []
  const line = (key: AmountKey): bigint => {
    const amount = input.amounts[key]!
    const rounded = formWholeDollars(BigInt(amount.minor))
    trace.push({ label: `Form line ${key}: originalMinor=${amount.minor} USD; roundedWholeUsd=${rounded}; origin=${amount.origin}` })
    return rounded
  }
  const status = input.filingStatus as 'single' | 'mfj'
  let wholeTax: bigint
  if (id === 'us.regular.ordinary') {
    wholeTax = nonnegativeWholeTax(ordinaryTaxNumerator(line('taxableIncome'), status, pack, trace))
  } else if (id === 'us.regular.qdcg') {
    wholeTax = nonnegativeWholeTax(qualifiedGainTaxNumerator(input, pack, line, trace))
  } else {
    const magi = line('niitMagi')
    const nii = line('netInvestmentIncome')
    const threshold = BigInt(pack.data.usNiit.thresholdsUsd[status])
    const excess = magi > threshold ? magi - threshold : 0n
    const base = nii < excess ? nii : excess
    const numerator = base * BigInt(pack.data.usNiit.rateBasisPoints)
    wholeTax = nonnegativeWholeTax(numerator, 10000n)
    trace.push({ label: `2025 Form 8960 individual lines 14-17: thresholdWholeUsd=${threshold}; excessWholeUsd=${excess}; cappedBaseWholeUsd=${base}; rateBasisPoints=${pack.data.usNiit.rateBasisPoints}; exactTaxUsd=${numerator}/10000; roundedWholeUsd=${wholeTax}` })
  }
  const amountMinor = String(wholeTax * 100n)
  trace.push({ label: `${id === 'us.niit' ? 'Form 8960 line 17' : 'Form 1040 line 16'}: amountMinor=${amountMinor} USD; whole-dollar form mode; component only` })
  return { id, mode: 'computed', amountMinor, reason: 'Calculated from supplied form-line bases in explicit 2025 whole-dollar form mode; no annual-total or settlement claim', sourceRefs, inputRefs, trace }
}
