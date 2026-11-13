import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { loadConnectorShadow, compareConnectorPositions } from '../scripts/connector-import.mjs'

const hash = (data) => createHash('sha256').update(data).digest('hex')
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'connector-shadow-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const records = path.join(root, 'records'), runtime = path.join(root, 'runtime')
  const run = path.join(records, 'runs', 'synthetic-run')
  fs.mkdirSync(path.join(run, 'normalized'), { recursive: true })
  fs.mkdirSync(path.join(run, 'raw'), { recursive: true })
  fs.mkdirSync(path.join(runtime, 'live/latest-good'), { recursive: true })
  const source = { runId: 'synthetic-run', path: 'raw/observations.json', pointer: '/positions/0' }
  const values = { accounts: [{ accountRef: 'snaptrade:test:acct', providerAccountId: 'acct', source }], balances: [], positions: [{ accountRef: 'snaptrade:test:acct', instrumentRef: 'snaptrade:security', ticker: 'TEST', currency: 'USD', quantity: '1.25', averageUnitCost: null, cashEquivalent: false, lotAvailability: 'unknown', source }], activities: [], 'tax-lots': [] }
  const raw = JSON.stringify({ positions: [{ id: 'synthetic-security', units: '1.25' }] })
  fs.writeFileSync(path.join(run, 'raw/observations.json'), raw)
  const files = { 'raw/observations.json': { sha256: hash(raw), bytes: Buffer.byteLength(raw) } }
  for (const [name, rows] of Object.entries(values)) {
    const text = JSON.stringify(rows)
    fs.writeFileSync(path.join(run, `normalized/${name}.json`), text)
    files[`normalized/${name}.json`] = { sha256: hash(text), bytes: Buffer.byteLength(text), records: rows.length }
  }
  const section = { capability: 'supported', result: 'complete', asOf: null, asOfPrecision: 'unknown' }
  const manifest = { schemaVersion: '1.0', runId: 'synthetic-run', provider: 'snaptrade', environment: 'live', sample: false, connectionKey: 'test', connectionId: 'synthetic-connection', accountIds: ['acct'], collectorVersion: '0.1.0', normalizerVersion: '1.0', startedAt: '2026-11-13T12:00:00Z', fetchedAt: '2026-11-13T12:00:00Z', historyScan: 'full', lastFullScanAt: '2026-11-13T12:00:00Z', accountStatus: [], dependencies: [], sections: Object.fromEntries(['accounts', 'balances', 'positions', 'activities'].map(k => [k, { ...section }])), files }
  const pointer = { schemaVersion: '1.0', runId: manifest.runId, manifestSha256: hash(JSON.stringify(manifest)), connectionKey: 'test', environment: 'live' }
  function write() {
    fs.writeFileSync(path.join(run, 'manifest.json'), JSON.stringify(manifest))
    pointer.manifestSha256 = hash(JSON.stringify(manifest))
    fs.writeFileSync(path.join(runtime, 'live/latest-good/test.json'), JSON.stringify(pointer))
  }
  write()
  const env = { FINANCE_MODE: 'private', FINANCE_CONNECTOR_EXPORT_DIR: runtime, FINANCE_CONNECTOR_RECORDS_DIR: records, FINANCE_CONNECTOR_CONNECTION: 'test' }
  return { root, records, runtime, run, manifest, pointer, write, env }
}
test('unconfigured connector is inert', () => assert.equal(loadConnectorShadow({}), null))
test('pins a completed run and reports freshness separately', (t) => {
  const f = fixture(t), result = loadConnectorShadow(f.env, new Date('2026-11-15T12:00:00Z'))
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'shadow')
  assert.equal(result.freshness, 'warning')
  assert.equal(result.data.positions[0].quantity, '1.25')
})
test('corrupt payload never becomes an empty successful account', (t) => {
  const f = fixture(t)
  fs.writeFileSync(path.join(f.run, 'normalized/positions.json'), '[]')
  assert.equal(loadConnectorShadow(f.env).ok, false)
})
test('rejects forged run paths, symlinks, partial sections and demo exports', (t) => {
  const f = fixture(t)
  f.pointer.runId = '../outside'
  fs.writeFileSync(path.join(f.runtime, 'live/latest-good/test.json'), JSON.stringify(f.pointer))
  assert.equal(loadConnectorShadow(f.env).ok, false)
  f.pointer.runId = f.manifest.runId; f.manifest.sections.positions.result = 'partial'; f.write()
  assert.equal(loadConnectorShadow(f.env).ok, false)
  f.manifest.sections.positions.result = 'complete'; f.manifest.environment = 'demo'; f.write()
  assert.equal(loadConnectorShadow(f.env).ok, false)
  f.manifest.environment = 'live'; f.write()
  fs.renameSync(path.join(f.run, 'normalized/positions.json'), path.join(f.root, 'positions.json'))
  fs.symlinkSync(path.join(f.root, 'positions.json'), path.join(f.run, 'normalized/positions.json'))
  assert.equal(loadConnectorShadow(f.env).ok, false)
})
test('aliases fail closed and sample refuses private connector roots', (t) => {
  const f = fixture(t)
  assert.equal(loadConnectorShadow({ ...f.env, STOCK_CONNECTOR_EXPORT_DIR: '/other' }).ok, false)
  assert.equal(loadConnectorShadow({ ...f.env, FINANCE_MODE: 'sample' }).ok, false)
})
test('mapping is explicit, missing differs from zero and core fund is uncertain', () => {
  const rows = [{ accountRef: 'ref', instrumentRef: 'snaptrade:security', ticker: 'TEST', quantity: '1.25' }, { accountRef: 'ref', instrumentRef: 'snaptrade:core', ticker: 'SPAXX', quantity: '100' }]
  const holdings = [{ account: 'Fidelity Existing', ticker: 'TEST', quantity: 1.25 }]
  const original = structuredClone(holdings)
  assert.equal(compareConnectorPositions(rows, holdings, {}).some(x => x.code === 'unmapped_account'), true)
  const found = compareConnectorPositions(rows, holdings, { ref: { account: 'Fidelity Existing', instruments: { 'snaptrade:security': 'TEST' } } })
  assert.equal(found.some(x => x.code === 'core_cash_unverified'), true)
  assert.equal(found.some(x => x.code === 'quantity_mismatch'), false)
  assert.deepEqual(holdings, original)
  assert.equal(compareConnectorPositions([{ accountRef: 'ref', instrumentRef: 'snaptrade:security', ticker: 'NEW', quantity: '0' }], holdings, { ref: { account: 'Fidelity Existing', instruments: { 'snaptrade:security': 'TEST' } } }).some(x => x.code === 'instrument_symbol_mismatch'), true)
})
test('a complete empty connector cannot conceal existing mapped holdings', () => {
  assert.equal(compareConnectorPositions([], [{ account: 'Existing', ticker: 'TEST', quantity: 1 }], { ref: { account: 'Existing', instruments: { 'snaptrade:security': 'TEST' } } }).some(x => x.code === 'missing_connector_position'), true)
})
test('quantity comparisons preserve decimal differences beyond floating precision', () => {
  assert.equal(compareConnectorPositions([{ accountRef: 'ref', instrumentRef: 'snaptrade:security', ticker: 'TEST', quantity: '9007199254740993' }], [{ account: 'Existing', ticker: 'TEST', quantity: '9007199254740992' }], { ref: { account: 'Existing', instruments: { 'snaptrade:security': 'TEST' } } }).some(x => x.code === 'quantity_mismatch'), true)
})

test('unreadable collection status stays unknown and unchanged requires verified lineage', t => {
  const f = fixture(t)
  assert.equal(loadConnectorShadow(f.env).latestStatus.status, 'unknown')
  f.manifest.sections.positions.result = 'unchanged'; f.write()
  assert.equal(loadConnectorShadow(f.env).ok, false)
})
test('ticker alone never establishes instrument identity', () => {
  const found = compareConnectorPositions([{ accountRef: 'ref', instrumentRef: 'snaptrade:new', ticker: 'TEST', quantity: '1' }], [{ account: 'Existing', ticker: 'TEST', quantity: 1 }], { ref: { account: 'Existing' } })
  assert.ok(found.some(x => x.code === 'unmapped_instrument'))
})
test('duplicate connector identities cannot pass by comparing each against one legacy row', () => {
  const row = { accountRef: 'ref', instrumentRef: 'snaptrade:security', ticker: 'TEST', quantity: '1' }
  assert.ok(compareConnectorPositions([row, row], [{ account: 'Existing', ticker: 'TEST', quantity: 1 }], { ref: { account: 'Existing', instruments: { 'snaptrade:security': 'TEST' } } }).some(x => x.code === 'duplicate_connector_position'))
})
