import test from 'node:test'
import assert from 'node:assert/strict'
import { withoutUnsettledBar } from '../scripts/settled-bars.mjs'

// The 2026-08-28 session, as Yahoo reported it. `end` is the bell; the Friday
// briefing ran at 11:00 ET, an hour and a half into the session.
const BELL = 1788206400
const rows = (...dates) => dates.map((price_date) => ({ price_date, close: 1 }))

test('keeps every bar once the session has settled', () => {
  const meta = { regularMarketTime: BELL + 1, currentTradingPeriod: { regular: { end: BELL } } }
  const out = withoutUnsettledBar(rows('2026-08-27', '2026-08-28'), meta)
  assert.deepEqual(out.map((r) => r.price_date), ['2026-08-27', '2026-08-28'])
})

test('drops the forming bar while the session is open', () => {
  // What actually happened: MSFT mid-session at 509.71 was stored as the
  // 2026-08-28 close, which settled at 513.53.
  const meta = { regularMarketTime: BELL - 9000, currentTradingPeriod: { regular: { end: BELL } } }
  const out = withoutUnsettledBar(rows('2026-08-27', '2026-08-28'), meta)
  assert.deepEqual(out.map((r) => r.price_date), ['2026-08-27'],
    'the in-progress session must not be stored as a close')
})

test('keeps the bar when meta cannot answer', () => {
  // Dropping on uncertainty would stop price updates silently — worse than a
  // visible wrong number, because nothing downstream re-checks this table.
  for (const meta of [undefined, {}, { regularMarketTime: 1 }, { currentTradingPeriod: { regular: {} } }]) {
    const out = withoutUnsettledBar(rows('2026-08-27', '2026-08-28'), meta)
    assert.equal(out.length, 2, `meta ${JSON.stringify(meta)} must not drop a bar`)
  }
})

test('handles an empty series', () => {
  assert.deepEqual(withoutUnsettledBar([], { regularMarketTime: 1, currentTradingPeriod: { regular: { end: 2 } } }), [])
})
