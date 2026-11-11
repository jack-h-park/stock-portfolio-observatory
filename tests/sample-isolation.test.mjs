import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, symlinkSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const script = path.resolve(import.meta.dirname, '../scripts/seed-sample.mjs')
function run(cwd, extra = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.startsWith('STOCK_') && !k.startsWith('FINANCE_') && !k.startsWith('SAMPLE_'),
    ),
  )
  return spawnSync(process.execPath, [script], { cwd, env: { ...env, ...extra }, encoding: 'utf8' })
}
test('sample seed refuses private configuration even with force and preserves files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'finance-isolation-'))
  try {
    const db = path.join(dir, 'private.db')
    writeFileSync(db, 'private sentinel')
    for (const extra of [{ STOCK_DB_PATH: db }, { FINANCE_RUNTIME_DIR: dir }]) {
      const result = run(dir, { ...extra, SAMPLE_FORCE: '1' })
      assert.notEqual(result.status, 0)
      assert.equal(readFileSync(db, 'utf8'), 'private sentinel')
    }
    writeFileSync(path.join(dir, '.env.local'), 'STOCK_DB_PATH=private.db\n')
    assert.notEqual(run(dir, { SAMPLE_FORCE: '1' }).status, 0)
    assert.equal(readFileSync(db, 'utf8'), 'private sentinel')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('sample seed owns only its marked root and refuses symlinked output', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'finance-sample-'))
  try {
    const first = run(dir)
    assert.equal(first.status, 0, first.stderr)
    const base = path.join(dir, 'private-data/personal-finance-sample')
    assert.ok(existsSync(path.join(base, 'runtime/observatory.db')))
    assert.equal(existsSync(path.join(dir, 'data/fx-rates.json')), false)
    assert.equal(run(dir).status, 0)
    const outside = path.join(dir, 'outside')
    mkdirSync(outside)
    writeFileSync(path.join(outside, 'fx-rates.json'), 'private sentinel')
    rmSync(path.join(base, 'runtime'), { recursive: true })
    symlinkSync(outside, path.join(base, 'runtime'))
    assert.notEqual(run(dir, { SAMPLE_FORCE: '1' }).status, 0)
    assert.equal(readFileSync(path.join(outside, 'fx-rates.json'), 'utf8'), 'private sentinel')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
