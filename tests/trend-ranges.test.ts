import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_TREND_RANGE, resolveTrendRange, trendRangeDays } from '../lib/trend-ranges'

test('a missing or unknown ?trend= falls back to 2Y', () => {
  assert.equal(DEFAULT_TREND_RANGE.label, '2Y')
  assert.equal(resolveTrendRange(undefined), DEFAULT_TREND_RANGE)
  assert.equal(resolveTrendRange('banana'), DEFAULT_TREND_RANGE)
})

test('a known key resolves, and a repeated parameter uses its first value', () => {
  assert.equal(resolveTrendRange('365').label, '1Y')
  assert.equal(resolveTrendRange(['ytd', '30']).label, 'YTD')
})

test('YTD counts January 1 as day 1', () => {
  assert.equal(trendRangeDays('ytd', new Date(2026, 0, 1, 12)), 1)
  assert.equal(trendRangeDays('ytd', new Date(2026, 1, 1, 12)), 32)
  assert.equal(trendRangeDays(90), 90)
})
