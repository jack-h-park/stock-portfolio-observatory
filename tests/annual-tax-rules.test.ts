import assert from 'node:assert/strict'
import test from 'node:test'
import { getAnnualRulePack, getAnnualRuleStatus, validateAnnualRulePack } from '../lib/domain/taxes/annual/rules'

test('2025 federal table preserves every official interval and Single/MFJ columns', () => {
  const pack=getAnnualRulePack(2025), rows=pack.data.usOrdinary.tableRows
  assert.equal(rows.length,2062)
  assert.deepEqual(rows[0],['0','5','0','0'])
  assert.deepEqual(rows.find(r=>r[0]==='25300'),['25300','25350','2801','2562'])
  assert.deepEqual(rows.at(-1),['99950','100000','16909','11823'])
  for(let i=1;i<rows.length;i++)assert.equal(rows[i][0],rows[i-1][1])
  assert.equal(pack.data.usOrdinary.worksheet.mfj[0].subtractUsd,'10172.00')
  assert.equal(pack.data.usNiit.rateBasisPoints,380)
  assert.equal(pack.data.usNiit.thresholdsUsd.mfj,'250000')
})

test('pack identity is year-specific, verified for data integrity and isolated from callers', () => {
  assert.throws(()=>getAnnualRulePack(2026),/year/i)
  const p=getAnnualRulePack(2025)
  p.data.usOrdinary.tableRows[0][2]='999'
  assert.throws(()=>validateAnnualRulePack(p),/integrity/i)
  assert.equal(getAnnualRulePack(2025).data.usOrdinary.tableRows[0][2],'0')
  const metadata=getAnnualRulePack(2025);metadata.readiness['kr.global.calculated'].status='reference-ready'
  assert.throws(()=>validateAnnualRulePack(metadata),/integrity/i)
})

test('unresolved rounding/worksheet coverage stays blocked as federal library support expands', () => {
  for(const id of ['kr.global.calculated','kr.local.calculated','us.regular.qdcg'] as const){
    const s=getAnnualRuleStatus(2025,id);assert.equal(s.status,'blocked');assert.ok(s.blockers.length);assert.equal(s.calculationAvailable,false)
  }
  assert.equal(getAnnualRuleStatus(2025,'us.regular.ordinary').status,'reference-ready')
  assert.equal(getAnnualRuleStatus(2025,'us.niit').calculationAvailable,true)
  const p=getAnnualRulePack(2025)
  assert.deepEqual(p.data.krGlobal[1],{upToKrw:'50000000',rateBasisPoints:1500,deductionKrw:'1260000'})
  assert.deepEqual(p.data.krLocal[1],{upToKrw:'50000000',rateBasisPoints:150,deductionKrw:'126000'})
  assert.ok(p.sources.every(s=>s.taxYear===2025 && /^[a-f0-9]{64}$/.test(s.sha256)))
})

test('a rehashed replacement cannot masquerade as the pinned rule pack', async () => {
  const { annualJsonDigest } = await import('../lib/domain/taxes/annual/rules')
  const p=getAnnualRulePack(2025);p.data.usOrdinary.tableRows[0][2]='100'
  const {contentSha256,...payload}=p;p.contentSha256=annualJsonDigest(payload)
  assert.throws(()=>validateAnnualRulePack(p),/integrity/)
  for(const value of [undefined,NaN,Infinity,new Date(),[,1]])assert.throws(()=>annualJsonDigest(value))
  assert.equal(annualJsonDigest({b:2,a:1}),annualJsonDigest({a:1,b:2}))
})
