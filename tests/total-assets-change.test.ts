import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { isoDaysBefore, previousYearEnd, totalAssetsChange } from '@/lib/total-assets-change'
import type { TotalAssetsPoint } from '@/lib/net-worth'

const point = (date: string, total: number, extra: Partial<TotalAssetsPoint> = {}): TotalAssetsPoint => ({
  date,
  stocks: total,
  crypto: null,
  cash: null,
  pensions: null,
  gold: null,
  total,
  ...extra,
})

test('measures from the latest point on or before the base date', () => {
  const points = [point('2026-09-01', 100), point('2026-10-15', 120), point('2026-10-25', 150), point('2026-11-20', 180)]
  const change = totalAssetsChange(points, '2026-10-21')
  assert.deepEqual(change, { baseDate: '2026-10-15', change: 60, pct: 50, addedClasses: [] })
})

test('a change with no point that old is unavailable, not zero', () => {
  assert.equal(totalAssetsChange([point('2026-11-01', 100), point('2026-11-20', 110)], '2026-10-21'), null)
  assert.equal(totalAssetsChange([], '2026-10-21'), null)
  assert.equal(totalAssetsChange([point('2026-10-01', 100)], '2026-10-21'), null)
})

test('names classes that arrived after the base date', () => {
  const points = [point('2026-01-01', 100), point('2026-11-20', 130, { gold: 30, stocks: 100 })]
  assert.deepEqual(totalAssetsChange(points, '2026-01-01')?.addedClasses, ['gold'])
})

test('a zero base total has no percentage', () => {
  assert.equal(totalAssetsChange([point('2026-01-01', 0), point('2026-11-20', 50)], '2026-01-01')?.pct, null)
})

test('date helpers', () => {
  assert.equal(isoDaysBefore('2026-03-01', 30), '2026-01-30')
  assert.equal(previousYearEnd('2026-11-20'), '2025-12-31')
})
