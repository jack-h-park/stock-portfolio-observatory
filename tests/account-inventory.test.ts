import assert from 'node:assert/strict'
import test from 'node:test'
import { inventoryDigest, projectAccountInventory, validateInventoryMap } from '../lib/domain/assets/account-inventory'

const today = '2026-01-20', clock = '2026-01-20T23:00:00Z'
const scope = () => ({ owners: ['self'], providers: 'all', wrappers: 'all', assetClasses: 'all', exclusions: [] }) as any
const primary = (id = 'exampleA', extra: any = {}) => ({ role: 'primary', accountId: id, providerId: 'chase', owner: { state: 'confirmed', ownerId: 'self' }, dimensions: { wrappers: ['deposit'], assetClasses: ['cash'] }, lifecycle: { state: 'active' }, requirements: [{ kind: 'activity', freshnessPolicyId: 'bank-30' }], ...extra })
const map = () => ({ bankAccounts: [{ institution: 'chase', alias: 'Example checking', inventory: primary() }] }) as any
const input = (value: any = map(), extra: any = {}) => ({ mapRead: { state: 'available', value }, observations: [], evidenceSignals: [], requestedScope: scope(), asOfDate: today, clock, adapterVersion: 'inventory-v1', ...extra }) as any
const observe = (extra: any = {}) => ({ key: 'observationA', providerId: 'chase', account: 'Example checking', asOfDate: today, evidenceRefs: ['source-example'], ...extra })
function reviewed(value = map(), requested = scope()) {
  const receipt = { reviewId: 'review-example', reviewedAt: clock, asOfDate: today, reviewerId: 'owner', basis: 'owner-attested', scope: requested, includedAccountIds: ['exampleA'], digestVersion: 1, inventoryDigest: inventoryDigest(validateInventoryMap({ state: 'available', value }), requested) }
  value.inventoryReview = { schemaVersion: 1, receipts: [receipt] }
  return value
}
const assessment = (out: any) => out.rows.find((r: any) => r.accountId === 'exampleA').sources[0]

test('missing, invalid and legacy empty map differ from a reviewed empty scope', () => {
  for (const state of ['missing', 'invalid', 'read_error']) {
    const out = projectAccountInventory(input({}, { mapRead: { state } }))
    assert.equal(out.review.state, 'unavailable'); assert.equal(out.counts.confirmedExpected, null)
  }
  assert.equal(validateInventoryMap({ state: 'available', value: [] }).state, 'unavailable')
  assert.equal(projectAccountInventory(input({})).review.state, 'unreviewed')
  const empty: any = {}; reviewed(empty).inventoryReview.receipts[0].includedAccountIds = []
  const out = projectAccountInventory(input(empty))
  assert.equal(out.review.state, 'reviewed'); assert.equal(out.counts.confirmedExpected, 0)
})

test('an expected account with no observations is missing evidence, never fabricated zero money', () => {
  const out = projectAccountInventory(input())
  assert.equal(out.rows.length, 1); assert.equal(out.rows[0].discovery, 'expected')
  assert.equal(assessment(out).state, 'missing'); assert.equal(out.review.state, 'unreviewed')
  assert.equal('balance' in out.rows[0], false)
})

test('validation rejects malformed metadata and versions without rewriting legacy values', () => {
  for (const value of [ {bankAccounts:'wrong'}, {inventoryReview:{schemaVersion:2,receipts:[]}}, {bankAccounts:[{inventory:{role:'primary',accountId:'123'}}]} ]) {
    const r = validateInventoryMap({state:'available',value})
    assert.ok(r.state === 'unavailable' || r.registrations.some((x:any)=>x.issues.length))
  }
  const m = map();m.bankAccounts[0].inventory.requirements.push({...m.bankAccounts[0].inventory.requirements[0]})
  assert.equal(projectAccountInventory(input(m)).review.state, 'conflicted')
})

test('bindings fold exact aliases and explicit currency series, not suffix guesses', () => {
  const m = map();m.bankAccounts[0].multiCurrency=true
  m.accounts = {'Example renamed':{inventory:{role:'binding',accountId:'exampleA'}}}
  const out=projectAccountInventory(input(m,{observations:[observe({account:'Example checking (USD)'}),observe({key:'second',account:'Example renamed'})]}))
  assert.equal(out.rows.length,1);assert.equal(out.rows[0].observationKeys.length,2)
  const unknown=projectAccountInventory(input(m,{observations:[observe({account:'Other ending 1111'})]}))
  assert.equal(unknown.rows.length,2);assert.equal(unknown.counts.observedOnly,1)
})

test('duplicate primaries, dangling bindings and alias collisions cannot certify a scope', () => {
  const duplicate=map();duplicate.bankAccounts.push({...duplicate.bankAccounts[0]})
  assert.equal(projectAccountInventory(input(duplicate)).review.state,'conflicted')
  const dangling={accounts:{Example:{inventory:{role:'binding',accountId:'missingPrimary'}}}}
  assert.equal(projectAccountInventory(input(dangling)).review.state,'conflicted')
  const collision=map();collision.bankAccounts.push({...collision.bankAccounts[0],inventory:primary('exampleB')})
  assert.equal(projectAccountInventory(input(collision,{observations:[observe()]})).review.state,'conflicted')
})

test('source evidence never leaks between two accounts at the same institution', () => {
  const m=map();m.bankAccounts.push({institution:'chase',alias:'Example second',inventory:primary('exampleB')})
  const out=projectAccountInventory(input(m,{observations:[observe()],evidenceSignals:[{observationKey:'observationA',kind:'activity',state:'present',throughDate:today,refs:['source-example']}]}))
  assert.equal(assessment(out).state,'current')
  assert.equal(out.rows.find((r:any)=>r.accountId==='exampleB')!.sources[0].state,'missing')
})

test('unknown owner blocks self review while explicit other owner is outside scope', () => {
  const m=map();m.bankAccounts[0].inventory.owner={state:'unconfirmed'}
  assert.equal(projectAccountInventory(input(m)).review.state,'conflicted')
  const other=map();other.bankAccounts[0].inventory.owner={state:'confirmed',ownerId:'other-example'}
  assert.equal(projectAccountInventory(input(other)).rows[0].membership,'excluded')
  const legacy={bankAccounts:[{institution:'chase',alias:'Example',owner:'self'}]}
  const out=projectAccountInventory(input(legacy));assert.equal(out.rows[0].owner.state,'unconfirmed')
  assert.equal(out.counts.confirmedExpected,null)
})

test('semantic digest ignores order and anchors but binds selected membership and ownership', () => {
  const m=map(),s=scope(),d=inventoryDigest(validateInventoryMap({state:'available',value:m}),s)
  m.anchors=[{amount:123}];m.accounts={}
  assert.equal(inventoryDigest(validateInventoryMap({state:'available',value:m}),s),d)
  m.bankAccounts.push({institution:'chase',alias:'Second',inventory:primary('exampleB')})
  const d2=inventoryDigest(validateInventoryMap({state:'available',value:m}),s);assert.notEqual(d2,d)
  m.bankAccounts.reverse();assert.equal(inventoryDigest(validateInventoryMap({state:'available',value:m}),s),d2)
  m.bankAccounts[0].inventory.owner.ownerId='other-example'
  assert.notEqual(inventoryDigest(validateInventoryMap({state:'available',value:m}),s),d2)
})

test('review receipts require exact scope, partition, dates and digest', () => {
  assert.equal(projectAccountInventory(input(reviewed())).review.state,'reviewed')
  const stale=reviewed();stale.bankAccounts[0].inventory.requirements=[]
  assert.equal(projectAccountInventory(input(stale)).review.state,'outdated')
  for(const change of [(r:any)=>r.includedAccountIds=[],(r:any)=>r.reviewedAt='2026-01-21T00:00:00Z',(r:any)=>r.scope.owners=['other-example']]) {
    const m=reviewed();change(m.inventoryReview.receipts[0]);assert.notEqual(projectAccountInventory(input(m)).review.state,'reviewed')
  }
  const dup=reviewed();dup.inventoryReview.receipts.push({...dup.inventoryReview.receipts[0],reviewerId:'another'})
  assert.equal(projectAccountInventory(input(dup)).review.state,'conflicted')
})

test('historical review cannot certify today, and later observations do not rewrite its population', () => {
  const m=reviewed()
  const out=projectAccountInventory(input(m,{asOfDate:'2026-01-21',clock:'2026-01-21T23:00:00Z'}))
  assert.equal(out.review.state,'unreviewed');assert.ok(out.review.reasons.includes('historical_receipt_only'))
  const historical=projectAccountInventory(input(m,{observations:[observe({account:'Later unknown',asOfDate:'2026-01-21'})]}))
  assert.equal(historical.review.state,'reviewed');assert.equal(historical.laterObservations.length,1)
  assert.equal(projectAccountInventory(input(m,{observations:[observe({account:'Unknown',asOfDate:null})]})).review.state,'conflicted')
})

test('each required kind ages independently and missing disposals remain actionable', () => {
  const m=map();m.bankAccounts[0].inventory.requirements.push({kind:'positions',freshnessPolicyId:'us-14'})
  const out=projectAccountInventory(input(m,{observations:[observe()],evidenceSignals:[{observationKey:'observationA',kind:'positions',state:'present',throughDate:today,refs:['snapshot']},{observationKey:'observationA',kind:'activity',state:'present',throughDate:today,refs:['activity'],missingDisposal:true}]}))
  assert.equal(out.rows[0].sources.find((s:any)=>s.kind==='positions')!.state,'current')
  assert.equal(out.rows[0].action,'update');assert.ok(assessment(out).reasons.includes('missing_disposal'))
})

test('unknown policies, conflicts, period uncertainty and stale evidence stay distinct', () => {
  const m=map();m.bankAccounts[0].inventory.requirements[0].freshnessPolicyId='unknown'
  assert.equal(assessment(projectAccountInventory(input(m))).state,'unsupported')
  for(const [signal,state] of [[{state:'conflicting'},'conflicting'],[{state:'present'},'unconfirmed'],[{state:'present',throughDate:'2025-01-01'},'stale'],[{state:'present',throughDate:'2026-01-21'},'unconfirmed']] as any[]) {
    const out=projectAccountInventory(input(map(),{observations:[observe()],evidenceSignals:[{observationKey:'observationA',kind:'activity',refs:['example'],...signal}]}))
    assert.equal(assessment(out).state,state)
  }
})

test('history needs full declared intervals, and legacy/new starts must agree', () => {
  const m=map();m.bankAccounts[0].historyFrom='2026-01-01'
  const signal={observationKey:'observationA',kind:'activity',state:'present',throughDate:today,refs:['example']}
  const run=(s:any)=>assessment(projectAccountInventory(input(m,{observations:[observe()],evidenceSignals:[s]})))
  assert.equal(run(signal).history.state,'unconfirmed')
  assert.equal(run({...signal,periods:[{from:'2026-01-01',to:today}]}).history.state,'covered')
  assert.equal(run({...signal,periods:[{from:'2026-01-10',to:today}]}).history.state,'gaps')
  m.bankAccounts[0].inventory.requirements[0].historyFrom='2026-01-02'
  const conflict=run(signal);assert.equal(conflict.history.state,'unconfirmed');assert.ok(conflict.reasons.includes('history_requirement_conflict'))
})

test('closed, empty and zero have separate lifecycle; closed requirements do not request current refresh', () => {
  const m=map();m.bankAccounts[0].inventory.lifecycle={state:'closed',basisRef:'review-example',closedOn:'2026-01-01'}
  const out=projectAccountInventory(input(m,{observations:[observe()],evidenceSignals:[{observationKey:'observationA',kind:'activity',state:'present',throughDate:'2026-01-01',empty:true,refs:['quiet-statement']}]}))
  assert.equal(out.rows[0].lifecycle.state,'closed');assert.notEqual(out.rows[0].action,'update')
  const future=map();future.bankAccounts[0].inventory.lifecycle={state:'closed',basisRef:'review-example',closedOn:'2027-01-01'}
  assert.equal(projectAccountInventory(input(future)).rows[0].lifecycle.state,'unconfirmed')
})

test('projection is deterministic, does not mutate even frozen inputs, and rejects invalid external shapes', () => {
  const x=input(reviewed(),{observations:[observe()]})
  const before=JSON.stringify(x)
  const freeze=(v:any)=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}};freeze(x)
  assert.deepEqual(projectAccountInventory(x),projectAccountInventory(x));assert.equal(JSON.stringify(x),before)
  for(const bad of [{...input(),asOfDate:'2026-02-30'},{...input(),observations:'bad'},{...input(),requestedScope:{owners:['self']}}]) assert.throws(()=>projectAccountInventory(bad))
})

test('cross-section alias collisions block review before any observation arrives', () => {
  const m=map();m.accounts={'Example checking':{inventory:primary('exampleB')}}
  assert.equal(projectAccountInventory(input(m)).review.state,'conflicted')
})

test('closed accounts retain review actions for unsupported or missing final-history evidence', () => {
  const m=map();m.bankAccounts[0].inventory.lifecycle={state:'closed',basisRef:'closure',closedOn:'2026-01-01'}
  m.bankAccounts[0].inventory.requirements[0].freshnessPolicyId='unknown'
  assert.equal(projectAccountInventory(input(m)).rows[0].action,'review')
})

test('contradictory historical requirements block inventory confirmation, not just freshness', () => {
  const m=map();m.bankAccounts[0].historyFrom='2026-01-01';m.bankAccounts[0].inventory.requirements[0].historyFrom='2026-01-02'
  reviewed(m)
  assert.equal(projectAccountInventory(input(m)).review.state,'conflicted')
})

test('unknown in-scope providers are unresolved rather than certified from a matching label', () => {
  const m=map();m.bankAccounts[0].inventory.providerId='unsupported-provider';delete m.bankAccounts[0].institution
  const out=projectAccountInventory(input(m,{observations:[observe({providerId:'unsupported-provider'})]}))
  assert.equal(out.review.state,'conflicted');assert.equal(assessment(out).state,'unconfirmed')
})

test('well-scoped exclusions partition reviewed expectations and remain visible', () => {
  const m=map();m.bankAccounts.push({institution:'chase',alias:'Example second',inventory:primary('exampleB')})
  const s=scope();s.exclusions=[{key:'account:exampleB',reason:'Separate reviewed scope',basisRef:'review-example'}]
  reviewed(m,s)
  const out=projectAccountInventory(input(m,{requestedScope:s}))
  assert.equal(out.review.state,'reviewed');assert.equal(out.counts.confirmedExpected,1)
  assert.equal(out.rows.find((r:any)=>r.accountId==='exampleB')!.membership,'excluded')
})

test('conflicting owners and duplicate-provider identities cannot escape a narrower review scope', () => {
  const m=map();m.bankAccounts[0].inventory.owner.ownerId='other-example';m.bankAccounts[0].owner='self'
  reviewed(m).inventoryReview.receipts[0].includedAccountIds=[]
  const out=projectAccountInventory(input(m));assert.equal(out.review.state,'conflicted');assert.equal(out.counts.confirmedExpected,null)
  const duplicate=map();duplicate.bankAccounts.push({institution:'fidelity',alias:'Example Fidelity',inventory:primary('exampleA',{providerId:'fidelity'})})
  const s=scope();s.providers=['fidelity'];reviewed(duplicate,s).inventoryReview.receipts[0].includedAccountIds=[]
  const result=projectAccountInventory(input(duplicate,{requestedScope:s}));assert.equal(result.review.state,'conflicted');assert.equal(result.counts.confirmedExpected,null)
})

test('contradictory observations are conservative and order independent for ownership scope', () => {
  const m:any={};reviewed(m).inventoryReview.receipts[0].includedAccountIds=[]
  const observations=[observe({key:'first',ownerId:'other-example'}),observe({key:'second',ownerId:'self'})]
  const forward=projectAccountInventory(input(m,{observations}));const backward=projectAccountInventory(input(m,{observations:[...observations].reverse()}))
  assert.equal(forward.review.state,'conflicted');assert.deepEqual(forward,backward)
})

test('runtime arrays are rejected as enums instead of coerced into active/current states', () => {
  const m=map();m.bankAccounts[0].inventory.lifecycle.state=['active']
  assert.equal(projectAccountInventory(input(m)).review.state,'conflicted')
  for(const fields of [{state:['conflicting']},{state:'present',reconciliation:['issues']}]) {
    assert.throws(()=>projectAccountInventory(input(map(),{observations:[observe()],evidenceSignals:[{observationKey:'observationA',kind:'activity',throughDate:today,refs:['example'],...fields}]})))
  }
})

test('inherited policy properties are unsupported and cannot make old evidence current', () => {
  for(const policy of ['constructor','__proto__','toString']) {
    const m=map();m.bankAccounts[0].inventory.requirements[0].freshnessPolicyId=policy
    const out=projectAccountInventory(input(m,{observations:[observe()],evidenceSignals:[{observationKey:'observationA',kind:'activity',state:'present',throughDate:'2020-01-01',refs:['old-example']}]}))
    assert.equal(assessment(out).state,'unsupported')
  }
})

test('freshness policies support explicit source kinds, not arbitrary enum combinations', () => {
  const m=map();m.bankAccounts[0].inventory.requirements[0].freshnessPolicyId='pension-180'
  assert.equal(assessment(projectAccountInventory(input(m))).state,'unsupported')
})

test('changed semantic inputs leave historical receipts outdated, never usable for another date', () => {
  const m=reviewed();m.bankAccounts[0].inventory.requirements=[]
  const out=projectAccountInventory(input(m,{asOfDate:'2026-01-21',clock:'2026-01-21T23:00:00Z'}))
  assert.equal(out.review.state,'outdated');assert.equal(out.counts.confirmedExpected,null)
})

test('unknown observation owners cannot inherit an excluding owner from another row', () => {
  const m:any={};reviewed(m).inventoryReview.receipts[0].includedAccountIds=[]
  const observations=[observe({key:'first',ownerId:'other-example'}),observe({key:'second'})]
  const forward=projectAccountInventory(input(m,{observations})), reverse=projectAccountInventory(input(m,{observations:[...observations].reverse()}))
  assert.equal(forward.review.state,'conflicted');assert.deepEqual(forward,reverse)
})

test('conflicting wrapper declarations remain potential members of either wrapper scope', () => {
  const m=map();m.bankAccounts[0].wrapper='pension'
  const s=scope();s.wrappers=['pension'];reviewed(m,s).inventoryReview.receipts[0].includedAccountIds=[]
  assert.equal(projectAccountInventory(input(m,{requestedScope:s})).review.state,'conflicted')
})

test('a binding with contradictory dimensions cannot hide behind its primary dimensions', () => {
  const m=map();m.accounts={'Example alternate':{wrapper:'pension',inventory:{role:'binding',accountId:'exampleA'}}}
  const s=scope();s.wrappers=['pension'];reviewed(m,s).inventoryReview.receipts[0].includedAccountIds=[]
  assert.equal(projectAccountInventory(input(m,{requestedScope:s})).review.state,'conflicted')
})
