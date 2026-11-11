import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { planFinanceStateMigration, applyFinanceStateMigration } from '../scripts/migrate-finance-state.mjs'

function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'finance-migration-')))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const source = path.join(dir, 'old'),
    destination = path.join(dir, 'new')
  fs.mkdirSync(source)
  fs.writeFileSync(path.join(source, 'policy.json'), 'synthetic policy')
  fs.mkdirSync(path.join(source, 'plans'))
  fs.writeFileSync(path.join(source, 'plans/one.json'), 'synthetic plan')
  return { dir, source, destination, mappings: [{ source, destination, owner: 'application-operator', kind: 'state' }] }
}
test('migration preview is read-only; apply copies hashes and supports matching resume', (t) => {
  const { source, destination, mappings } = fixture(t),
    plan = planFinanceStateMigration(mappings)
  assert.equal(plan.files.length, 2)
  assert.equal(fs.existsSync(destination), false)
  applyFinanceStateMigration(plan)
  assert.equal(fs.readFileSync(path.join(destination, 'plans/one.json'), 'utf8'), 'synthetic plan')
  assert.equal(fs.readFileSync(path.join(source, 'plans/one.json'), 'utf8'), 'synthetic plan')
  const resumed = planFinanceStateMigration(mappings)
  assert.ok(resumed.files.every((row) => row.status === 'matching'))
  applyFinanceStateMigration(resumed)
})
test('preflight refuses conflicts, changed source bytes, and symlink destinations', (t) => {
  const { dir, source, destination, mappings } = fixture(t),
    plan = planFinanceStateMigration(mappings)
  fs.writeFileSync(path.join(source, 'policy.json'), 'changed after preview')
  assert.throws(() => applyFinanceStateMigration(plan), /changed/i)
  assert.equal(fs.existsSync(destination), false)
  fs.mkdirSync(destination)
  fs.writeFileSync(path.join(destination, 'policy.json'), 'conflicting destination')
  assert.throws(() => planFinanceStateMigration(mappings), /conflict/i)
  fs.rmSync(destination, { recursive: true })
  fs.symlinkSync(dir, destination)
  assert.throws(() => planFinanceStateMigration(mappings), /symlink/i)
})
test('source symlinks are not followed and copy does not flip configuration', (t) => {
  const { dir, source, destination, mappings } = fixture(t)
  fs.symlinkSync(path.join(source, 'policy.json'), path.join(source, 'alias.json'))
  assert.throws(() => planFinanceStateMigration(mappings), /symlink/i)
  fs.unlinkSync(path.join(source, 'alias.json'))
  const config = path.join(dir, '.env.local')
  fs.writeFileSync(config, 'STOCK_TAX_POLICY_PATH=old/policy.json\n')
  applyFinanceStateMigration(planFinanceStateMigration(mappings))
  assert.equal(fs.readFileSync(config, 'utf8'), 'STOCK_TAX_POLICY_PATH=old/policy.json\n')
  fs.writeFileSync(path.join(destination, 'policy.json'), 'edited after copy')
  assert.equal(fs.readFileSync(path.join(source, 'policy.json'), 'utf8'), 'synthetic policy')
})
