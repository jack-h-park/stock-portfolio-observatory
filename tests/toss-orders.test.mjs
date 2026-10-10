import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeFills } from '../scripts/toss-orders.mjs'

// The fetch log counted only orders whose final status was FILLED. A limit
// sell for 196 shares that filled 61 at the close and had the rest rejected
// ends REJECTED, so the log left out a fill the ingest books. That is the same
// rule that left 61 shares open in the lots until the ingest stopped using it.

const order = (status, filledQuantity, filledAt) => ({
  status,
  orderedAt: `${filledAt}T09:00:00.000+09:00`,
  execution: { filledQuantity, filledAt: filledQuantity ? `${filledAt}T15:30:07.000+09:00` : null },
})

test('an order that ended rejected after a partial fill is counted as filled', () => {
  const summary = summarizeFills([
    order('FILLED', '135', '2026-09-23'),
    order('REJECTED', '61', '2026-09-22'),
  ])
  assert.equal(summary.filled, 2)
  assert.equal(summary.partial, 1)
  assert.equal(summary.first, '2026-09-22')
  assert.equal(summary.last, '2026-09-23')
})

test('an order that moved no shares is not a fill, whatever its status', () => {
  const summary = summarizeFills([
    order('CANCELED', '0', '2026-09-21'),
    order('REJECTED', null, '2026-09-20'),
    order('FILLED', '1', '2026-09-24'),
  ])
  assert.equal(summary.filled, 1)
  assert.equal(summary.partial, 0)
  assert.equal(summary.first, '2026-09-24')
})

test('no orders, no dates', () => {
  assert.deepEqual(summarizeFills([]), { filled: 0, partial: 0, first: null, last: null })
})
