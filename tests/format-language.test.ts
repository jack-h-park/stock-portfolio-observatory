import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMPTY_VALUE, fmtDate, fmtDateTime, fmtDuration, fmtDurationDays, fmtMonth } from '../lib/format'

test('fmtMonth names the month in the reader language', () => {
  assert.equal(fmtMonth('2026-03', 'en', { year: true }), 'Mar 2026')
  assert.equal(fmtMonth('2026-03', 'en'), 'Mar')
  assert.equal(fmtMonth('2026-03', 'ko', { year: true }), '2026년 3월')
  assert.equal(fmtMonth('2026-03', 'ko'), '3월')
})

test('fmtDuration uses Korean units in Korean', () => {
  assert.equal(fmtDuration(5 * 60_000, 'ko'), '5분')
  assert.equal(fmtDuration(5 * 60_000, 'en'), '5m')
  assert.equal(fmtDuration(3 * 60 * 60_000, 'ko'), '3시간')
  assert.equal(fmtDuration(3 * 24 * 60 * 60_000, 'ko'), '3일')
})

test('fmtDurationDays uses Korean units in Korean', () => {
  assert.equal(fmtDurationDays(10, 'ko'), '10일')
})

test('date helpers return EMPTY_VALUE for a missing value', () => {
  assert.equal(fmtDateTime(null, 'en'), EMPTY_VALUE)
  assert.equal(fmtDate(undefined, 'ko'), EMPTY_VALUE)
  assert.equal(fmtDuration(null, 'en'), EMPTY_VALUE)
})

test('fmtDate keeps the ISO calendar date in Korean', () => {
  assert.equal(fmtDate('2026-08-11', 'ko'), '2026-08-11')
})
