import assert from 'node:assert/strict'
import test from 'node:test'
import example from '../examples/annual-tax-estimate.synthetic.json'
import references from './fixtures/annual-korean-reference-2025.json'
import { calculateKoreanTaxReference } from '../lib/domain/taxes/annual/kr-general-reference'
import { annualInputDigest, validateAnnualEstimateInput, validateAnnualEstimateResult } from '../lib/domain/taxes/annual/contracts'
import { calculateAnnualComponents } from '../lib/domain/taxes/annual/calculate'
import { getAnnualRulePack, getAnnualRuleStatus } from '../lib/domain/taxes/annual/rules'

function scenario(authority='KR:national',base='30000000') {
  const input:any=structuredClone(example)
  input.authority=authority;input.currency='KRW';input.filingStatus='individual'
  input.taxUnit={id:'synthetic-kr-unit',kind:'individual',ownerIds:['example-a']}
  input.regularTaxMethod={...input.regularTaxMethod,state:'general-reviewed',reason:'Synthetic reviewed general-rate eligibility, not a private tax profile'}
  input.requestedComponents=[authority==='KR:national'?'kr.global.calculated':'kr.local.calculated']
  input.amounts={taxableBase:{...input.amounts.taxableIncome,currency:'KRW',minor:base}}
  return input
}

test('national/local exact references match independent boundary and large-money fixtures', () => {
  for(const reference of references.cases){
    const input=scenario(reference.authority,reference.baseMinor),result=calculateKoreanTaxReference(input)
    assert.equal(result.status,'reference-only')
    assert.deepEqual(result.exactTaxKrw,{numerator:reference.expectedNumerator,denominator:reference.denominator},`${reference.authority} ${reference.baseMinor}`)
    assert.equal(result.reportedAmountMinor,null);assert.equal(result.annualTotal,null);assert.equal(result.comparisonEligible,false)
  }
})

test('fractional exact tax remains rational; neither sub-won nor collection rounding is inferred', () => {
  const national=calculateKoreanTaxReference(scenario('KR:national','1'))
  const local=calculateKoreanTaxReference(scenario('KR:local','1'))
  assert.deepEqual(national.exactTaxKrw,{numerator:'600',denominator:'10000'})
  assert.deepEqual(local.exactTaxKrw,{numerator:'60',denominator:'10000'})
  assert.equal(national.roundingPolicy,'unverified');assert.equal(local.reportedAmountMinor,null)
  assert.equal(calculateKoreanTaxReference(scenario('KR:national','100')).exactTaxKrw?.numerator,'60000')
  for(const authority of ['KR:national','KR:local']){
    const zero=calculateKoreanTaxReference(scenario(authority,'0'))
    assert.equal(zero.exactTaxKrw?.numerator,'0');assert.equal(zero.reportedAmountMinor,null)
  }
})

test('missing, unknown or special-method facts never produce a rational reference', () => {
  const missing=scenario();delete missing.amounts.taxableBase
  assert.equal(calculateKoreanTaxReference(missing).status,'unknown');assert.equal(calculateKoreanTaxReference(missing).exactTaxKrw,null)
  for(const field of ['residency','specialMethod','regularTaxMethod'])for(const state of ['unknown','unsupported']){
    const input=scenario();input[field].state=state
    const result=calculateKoreanTaxReference(input)
    assert.equal(result.status,state);assert.equal(result.exactTaxKrw,null);assert.equal(result.reportedAmountMinor,null)
  }
})

test('authority bases remain separate and malformed/non-Korean scope is rejected', () => {
  assert.equal(calculateKoreanTaxReference(scenario('KR:national','30000000')).exactTaxKrw?.numerator,'32400000000')
  assert.equal(calculateKoreanTaxReference(scenario('KR:local','40000000')).exactTaxKrw?.numerator,'4740000000')
  assert.throws(()=>calculateKoreanTaxReference(example))
  for(const patch of [{taxYear:2026},{currency:'USD'},{filingStatus:'mfj'}])assert.throws(()=>calculateKoreanTaxReference({...scenario(),...patch}))
  const negative=scenario('KR:national','-1');assert.throws(()=>calculateKoreanTaxReference(negative))
})

test('reference identity/provenance is deterministic, isolated and cannot masquerade as an annual result', () => {
  const input=scenario(),before=JSON.stringify(input),result=calculateKoreanTaxReference(input)
  assert.equal(JSON.stringify(input),before);assert.equal(result.calculationScope,'rate-schedule-reference')
  assert.equal(result.inputSha256,annualInputDigest(validateAnnualEstimateInput(input)))
  assert.equal(result.rulePackSha256,getAnnualRulePack(2025).contentSha256)
  assert.deepEqual(calculateKoreanTaxReference(input),result)
  assert.ok(result.trace.some(t=>t.label.includes('origin=synthetic')))
  assert.throws(()=>validateAnnualEstimateResult(result,validateAnnualEstimateInput(input)))
  result.exactTaxKrw!.numerator='999';result.trace[0].label='changed'
  assert.notDeepEqual(calculateKoreanTaxReference(input),result)
  const assumed=scenario();assumed.amounts.taxableBase.origin='assumption'
  assert.ok(calculateKoreanTaxReference(assumed).trace.some(t=>t.label.includes('origin=assumption')))
})

test('both old packs and annual Korean components remain blocked with null money', () => {
  for(const rulePackId of ['annual-2025-foundation-v1','annual-2025-qualified-gains-v2'] as const)for(const authority of ['KR:national','KR:local']){
    const input=scenario(authority);input.rulePackId=rulePackId
    const reference=calculateKoreanTaxReference(input),annual=calculateAnnualComponents(input),id=input.requestedComponents[0]
    assert.equal(reference.rulePackId,rulePackId);assert.equal(reference.reportedAmountMinor,null)
    assert.equal(getAnnualRuleStatus(2025,id,rulePackId).calculationAvailable,false)
    assert.equal(annual.status,'blocked');assert.equal(annual.components[0].mode,'unsupported');assert.equal(annual.components[0].amountMinor,null)
  }
})
