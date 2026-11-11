import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import example from '../examples/tax-history.synthetic.json'
import { emptyTaxHistory, validateTaxHistory } from '../lib/domain/taxes/history'
import { readTaxHistory } from '../lib/adapters/tax-history-store'
import { previewTaxHistoryImport, applyTaxHistoryImport } from '../lib/application/import-tax-history'

test('preview is pure and identical repeated import preserves revision and history', t => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'tax-import-')); t.after(() => fs.rmSync(dir, { recursive:true, force:true }))
  const file = path.join(dir, 'state.json'), incoming = validateTaxHistory(example)
  const preview = previewTaxHistoryImport(emptyTaxHistory(), incoming)
  assert.equal(preview.additions.length, 19)
  assert.equal(fs.existsSync(file), false)
  const options = { expectedRevision: 0, incoming, reason: 'Reviewed synthetic import', reviewedMatchDecisions: [], reviewedRecordChanges: [] }
  const first = applyTaxHistoryImport(file, options)
  assert.equal(first.revision, 1)
  const repeated = applyTaxHistoryImport(file, { ...options, expectedRevision: 1 })
  assert.deepEqual(repeated, first)
  assert.equal(readTaxHistory(file).changes.length, 1)
})
test('changed records require a reviewed revision and digest; import cannot replace the local log', t => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'tax-import-')); t.after(() => fs.rmSync(dir, { recursive:true, force:true }))
  const file = path.join(dir, 'state.json'), incoming = validateTaxHistory(example)
  const options = { expectedRevision: 0, incoming, reason: 'Reviewed import', reviewedMatchDecisions: [], reviewedRecordChanges: [] }
  const first = applyTaxHistoryImport(file, options)
  const updated = structuredClone(incoming); updated.taxUnits[0].ownerIds = ['corrected-owner']
  const preview = previewTaxHistoryImport(first, updated)
  assert.equal(preview.changes.length, 1)
  assert.throws(() => applyTaxHistoryImport(file, { ...options, expectedRevision: 1, incoming: updated }), /review/i)
  const second = applyTaxHistoryImport(file, { ...options, expectedRevision: 1, incoming: updated, reviewedRecordChanges: preview.changes })
  assert.equal(second.changes.length, 2)
  assert.deepEqual(second.changes[0], first.changes[0])
  assert.equal(second.taxUnits[0].recordRevision, 2)
  assert.throws(() => applyTaxHistoryImport(file, { ...options, expectedRevision: 2, stateWritable: false }), { name:'TaxHistoryReadOnlyError' })
})
