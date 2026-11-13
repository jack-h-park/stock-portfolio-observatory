import assert from 'node:assert/strict'
import test from 'node:test'
import example from '../examples/annual-tax-estimate.synthetic.json'
import { validateAnnualEstimateInput, validateAnnualEstimateResult } from '../lib/domain/taxes/annual/contracts'
import { calculateFederalComponent } from '../lib/domain/taxes/annual/us-federal'

function scenario(status: 'single' | 'mfj' = 'mfj', minor = '12000000') {
  const input:any = structuredClone(example)
  input.filingStatus = status
  input.taxUnit.kind = status === 'mfj' ? 'joint' : 'individual'
  input.taxUnit.ownerIds = status === 'mfj' ? ['example-a','example-b'] : ['example-a']
  input.amounts.taxableIncome.minor = minor
  return input
}
function ordinary(minor: string, status: 'single' | 'mfj' = 'mfj') {
  return calculateFederalComponent(validateAnnualEstimateInput(scenario(status, minor)), 'us.regular.ordinary')
}
function niit(magi: string, nii: string, status: 'single' | 'mfj' = 'mfj') {
  const input = scenario(status)
  input.requestedComponents = ['us.niit']
  const base = input.amounts.taxableIncome
  input.amounts = { niitMagi: {...base,minor:magi}, netInvestmentIncome: {...base,minor:nii} }
  return calculateFederalComponent(validateAnnualEstimateInput(input), 'us.niit')
}

test('ordinary calculation uses official table cells and already-deducted taxable income', () => {
  assert.equal(ordinary('12000000').amountMinor,'1622800')
  for (const [minor,single,mfj] of [
    ['0','0','0'],['400','0','0'],['500','100','100'],['2500','400','400'],
    ['2530000','280100','256200'],['2534999','280700','256800'],
    ['9999900','1690900','1182300'],['10000000','1691400','1182800'],
  ]) {
    assert.equal(ordinary(minor,'single').amountMinor,single)
    assert.equal(ordinary(minor,'mfj').amountMinor,mfj)
  }
})

test('input line rounding selects the correct table/worksheet; cents remain in trace', () => {
  assert.equal(ordinary('9999949').amountMinor,'1182300')
  const result=ordinary('9999950')
  assert.equal(result.amountMinor,'1182800')
  assert.ok(result.trace.some(step=>step.label.includes('9999950') && step.label.includes('100000')))
  assert.equal(ordinary('449').amountMinor,'0')
  assert.equal(ordinary('450').amountMinor,'100')
})

test('worksheet equality boundaries, subtraction cents and large exact inputs are preserved', () => {
  const cases: ['single'|'mfj',string,string][] = [
    ['single','10000100','1691400'],['mfj','10000100','1182800'],
    ['single','10334900','1765100'],['single','19729900','4019900'],['single','25052400','5723100'],
    ['mfj','20669900','3530200'],['mfj','39459900','8039800'],['mfj','50104900','11446200'],
    ['single','10335000','1765100'],['single','10335100','1765100'],
    ['single','19730000','4019900'],['single','19730100','4019900'],
    ['single','25052500','5723100'],['single','25052600','5723100'],
    ['single','62634900','18876900'],['single','62635000','18877000'],['single','62635100','18877000'],['single','62635500','18877200'],
    ['mfj','20670000','3530200'],['mfj','20670100','3530200'],
    ['mfj','39460000','8039800'],['mfj','39460100','8039800'],
    ['mfj','50105000','11446200'],['mfj','50105100','11446200'],
    ['mfj','75159900','20215400'],['mfj','75160000','20215500'],['mfj','75160100','20215500'],['mfj','75160200','20215500'],
  ]
  for(const [status,minor,expected] of cases)assert.equal(ordinary(minor,status).amountMinor,expected,`${status} ${minor}`)
  assert.equal(ordinary('900719925474099312345').amountMinor,'333266372425409151800')
})

test('NIIT uses the smaller of NII and nonnegative MAGI threshold excess', () => {
  for(const [magi,nii,status,expected] of [
    ['30000000','2000000','mfj','76000'],['26000000','2000000','mfj','38000'],
    ['25000000','2000000','mfj','0'],['24999999','2000000','mfj','0'],
    ['30000000','0','mfj','0'],['-10000','2000000','single','0'],
    ['21000000','2000000','single','38000'],['20000049','2000000','single','0'],
    ['20025000','25000','single','1000'],['20024900','24900','single','900'],
    ['20001400','1349','single','0'],['20001400','1350','single','100'],
    ['20001349','2000000','single','0'],['20001350','2000000','single','100'],
    ['20001300','1300','single','0'],['20001400','1400','single','100'],
  ] as const) assert.equal(niit(magi,nii,status).amountMinor,expected)
  assert.equal(niit('900719925474099312345','900719925474099312345').amountMinor,'34227357168014823900')
  const signed=niit('-150','10000','single')
  assert.ok(signed.trace.some(step=>step.label.includes('-150') && step.label.includes('-2')))
})

test('profile/method/missing-base gates cannot produce a computed assertion', () => {
  for(const state of ['unknown','unsupported']){
    const input=scenario();input.residency.state=state
    const result=calculateFederalComponent(validateAnnualEstimateInput(input),'us.regular.ordinary')
    assert.equal(result.mode,state);assert.equal(result.amountMinor,null)
  }
  const missing=scenario();delete missing.amounts.taxableIncome
  assert.equal(calculateFederalComponent(validateAnnualEstimateInput(missing),'us.regular.ordinary').mode,'unknown')
  const method=scenario();method.regularTaxMethod.state='unknown'
  assert.equal(calculateFederalComponent(validateAnnualEstimateInput(method),'us.regular.ordinary').mode,'unknown')
  const preferred=scenario();preferred.amounts.qualifiedDividends={...preferred.amounts.taxableIncome,minor:'1'}
  assert.equal(calculateFederalComponent(validateAnnualEstimateInput(preferred),'us.regular.ordinary').mode,'unsupported')
  assert.throws(()=>calculateFederalComponent({...validateAnnualEstimateInput(scenario()),taxYear:2026} as any,'us.regular.ordinary'))
})

import { calculateAnnualComponents } from '../lib/domain/taxes/annual/calculate'
import { annualInputDigest } from '../lib/domain/taxes/annual/contracts'
import { getAnnualRulePack, getAnnualRuleStatus } from '../lib/domain/taxes/annual/rules'

function both() {
  const input=scenario()
  input.requestedComponents=['us.regular.ordinary','us.niit']
  input.amounts.niitMagi={...input.amounts.taxableIncome,minor:'30000000'}
  input.amounts.netInvestmentIncome={...input.amounts.taxableIncome,minor:'2000000'}
  return input
}

test('orchestration binds identities and keeps computed components separate from annual liability', () => {
  const input=both(),before=JSON.stringify(input),result=calculateAnnualComponents(input)
  assert.equal(JSON.stringify(input),before)
  assert.equal(result.inputSha256,annualInputDigest(validateAnnualEstimateInput(input)))
  assert.equal(result.rulePackSha256,getAnnualRulePack(2025).contentSha256)
  assert.equal(result.status,'components-only');assert.equal(result.annualTotal,null);assert.equal(result.comparisonEligible,false)
  assert.deepEqual(result.components.map(c=>[c.id,c.mode,c.amountMinor]),[['us.regular.ordinary','computed','1622800'],['us.niit','computed','76000']])
  assert.deepEqual(validateAnnualEstimateResult(result,validateAnnualEstimateInput(input)),result)
  result.components[0].trace[0].label='changed'
  assert.notEqual(calculateAnnualComponents(input).components[0].trace[0].label,'changed')
})

test('missing or unsupported ordinary inputs do not suppress independently supported NIIT', () => {
  const input=both();delete input.amounts.taxableIncome
  const partial=calculateAnnualComponents(input)
  assert.equal(partial.status,'components-only');assert.equal(partial.components[0].mode,'unknown');assert.equal(partial.components[0].amountMinor,null)
  assert.equal(partial.components[1].amountMinor,'76000')
  const contradiction=both();contradiction.amounts.qualifiedDividends={...contradiction.amounts.taxableIncome,minor:'1'}
  const blockedOrdinary=calculateAnnualComponents(contradiction)
  assert.equal(blockedOrdinary.components[0].mode,'unsupported');assert.equal(blockedOrdinary.components[1].mode,'computed')
  const unknown=both();unknown.regularTaxMethod.state='unknown'
  assert.equal(calculateAnnualComponents(unknown).components[1].mode,'computed')
})

test('known zero, all-unknown and unsupported profile results stay distinct', () => {
  const zero=scenario('mfj','0');assert.equal(calculateAnnualComponents(zero).components[0].amountMinor,'0')
  const missing=scenario();delete missing.amounts.taxableIncome
  const result=calculateAnnualComponents(missing);assert.equal(result.status,'blocked');assert.equal(result.components[0].amountMinor,null)
  const profile=both();profile.residency.state='unsupported'
  const unsupported=calculateAnnualComponents(profile);assert.equal(unsupported.status,'blocked');assert.ok(unsupported.components.every(c=>c.mode==='unsupported' && c.amountMinor===null))
})

test('preferential and Korean components stay unsupported without arithmetic fallback', () => {
  const preferential=both();preferential.requestedComponents=['us.regular.qdcg','us.niit'];preferential.regularTaxMethod.state='qdcg-reviewed'
  const result=calculateAnnualComponents(preferential)
  assert.equal(result.components[0].mode,'unsupported');assert.match(result.components[0].reason,/worksheet/i);assert.equal(result.components[1].amountMinor,'76000')
  for(const authority of ['KR:national','KR:local']){
    const input=scenario('single');input.authority=authority;input.currency='KRW';input.filingStatus='individual';input.regularTaxMethod.state='general-reviewed'
    input.requestedComponents=[authority==='KR:national'?'kr.global.calculated':'kr.local.calculated']
    input.amounts={taxableBase:{...input.amounts.taxableIncome,minor:'30000000',currency:'KRW'}}
    const blocked=calculateAnnualComponents(input)
    assert.equal(blocked.status,'blocked');assert.equal(blocked.components[0].mode,'unsupported');assert.equal(blocked.components[0].amountMinor,null)
  }
})

test('assumption/synthetic origins and exact input cents remain visible and deterministic', () => {
  const input=both();input.amounts.niitMagi.origin='assumption';input.amounts.niitMagi.minor='30000049'
  const first=calculateAnnualComponents(input),second=calculateAnnualComponents(input)
  assert.deepEqual(first,second)
  assert.ok(first.components[1].trace.some(t=>t.label.includes('origin=assumption') && t.label.includes('30000049')))
  assert.ok(first.components[0].trace.some(t=>t.label.includes('origin=synthetic')))
  assert.equal(first.comparisonEligible,false)
  const invalid=scenario();invalid.taxYear=2026;assert.throws(()=>calculateAnnualComponents(invalid))
  invalid.taxYear=2025;invalid.currency='KRW';assert.throws(()=>calculateAnnualComponents(invalid))
})

test('registry distinguishes implemented federal library from blocked reference components', () => {
  assert.equal(getAnnualRuleStatus(2025,'us.regular.ordinary').calculationAvailable,true)
  assert.equal(getAnnualRuleStatus(2025,'us.niit').calculationAvailable,true)
  for(const id of ['us.regular.qdcg','kr.global.calculated','kr.local.calculated'] as const)assert.equal(getAnnualRuleStatus(2025,id).calculationAvailable,false)
})
