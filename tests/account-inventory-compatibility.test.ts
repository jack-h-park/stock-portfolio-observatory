import assert from 'node:assert/strict'
import test from 'node:test'
import { readRobinhoodSnapshotIdentities } from '../lib/domain/assets/robinhood-snapshot-identity'
import { inventoryPensionPolicies } from '../lib/application/inventory-pension-policy'

const date='2026-01-20'
const policies=(entries:any[])=>inventoryPensionPolicies({state:'available',value:{pensionAccounts:entries}},date)

test('existing full-number/nickname schema resolves exact strategy labels without suffix guesses',()=>{
 const result=readRobinhoodSnapshotIdentities([{accountNumber:'00001111',nickname:'Long-term'},{accountNumber:'99991111',nickname:'Mid-term'}])
 assert.deepEqual(result.map(r=>r.label),['Robinhood Long-term','Robinhood Mid-term'])
 assert.ok(result.every(r=>r.issue===null))
})
test('named legacy snapshots and explicit snake-case numbers remain compatible',()=>{
 assert.equal(readRobinhoodSnapshotIdentities([{account:'Robinhood explicit'}])[0].label,'Robinhood explicit')
 assert.equal(readRobinhoodSnapshotIdentities([{account_number:'SAMPLE0001',nickname:'Exact strategy'}])[0].label,'Robinhood Exact strategy')
 const raw=[{accountNumber:'SAMPLE0001',nickname:'Exact strategy'}];const before=JSON.stringify(raw)
 readRobinhoodSnapshotIdentities(raw);assert.equal(JSON.stringify(raw),before)
})
test('duplicate full numbers, strategy ambiguity and contradictory number fields stay unresolved',()=>{
 for(const entries of [
  [{accountNumber:'00001111',nickname:'First'},{accountNumber:'00001111',nickname:'Second'}],
  [{accountNumber:'00001111',nickname:'Same'},{accountNumber:'99992222',nickname:'Same'}],
  [{accountNumber:'00001111',account_number:'99992222',nickname:'Conflicting'}],
 ])assert.ok(readRobinhoodSnapshotIdentities(entries).every(r=>r.issue!==null))
 assert.ok(readRobinhoodSnapshotIdentities([{nickname:'No number'}])[0].issue)
 assert.ok(readRobinhoodSnapshotIdentities([{accountNumber:['bad'],nickname:'Bad type'}])[0].issue)
})
test('tokenless and retired legacy pensions are declared policies, not inferred financial facts',()=>{
 const result=policies([{account:'Closed example',retiredOn:'2025-12-31',owner:'other'},{account:'Unloaded example',note:'arbitrary free text',owner:'other'}])
 assert.deepEqual(result.map(r=>r.state),['closed_declared','not_loaded'])
 assert.ok(result.every(r=>!('confirmedOwner' in r)&&!('balance' in r)))
 const altered=policies([{account:'Unloaded example',note:'different note'}]);assert.equal(altered[0].state,'not_loaded')
})
test('active primary requirements and malformed/future retirement remain genuine review issues',()=>{
 const result=policies([
  {account:'Future closed',retiredOn:'2027-01-01'},
  {account:'Malformed closed',retiredOn:'bad'},
  {account:'Required snapshot',inventory:{role:'primary',accountId:'Example',providerId:'mirae',owner:{state:'confirmed',ownerId:'self'},dimensions:{wrappers:['irp'],assetClasses:['security']},lifecycle:{state:'active'},requirements:[{kind:'pension_snapshot',freshnessPolicyId:'pension-180'}]}},
 ])
 assert.ok(result.every(r=>r.state==='review_required'))
 assert.equal(policies([{account:'Active token',token:'sample'}])[0].state,'active')
})

test('final labels are unique across explicit, strategy and full-number fallback schemas',()=>{
 for(const entries of [
  [{account:'Robinhood Same',accountNumber:'SAMPLE0001'},{accountNumber:'SAMPLE0002',nickname:'Same'}],
  [{account:'Robinhood accountNumber SAMPLE0001'},{accountNumber:'SAMPLE0001'}],
 ]) {
  const result=readRobinhoodSnapshotIdentities(entries)
  assert.ok(result.every(r=>r.label===null&&r.issue==='robinhood_snapshot_identity_ambiguous'))
 }
})
