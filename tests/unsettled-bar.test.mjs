import test from 'node:test'
import assert from 'node:assert/strict'
import { withoutUnsettledBar } from '../scripts/settled-bars.mjs'

// The two sessions the 2026-09-01/02 incident spans. Derived from the dates so a
// constant can never drift out of step with the bar dates again — the first
// version of this file hard-coded an epoch labelled 08-28 that was really 08-31,
// and the mid-session case stopped exercising anything.
const at = (iso) => Math.floor(Date.parse(iso) / 1000)
const OPEN = (d) => at(`${d}T13:30:00Z`)   // 09:30 ET
const BELL = (d) => at(`${d}T20:00:00Z`)   // 16:00 ET
const period = (d) => ({ regular: { start: OPEN(d), end: BELL(d) } })

const rows = (...dates) => dates.map((price_date) => ({ price_date, close: 1 }))
const SERIES = rows('2026-08-31', '2026-09-01')

test('keeps every bar once the session has settled', () => {
  const meta = { regularMarketTime: BELL('2026-09-01') + 1, currentTradingPeriod: period('2026-09-01') }
  assert.deepEqual(withoutUnsettledBar(SERIES, meta).map((r) => r.price_date),
    ['2026-08-31', '2026-09-01'])
})

test('drops the forming bar while its own session is open', () => {
  // Mid-session on 09-01: the last bar IS 09-01, and its close is just the last
  // trade so far. Storing it is how 509.71 became "the 08-28 close" against a
  // settled 513.53.
  const meta = { regularMarketTime: BELL('2026-09-01') - 9000, currentTradingPeriod: period('2026-09-01') }
  assert.deepEqual(withoutUnsettledBar(SERIES, meta).map((r) => r.price_date), ['2026-08-31'],
    'the in-progress session must not be stored as a close')
})

test('keeps the previous close when run before the next open', () => {
  // 09:07 ET on 09-02, twenty minutes pre-open. The period is 09-02 and its bell
  // has not rung, but Yahoo has no 09-02 bar yet — so the last bar is the settled
  // 09-01 close. The first version dropped it, and the table then had no 09-01
  // row at all, which the trading review's shadow check reported that afternoon.
  const meta = { regularMarketTime: BELL('2026-09-01'), currentTradingPeriod: period('2026-09-02') }
  assert.deepEqual(withoutUnsettledBar(SERIES, meta).map((r) => r.price_date),
    ['2026-08-31', '2026-09-01'], 'a settled close must survive a pre-market refresh')
})

test('keeps the bar when meta cannot answer', () => {
  // Dropping on uncertainty would stop price updates silently — worse than a
  // visible wrong number, because nothing downstream re-checks this table.
  for (const meta of [undefined, {}, { regularMarketTime: 1 },
                      { currentTradingPeriod: { regular: {} } },
                      { regularMarketTime: 1, currentTradingPeriod: { regular: { end: 2 } } }]) {
    assert.equal(withoutUnsettledBar(SERIES, meta).length, 2,
      `meta ${JSON.stringify(meta)} must not drop a bar`)
  }
})

test('handles an empty series', () => {
  assert.deepEqual(withoutUnsettledBar([], {
    regularMarketTime: BELL('2026-09-01') + 1, currentTradingPeriod: period('2026-09-01') }), [])
})

import { newestSettledSession } from '../scripts/settled-bars.mjs'

test('newest settled session: nothing today has settled before the US close', () => {
  // 2026-09-02 13:07 UTC = 09:07 ET, the pre-open moment the 06:07 PT refresh ran.
  assert.equal(newestSettledSession(new Date('2026-09-02T13:07:00Z')), '2026-09-01',
    'pre-open, the newest close is the previous session — a file ending 08-31 must refetch')
  // Same day after the bell.
  assert.equal(newestSettledSession(new Date('2026-09-02T20:30:00Z')), '2026-09-02')
})

test('newest settled session: weekends walk back to Friday', () => {
  // Saturday and Sunday both answer Friday, so a weekend run correctly skips
  // instead of refetching all day for a session that will never exist.
  assert.equal(newestSettledSession(new Date('2026-09-05T21:00:00Z')), '2026-09-04') // Fri after close
  assert.equal(newestSettledSession(new Date('2026-09-06T12:00:00Z')), '2026-09-04') // Sat
  assert.equal(newestSettledSession(new Date('2026-09-07T12:00:00Z')), '2026-09-04') // Sun
  assert.equal(newestSettledSession(new Date('2026-09-08T12:00:00Z')), '2026-09-07') // Mon pre-open
})
