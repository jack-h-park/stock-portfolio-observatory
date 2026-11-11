import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeAssetView } from '../lib/asset-view'

test('all assets is the default while explicit legacy stock preference remains effective', () => {
  assert.equal(normalizeAssetView('all'), 'all')
  assert.equal(normalizeAssetView('stocks'), 'stocks')
  for (const junk of [undefined, '', 'ALL', 'everything', 1]) assert.equal(normalizeAssetView(junk), 'all')
})
