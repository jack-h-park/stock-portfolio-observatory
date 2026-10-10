import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

// An ingest over empty inputs fails some unrelated checks and exits non-zero
// while still writing the database, so allowFailure is set and the tests read
// the tables and checks they care about. The sheet payloads (headers only) are
// written first because the ingest reads them unconditionally.
function ingest(env: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cash-ingest-'))
  writeSheetPayloads(dir)
  return new Database(runIngest(dir, { env, allowFailure: true }), { readonly: true })
}

test('securities tables carry account_wrapper and owner; holdings carry asset_class', () => {
  const db = ingest()
  for (const table of ['holdings', 'tax_lots', 'realized_lots', 'transactions', 'dividends']) {
    const cols = (db.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
    assert.ok(cols.includes('account_wrapper'), `${table}.account_wrapper`)
    assert.ok(cols.includes('owner'), `${table}.owner`)
  }
  const holdingCols = (db.prepare('pragma table_info(holdings)').all() as { name: string }[]).map((c) => c.name)
  assert.ok(holdingCols.includes('asset_class'))
  const check = db.prepare("select status, severity from validation_checks where name = 'wrapper_assigned'").get() as any
  assert.equal(check.status, 'pass')
  assert.equal(check.severity, 'warning')
})
