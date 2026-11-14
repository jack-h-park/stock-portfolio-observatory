import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import {writeScenario} from './pension-fixtures'
import {runIngestWithOutput} from './ingest-harness'

test('ingest records confirmed empty holdings and a CMA observation but rejects an unconsumed history',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'confirmed-ingest-'))
 const env=writeScenario(dir,{withPensions:false})
 const header='Account number,Account name,Symbol,Current value\n'
 const empty=header+'\nDate downloaded Jan-13-2026\n'
 const cash=header+'X00012345,Sample CMA,SPAXX**,$123.45\nDate downloaded Jan-13-2026\n'
 const specs=[
  {scope:'investment',institution:'Fidelity',account:'Sample Fidelity',kind:'holdings',source:'us-holdings/fidelity-holdings-20260113.csv',emptyHoldings:true,body:empty},
  {scope:'bank',institution:'fidelity',account:'Sample CMA',kind:'holdings',source:'bank-statements/fidelity-positions-cma-20260113.csv',body:cash},
  {scope:'investment',institution:'Fidelity',account:'Sample Fidelity',kind:'transactions',source:'us-transactions/ignored.csv',body:'Run Date,Action\n01/03/2026,Transfer\n'},
 ]
 const sourceConfirmations=specs.map(({body,...receipt})=>{
  const file=path.join(dir,receipt.source);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,body)
  return {...receipt,through:'2026-01-13',confirmedAt:'2026-01-13',basis:'owner-confirmed',sha256:createHash('sha256').update(body).digest('hex')}
 })
 const mapPath=path.join(dir,'accounts.local.json')
 writeFileSync(mapPath,JSON.stringify({bankAccounts:[{institution:'fidelity',kind:'cma',alias:'Sample CMA',accountId:'X00012345'}],sourceConfirmations}))
 const result=runIngestWithOutput(dir,{env:{...env,STOCK_ACCOUNT_MAP_PATH:mapPath},allowFailure:true})
 const db=new Database(result.dbPath)
 assert.equal((db.prepare('select count(*) as n from source_coverage_confirmations').get() as {n:number}).n,2,JSON.stringify(db.prepare("select * from validation_checks where name='source_confirmations_valid'").get()))
 assert.equal((db.prepare("select balance from cash_balances where institution='fidelity'").get() as {balance:number}).balance,123.45)
 assert.equal((db.prepare("select count(*) as n from bank_inflows").get() as {n:number}).n,0)
 const check=db.prepare("select status,detail from validation_checks where name='source_confirmations_valid'").get() as {status:string;detail:string}
 assert.equal(check.status,'fail');assert.match(check.detail,/not selected for ingestion/)
 db.close()
 // A later investment snapshot supersedes the older empty receipt without requiring manual metadata cleanup.
 writeFileSync(path.join(dir,'us-holdings/fidelity-holdings-20260114.csv'),header+'Y00067890,Sample Investment,AAPL,$20.00\nDate downloaded Jan-14-2026\n')
 const second=runIngestWithOutput(dir,{env:{...env,STOCK_ACCOUNT_MAP_PATH:mapPath},allowFailure:true})
 const newer=new Database(second.dbPath)
 assert.equal((newer.prepare("select count(*) as n from source_coverage_confirmations where empty_holdings=1").get() as {n:number}).n,0)
 newer.close()
})


test('Merrill confirmed query coverage requires the consumed CSV and its exact account',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'merrill-confirmed-'))
 const env=writeScenario(dir,{withPensions:false})
 const source='us-transactions/merrill-transactions-20260101-20260104.csv'
 const body='"Exported on: 01/13/2026 01:50 PM ET"\n"Selected account(s): CMA-Edge SAMPLE"\n"Settlement date","Description","Type","Symbol/ CUSIP","Quantity","Price","Amount"\n"01/04/2026","Dividend ACME","Dividend","ACME","0","0","1.00"\n'
 mkdirSync(path.join(dir,'us-transactions'),{recursive:true});writeFileSync(path.join(dir,source),body)
 const receipt={scope:'investment',institution:'Merrill',account:'Merrill CMA-Edge SAMPLE',kind:'transactions',source,sha256:createHash('sha256').update(body).digest('hex'),basis:'owner-confirmed',through:'2026-01-13',confirmedAt:'2026-01-13'}
 const mapPath=path.join(dir,'accounts.local.json')
 for(const [account,want] of [[receipt.account,1],['Merrill Other',0]] as const){
  writeFileSync(mapPath,JSON.stringify({sourceConfirmations:[{...receipt,account}]}))
  const result=runIngestWithOutput(dir,{env:{...env,STOCK_ACCOUNT_MAP_PATH:mapPath},allowFailure:true})
  const db=new Database(result.dbPath)
  assert.equal((db.prepare('select count(*) as n from source_coverage_confirmations').get() as {n:number}).n,want)
  if(want) assert.equal((db.prepare('select through_date from source_coverage_confirmations').get() as {through_date:string}).through_date,'2026-01-13')
  else assert.match((db.prepare("select detail from validation_checks where name='source_confirmations_valid'").get() as {detail:string}).detail,/account/)
  db.close()
 }
})

test('explicit empty query confirmations work without fabricated bank or investment activity',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'empty-query-'))
 const env=writeScenario(dir,{withPensions:false})
 const bankPath=path.join(dir,'bank.json');writeFileSync(bankPath,JSON.stringify({accounts:[],findings:[],coverage:[]}))
 const specs=[{scope:'investment',institution:'Chase',account:'Chase SAMPLE',source:'us-transactions/chase-transactions-20260101-20260113.csv',body:'Trade Date,Account Name,Account Number,Settlement Date,Cusip\n'},
 {scope:'bank',institution:'amex',account:'Sample savings',source:'bank-statements/amex-savings-1234-20260101-20260113.csv',body:''}]
 const receipts=specs.map(({body,...entry})=>{mkdirSync(path.dirname(path.join(dir,entry.source)),{recursive:true});writeFileSync(path.join(dir,entry.source),body);return {...entry,kind:'transactions',basis:'owner-confirmed',through:'2026-01-13',confirmedAt:'2026-01-13',sha256:createHash('sha256').update(body).digest('hex'),emptyTransactions:true}})
 const mapPath=path.join(dir,'map.json');writeFileSync(mapPath,JSON.stringify({bankAccounts:[{institution:'amex',kind:'savings',alias:'Sample savings',last4:'1234'}],sourceConfirmations:receipts}))
 const result=runIngestWithOutput(dir,{env:{...env,STOCK_ACCOUNT_MAP_PATH:mapPath,STOCK_BANK_BALANCES_PATH:bankPath},allowFailure:true})
 const db=new Database(result.dbPath)
 assert.equal((db.prepare('select count(*) as n from source_coverage_confirmations').get() as {n:number}).n,2,JSON.stringify(db.prepare("select * from validation_checks where name='source_confirmations_valid'").get()))
 assert.equal((db.prepare("select count(*) as n from transactions where market='US'").get() as {n:number}).n,0)
 assert.equal((db.prepare("select count(*) as n from cash_balances").get() as {n:number}).n,0)
 db.close()
 // Blank Chase data has no broker header; a bank source cannot borrow another account's identity.
 writeFileSync(path.join(dir,receipts[0].source),'')
 receipts[0].sha256=createHash('sha256').update('').digest('hex')
 writeFileSync(mapPath,JSON.stringify({bankAccounts:[{institution:'amex',kind:'savings',alias:'Sample savings',last4:'9999'}],sourceConfirmations:receipts}))
 const rejected=runIngestWithOutput(dir,{env:{...env,STOCK_ACCOUNT_MAP_PATH:mapPath,STOCK_BANK_BALANCES_PATH:bankPath},allowFailure:true})
 const bad=new Database(rejected.dbPath)
 assert.equal((bad.prepare('select count(*) as n from source_coverage_confirmations').get() as {n:number}).n,0)
 bad.close()
})

test('declared bank coverage is bound to source bytes and advances no balances',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'declared-bank-ingest-'))
 const env=writeScenario(dir,{withPensions:false})
 mkdirSync(path.join(dir,'bank-statements'),{recursive:true})
 const body='statement content';writeFileSync(path.join(dir,'bank-statements','sample.csv'),body)
 const sha256=createHash('sha256').update(body).digest('hex')
 const bankPath=path.join(dir,'bank.json')
 for(const [hash,count] of [[sha256,1],['0'.repeat(64),0]] as const){
 writeFileSync(bankPath,JSON.stringify({accounts:[],coverage:[{institution:'Sample bank',account:'Empty',source:'sample.csv',basis:'declared-period',periodStart:'2026-01-01',periodEnd:'2026-01-13',sha256:hash}]}))
 const result=runIngestWithOutput(dir,{env:{...env,STOCK_BANK_BALANCES_PATH:bankPath},allowFailure:true})
 const db=new Database(result.dbPath)
 assert.equal((db.prepare('select count(*) as n from bank_statement_coverage').get() as {n:number}).n,count,JSON.stringify(db.prepare("select detail from validation_checks where name='bank_statement_coverage_valid'").get()))
 assert.equal((db.prepare('select count(*) as n from cash_balances').get() as {n:number}).n,0)
 assert.equal((db.prepare("select status from validation_checks where name='bank_statement_coverage_valid'").get() as {status:string}).status,count?'pass':'fail')
 db.close()
 }
})
