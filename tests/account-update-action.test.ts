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
 // The page renders each source's artifact code, not its requiredArtifact string.
 const source=(label:string,method:'mcp'|'manual',status:'current'|'action_needed'|'unconfirmed')=>({label,method,status,coveredThrough:'2026-01-01',downloadFrom:method==='mcp'?null:'2025-12-31',lagDays:1,maxLagDays:14,overdueDays:0,requiredArtifact:label+' ARTIFACT',artifact:{code:method==='mcp'?'ROBINHOOD_MCP_SNAPSHOT':'ROBINHOOD_TRANSACTIONS_CSV'} as const,destination:label+'-destination'})
 const sources=[source('MCP','mcp','action_needed'),source('CSV','manual','current')]
 const row:import('../lib/adapters/portfolio-db').AccountCoverage={id:'US|RH|Sample',market:'US',brokerage:'Robinhood',account:'Sample',coveredThrough:'2026-01-01',downloadFrom:null,lagDays:1,apiCoveredThrough:null,apiLagDays:null,statementCoveredThrough:null,statementLagDays:null,maxLagDays:14,overdueDays:0,status:'action_needed',method:'mcp',requiredArtifact:'MCP AND CSV',format:'JSON + CSV',destination:'both',lastFile:null,artifacts:[{code:'ROBINHOOD_MCP_SNAPSHOT'},{code:'ROBINHOOD_TRANSACTIONS_CSV'}],action:{code:'ROBINHOOD_SNAPSHOT_AND_CSV'},detail:{code:'ROBINHOOD_OLDER_OF_TWO'},sources,missingDisposals:[]}
 let html=renderToStaticMarkup(React.createElement(InvestmentUpdateAction,{row,language:'en'}))
 assert.match(html,/Regenerate Robinhood MCP snapshot/);assert.doesNotMatch(html,/transactions CSV|Full available history|2025-12-31/)
 sources[0].status='current';sources[1].status='action_needed'
 html=renderToStaticMarkup(React.createElement(InvestmentUpdateAction,{row,language:'en'}))
 assert.match(html,/Robinhood transactions CSV/);assert.match(html,/2025-12-31/);assert.doesNotMatch(html,/MCP snapshot|Regenerate the snapshot/)
 sources[0].status='action_needed';sources[1].status='unconfirmed';row.status='unconfirmed'
 html=renderToStaticMarkup(React.createElement(InvestmentUpdateAction,{row,language:'en'}))
 assert.match(html,/Regenerate Robinhood MCP snapshot/);assert.match(html,/Confirm the query end date/);assert.doesNotMatch(html,/2025-12-31/)
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

test('the unconfirmed supplementary action reads from copy for each kind that can be unconfirmed', async () => {
  const {accountUpdates} = await import('../lib/ui-copy/pages/accountUpdates')
  const label = 'Sample Bank ••1234'
  // The Korean wording is the sentence the adapter writes for the reminder.
  assert.equal(accountUpdates.ko.unconfirmedAction('deposit', label), `${label} 기존 자료의 조회 종료일을 확인해주세요. 마지막 거래일로 다운로드 필요 여부를 판단하지 않습니다.`)
  assert.equal(accountUpdates.ko.unconfirmedAction('cma', label), `${label} 기존 자료의 조회 종료일을 확인해주세요. 마지막 거래일로 다운로드 필요 여부를 판단하지 않습니다.`)
  assert.equal(accountUpdates.ko.unconfirmedAction('gold', label), `${label} 기존 증명서의 조회 종료일을 확인해주세요`)
  for (const kind of ['deposit', 'cma', 'gold']) {
    const en = accountUpdates.en.unconfirmedAction(kind, label)
    assert.ok(en && en.includes(label), kind)
    assert.doesNotMatch(en!, /[가-힯]/, kind)
  }
  assert.match(accountUpdates.en.unconfirmedAction('gold', label)!, /certificate/)
  // Pension and gold price rows never reach unconfirmed; they keep the adapter sentence.
  for (const kind of ['pension', 'gold_price']) {
    assert.equal(accountUpdates.en.unconfirmedAction(kind, label), null)
    assert.equal(accountUpdates.ko.unconfirmedAction(kind, label), null)
  }
})

test('the supplementary table prints the unconfirmed action in the page language with the account masked', async () => {
  ;(globalThis as {React?: typeof React}).React = React
  const {SupplementaryCoverageTable} = await import('../components/SupplementaryCoverageTable')
  const row: import('../lib/adapters/portfolio-db').SupplementaryCoverageRow = {
    kind: 'deposit', label: 'Sample Bank AB-12345678', status: 'unconfirmed', freshnessStatus: 'unconfirmed',
    action: 'Sample Bank AB-12345678 기존 자료의 조회 종료일을 확인해주세요. 마지막 거래일로 다운로드 필요 여부를 판단하지 않습니다.',
    latestDate: null, lagDays: null, maxLagDays: 30,
  }
  const en = renderToStaticMarkup(React.createElement(SupplementaryCoverageTable, {rows: [row], language: 'en'}))
  assert.match(en, /Confirm the query end date of the existing file for Sample Bank …5678/)
  assert.doesNotMatch(en, /기존 자료|12345678/)
  const ko = renderToStaticMarkup(React.createElement(SupplementaryCoverageTable, {rows: [row], language: 'ko'}))
  assert.match(ko, /Sample Bank …5678 기존 자료의 조회 종료일을 확인해주세요/)
})
