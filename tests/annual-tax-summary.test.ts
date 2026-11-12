import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import example from '../examples/tax-history.synthetic.json'
import { validateTaxHistory } from '../lib/domain/taxes/history'
import { getAnnualTaxSummary } from '../lib/application/annual-tax-summary'
import { AnnualTaxSummary } from '../components/AnnualTaxSummary'

const fixture = () => validateTaxHistory(structuredClone(example))
const row = (s = fixture(), id = 'us-2025') => getAnnualTaxSummary(s).years.flatMap(year => year.rows).find(item => item.id === id)!

test('year summaries retain exact unit/authority/currency scope and allocated shares', () => {
  const s = fixture(), before = JSON.stringify(s), summary = getAnnualTaxSummary(s), us = row(s)
  assert.deepEqual(summary.years.map(year => year.year), [2025, 2024])
  assert.equal(us.liabilityMinor, '11000')
  assert.equal(us.payments?.principal, '8000')
  assert.equal(us.withholding?.principal, '3000')
  assert.equal(us.refunds?.principal, '1000')
  assert.equal(us.reversals?.principal, '500')
  assert.equal(us.interestMinor, '100')
  assert.equal(us.penaltyMinor, '50')
  assert.equal(us.outstandingMinor, '1500')
  assert.equal(row(s, 'us-2024').payments?.principal, '2000')
  assert.equal(row(s, 'kr-2025').payments, null)
  assert.equal(row(s, 'kr-2025').currency, 'KRW')
  assert.equal(JSON.stringify(s), before)
})

test('missing amounts stay unknown and settlement coverage cannot make a liability disappear', () => {
  const s = fixture();s.obligations[0].coverageConfirmed = false
  const result = row(s)
  assert.equal(result.liabilityMinor, '11000')
  assert.equal(result.outstandingMinor, null)
  assert.equal(row(s, 'kr-2025').liabilityMinor, null)
  assert.equal(row(s, 'kr-2025').refunds, null)
})

test('stale, submitted and missing-evidence bases are unavailable, never a sum of return versions', () => {
  for (const kind of ['stale', 'submitted', 'evidence'] as const) {
    const s = fixture()
    if(kind === 'stale') s.obligations[0].effectiveBasis!.recordRevision = 99
    if(kind === 'submitted') s.obligations[0].effectiveBasis = {...s.obligations[0].effectiveBasis!,kind:'return',id:'return-amended'}
    if(kind === 'evidence') s.evidence.forEach(e => e.deleted = true)
    assert.equal(row(s).liabilityMinor, null)
    assert.equal(row(s).outstandingMinor, null)
  }
})

test('unreviewed and missing-evidence allocations stay outside recorded amounts', () => {
  const s = fixture();s.events.find(e=>e.id==='payment')!.review='unreviewed'
  s.allocations.find(a=>a.id==='alloc-r')!.evidenceIds=[]
  const r=row(s)
  assert.equal(r.payments,null);assert.equal(r.refunds,null)
  assert.equal(r.excludedAllocations,2)
  assert.equal(r.interestMinor,'0')
  assert.equal(r.outstandingMinor,null)
})

test('dated unknowns and unallocated money are explicit; large values never use floating point', () => {
  const s = fixture();const event=s.events.find(e=>e.id==='payment')!
  event.date=null;event.principal='900719925474099312345'
  s.allocations.find(a=>a.id==='alloc-p25')!.principal='900719925474099300000'
  assert.equal(row(s).payments?.principal,'900719925474099300000')
  assert.equal(row(s).undatedAllocations,1)
  assert.equal(getAnnualTaxSummary(s).unallocatedEventCount,1)
})

test('deleted settlement rows cannot change current summaries; recorded zero principal remains zero', () => {
  const s=fixture();s.allocations.find(a=>a.id==='alloc-p25')!.deleted=true
  assert.equal(row(s).payments,null)
  s.allocations.find(a=>a.id==='alloc-p25')!.deleted=false
  s.allocations.find(a=>a.id==='alloc-p25')!.principal='0'
  assert.equal(row(s).payments?.principal,'0')
  assert.equal(row(s).interestMinor,'100')
})

test('bilingual renderer provides year-scoped links, uncertainty and no write controls', () => {
  for(const language of ['en','ko'] as const) {
    const html=renderToStaticMarkup(React.createElement(AnnualTaxSummary,{summary:getAnnualTaxSummary(fixture()),language}))
    assert.match(html,/USD 110\.00/);assert.match(html,/USD 80\.00/);assert.match(html,/USD 10\.00/)
    assert.match(html,/2025/);assert.match(html,/2024/)
    assert.match(html,/\/taxes\/records\/us-2025/)
    assert.match(html,/unit=self-2025&amp;year=2025/)
    assert.match(html,language==='en'?/requested refunds/:/환급 신청/)
    assert.doesNotMatch(html,/<form|<button|<input/)
  }
})

test('empty and failed read states differ and do not render zero liabilities', () => {
  const s=fixture();s.obligations=[];s.events=[];s.allocations=[]
  const empty=renderToStaticMarkup(React.createElement(AnnualTaxSummary,{summary:getAnnualTaxSummary(s),language:'en'}))
  const unavailable=renderToStaticMarkup(React.createElement(AnnualTaxSummary,{summary:null,language:'en'}))
  assert.match(empty,/No tax-history/);assert.match(unavailable,/could not be read/)
  assert.doesNotMatch(unavailable,/USD 0|KRW 0/)
})

test('events-only history keeps unallocated amounts visible without inventing an obligation year', () => {
  const s=fixture();s.obligations=[];s.allocations=[];s.returns=[];s.assessments=[]
  const result=getAnnualTaxSummary(s)
  assert.equal(result.years.length,0);assert.equal(result.unallocatedEventCount,4)
  for(const language of ['en','ko'] as const){
    const html=renderToStaticMarkup(React.createElement(AnnualTaxSummary,{summary:result,language}))
    assert.match(html,/\/taxes\/history\?unit=__all__/)
    assert.match(html,language==='en'?/4 event/:/4건/)
  }
})

test('noncash credits remain distinct from payments and incomplete adjustment evidence remains unknown', () => {
  const s=fixture();s.adjustments.push({id:'credit',recordRevision:1,obligationId:'us-2025',amount:{currency:'USD',minor:'200'},effectiveDate:'2026-01-01',evidenceIds:['doc-1']})
  assert.equal(row(s).adjustmentMinor,'200');assert.equal(row(s).outstandingMinor,'1300')
  assert.equal(row(s).payments?.principal,'8000')
  s.adjustments[0].evidenceIds=[]
  assert.equal(row(s).adjustmentMinor,null);assert.equal(row(s).excludedAdjustments,1)
  assert.equal(row(s).outstandingMinor,null)
})
