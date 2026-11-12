import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import type { FreshnessDetail, FreshnessItem } from '@/lib/adapters/portfolio-db'
import { freshnessDetailText, freshnessLabel } from '@/lib/freshness-text'

const item = (over: Partial<FreshnessItem>): FreshnessItem => ({
  key: 'kr_prices',
  label: 'kr_prices',
  category: 'price',
  status: 'fresh',
  observedAt: null,
  thresholdMs: null,
  ageMs: null,
  detail: { code: 'FX_RATE_MISSING' },
  ...over,
})

test('the English freshness detail reads as the adapter sentence did', () => {
  assert.equal(
    freshnessDetailText({ code: 'PRICE_SNAPSHOT', count: 3, marketDate: '2020-01-02' }, 'en'),
    '3 prices · market date 2020-01-02',
  )
  assert.equal(
    freshnessDetailText({ code: 'PRICE_SNAPSHOT', count: 3, marketDate: null }, 'en'),
    '3 prices · market date unknown',
  )
  assert.equal(freshnessDetailText({ code: 'CRYPTO_SNAPSHOT', count: 0, quotes: [] }, 'en'), '0 prices · none')
  assert.equal(freshnessDetailText({ code: 'FX_RATE_MISSING' }, 'en'), 'No FX rate configured.')
})

test('a snapshot label comes from copy; a source-drift label is the file name', () => {
  assert.equal(freshnessLabel(item({ key: 'kr_prices', label: 'kr_prices' }), 'ko'), '한국 주식 시세')
  assert.equal(freshnessLabel(item({ key: 'kr_prices', label: 'kr_prices' }), 'en'), 'KR prices')
  const source = item({ key: 'source:example.csv', label: 'example.csv', category: 'source' })
  assert.equal(freshnessLabel(source, 'en'), 'example.csv')
  assert.equal(freshnessLabel(source, 'ko'), 'example.csv')
})

test('every freshness detail code has a Korean sentence without English words', () => {
  const samples: FreshnessDetail[] = [
    { code: 'PRICE_SNAPSHOT', count: 2, marketDate: '2020-01-02' },
    { code: 'PRICE_SNAPSHOT', count: 2, marketDate: null },
    { code: 'CRYPTO_SNAPSHOT', count: 0, quotes: [] },
    { code: 'FX_RATE', rate: 1000, source: 'manual' },
    { code: 'FX_RATE_MISSING' },
    { code: 'SOURCE_MISSING' },
    { code: 'SOURCE_CHANGED', recordedBytes: 10, currentBytes: 12 },
    { code: 'SOURCE_MTIME_ONLY' },
    { code: 'SOURCE_MATCHES' },
  ]
  const allowed = new Set(['FX', 'SHA', 'USD', 'KRW'])
  const codes = new Set<string>()
  for (const detail of samples) {
    codes.add(detail.code)
    // The FX source is data the adapter passes through, not copy.
    const text = freshnessDetailText(detail, 'ko').replace('manual', '')
    assert.ok(/[가-힣]/.test(text) || detail.code === 'FX_RATE', `${detail.code}: ${text}`)
    const words = (text.match(/[A-Za-z]+/g) ?? []).filter((word) => !allowed.has(word))
    assert.deepEqual(words, [], `${detail.code}: ${text}`)
  }
  assert.equal(codes.size, 8)
})
