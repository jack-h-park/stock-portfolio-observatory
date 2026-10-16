import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { fmtPct } from '@/lib/format'
import { fractionPct } from '@/lib/cash-inflow-format'

test('a share is shown as a percent, not a fraction', () => {
  assert.equal(fmtPct(fractionPct(6000000 / 6200000)), fmtPct(96.7741935483871))
  assert.match(fmtPct(fractionPct(0.971)), /^97\.1/)
})

test('a missing share stays null', () => {
  assert.equal(fractionPct(null), null)
  assert.equal(fractionPct(undefined), null)
})
