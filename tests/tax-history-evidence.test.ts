import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { resolveTaxEvidence, indexEvidenceRoot } from '../lib/application/evidence-index'

test('evidence resolution verifies bytes and refuses traversal and cross-root symlinks', (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'tax-evidence-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const roots = { records: path.join(dir, 'records'), tax: path.join(dir, 'tax') }
  for (const root of Object.values(roots)) fs.mkdirSync(root)
  fs.writeFileSync(path.join(roots.tax, 'receipt.pdf'), 'synthetic receipt')
  const sha256 = createHash('sha256').update('synthetic receipt').digest('hex')
  const evidence = { id: 'receipt', recordRevision: 1, root: 'tax' as const, relativePath: 'receipt.pdf', sha256 }
  assert.equal(resolveTaxEvidence(evidence, roots).bytes.toString(), 'synthetic receipt')
  for (const relativePath of ['../tax/receipt.pdf', path.join(roots.tax, 'receipt.pdf'), '..\\tax\\receipt.pdf'])
    assert.throws(() => resolveTaxEvidence({ ...evidence, relativePath }, roots))
  fs.writeFileSync(path.join(roots.records, 'receipt.pdf'), 'synthetic receipt')
  fs.symlinkSync(path.join(roots.records, 'receipt.pdf'), path.join(roots.tax, 'linked.pdf'))
  assert.throws(() => resolveTaxEvidence({ ...evidence, relativePath: 'linked.pdf' }, roots), /root|link/i)
  fs.writeFileSync(path.join(roots.tax, 'receipt.pdf'), 'changed')
  assert.throws(() => resolveTaxEvidence(evidence, roots), /changed/i)
  assert.throws(() => resolveTaxEvidence(evidence, { ...roots, tax: null }), /unavailable/i)
})
test('hash index finds moved and renamed documents but offers no different-hash candidate', (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'tax-relink-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, 'moved'))
  fs.writeFileSync(path.join(dir, 'moved/renamed.pdf'), 'same bytes')
  fs.writeFileSync(path.join(dir, 'different.pdf'), 'different')
  const hash = createHash('sha256').update('same bytes').digest('hex')
  assert.deepEqual(indexEvidenceRoot(dir, hash).candidates, ['moved/renamed.pdf'])
  assert.deepEqual(indexEvidenceRoot(dir, '0'.repeat(64)).candidates, [])
  assert.equal(indexEvidenceRoot(dir, hash, { maxFiles: 0 }).complete, false)
})
