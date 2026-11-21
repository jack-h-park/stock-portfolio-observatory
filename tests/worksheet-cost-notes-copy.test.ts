import assert from 'node:assert/strict'
import test from 'node:test'
import { costBasisStatus, type CostBasisStatus } from '@/lib/adapters/portfolio-db'
import { NOT_COVERED_NOTES } from '@/lib/tax-export'
import { holdings } from '@/lib/ui-copy/pages/holdings'
import { realized } from '@/lib/ui-copy/pages/realized'

// /holdings and /realized render two sets of fixed English sentences by code.
// English stays exactly what the adapter and the notes file write; Korean is a
// translation of each. Synthetic rows only.

const HANGUL = /[가-힯]/

test('every worksheet note code has English equal to the notes file and a Korean translation', () => {
  for (const { code, text } of NOT_COVERED_NOTES) {
    assert.equal(realized.en.taxExport.notCoveredLines[code], text, code)
    const ko = realized.ko.taxExport.notCoveredLines[code]
    assert.ok(HANGUL.test(ko), code)
    assert.notEqual(ko, text, code)
  }
  assert.deepEqual(Object.keys(realized.en.taxExport.notCoveredLines).sort(), NOT_COVERED_NOTES.map((n) => n.code).sort())
})

const ROWS: Record<CostBasisStatus, Parameters<typeof costBasisStatus>[0]> = {
  missing_cost: { native_cost: 0, native_market_value: 100, lot_count: 1, source_system: 'invented' },
  unpriced: { native_cost: 100, native_market_value: null, lot_count: 1, source_system: 'invented' },
  estimated: { native_cost: 100, native_market_value: 120, lot_count: 0, source_system: 'invented' },
  ready: { native_cost: 100, native_market_value: 120, lot_count: 2, source_system: 'invented' },
}

test('costNotes covers the four cost statuses, with English equal to the adapter note', () => {
  for (const [status, row] of Object.entries(ROWS) as [CostBasisStatus, (typeof ROWS)[CostBasisStatus]][]) {
    const derived = costBasisStatus(row)
    assert.equal(derived.cost_status, status)
    assert.equal(holdings.en.costNotes[status], derived.cost_note, status)
    assert.ok(HANGUL.test(holdings.ko.costNotes[status]), status)
  }
  assert.deepEqual(Object.keys(holdings.en.costNotes).sort(), Object.keys(ROWS).sort())
  assert.deepEqual(Object.keys(holdings.ko.costNotes).sort(), Object.keys(ROWS).sort())
})
