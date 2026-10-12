import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { fmtPct } from '@/lib/format'
import { salarySharePct } from '@/lib/cash-inflow-format'

test('salary share is shown as a percent, not a fraction', () => {
  assert.equal(fmtPct(salarySharePct(6000000 / 6200000)), fmtPct(96.7741935483871))
  assert.match(fmtPct(salarySharePct(0.971)), /^97\.1/)
})

test('a missing salary share stays null', () => {
  assert.equal(salarySharePct(null), null)
  assert.equal(salarySharePct(undefined), null)
})
