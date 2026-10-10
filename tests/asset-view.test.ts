import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeAssetView } from '../lib/asset-view'

test('the asset view defaults to stocks for anything but "all"', () => {
  assert.equal(normalizeAssetView('all'), 'all')
  for (const junk of [undefined, '', 'ALL', 'everything', 1]) assert.equal(normalizeAssetView(junk), 'stocks')
})
