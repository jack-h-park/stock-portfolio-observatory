import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { buildAccountInventoryReview } from '../lib/application/account-inventory'
import { getAccountInventoryReview } from '../lib/adapters/account-inventory'

const clock='2026-01-20T23:00:00Z'
const metadata=(id='exampleA')=>({role:'primary',accountId:id,providerId:'chase',owner:{state:'confirmed',ownerId:'self'},dimensions:{wrappers:['deposit'],assetClasses:['cash']},lifecycle:{state:'active'},requirements:[{kind:'activity',freshnessPolicyId:'bank-30',historyFrom:'2026-01-01'}]})
const map=()=>({state:'available',value:{bankAccounts:[{institution:'chase',alias:'Example one',inventory:metadata()}]}}) as any
const fact=(extra:any={})=>({provider:'Chase',account:'Example one',kind:'activity',date:'2026-01-20',refs:['example.csv'],state:'present',basis:'declared_period',periods:[{from:'2026-01-01',to:'2026-01-20'}],...extra})
const run=(facts:any[],extra:any={})=>buildAccountInventoryReview({mapRead:map(),facts,readIssues:[],...extra},clock)
const source=(result:any)=>result.projection.rows.find((r:any)=>r.accountId==='exampleA').sources[0]

test('quiet identity-bound periods connect to requirements without any transaction',()=>{
 const r=run([fact()]);assert.equal(source(r).state,'current');assert.equal(source(r).history.state,'covered')
 assert.equal(r.projection.rows[0].observationKeys.length,1);assert.equal(r.projection.review.state,'unreviewed')
})
test('transaction and balance observation dates never become source periods or owner confirmation',()=>{
 const r=run([fact({basis:'database_observation',periods:undefined})])
 assert.equal(source(r).state,'unconfirmed');assert.equal(source(r).history.state,'unconfirmed')
 const legacy=run([fact()],{mapRead:{state:'available',value:{bankAccounts:[{institution:'chase',alias:'Example one',owner:'self'}]}}})
 assert.equal(legacy.projection.rows[0].owner.state,'unconfirmed')
})
test('same institution accounts cannot borrow quiet periods and historical chains consolidate before freshness',()=>{
 const m=map();m.value.bankAccounts.push({institution:'chase',alias:'Example two',inventory:metadata('exampleB')})
 const r=run([fact({date:'2026-01-10',periods:[{from:'2026-01-01',to:'2026-01-10'}]}),fact({refs:['second.csv'],periods:[{from:'2026-01-11',to:'2026-01-20'}]})],{mapRead:m})
 assert.equal(source(r).throughDate,'2026-01-20');assert.equal(source(r).history.state,'covered')
 assert.equal(r.projection.rows.find((row:any)=>row.accountId==='exampleB')!.sources[0].state,'missing')
})
test('endpoint confirmations do not fill historical gaps and conflicts win',()=>{
 assert.equal(source(run([fact({basis:'owner_confirmation',periods:undefined})])).history.state,'unconfirmed')
 assert.equal(source(run([fact(),fact({refs:['conflict'],state:'conflicting'})])).state,'conflicting')
})
test('failed input reads cannot certify a zero result, and messages never include paths',()=>{
 const r=run([],{mapRead:{state:'available',value:{}},readIssues:['database_unavailable']})
 assert.equal(r.projection.review.state,'unavailable');assert.equal(r.projection.counts.confirmedExpected,null)
 assert.ok(!JSON.stringify(r).includes('/Users/'))
})
test('facts are deterministic and future or unbound identities stay separate',()=>{
 const facts=[fact(),fact({account:'Other',date:'2026-01-21'})]
 const before=JSON.stringify(facts);const a=run(facts),b=run([...facts].reverse())
 assert.deepEqual(a,b);assert.equal(a.projection.laterObservations.length,1);assert.equal(JSON.stringify(facts),before)
})

test('actual read-only transport preserves map and SQLite while binding declared periods',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inventory-adapter-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const dbPath=path.join(dir,'portfolio.db'),mapPath=path.join(dir,'accounts.json')
 fs.writeFileSync(mapPath,JSON.stringify(map().value))
 const db=new Database(dbPath)
 db.exec(`create table transactions_all (brokerage text,account text,date text); create table bank_statement_coverage (institution text,account text,period_start text,period_end text,source text,sha256 text); create table source_files(name text, filename text,sha256 text);`)
 db.prepare('insert into transactions_all values (?,?,?)').run('Chase','Example one','2026-01-05')
 db.prepare('insert into bank_statement_coverage values (?,?,?,?,?,?)').run('chase','Example one','2026-01-01','2026-01-20','quiet.csv','a'.repeat(64))
 db.prepare('insert into source_files values (?,?,?)').run('account_map','accounts.json',createHash('sha256').update(fs.readFileSync(mapPath)).digest('hex'));db.close()
 const files=[mapPath,dbPath];const before=files.map(p=>[createHash('sha256').update(fs.readFileSync(p)).digest('hex'),fs.statSync(p).mtimeMs])
 const paths={mapPath,dbPath,krMetadataPath:path.join(dir,'missing-kr'),cryptoPath:path.join(dir,'missing-crypto'),robinhoodPath:path.join(dir,'missing-rh'),tossPath:path.join(dir,'missing-toss')}
 const r=getAccountInventoryReview({paths,clock});assert.equal(source(r).state,'current');assert.equal(source(r).history.state,'covered');assert.deepEqual(r.readIssues,[])
 assert.deepEqual(files.map(p=>[createHash('sha256').update(fs.readFileSync(p)).digest('hex'),fs.statSync(p).mtimeMs]),before)
 fs.writeFileSync(mapPath,JSON.stringify({...map().value,anchors:[{amount:123}]}))
 const mismatch=getAccountInventoryReview({paths,clock});assert.ok(mismatch.readIssues.includes('account_map_changed_since_ingest'));assert.equal(mismatch.projection.review.state,'unavailable')
 fs.writeFileSync(mapPath,'{broken');assert.equal(getAccountInventoryReview({paths,clock}).projection.mapState,'unavailable')
})

test('unconfirmed recorded artifacts remain unresolved beside a valid period',()=>{
 const r=run([fact(),fact({date:null,refs:['malformed.csv'],state:'unconfirmed',periods:undefined})])
 assert.equal(source(r).state,'unconfirmed');assert.equal(source(r).history.state,'unconfirmed')
 assert.ok(source(r).evidenceRefs.includes('malformed.csv'))
})

function transportFixture(t:import('node:test').TestContext){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inventory-records-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const paths={mapPath:path.join(dir,'map.json'),dbPath:path.join(dir,'db.sqlite'),krMetadataPath:path.join(dir,'kr.json'),cryptoPath:path.join(dir,'crypto.json'),robinhoodPath:path.join(dir,'rh.json'),tossPath:path.join(dir,'toss.json')}
 fs.writeFileSync(paths.mapPath,JSON.stringify(map().value))
 const db=new Database(paths.dbPath);db.exec('create table transactions_all (brokerage text,account text,account_type text,date text); create table source_files (name text,filename text,sha256 text);')
 const fingerprint=(name:string,file:string)=>db.prepare('insert into source_files values (?,?,?)').run(name,path.basename(file),createHash('sha256').update(fs.readFileSync(file)).digest('hex'))
 fingerprint('account_map',paths.mapPath)
 return {paths,db,fingerprint}
}

test('missing ingested caches and malformed generated schemas are explicit incomplete reads',t=>{
 const f=transportFixture(t)
 f.db.prepare('insert into source_files values (?,?,?)').run('crypto_activity','gone.json','a'.repeat(64));f.db.close()
 let r=getAccountInventoryReview({paths:f.paths,clock});assert.ok(r.readIssues.includes('crypto_activity_missing'));assert.equal(r.projection.review.state,'unavailable')
 fs.writeFileSync(f.paths.tossPath,'{}')
 r=getAccountInventoryReview({paths:f.paths,clock});assert.ok(r.readIssues.includes('toss_snapshot_invalid'))
})

test('source-only Toss accountNo stays visible without inventing its label bridge',t=>{
 const f=transportFixture(t);fs.writeFileSync(f.paths.tossPath,JSON.stringify({fetchedAt:clock,accounts:[{accountNo:'123456789',accountSeq:1,accountType:'test'}]}));f.fingerprint('toss_snapshot',f.paths.tossPath);f.db.close()
 const r=getAccountInventoryReview({paths:f.paths,clock})
 assert.ok(r.projection.rows.some(row=>row.providerId==='toss'&&row.discovery==='observed_only'))
})

test('two pension identities sharing one token cannot borrow a snapshot',t=>{
 const f=transportFixture(t)
 fs.writeFileSync(f.paths.mapPath,JSON.stringify({pensionAccounts:['A','B'].map(label=>({token:'shared',account:`Example ${label}`,institution:'mirae',inventory:{...metadata(`example${label}`),providerId:'mirae',requirements:[{kind:'pension_snapshot',freshnessPolicyId:'pension-180'}]}}))}))
 f.db.prepare('delete from source_files').run();f.fingerprint('account_map',f.paths.mapPath)
 f.db.prepare('insert into source_files values (?,?,?)').run('pension:shared-holdings-20260120.csv','shared-holdings-20260120.csv','b'.repeat(64));f.db.close()
 const r=getAccountInventoryReview({paths:f.paths,clock});assert.ok(r.readIssues.includes('pension_token_ambiguous'))
 for(const row of r.projection.rows) { assert.notEqual(row.sources[0]?.state,'current');assert.equal(row.action,'review') }
})

test('a uniquely bound missing disposal remains actionable with a current query confirmation',t=>{
 const f=transportFixture(t)
 f.db.exec('create table missing_disposals (brokerage text,account_type text,ticker text); create table source_coverage_confirmations (scope text,institution text,account text,kind text,through_date text,source text,empty_holdings integer);')
 f.db.prepare('insert into transactions_all values (?,?,?,?)').run('Chase','Example one','Cash','2026-01-20')
 f.db.prepare('insert into missing_disposals values (?,?,?)').run('Chase','Cash','EXAMPLE')
 f.db.prepare('insert into source_coverage_confirmations values (?,?,?,?,?,?,?)').run('investment','Chase','Example one','transactions','2026-01-20','confirmed.csv',0);f.db.close()
 const r=getAccountInventoryReview({paths:f.paths,clock});assert.ok(source(r).reasons.includes('missing_disposal'));assert.equal(r.projection.rows.find(row=>row.accountId==='exampleA')?.action,'update')
})
