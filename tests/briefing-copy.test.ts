import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { getPageCopy } from '@/lib/ui-copy'
import type { BriefingActivity, BriefingSessionMove } from '@/lib/adapters/briefing-archive'

const en = getPageCopy('dailyBriefing', 'en')
const ko = getPageCopy('dailyBriefing', 'ko')

const fmt = (n: number) => String(n)
const act = (a: Partial<BriefingActivity>): BriefingActivity =>
  ({ ticker: 'X', kind: 'bought', quantityChange: 1, quantity: 1, cost: 0, ...a }) as BriefingActivity
const move = (m: Partial<BriefingSessionMove>): BriefingSessionMove =>
  ({
    ticker: 'X', pctChange: 0, valueChange: 0, priceFrom: 1, priceTo: 1, quantity: 1, marketValue: 1, ...m,
  }) as BriefingSessionMove

// CRWD sat at 1 share for weeks after a 4-for-1 split. When the sheet caught up
// the briefing said "Bought 3 shares" — a claim about Jack's own behaviour that
// never happened. The briefing repo fixed its own page; this page reads the same
// archive and rendered the raw kind, so it said "split 3 shares" instead: the
// same false claim about three shares of activity, reworded.
test('a restated share count is never worded as a trade', () => {
  const line = en.activityWording(act({ kind: 'split', quantityChange: 3, quantity: 4, ratioLabel: '4-for-1' }), fmt)
  assert.equal(line, 'Share count restated 4-for-1 · now holding 4 · cost basis unchanged, so this is not a purchase or sale.')
  assert.ok(!/Bought/.test(line), 'must not claim a purchase')
  assert.ok(!/\b3\b/.test(line), 'must not present the delta as shares that were traded')
  assert.equal(en.activityBadge(act({ kind: 'split' })), 'restated')
})

// The same rule in Korean: a restatement reads 정정, never the trade phrasing
// "<n>주 매수" (the sentence may still say it is not 매수나 매도), and the delta
// never appears as a number of shares.
test('a restated share count is never worded as a trade, in Korean', () => {
  const line = ko.activityWording(act({ kind: 'split', quantityChange: 3, quantity: 4, ratioLabel: '4-for-1' }), fmt)
  assert.ok(line.includes('정정'), 'must say the count was restated')
  assert.ok(!/주 매수/.test(line), 'must not claim a purchase')
  assert.ok(!/(^|[^0-9])3([^0-9]|$)/.test(line), 'must not present the delta as shares that were traded')
  assert.equal(ko.activityBadge(act({ kind: 'split' })), '정정')
})

// The briefing reports a restatement even when the ratio is not a recognisable
// one — the cost basis still did not move — so the wording must survive a null.
test('an unnamed restatement still reads as one', () => {
  assert.equal(
    en.activityWording(act({ kind: 'split', quantityChange: 7, quantity: 19, ratioLabel: null }), fmt),
    'Share count restated · now holding 19 · cost basis unchanged, so this is not a purchase or sale.',
  )
})

// The distinction is the whole point, so real trades must be untouched.
test('real trades keep their verbs', () => {
  assert.equal(en.activityWording(act({ kind: 'bought', quantityChange: 10, quantity: 30 }), fmt), 'Bought 10 shares · now holding 30')
  assert.equal(en.activityWording(act({ kind: 'sold', quantityChange: -1, quantity: 9 }), fmt), 'Sold 1 share · now holding 9')
  assert.equal(en.activityWording(act({ kind: 'closed', quantityChange: -5, quantity: 0 }), fmt), 'Closed 5 shares')
  assert.equal(en.activityBadge(act({ kind: 'bought' })), 'bought')
})

test('real trades keep their verbs, in Korean', () => {
  assert.ok(ko.activityWording(act({ kind: 'bought', quantityChange: 10, quantity: 30 }), fmt).includes('매수'))
  assert.equal(ko.activityBadge(act({ kind: 'bought' })), '매수')
  assert.equal(ko.activityBadge(act({ kind: 'unlisted' as BriefingActivity['kind'] })), 'unlisted', 'an unknown kind falls back to the raw slug')
})

// On a split DAY the price falls by the split factor while the count is still
// stale, and nothing in the sheet can tell that from a crash — so the briefing
// leaves the move at full weight and flags it. The note beside it was written to
// explain a fall; if the fall may not have happened, showing it is wrong.
test('a suspected restatement replaces the researched note', () => {
  const note = en.moverNote(move({ ticker: 'CRWD', suspectedRestatement: '4-for-1' }), { CRWD: { why: 'Shares fell after a downgrade.' } })
  assert.ok(note.includes('4-for-1 split moves the price by exactly this factor'))
  assert.ok(note.includes('share count here has not changed'))
  assert.ok(!note.includes('downgrade'), 'must not explain a fall that may not have happened')
})

test('a suspected restatement replaces the researched note, in Korean', () => {
  const note = ko.moverNote(move({ ticker: 'CRWD', suspectedRestatement: '4-for-1' }), { CRWD: { why: 'Shares fell after a downgrade.' } })
  assert.ok(note.includes('4-for-1'))
  assert.ok(!note.includes('downgrade'), 'must not explain a fall that may not have happened')
})

test('an ordinary mover keeps its note, and its fallback', () => {
  assert.equal(en.moverNote(move({ ticker: 'AMD' }), { AMD: { why: 'Rose on earnings.' } }), 'Rose on earnings.')
  assert.equal(en.moverNote(move({ ticker: 'AMD' }), {}), 'No researched note for this session move.')
  assert.equal(ko.moverNote(move({ ticker: 'AMD' }), {}), '이 세션 변동에 대한 조사 메모가 없습니다.')
})
