import assert from 'node:assert/strict'
import { test } from 'node:test'
import { devCopyNotice } from '../lib/dev-copy'

// The laptop's database looked exactly like the host's: same pages, same
// subtitle format, nothing saying it was two months old. The dev server now
// says so on every page; the production build (`next start`, the host) never does.

const NOW = Date.parse('2026-10-20T12:00:00Z')

test('the production build shows no notice', () => {
  assert.equal(devCopyNotice('production', '2026-08-27T05:03:20Z', NOW), null)
})

test('the dev server shows the ingest date and its age in whole days', () => {
  assert.deepEqual(devCopyNotice('development', '2026-08-27T05:03:20Z', NOW), {
    ingestedAt: '2026-08-27T05:03:20Z',
    ageDays: 54,
  })
})

test('a missing or unreadable ingest time still shows the notice, without an age', () => {
  assert.deepEqual(devCopyNotice('development', null, NOW), { ingestedAt: null, ageDays: null })
  assert.deepEqual(devCopyNotice(undefined, 'not a date', NOW), { ingestedAt: 'not a date', ageDays: null })
})
