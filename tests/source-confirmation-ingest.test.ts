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
