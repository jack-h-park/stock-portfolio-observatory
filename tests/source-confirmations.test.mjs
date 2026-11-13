import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {verifiedSourceConfirmations, fidelitySnapshotFacts} from '../scripts/source-confirmations.mjs'

const root=mkdtempSync(path.join(tmpdir(),'source-confirmations-'))
mkdirSync(path.join(root,'us-transactions'))
const file='us-transactions/fidelity-transactions-20260101-20260103.csv'
const body='Run Date,Action\n01/03/2026,Transfer\nDate downloaded 11/13/2026'
writeFileSync(path.join(root,file),body)
const receipt={scope:'investment',institution:'Fidelity',account:'Sample Fidelity',kind:'transactions',source:file,sha256:createHash('sha256').update(body).digest('hex'),through:'2026-11-13',basis:'owner-confirmed',confirmedAt:'2026-11-13'}

test('an owner-confirmed end is bound to exact original bytes, not the last row or download date',()=>{
 assert.equal(verifiedSourceConfirmations([receipt],root,{today:'2026-11-13'}).accepted[0].through,'2026-11-13')
 for(const change of [{sha256:'0'.repeat(64)},{source:'../outside.csv'},{through:'2026-11-14'},{through:'2026-02-30'},{basis:'download-date'}]){
  const result=verifiedSourceConfirmations([{...receipt,...change}],root,{today:'2026-11-13'})
  assert.equal(result.accepted.length,0)
  assert.equal(result.problems.length,1)
 }
})

test('empty investment snapshot is accepted only with explicit confirmation and its own snapshot date',()=>{
 const rows=[['Account number','Account name','Symbol','Current value'],[],['Date downloaded Nov-13-2026 at 1:44 p.m ET']]
 assert.deepEqual(fidelitySnapshotFacts(rows,{scope:'investment',account:'Sample Fidelity',through:'2026-11-13',emptyHoldings:true},{}),{empty:true,balance:null})
 assert.throws(()=>fidelitySnapshotFacts(rows,{scope:'investment',through:'2026-11-13'},{}))
 assert.throws(()=>fidelitySnapshotFacts(rows,{scope:'investment',through:'2026-11-12',emptyHoldings:true},{}))
})

test('CMA core money market snapshot is a balance observation, never an incoming payment',()=>{
 const rows=[['Account number','Account name','Symbol','Current value'],['X00012345','Sample CMA','SPAXX**','$123.45'],['Date downloaded Nov-13-2026']]
 const map={bankAccounts:[{institution:'fidelity',kind:'cma',alias:'Sample CMA',accountId:'X00012345'}]}
 assert.deepEqual(fidelitySnapshotFacts(rows,{scope:'bank',account:'Sample CMA',through:'2026-11-13'},map),{empty:false,balance:123.45})
 assert.throws(()=>fidelitySnapshotFacts(rows,{scope:'bank',account:'Other CMA',through:'2026-11-13'},map))
 assert.throws(()=>fidelitySnapshotFacts([rows[0],['X00012345','Sample CMA','AAPL','$123.45'],rows[2]],{scope:'bank',account:'Sample CMA',through:'2026-11-13'},map))
})
