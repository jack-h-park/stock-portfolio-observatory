import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import example from '../examples/tax-history.synthetic.json'
import { validateTaxHistory } from '../lib/domain/taxes/history'
import { readTaxHistory, commitTaxHistory } from '../lib/adapters/tax-history-store'
import { reconcileTaxHistory } from '../lib/domain/taxes/reconcile'
import { runIngest } from './ingest-harness'
import { writeScenario } from './pension-fixtures'

test('actual isolated ingest rebuild and backup restore leave durable tax history intact', (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'tax-durability-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'outputs/personal-finance-observatory/state/tax-history.json')
  const env = writeScenario(dir, { withPensions: false })
  const initial = commitTaxHistory(file, {
    expectedRevision: 0,
    next: validateTaxHistory(example),
    actor: 'import',
    reason: 'Reviewed synthetic year',
    stateWritable: true,
  })
  const backup = fs.readFileSync(file)
  const dbPath = runIngest(dir, { env, allowFailure: true })
  assert.equal(fs.existsSync(dbPath), true)
  assert.deepEqual(readTaxHistory(file), initial)
  const edited = structuredClone(initial)
  edited.taxUnits[0].ownerIds = ['corrected']
  commitTaxHistory(file, {
    expectedRevision: 1,
    next: edited,
    actor: 'local-user',
    reason: 'Synthetic correction',
    stateWritable: true,
  })
  fs.writeFileSync(file, 'partial failure')
  assert.throws(() => readTaxHistory(file))
  fs.writeFileSync(file, backup)
  assert.deepEqual(reconcileTaxHistory(readTaxHistory(file)), reconcileTaxHistory(initial))
})
