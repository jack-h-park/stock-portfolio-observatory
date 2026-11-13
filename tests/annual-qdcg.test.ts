import assert from 'node:assert/strict'
import test from 'node:test'
import example from '../examples/annual-tax-estimate.synthetic.json'
import legacyPack from '../data/tax-rules/2025/annual-foundation.json'
import { annualJsonDigest, getAnnualRulePack, getAnnualRuleStatus, validateAnnualRulePack } from '../lib/domain/taxes/annual/rules'
import { getAnnualComponentBlocker, getAnnualRequiredAmounts, validateAnnualEstimateInput } from '../lib/domain/taxes/annual/contracts'

const V2='annual-2025-qualified-gains-v2' as const
const fact=(state:string)=>({...structuredClone(example.regularTaxMethod),state,reason:`Synthetic reviewed eligibility/branch fact: ${state}; no private return`})
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

import references from './fixtures/annual-qdcg-2025.json'
import qdcgExample from '../examples/annual-tax-qdcg.synthetic.json'
import { calculateAnnualComponents } from '../lib/domain/taxes/annual/calculate'
import { validateAnnualEstimateResult } from '../lib/domain/taxes/annual/contracts'

function referenceInput(reference: typeof references.cases[number]) {
  const input=scenario(reference.branch)
  input.filingStatus=reference.filingStatus
  if(reference.filingStatus==='single'){input.taxUnit.kind='individual';input.taxUnit.ownerIds=['example-a']}
  const base=input.amounts.taxableIncome
  input.amounts=Object.fromEntries(Object.entries(reference.amounts).filter(([,minor])=>minor!==undefined).map(([key,minor])=>[key,{...base,minor}]))
  return input
}

test('complete QDCG worksheet matches independent references for every line and final component', () => {
  for(const reference of references.cases){
    const input=referenceInput(reference),before=JSON.stringify(input),result=calculateAnnualComponents(input),component=result.components[0]
    assert.equal(component.mode,'computed',reference.name);assert.equal(component.amountMinor,reference.expectedMinor,reference.name)
    for(const [number,numerator] of Object.entries(reference.expectedLineNumerators)){
      const line=component.trace.find(t=>t.label.startsWith(`QDCG line ${number}:`))
      assert.ok(line,`${reference.name}: missing line ${number}`)
      assert.ok(line.label.includes(`exactUsd=${numerator}/10000;`),`${reference.name}: line ${number}: ${line.label}`)
    }
    assert.equal(JSON.stringify(input),before);assert.equal(result.annualTotal,null);assert.equal(result.comparisonEligible,false)
    assert.deepEqual(validateAnnualEstimateResult(result,validateAnnualEstimateInput(input)),result)
  }
})

test('QDCG blockers preserve independently reviewed NIIT and never fall back to ordinary', () => {
  for(const patch of ['missing-branch','missing-base','unsupported-method','dividend-conflict']){
    const input=scenario();input.requestedComponents.push('us.niit')
    input.amounts.niitMagi={...input.amounts.taxableIncome,minor:'30000000'}
    input.amounts.netInvestmentIncome={...input.amounts.taxableIncome,minor:'2000000'}
    if(patch==='missing-branch')delete input.qdcgWorksheet
    if(patch==='missing-base')delete input.amounts.netCapitalGain
    if(patch==='unsupported-method')input.qdcgWorksheet.state='unsupported'
    if(patch==='dividend-conflict')input.amounts.qualifiedDividends.minor='2500001'
    const result=calculateAnnualComponents(input)
    assert.equal(result.components[0].amountMinor,null);assert.notEqual(result.components[0].mode,'computed')
    assert.equal(result.components[1].amountMinor,'76000');assert.equal(result.status,'components-only')
  }
  const v1=scenario();v1.rulePackId=legacyPack.id
  assert.equal(calculateAnnualComponents(v1).components[0].mode,'unsupported')
})

test('published v2 example, source identity, input origins and output isolation remain explicit', () => {
  const input:any=structuredClone(qdcgExample);input.amounts.qualifiedDividends.origin='assumption'
  const result=calculateAnnualComponents(input)
  assert.equal(result.rulePackId,V2);assert.equal(result.rulePackSha256,getAnnualRulePack(2025,V2).contentSha256)
  assert.ok(result.components[0].trace.some(t=>t.label.includes('origin=assumption')))
  assert.deepEqual(calculateAnnualComponents(input),result)
  result.components[0].trace[0].label='changed';assert.notDeepEqual(calculateAnnualComponents(input),result)
  assert.equal(getAnnualRuleStatus(2025,'us.regular.qdcg',V2).calculationAvailable,true)
  assert.equal(getAnnualRuleStatus(2025,'us.regular.qdcg').calculationAvailable,false)
})

test('positive capital-gain distributions cannot bypass ordinary-only scope in either pack', () => {
  for(const rulePackId of [legacyPack.id,V2]){
    const input:any=structuredClone(example);input.rulePackId=rulePackId
    input.requestedComponents=['us.regular.ordinary','us.niit']
    input.amounts.capitalGainDistributions={...input.amounts.taxableIncome,minor:'2000000'}
    input.amounts.niitMagi={...input.amounts.taxableIncome,minor:'30000000'}
    input.amounts.netInvestmentIncome={...input.amounts.taxableIncome,minor:'2000000'}
    const result=calculateAnnualComponents(input)
    assert.equal(result.components[0].mode,'unsupported');assert.equal(result.components[0].amountMinor,null)
    assert.equal(result.components[1].amountMinor,'76000')
  }
})

import rawQualified from '../data/tax-rules/2025/qualified-gains.json'
test('pinned digest identity cannot be replaced through shared JSON module mutation', () => {
  for(const raw of [legacyPack,rawQualified]){
    const original=structuredClone(raw)
    try {
      raw.data.usOrdinary.tableRows[0][2]='999'
      const {contentSha256,...payload}=raw;raw.contentSha256=annualJsonDigest(payload)
      assert.throws(()=>getAnnualRulePack(2025,raw.id as any),/integrity/)
    } finally { Object.assign(raw,original) }
  }
  assert.equal(getAnnualRulePack(2025).data.usOrdinary.tableRows[0][2],'0')
})
