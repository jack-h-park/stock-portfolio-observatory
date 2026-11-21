import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { attentionItems } from '@/lib/overview-attention'
import { POSITION_BREAK_CAP } from '@/lib/header-status'

test('counts each source and keeps the act-first order', () => {
  const items = attentionItems({
    queue: [{ kind: 'validation', count: 2 }, { kind: 'manual_mappings', count: 3 }],
    overCap: 1,
    marketActions: [{ action: 'Add' }, { action: 'Hold' }, { action: 'Reduce' }],
  })
  assert.deepEqual(items.map((item) => [item.kind, item.count]), [['work_queue', 5], ['over_cap', 1], ['market_gap', 2]])
  assert.equal(items[0].href, '/data-ops#data-ops-priority-work')
})

test('everything clear is an empty list, so the strip hides', () => {
  assert.deepEqual(attentionItems({ queue: [{ kind: 'validation', count: 0 }], overCap: 0, marketActions: [{ action: 'Hold' }] }), [])
})

test('a capped position-break row marks the queue total as a lower bound', () => {
  const [item] = attentionItems({ queue: [{ kind: 'position_breaks', count: POSITION_BREAK_CAP }], overCap: 0, marketActions: [] })
  assert.equal(item.capped, true)
})
