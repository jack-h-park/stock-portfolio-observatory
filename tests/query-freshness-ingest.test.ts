import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import {writeScenario} from './pension-fixtures'
import {runIngestWithOutput} from './ingest-harness'

test('Samsung freshness uses declared quiet-period receipts rather than legacy activity pins',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'samsung-query-'))
 const env=writeScenario(root,{withPensions:false})
 const dir=path.join(root,'kr-statements');mkdirSync(dir,{recursive:true})
 const today=new Date().toISOString().slice(0,10)
 for(const [state,want] of [['declared','pass'],['conflicting','fail']] as const){
  writeFileSync(path.join(dir,'as-of.json'),JSON.stringify({accounts:{'삼성증권(주식보상)':'2025-01-01'},statementPeriods:{schemaVersion:1,accounts:{'삼성증권(주식보상)':{state,sources:[{source:'samsung.pdf',sha256:'a'.repeat(64),page:1,start:'2025-01-01',end:today}]}}}}))
  const out=runIngestWithOutput(root,{env:{...env,STOCK_KR_STATEMENTS_DIR:dir},allowFailure:true})
  const db=new Database(out.dbPath)
  const row=db.prepare("select status,detail from validation_checks where name='samsung_statement_fresh'").get() as {status:string;detail:string}
  assert.equal(row.status,want,row.detail)
  if(state==='declared') assert.match(row.detail,new RegExp(today))
  db.close()
 }
})
