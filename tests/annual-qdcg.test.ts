import assert from 'node:assert/strict'
import test from 'node:test'
import example from '../examples/annual-tax-estimate.synthetic.json'
import legacyPack from '../data/tax-rules/2025/annual-foundation.json'
import { annualJsonDigest, getAnnualRulePack, getAnnualRuleStatus, validateAnnualRulePack } from '../lib/domain/taxes/annual/rules'
import { getAnnualComponentBlocker, getAnnualRequiredAmounts, validateAnnualEstimateInput } from '../lib/domain/taxes/annual/contracts'

const V2='annual-2025-qualified-gains-v2' as const
const fact=(state:string)=>({...structuredClone(example.regularTaxMethod),state})
function scenario(branch='schedule-d-reviewed') {
  const input:any=structuredClone(example)
  input.rulePackId=V2;input.requestedComponents=['us.regular.qdcg'];input.regularTaxMethod=fact('qdcg-reviewed');input.qdcgWorksheet=fact(branch)
  const base=input.amounts.taxableIncome
  input.amounts={taxableIncome:base,ordinaryDividends:{...base,minor:'2500000'},qualifiedDividends:{...base,minor:'2000000'}}
  if(branch==='distributions-only-reviewed')input.amounts.capitalGainDistributions={...base,minor:'800000'}
  else {input.amounts.netLongTermGain={...base,minor:'1000000'};input.amounts.netCapitalGain={...base,minor:'800000'}}
  return input
}

test('QDCG explicitly selects a source-pinned v2 while v1/default bytes and block stay unchanged', () => {
  assert.deepEqual(getAnnualRulePack(2025),legacyPack)
  const v2=getAnnualRulePack(2025,V2)
  assert.equal(v2.id,V2);assert.deepEqual(v2.data.usOrdinary,legacyPack.data.usOrdinary);assert.deepEqual(v2.data.usNiit,legacyPack.data.usNiit)
  assert.deepEqual(v2.data.krGlobal,legacyPack.data.krGlobal);assert.deepEqual(v2.data.krLocal,legacyPack.data.krLocal)
  assert.equal(getAnnualRuleStatus(2025,'us.regular.qdcg').status,'blocked')
  assert.equal(getAnnualRuleStatus(2025,'us.regular.qdcg',V2).status,'reference-ready')
  assert.throws(()=>getAnnualRulePack(2025,'no-such-version' as any))
  assert.throws(()=>getAnnualRulePack(2026,V2))
  const data=(v2.data as any).usQdcg
  assert.deepEqual(data.thresholdsUsd,{single:{zeroRateCeiling:'48350',fifteenRateCeiling:'533400'},mfj:{zeroRateCeiling:'96700',fifteenRateCeiling:'600050'}})
  assert.deepEqual(data.ratesBasisPoints,{zero:0,fifteen:1500,twenty:2000});assert.equal(data.lineCount,25)
  assert.equal(new Set(v2.sources.map(s=>s.id)).size,v2.sources.length)
  assert.ok(v2.sources.some(s=>s.id==='irs-1040-instructions-pdf'))
  const tampered:any=structuredClone(v2);tampered.data.usQdcg.thresholdsUsd.single.zeroRateCeiling='1'
  const {contentSha256,...payload}=tampered;tampered.contentSha256=annualJsonDigest(payload)
  assert.throws(()=>validateAnnualRulePack(tampered),/integrity/i)
})

test('QDCG branch selection has reviewed provenance and conditional bases, never an inferred default', () => {
  for(const branch of ['schedule-d-reviewed','distributions-only-reviewed']){
    const input=validateAnnualEstimateInput(scenario(branch))
    assert.equal(getAnnualComponentBlocker(input,'us.regular.qdcg'),null)
    const required=getAnnualRequiredAmounts(input,'us.regular.qdcg')
    assert.ok(required.includes(branch==='schedule-d-reviewed'?'netCapitalGain':'capitalGainDistributions'))
    assert.ok(!required.includes(branch==='schedule-d-reviewed'?'capitalGainDistributions':'netCapitalGain'))
  }
  for(const state of ['unknown','unsupported']){
    const input=scenario();input.qdcgWorksheet.state=state
    assert.equal(getAnnualComponentBlocker(validateAnnualEstimateInput(input),'us.regular.qdcg')?.mode,state)
  }
  const missing=scenario();delete missing.qdcgWorksheet
  assert.equal(getAnnualComponentBlocker(validateAnnualEstimateInput(missing),'us.regular.qdcg')?.mode,'unknown')
  const missingAmount=scenario('distributions-only-reviewed');delete missingAmount.amounts.capitalGainDistributions
  assert.equal(getAnnualComponentBlocker(validateAnnualEstimateInput(missingAmount),'us.regular.qdcg')?.mode,'unknown')
  const provenance=scenario();delete provenance.qdcgWorksheet.reviewedAt;assert.throws(()=>validateAnnualEstimateInput(provenance))
  const unresolved=scenario();unresolved.qdcgWorksheet.sourceRefs=['missing'];assert.throws(()=>validateAnnualEstimateInput(unresolved))
})

test('contradictory dividend classification/branch inputs are not accepted as a computed worksheet', () => {
  const dividend=scenario();dividend.amounts.qualifiedDividends.minor='2500001'
  assert.equal(getAnnualComponentBlocker(validateAnnualEstimateInput(dividend),'us.regular.qdcg')?.mode,'unsupported')
  const mixed=scenario('distributions-only-reviewed');mixed.amounts.netCapitalGain={...mixed.amounts.capitalGainDistributions,minor:'1'}
  assert.equal(getAnnualComponentBlocker(validateAnnualEstimateInput(mixed),'us.regular.qdcg')?.mode,'unsupported')
  const schedule=scenario();schedule.amounts.capitalGainDistributions={...schedule.amounts.netCapitalGain,minor:'1'}
  assert.equal(getAnnualComponentBlocker(validateAnnualEstimateInput(schedule),'us.regular.qdcg')?.mode,'unsupported')
  const negative=scenario('distributions-only-reviewed');negative.amounts.capitalGainDistributions.minor='-1';assert.throws(()=>validateAnnualEstimateInput(negative))
  const legacy=scenario();legacy.rulePackId=legacyPack.id
  assert.equal(getAnnualComponentBlocker(validateAnnualEstimateInput(legacy),'us.regular.qdcg')?.mode,'unsupported')
})
