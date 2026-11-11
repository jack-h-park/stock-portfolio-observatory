import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import example from '../examples/tax-history.synthetic.json'
import { validateTaxHistory } from '../lib/domain/taxes/history'
import { commitTaxHistory, readTaxHistory } from '../lib/adapters/tax-history-store'
import { applyTaxHistoryEdit } from '../lib/application/tax-history-edit'

test('review edits require current revision, preserve audit log, and respect write authority', (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'tax-edit-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'state.json')
  commitTaxHistory(file, {
    expectedRevision: 0,
    next: validateTaxHistory(example),
    actor: 'import',
    reason: 'Synthetic reviewed records',
  })
  const edit = {
    kind: 'review-event' as const,
    id: 'payment',
    expectedRevision: 1,
    review: 'evidenced' as const,
    reason: 'Receipt checked; authority posting not confirmed',
  }
  const second = applyTaxHistoryEdit(file, edit, { stateWritable: true, roots: { records: dir, tax: dir } })
  assert.equal(second.events.find((row) => row.id === 'payment')!.review, 'evidenced')
  assert.equal(second.changes.length, 2)
  assert.throws(() => applyTaxHistoryEdit(file, edit, { stateWritable: true, roots: { records: dir, tax: dir } }), {
    name: 'TaxHistoryConflictError',
  })
  assert.throws(
    () =>
      applyTaxHistoryEdit(
        file,
        { ...edit, expectedRevision: 2 },
        { stateWritable: false, roots: { records: dir, tax: dir } },
      ),
    { name: 'TaxHistoryReadOnlyError' },
  )
  assert.equal(readTaxHistory(file).revision, 2)
})
