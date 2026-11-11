import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import example from '../examples/tax-history.synthetic.json'
import { validateTaxHistory } from '../lib/domain/taxes/history'
import { commitTaxHistory, readTaxHistory } from '../lib/adapters/tax-history-store'
import { applyTaxHistoryEdit } from '../lib/application/tax-history-edit'

test('reviewed relink preserves document identity/hash and the previous path', (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'tax-relink-review-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const root = path.join(dir, 'tax'), file = path.join(dir, 'history.json')
  fs.mkdirSync(path.join(root, 'moved'), { recursive: true })
  fs.writeFileSync(path.join(root, 'moved/same.pdf'), 'same document')
  fs.writeFileSync(path.join(root, 'moved/other.pdf'), 'other document')
  const data = validateTaxHistory(example)
  data.evidence[0].sha256 = createHash('sha256').update('same document').digest('hex')
  commitTaxHistory(file, { expectedRevision: 0, next: data, actor: 'import', reason: 'Synthetic evidence', stateWritable: true })
  const edit = { kind: 'relink-evidence' as const, id: 'doc-1', expectedRevision: 1, relativePath: 'moved/same.pdf', reason: 'Reviewed exact content match' }
  assert.throws(() => applyTaxHistoryEdit(file, { ...edit, relativePath: 'moved/other.pdf' }, { stateWritable: true, roots: { records: root, tax: root } }), /changed/)
  assert.equal(readTaxHistory(file).revision, 1)
  const after = applyTaxHistoryEdit(file, edit, { stateWritable: true, roots: { records: root, tax: root } })
  assert.equal(after.evidence[0].id, 'doc-1')
  assert.equal(after.evidence[0].sha256, data.evidence[0].sha256)
  assert.equal(after.evidence[0].recordRevision, 2)
  assert.equal(after.changes[1].records[0].before && 'relativePath' in after.changes[1].records[0].before ? after.changes[1].records[0].before.relativePath : null, 'synthetic/return.pdf')
})
