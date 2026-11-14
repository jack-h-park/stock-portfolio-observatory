import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

function checkLots(quantity: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'robinhood-lots-'))
  try {
    writeSheetPayloads(dir)
    const snapshot = path.join(dir, 'snapshot.json')
    writeFileSync(snapshot, JSON.stringify({ fetchedAt: '2026-11-14T02:00:00Z', accounts: [{
      accountNumber: '000001111', positions: [{ symbol: 'ANT', quantity }],
      lots: [{ symbol: 'ANT', lots: [] }],
    }] }))
    const dbPath = runIngest(dir, { env: { STOCK_ROBINHOOD_SNAPSHOT_PATH: snapshot }, allowFailure: true })
    const db = new Database(dbPath, { readonly: true })
    try {
      return db.prepare("select status, detail from validation_checks where name = 'robinhood_snapshot_lots_mapped'").get() as { status: string; detail: string }
    } finally { db.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('zero-share position with no lots passes lot coverage', () => {
  assert.equal(checkLots('0.000000').status, 'pass')
})

test('positive-share position with no lots warns about missing coverage', () => {
  const check = checkLots('1.000000')
  assert.equal(check.status, 'fail')
  assert.match(check.detail, /Robinhood 1111 ANT/)
})
