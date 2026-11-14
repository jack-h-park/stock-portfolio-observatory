import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildAccountInventoryReview } from '../lib/application/account-inventory'
import { AccountInventoryReview } from '../components/AccountInventoryReview'
// Match the existing standalone JSX render harness for shared UI components.
;(globalThis as { React?: typeof React }).React = React
const clock='2026-01-20T23:00:00Z'
const review=(issues:string[]=[])=>buildAccountInventoryReview({mapRead:{state:'available',value:{bankAccounts:[{institution:'chase',alias:'Example 123456789',owner:'self'}]}},facts:[{provider:'chase',account:'Example 123456789',kind:'activity',date:'2026-01-20',refs:['example.csv'],basis:'declared_period',state:'present'}],readIssues:issues},clock)

test('English and Korean show inventory uncertainty separately from source cutoffs and readonly detail links',()=>{
 for(const language of ['en','ko'] as const){
  const html=renderToStaticMarkup(React.createElement(AccountInventoryReview,{review:review(),language}))
  assert.match(html,language==='en'?/Account inventory review/:/계좌 목록 검토/)
  assert.match(html,language==='en'?/Not confirmed/:/미확인/)
  assert.match(html,/2026-01-20/);assert.match(html,/href="\/data-map"/);assert.match(html,/href="\/data-ops#account-coverage"/)
  assert.doesNotMatch(html,/123456789|<form|<input|<script|%|all accounts are current/i)
 }
})
test('read failures and unavailable maps cannot display a green zero or conceal empty inputs',()=>{
 const r=review(['database_unavailable'])
 const html=renderToStaticMarkup(React.createElement(AccountInventoryReview,{review:r,language:'en'}))
 assert.match(html,/Read incomplete/);assert.match(html,/Not confirmed/)
 const empty=buildAccountInventoryReview({mapRead:{state:'missing'},facts:[],readIssues:[]},clock)
 const missing=renderToStaticMarkup(React.createElement(AccountInventoryReview,{review:empty,language:'en'}))
 assert.match(missing,/Unavailable/);assert.match(missing,/No account rows available/);assert.doesNotMatch(missing,/Confirmed accounts[^<]*0/)
})

test('a genuinely reviewed empty scope is distinguished from unreadable or unreviewed zero',async()=>{
 const {inventoryDigest,validateInventoryMap}=await import('../lib/domain/assets/account-inventory')
 const map:any={};const scope:any={owners:['self'],providers:'all',wrappers:'all',assetClasses:'all',exclusions:[]}
 map.inventoryReview={schemaVersion:1,receipts:[{reviewId:'empty-review',reviewedAt:clock,asOfDate:clock.slice(0,10),reviewerId:'owner',basis:'owner-attested',scope,includedAccountIds:[],digestVersion:1,inventoryDigest:inventoryDigest(validateInventoryMap({state:'available',value:map}),scope)}]}
 const r=buildAccountInventoryReview({mapRead:{state:'available',value:map},facts:[],readIssues:[]},clock)
 const html=renderToStaticMarkup(React.createElement(AccountInventoryReview,{review:r,language:'en'}))
 assert.match(html,/Reviewed empty scope/);assert.doesNotMatch(html,/does not establish an empty inventory/)
})

test('legacy pension declarations are explained without owner confirmation or collection requests',()=>{
 const r=buildAccountInventoryReview({mapRead:{state:'available',value:{pensionAccounts:[{institution:'mirae',account:'Closed example',retiredOn:'2025-12-31',owner:'other'},{institution:'mirae',account:'Unloaded example',owner:'other'}]}},facts:[],readIssues:[]},clock)
 for(const language of ['en','ko'] as const){
  const html=renderToStaticMarkup(React.createElement(AccountInventoryReview,{review:r,language}))
  assert.match(html,language==='en'?/Legacy retirement declared/:/기존 폐쇄 선언/)
  assert.match(html,language==='en'?/Not loaded by existing policy/:/기존 정책상 미적재/)
  assert.match(html,language==='en'?/No new source request/:/새 자료 요청 없음/)
  assert.match(html,language==='en'?/Owner not confirmed/:/소유자 미확인/)
  assert.doesNotMatch(html,/zero balance|잔액 0|<form|<input/)
 }
})
