import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {AccountUpdateAction} from '../components/AccountUpdateAction'

test('current and due-soon accounts never render download instructions',()=>{
 for(const status of ['current','due_soon'] as const){
  const html=renderToStaticMarkup(React.createElement(AccountUpdateAction,{status,language:'ko',confirmation:'confirm existing query'},'DOWNLOAD THIS FILE 2026-01-01 ~ 2026-11-13'))
  assert.match(html,/추가 자료 필요 없음/)
  assert.doesNotMatch(html,/DOWNLOAD|2026-01-01/)
 }
})
test('only required updates render the supplied artifact and query window',()=>{
 for(const status of ['action_needed','missing'] as const){
  const html=renderToStaticMarkup(React.createElement(AccountUpdateAction,{status,language:'ko',confirmation:'confirm existing query'},'PDF 2026-01-01 ~ 2026-11-13'))
  assert.match(html,/PDF 2026-01-01 ~ 2026-11-13/)
 }
 const unconfirmed=renderToStaticMarkup(React.createElement(AccountUpdateAction,{status:'unconfirmed',language:'ko',confirmation:'confirm existing query'},'DOWNLOAD THIS FILE'))
 assert.match(unconfirmed,/confirm existing query/);assert.doesNotMatch(unconfirmed,/DOWNLOAD/)
})

test('Robinhood requests only the stale source and never downloads an MCP snapshot',async()=>{
 const {InvestmentUpdateAction}=await import('../components/AccountUpdateAction')
 const source=(label:string,method:'mcp'|'manual',status:'current'|'action_needed'|'unconfirmed')=>({label,method,status,coveredThrough:'2026-01-01',downloadFrom:method==='mcp'?null:'2025-12-31',lagDays:1,maxLagDays:14,overdueDays:0,requiredArtifact:label+' ARTIFACT',destination:label+'-destination'})
 const sources=[source('MCP','mcp','action_needed'),source('CSV','manual','current')]
 const row:import('../lib/adapters/portfolio-db').AccountCoverage={id:'US|RH|Sample',market:'US',brokerage:'Robinhood',account:'Sample',coveredThrough:'2026-01-01',downloadFrom:null,lagDays:1,apiCoveredThrough:null,apiLagDays:null,statementCoveredThrough:null,statementLagDays:null,maxLagDays:14,overdueDays:0,status:'action_needed',method:'mcp',requiredArtifact:'MCP AND CSV',format:'JSON + CSV',destination:'both',lastFile:null,action:'old combined request',detail:'',sources,missingDisposals:[]}
 let html=renderToStaticMarkup(React.createElement(InvestmentUpdateAction,{row,language:'en'}))
 assert.match(html,/Regenerate MCP ARTIFACT/);assert.doesNotMatch(html,/CSV ARTIFACT|Full available history|2025-12-31/)
 sources[0].status='current';sources[1].status='action_needed'
 html=renderToStaticMarkup(React.createElement(InvestmentUpdateAction,{row,language:'en'}))
 assert.match(html,/CSV ARTIFACT/);assert.match(html,/2025-12-31/);assert.doesNotMatch(html,/MCP ARTIFACT|old combined request/)
 sources[0].status='action_needed';sources[1].status='unconfirmed';row.status='unconfirmed'
 html=renderToStaticMarkup(React.createElement(InvestmentUpdateAction,{row,language:'en'}))
 assert.match(html,/Regenerate MCP ARTIFACT/);assert.match(html,/Confirm the query end date/);assert.doesNotMatch(html,/2025-12-31/)
})

test('needed supplementary history actions include both query endpoints',async()=>{
 const {getPageCopy}=await import('../lib/ui-copy')
 for(const language of ['ko','en'] as const){
  const copy=getPageCopy('accountUpdates',language)
  for(const kind of ['deposit','cma','gold']){
   const action=copy.action(kind,'2026-01-01','old incomplete action','2026-11-13')
   assert.match(action,/2026-01-01/);assert.match(action,/2026-11-13/)
   assert.match(copy.action(kind,null,'old incomplete action','2026-11-13'),/2026-11-13/)
  }
 }
})
