import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

// push-sources.sh carries the files a person edits on the laptop to the refresh
// host. tax-policy.json is edited the other way round, through /tax-settings on
// the host, and pushing the laptop copy over it reverted every such save within
// the hour. This pins which side owns which file.

const script = readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'push-sources.sh'), 'utf8')

function configList() {
  const block = script.match(/^CONFIG=\(\n([\s\S]*?)^\)/m)
  assert.ok(block, 'push-sources.sh defines a CONFIG=( ... ) list')
  return block[1].split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
}

test('tax-policy.json is not pushed: the host copy, written by /tax-settings, is the authority', () => {
  assert.ok(!configList().includes('tax-policy.json'))
})

test('the files edited on the laptop still travel', () => {
  assert.deepEqual(configList(), ['manual-mappings.json', 'accounts.local.json'])
})
