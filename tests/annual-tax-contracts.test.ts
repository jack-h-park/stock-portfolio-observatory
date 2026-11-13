import assert from 'node:assert/strict'
import test from 'node:test'
import { getAnnualRulePack } from '../lib/domain/taxes/annual/rules'
import { validateAnnualEstimateInput, validateAnnualEstimateResult, annualInputDigest } from '../lib/domain/taxes/annual/contracts'

const source={id:'public-example',sha256:'0'.repeat(64),locator:'Synthetic example only'}
const fact=(state:string)=>({state,reason:'Synthetic reviewed fact',sourceRefs:[source.id],reviewedAt:'2026-11-12'})
const amount=(minor='12000000')=>({minor,currency:'USD',origin:'synthetic',reason:'Synthetic base, not a private return',sourceRefs:[]})
const fixture=()=>({schemaVersion:1,rulePackId:'annual-2025-foundation-v1',id:'example-estimate',revision:0,taxYear:2025,taxUnit:{id:'example-unit',kind:'joint',ownerIds:['example-a','example-b']},authority:'US:federal',currency:'USD',taxType:'income',filingStatus:'mfj',requestedComponents:['us.regular.ordinary'],residency:fact('reviewed-full-year'),specialMethod:fact('none-reviewed'),regularTaxMethod:fact('ordinary-reviewed'),sources:[source],amounts:{taxableIncome:amount()}})
const result=(input=fixture())=>({schemaVersion:1,rulePackId:input.rulePackId,rulePackSha256:getAnnualRulePack(2025).contentSha256,scenarioId:input.id,inputRevision:input.revision,inputSha256:annualInputDigest(validateAnnualEstimateInput(input)),taxYear:2025,taxUnitId:input.taxUnit.id,authority:input.authority,currency:input.currency,taxType:'income',calculationScope:'component',status:'components-only',annualTotal:null,comparisonEligible:false,components:[{id:'us.regular.ordinary',mode:'computed',amountMinor:'1622800',reason:'Synthetic expected worksheet amount; validation is not a calculator',sourceRefs:['irs-p1040'],inputRefs:['taxableIncome'],trace:[{label:'2025 Pub 1040 Section B'}]}]})

test('input validation is non-mutating and retains exact money and explicit unknown facts', () => {
  const f=fixture(),before=JSON.stringify(f);f.amounts.taxableIncome.minor='900719925474099312345'
  const input=validateAnnualEstimateInput(f);assert.equal(input.amounts.taxableIncome!.minor,f.amounts.taxableIncome.minor)
  assert.equal(JSON.stringify(f),JSON.stringify({...JSON.parse(before),amounts:f.amounts}))
  input.amounts.taxableIncome!.minor='0';assert.notEqual(input.amounts.taxableIncome!.minor,f.amounts.taxableIncome.minor)
  const unknown=fixture();unknown.residency=fact('unknown');assert.equal(validateAnnualEstimateInput(unknown).residency.state,'unknown')
  const absent=fixture();delete (absent.amounts as any).taxableIncome;assert.equal(validateAnnualEstimateInput(absent).amounts.taxableIncome,undefined)
})

test('scope, canonical money and provenance failures are rejected', () => {
  const cases:any[]=[{taxYear:2026},{currency:'KRW'},{filingStatus:'individual'},{requestedComponents:['kr.global.calculated']},{requestedComponents:['us.regular.ordinary','us.regular.ordinary']},{extra:true}]
  for(const patch of cases)assert.throws(()=>validateAnnualEstimateInput({...fixture(),...patch}))
  for(const minor of ['-0','01','1.0','1e3','-1','1\n','1\r']){const f=fixture();f.amounts.taxableIncome.minor=minor;assert.throws(()=>validateAnnualEstimateInput(f))}
  for(const origin of ['reviewed-input','assumption']){
    const f=fixture();(f.amounts.taxableIncome as any).origin=origin;f.amounts.taxableIncome.reason='';assert.throws(()=>validateAnnualEstimateInput(f))
  }
  const reviewed=fixture();(reviewed.amounts.taxableIncome as any).origin='reviewed-input';assert.throws(()=>validateAnnualEstimateInput(reviewed))
  const badDate=fixture();badDate.residency.reviewedAt='2026-02-30';assert.throws(()=>validateAnnualEstimateInput(badDate))
  const members=fixture();members.taxUnit.ownerIds=['example-a'];assert.throws(()=>validateAnnualEstimateInput(members))
})

test('Korean scenarios remain individual and have their own currency and base', () => {
  const f:any=fixture();f.authority='KR:national';f.regularTaxMethod=fact('general-reviewed');f.currency='KRW';f.filingStatus='individual';f.taxUnit={id:'kr-example',kind:'individual',ownerIds:['example-a']};f.requestedComponents=['kr.global.calculated'];f.amounts={taxableBase:{...amount('30000000'),currency:'KRW'}}
  assert.equal(validateAnnualEstimateInput(f).currency,'KRW')
  f.taxUnit.kind='joint';assert.throws(()=>validateAnnualEstimateInput(f))
})

test('result contract is component-only and cannot assert annual liability/comparison', () => {
  const input=validateAnnualEstimateInput(fixture()),r=result()
  assert.equal(validateAnnualEstimateResult(r,input).components[0].amountMinor,'1622800')
  for(const patch of [{annualTotal:'1622800'},{comparisonEligible:true},{calculationScope:'annual-total'},{scenarioId:'another'},{taxUnitId:'another'},{inputRevision:1},{currency:'KRW'},{inputSha256:'1'.repeat(64)}])assert.throws(()=>validateAnnualEstimateResult({...r,...patch},input))
})

test('unknown, missing, blocked or unreviewed dependencies cannot produce known computed components', () => {
  const input=fixture();input.residency=fact('unknown');assert.throws(()=>validateAnnualEstimateResult(result(input),validateAnnualEstimateInput(input)))
  const missing=fixture();delete (missing.amounts as any).taxableIncome;assert.throws(()=>validateAnnualEstimateResult(result(missing),validateAnnualEstimateInput(missing)))
  for(const patch of [{trace:[]},{sourceRefs:[]},{inputRefs:[]},{mode:'unknown',amountMinor:'0'},{mode:'not-applicable',amountMinor:'10'}]){
    const r=result();Object.assign(r.components[0],patch);assert.throws(()=>validateAnnualEstimateResult(r,validateAnnualEstimateInput(fixture())))
  }
  const r:any=result();r.status='blocked';r.components[0]={id:'us.regular.ordinary',mode:'unknown',amountMinor:null,reason:'Missing reviewed amount',sourceRefs:[],inputRefs:[],trace:[]}
  assert.equal(validateAnnualEstimateResult(r,validateAnnualEstimateInput(fixture())).components[0].amountMinor,null)
})

test('input digests are deterministic and reject post-validation mutation/duplicate result IDs', () => {
  const f=fixture(),input=validateAnnualEstimateInput(f),r=result()
  assert.equal(annualInputDigest({...input,amounts:{...input.amounts}}),r.inputSha256)
  input.amounts.taxableIncome!.minor='1';assert.throws(()=>validateAnnualEstimateResult(r,input))
  r.components.push({...r.components[0]});assert.throws(()=>validateAnnualEstimateResult(r,validateAnnualEstimateInput(f)))
})

test('published synthetic fixture and strict schemas reject invalid provenance and scope', async () => {
  const { default: example } = await import('../examples/annual-tax-estimate.synthetic.json')
  assert.equal(validateAnnualEstimateInput(example).rulePackId, getAnnualRulePack(2025).id)
  const duplicate = fixture(); duplicate.sources.push({...source}); assert.throws(() => validateAnnualEstimateInput(duplicate))
  const unresolved = fixture(); unresolved.residency.sourceRefs=['missing']; assert.throws(() => validateAnnualEstimateInput(unresolved))
  const invalidAmount:any = fixture(); invalidAmount.amounts.taxableIncome.currency='KRW'; assert.throws(() => validateAnnualEstimateInput(invalidAmount))
  const methods=fixture(); methods.requestedComponents.push('us.regular.qdcg'); assert.throws(() => validateAnnualEstimateInput(methods))
  const sparse=fixture(); delete (sparse.taxUnit.ownerIds as any)[0]; assert.throws(() => validateAnnualEstimateInput(sparse))
  for (const patch of [{rulePackId:'other'},{revision:NaN},{revision:0.1},{taxUnit:null},{requestedComponents:'us.niit'}]) assert.throws(() => validateAnnualEstimateInput({...fixture(),...patch}))
  const r=result(); r.rulePackSha256='f'.repeat(64); assert.throws(() => validateAnnualEstimateResult(r,validateAnnualEstimateInput(fixture())))
})

test('reviewed and not-applicable results require explicit provenance; blocked methods cannot claim computation', () => {
  const input=validateAnnualEstimateInput(fixture()),r:any=result()
  r.components[0]={...r.components[0],mode:'not-applicable',amountMinor:'0',sourceRefs:[source.id],reviewedAt:'2026-11-12'}
  assert.equal(validateAnnualEstimateResult(r,input).components[0].amountMinor,'0')
  delete r.components[0].reviewedAt; assert.throws(() => validateAnnualEstimateResult(r,input))
  r.components[0].mode='reviewed-input';r.components[0].reviewedAt='2026-11-12'
  assert.equal(validateAnnualEstimateResult(r,input).components[0].mode,'reviewed-input')
  r.components[0].sourceRefs=['irs-p1040']; assert.throws(() => validateAnnualEstimateResult(r,input))
  const q:any=fixture();q.requestedComponents=['us.regular.qdcg'];q.amounts={...q.amounts,ordinaryDividends:amount('0'),qualifiedDividends:amount('0'),netLongTermGain:amount('0'),netCapitalGain:amount('0')}
  const qr:any=result(q);qr.components[0].id='us.regular.qdcg';qr.components[0].inputRefs=Object.keys(q.amounts)
  assert.throws(() => validateAnnualEstimateResult(qr,validateAnnualEstimateInput(q)),/blocked/)
  const blocked:any=result();blocked.status='blocked';blocked.components[0]={...blocked.components[0],mode:'unsupported',amountMinor:null,sourceRefs:[],inputRefs:[],trace:[]}
  assert.equal(validateAnnualEstimateResult(blocked,input).status,'blocked')
  blocked.status='components-only';assert.throws(() => validateAnnualEstimateResult(blocked,input))
})

test('ordinary method needs reviewed eligibility and rejects contradictory preferential amounts', () => {
  const missing:any=fixture();delete missing.regularTaxMethod;assert.throws(()=>validateAnnualEstimateInput(missing))
  const unknown:any=fixture();unknown.regularTaxMethod=fact('unknown');assert.throws(()=>validateAnnualEstimateResult(result(unknown),validateAnnualEstimateInput(unknown)),/method/)
  for(const key of ['qualifiedDividends','netLongTermGain','netCapitalGain']){
    const f:any=fixture();f.amounts[key]=amount('1000000');assert.throws(()=>validateAnnualEstimateResult(result(f),validateAnnualEstimateInput(f)),/preferential/)
  }
})
