import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'

const root=mkdtempSync(path.join(tmpdir(),'query-adapter-'))
process.env.STOCK_DB_PATH=path.join(root,'db.sqlite')
process.env.STOCK_KR_STATEMENTS_DIR=root
process.env.STOCK_ACCOUNT_MAP_PATH=path.join(root,'map.json')
process.env.STOCK_CRYPTO_ACTIVITY_PATH=path.join(root,'crypto.json')
process.env.STOCK_TOSS_SNAPSHOT_PATH=path.join(root,'toss.json')
writeFileSync(process.env.STOCK_ACCOUNT_MAP_PATH,JSON.stringify({}))
const db=new Database(process.env.STOCK_DB_PATH)
db.exec(`create table source_files(name text,filename text,mtime_ms integer);
create table source_coverage_confirmations(scope text,institution text,account text,kind text,through_date text,source text,sha256 text,empty_holdings integer);
create table holdings(market text,brokerage text,account text,account_type text,as_of_date text,account_wrapper text);
create table transactions(market text,brokerage text,account text,account_type text,date text,source_system text);
create table transactions_all(account text,account_wrapper text,asset_class text,date text);
create table tax_lots(market text,brokerage text,account text,account_type text,as_of_date text);
create table validation_checks(name text,status text,detail text);
create table cash_balances(institution text,account text,kind text,as_of_date text,source text);
create table bank_statement_coverage(institution text,account text,source text,period_start text,period_end text,sha256 text);`)
const today=new Date().toISOString().slice(0,10)
const old='2025-01-01'
const receipt=(start:string,end:string)=>({state:'declared',sources:[{source:'statement.pdf',sha256:'a'.repeat(64),page:1,start,end}]})
writeFileSync(path.join(root,'as-of.json'),JSON.stringify({accounts:{토스증권:today},statementPeriods:{schemaVersion:1,accounts:{'미래에셋증권(종합)':receipt(old,today),'미래에셋증권(금현물)':receipt(old,today),토스증권:receipt(old,old)}}}))
db.prepare('insert into holdings values (?,?,?,?,?,?)').run('KR','토스증권','토스증권','taxable',today,'taxable')
writeFileSync(process.env.STOCK_TOSS_SNAPSHOT_PATH,JSON.stringify({fetchedAt:old+'T12:00:00Z',accounts:[{accountNo:'SAMPLE'}]}))

writeFileSync(process.env.STOCK_CRYPTO_ACTIVITY_PATH,JSON.stringify({documents:[{category:'robinhood_crypto_statement',venue:'Robinhood',account:'Robinhood Crypto',rowCount:0,metrics:{periodStart:old,periodEnd:today}}]}))
db.prepare('insert into cash_balances values (?,?,?,?,?)').run('Example','row-only','deposit',today,`example-${today.replaceAll('-','')}.csv`)
db.prepare('insert into bank_statement_coverage values (?,?,?,?,?,?)').run('Example','empty','empty.pdf',old,today,'a'.repeat(64))
db.prepare('insert into holdings values (?,?,?,?,?,?)').run('US','Chase','Chase A','Cash',today,'taxable')
db.prepare('insert into transactions values (?,?,?,?,?,?)').run('US','Chase','Chase B','Cash',old,'csv')
db.prepare('insert into source_coverage_confirmations values (?,?,?,?,?,?,?,?)').run('investment','Chase','Chase B','transactions',today,'sample.csv','a'.repeat(64),0)
db.close()

test('quiet KR and gold statements remain visible and use declared receipts',async()=>{
 const {getAccountCoverage,getSupplementaryCoverage}=await import('../lib/adapters/portfolio-db')
 const row=getAccountCoverage().rows.find(row=>row.account==='미래에셋증권(종합)')!
 assert.equal(row.coveredThrough,today);assert.equal(row.status,'current')
 assert.equal(getSupplementaryCoverage().rows.find(row=>row.kind==='gold')?.latestDate,today)
})
test('Toss quote dates cannot advance the actual API query date',async()=>{
 const {getAccountCoverage}=await import('../lib/adapters/portfolio-db')
 const row=getAccountCoverage().rows.find(row=>row.brokerage==='토스증권')!
 assert.equal(row.apiCoveredThrough,old);assert.equal(row.coveredThrough,old);assert.equal(row.status,'action_needed')
})
test('Robinhood crypto uses quiet monthly statement coverage rather than the last trade',async()=>{
 const {getAccountCoverage}=await import('../lib/adapters/portfolio-db')
 assert.equal(getAccountCoverage().rows.find(row=>row.account==='Robinhood Crypto')?.coveredThrough,today)
})
test('row-only bank history stays unconfirmed while an empty declared statement is current',async()=>{
 const {getSupplementaryCoverage}=await import('../lib/adapters/portfolio-db')
 const rows=getSupplementaryCoverage().rows
 assert.equal(rows.find(row=>row.label==='Example row-only')?.status,'unconfirmed')
 assert.equal(rows.find(row=>row.label==='Example row-only')?.latestDate,null)
 assert.equal(rows.find(row=>row.label==='Example empty')?.status,'current')
 assert.equal(rows.find(row=>row.label==='Example empty')?.latestDate,today)
})


test('different accounts at one broker cannot lend each other freshness',async()=>{
 const {getAccountCoverage}=await import('../lib/adapters/portfolio-db')
 const rows=getAccountCoverage().rows.filter(row=>row.brokerage==='Chase')
 assert.equal(rows.length,2)
 for(const row of rows){assert.equal(row.coveredThrough,null);assert.notEqual(row.status,'current')}
})
test('future gold receipt ends remain unconfirmed',async()=>{
 const file=path.join(root,'as-of.json');const {readFileSync}=await import('node:fs');const before=readFileSync(file,'utf8')
 try {
  const doc=JSON.parse(before);doc.statementPeriods.accounts['미래에셋증권(금현물)']=receipt(old,'2099-01-01');writeFileSync(file,JSON.stringify(doc))
  const {getSupplementaryCoverage}=await import('../lib/adapters/portfolio-db')
  const gold=getSupplementaryCoverage().rows.find(row=>row.kind==='gold')!
  assert.equal(gold.latestDate,null);assert.equal(gold.status,'unconfirmed')
 }finally{writeFileSync(file,before)}
})
