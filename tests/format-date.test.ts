import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fmtDate } from '../lib/format'

test('fmtDate returns a date-only value as written, whatever the local time zone', () => {
  // The regression only shows west of UTC, and CI runs in UTC, so pin the zone.
  // Node re-reads TZ when it changes at runtime.
  process.env.TZ = 'America/Los_Angeles'
  assert.equal(fmtDate('2026-08-11'), '2026-08-11')
})
