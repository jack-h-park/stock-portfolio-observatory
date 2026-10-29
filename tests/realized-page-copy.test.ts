import assert from 'node:assert/strict'
import test from 'node:test'

import { getPageCopy } from '../lib/ui-copy'

function keyPaths(value: unknown, prefix = ''): string[] {
  if (value == null || typeof value !== 'object') return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    typeof child === 'function' ? [`${prefix}${key}`] : keyPaths(child, `${prefix}${key}.`)
  )
}

test('realized copy has the same keys in both languages', () => {
  const en = keyPaths(getPageCopy('realized', 'en')).sort()
  const ko = keyPaths(getPageCopy('realized', 'ko')).sort()
  assert.deepEqual(ko, en)
})

test('realized copy carries the tax export block strings', () => {
  for (const language of ['en', 'ko'] as const) {
    const copy = getPageCopy('realized', language) as any
    for (const key of ['title', 'year', 'audit', 'csv', 'notes', 'filtersIgnored', 'apply']) {
      assert.equal(typeof copy.taxExport[key], 'string', `${language} taxExport.${key}`)
      assert.ok(copy.taxExport[key].length > 0)
    }
    const counts = copy.taxExport.counts(12, 3)
    assert.match(counts, /12/)
    assert.match(counts, /3/)
    assert.equal('export' in copy, false)
    assert.equal('exportNote' in copy, false)
  }
})
