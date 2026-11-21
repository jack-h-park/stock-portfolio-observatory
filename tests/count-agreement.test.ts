import { strict as assert } from 'node:assert'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Card } from '@/components/card'
import {
  POSITION_BREAK_CAP,
  dataOpsLinkedIssues,
  fmtCount,
  mappingSuggestionRows,
  overviewLinkedStatus,
  positionBreaksCapped,
  queueRowCapped,
  reconciliationLinkedIssues,
} from '@/lib/header-status'
import { tickerWindowTruncated } from '@/lib/table-filter'
import * as tone from '@/lib/tone'
import { POSITION_BREAK_SEVERITY, countTone, severityTone } from '@/lib/tone'
import { getPageCopy, getUiCopy } from '@/lib/ui-copy'

;(globalThis as { React?: typeof React }).React = React

/**
 * One count or severity must read the same on every page that shows it. Each
 * test below pins one agreement that used to differ between two pages, or
 * between a figure and the card it summarises.
 */

function text(node: React.ReactNode): string {
  return renderToStaticMarkup(React.createElement(React.Fragment, null, node)).replace(/<[^>]*>/g, '')
}

// 1. A position break is one severity everywhere: red on /reconciliation's
// pill and card, and red on the /data-ops tile that counts the same breaks.
test('position breaks read one severity on /reconciliation and on the /data-ops tile', () => {
  const pair = reconciliationLinkedIssues(getPageCopy('reconciliation', 'en'), 3, 'en')
  assert.equal(pair.issues.severity, POSITION_BREAK_SEVERITY.some)
  assert.equal(pair.status?.severity, POSITION_BREAK_SEVERITY.some)
  assert.equal(countTone(POSITION_BREAK_SEVERITY, 3), severityTone(pair.issues.severity))
  const page = readFileSync('app/data-ops/page.tsx', 'utf8')
  assert.ok(page.includes('tone={countTone(POSITION_BREAK_SEVERITY, tiles.breaks)}'), 'the /data-ops breaks tile reads POSITION_BREAK_SEVERITY')
})

// 3. The mapping tile counts income rows (as the queue row does), so the card
// that lists the suggestions badges the same income rows, not its row count.
test('the mapping suggestions card badges income rows, as the mapping tile counts them', () => {
  assert.equal(mappingSuggestionRows([{ row_count: 4 }, { row_count: 7 }, { row_count: null }]), 11)
  const page = readFileSync('app/data-ops/page.tsx', 'utf8')
  const card = page.slice(page.indexOf('<Card id="data-ops-manual-mappings"'))
  assert.ok(
    card.slice(0, card.indexOf('>')).includes('issues={{ count: mappingSuggestionRows(ops.mappingSuggestions) }}'),
    'the suggestions card badge counts income rows',
  )
})

// 4. The adapter stops the break list at POSITION_BREAK_CAP rows, so a full
// list is a lower bound and every place that shows it reads "100+".
test('the position-break cap matches the adapter query', () => {
  const adapter = readFileSync('lib/adapters/portfolio-db.ts', 'utf8')
  const start = adapter.indexOf('function readPositionBreaks(')
  const body = adapter.slice(start, adapter.indexOf('\nfunction ', start + 1))
  assert.match(body, new RegExp(`limit ${POSITION_BREAK_CAP}\\b`))
})

for (const language of ['en', 'ko'] as const) {
  test(`a capped position-break count reads ${POSITION_BREAK_CAP}+ in the pill, the card badge and the hero (${language})`, () => {
    const atLeast = getUiCopy(language).common.countAtLeast(String(POSITION_BREAK_CAP))
    assert.equal(atLeast, `${POSITION_BREAK_CAP}+`)
    assert.equal(positionBreaksCapped(POSITION_BREAK_CAP - 1), false)
    assert.equal(positionBreaksCapped(POSITION_BREAK_CAP), true)

    const capped = reconciliationLinkedIssues(getPageCopy('reconciliation', language), POSITION_BREAK_CAP, language)
    assert.deepEqual(capped.issues, { count: POSITION_BREAK_CAP, severity: 'problem', capped: true })
    assert.ok(text(capped.status?.label).includes(atLeast), 'the pill says 100+')
    assert.equal(fmtCount(capped.issues.count, capped.issues.capped, language), atLeast)

    const badge = text(React.createElement(Card, { title: 'Breaks', issues: capped.issues, children: null }))
    assert.ok(badge.includes(atLeast), `the card badge says ${atLeast}: ${badge}`)

    const exact = reconciliationLinkedIssues(getPageCopy('reconciliation', language), POSITION_BREAK_CAP - 1, language)
    assert.equal('capped' in exact.issues, false)
    assert.ok(!text(exact.status?.label).includes('+'), 'an uncapped count stays exact')
  })

  test(`a capped break row makes the /data-ops queue sum a lower bound (${language})`, () => {
    const queue = [
      { kind: 'validation' as const, count: 2 },
      { kind: 'position_breaks' as const, count: POSITION_BREAK_CAP },
    ]
    assert.equal(queueRowCapped(queue[0]), false)
    assert.equal(queueRowCapped(queue[1]), true)
    assert.equal(queueRowCapped({ kind: 'manual_mappings', count: POSITION_BREAK_CAP }), false)
    const pair = dataOpsLinkedIssues(getPageCopy('dataOps', language), queue, language)
    assert.equal(pair.issues.capped, true)
    assert.ok(text(pair.status?.label).includes(`${POSITION_BREAK_CAP + 2}+`))
    const exact = dataOpsLinkedIssues(getPageCopy('dataOps', language), [{ kind: 'position_breaks', count: 3 }], language)
    assert.equal('capped' in exact.issues, false)
  })
}

test('/reconciliation and /data-ops show break counts through fmtCount, which knows the cap', () => {
  const reconciliation = readFileSync('app/reconciliation/page.tsx', 'utf8')
  assert.ok(reconciliation.includes('value={fmtCount(breaks.issues.count, breaks.issues.capped, language)}'))
  const dataOps = readFileSync('app/data-ops/page.tsx', 'utf8')
  assert.ok(dataOps.includes('value={fmtCount(issueCount, priorityWork.issues.capped, language)}'))
  assert.ok(dataOps.includes('fmtCount(r.count, queueRowCapped(r), language)'))
  const health = readFileSync('app/health/page.tsx', 'utf8')
  assert.ok(!/const POSITION_BREAK_CAP\b/.test(health), '/health reads the shared cap')
})

// 5. A ticker link filters a window of the newest rows; when that window is
// full the page says older rows for the ticker are not listed.
test('a ticker link over a full window of recent transactions says it only searched that window', () => {
  assert.equal(tickerWindowTruncated(200, 200, 'AAA'), true)
  assert.equal(tickerWindowTruncated(150, 200, 'AAA'), false)
  assert.equal(tickerWindowTruncated(200, 200, undefined), false)
  const page = readFileSync('app/transactions/page.tsx', 'utf8')
  assert.ok(page.includes('getRecentTransactions(RECENT_TRANSACTION_LIMIT)'), 'the page reads the limit it reports')
  assert.ok(page.includes('tickerWindowTruncated(rows.length, RECENT_TRANSACTION_LIMIT, ticker)'))
  for (const language of ['en', 'ko'] as const) {
    assert.ok(getPageCopy('transactions', language).tickerWindow('200').includes('200'))
  }
})

// 6. The three status-to-tone maps that lived in their pages are named maps in
// lib/tone.ts, and no file defines its own copy.
test('scenario, execution and proposal-status tones live in lib/tone.ts only', () => {
  for (const name of ['SCENARIO_TONE', 'EXECUTION_TONE', 'PROPOSAL_STATUS_TONE'] as const) {
    assert.ok(name in tone, `${name} is exported from lib/tone.ts`)
  }
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry)) files.push(full)
    }
  }
  for (const dir of ['app', 'components', 'lib']) walk(dir)
  for (const file of files) {
    if (file === path.join('lib', 'tone.ts')) continue
    const source = readFileSync(file, 'utf8')
    assert.ok(!/(const|let)\s+(SCENARIO|EXECUTION|PROPOSAL_STATUS)_TONE\b/.test(source), `${file} defines its own tone map`)
  }
})

// The Overview pill and the /data-ops pill name the same queue; they show the
// same count, label and severity, and the Overview's links to that queue.
test('the Overview pill reads the /data-ops work queue', () => {
  const queue = [
    { kind: 'validation' as const, count: 2 },
    { kind: 'position_breaks' as const, count: POSITION_BREAK_CAP },
  ]
  const copy = getPageCopy('dataOps', 'en')
  const ops = dataOpsLinkedIssues(copy, queue, 'en').status!
  const overview = overviewLinkedStatus(copy, queue, 'en', 'Healthy')
  assert.equal(text(overview.label), text(ops.label))
  assert.equal(overview.severity, ops.severity)
  assert.equal(overview.href, '/data-ops#data-ops-priority-work')
  assert.deepEqual(overviewLinkedStatus(copy, [{ kind: 'validation', count: 0 }], 'en', 'Healthy'), { severity: 'ok', label: 'Healthy' })
})
