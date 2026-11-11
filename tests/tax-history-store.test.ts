import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { emptyTaxHistory } from '../lib/domain/taxes/history'
import { readTaxHistory, commitTaxHistory } from '../lib/adapters/tax-history-store'

function sandbox(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'tax-state-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return { dir, file: path.join(dir, 'state/history.json') }
}
const next = () => ({
  ...emptyTaxHistory(),
  taxUnits: [{ id: 'self', recordRevision: 1, year: 2025, kind: 'individual' as const, ownerIds: ['synthetic'] }],
})
const meta = { expectedRevision: 0, actor: 'local-user' as const, reason: 'Synthetic initial record' }
test('read-only hosts refuse commit without creating any state or lock', (t) => {
  const { file } = sandbox(t)
  assert.equal(readTaxHistory(file).revision, 0)
  assert.throws(() => commitTaxHistory(file, { ...meta, next: next(), stateWritable: false }), {
    name: 'TaxHistoryReadOnlyError',
  })
  assert.equal(fs.existsSync(path.dirname(file)), false)
})
test('edits and tombstones preserve prior payloads and reject stale revisions/log rewrites', (t) => {
  const { file } = sandbox(t)
  const first = commitTaxHistory(file, { ...meta, next: next() })
  assert.equal(first.revision, 1)
  const edited = structuredClone(first)
  edited.taxUnits[0].ownerIds = ['updated']
  const second = commitTaxHistory(file, { ...meta, expectedRevision: 1, next: edited })
  assert.equal(second.taxUnits[0].recordRevision, 2)
  assert.deepEqual(second.changes[1].records[0].before?.id, 'self')
  assert.deepEqual((second.changes[1].records[0].before as { ownerIds: string[] }).ownerIds, ['synthetic'])
  assert.throws(() => commitTaxHistory(file, { ...meta, next: edited }), { name: 'TaxHistoryConflictError' })
  const rewritten = structuredClone(second)
  rewritten.changes[0].reason = 'rewrite'
  assert.throws(() => commitTaxHistory(file, { ...meta, expectedRevision: 2, next: rewritten }), /history/i)
  const removed = structuredClone(second)
  removed.taxUnits = []
  const third = commitTaxHistory(file, { ...meta, expectedRevision: 2, next: removed })
  assert.equal(third.taxUnits[0].deleted, true)
  assert.equal(third.changes.length, 3)
})
test('lock contention, corruption and orphan temporary files preserve committed data', (t) => {
  const { file } = sandbox(t)
  const state = commitTaxHistory(file, { ...meta, next: next() })
  const before = fs.readFileSync(file)
  fs.writeFileSync(file + '.lock', 'held')
  assert.throws(() => commitTaxHistory(file, { ...meta, expectedRevision: 1, next: state }), {
    name: 'TaxHistoryLockedError',
  })
  fs.unlinkSync(file + '.lock')
  fs.writeFileSync(file + '.orphan.tmp', 'partial JSON')
  assert.deepEqual(readTaxHistory(file), state)
  assert.deepEqual(fs.readFileSync(file), before)
  fs.writeFileSync(file, '{"schemaVersion":2}')
  assert.throws(() => readTaxHistory(file))
  fs.writeFileSync(file, before)
  assert.deepEqual(readTaxHistory(file), state)
})
test('concurrent writers expecting the same revision produce one successor and one conflict', async (t) => {
  const { file } = sandbox(t)
  const module = pathToFileURL(path.resolve('lib/adapters/tax-history-store.ts')).href
  const code = `import {commitTaxHistory} from ${JSON.stringify(module)}; try {commitTaxHistory(${JSON.stringify(file)}, ${JSON.stringify({ ...meta, next: next() })}); console.log('committed')} catch(e) {console.log(e.name)}`
  const run = () =>
    new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
        cwd: process.cwd(),
      })
      let out = '',
        err = ''
      child.stdout.on('data', (v) => (out += v))
      child.stderr.on('data', (v) => (err += v))
      child.on('error', reject)
      child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err))))
    })
  const results = await Promise.all([run(), run()])
  assert.equal(results.filter((v) => v === 'committed').length, 1)
  assert.ok(results.some((v) => ['TaxHistoryLockedError', 'TaxHistoryConflictError'].includes(v)))
  assert.equal(readTaxHistory(file).revision, 1)
})
