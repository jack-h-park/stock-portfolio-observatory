import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { STOCK_WRAPPERS, loadAccountMap, tagRows, wrapperFor } from '../scripts/account-map.mjs'

test('no map file is an empty map, not an error', () => {
  const map = loadAccountMap(path.join(tmpdir(), 'does-not-exist.json'))
  assert.deepEqual(map, { accounts: {}, bankAccounts: [], anchors: [] })
})

test('ISA is recognised from the account label; everything else defaults to taxable', () => {
  const map = loadAccountMap(undefined)
  assert.equal(wrapperFor({ account: '미래에셋증권(ISA)' }, map), 'isa')
  assert.equal(wrapperFor({ account: 'Robinhood 1111' }, map), 'taxable')
  assert.deepEqual([...STOCK_WRAPPERS], ['taxable', 'isa'])
})

test('the local map overrides the label rule and sets the owner', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'acct-map-'))
  const file = path.join(dir, 'accounts.local.json')
  writeFileSync(file, JSON.stringify({ accounts: { 'Example IRP': { wrapper: 'irp', owner: 'self' } } }))
  const map = loadAccountMap(file)
  const [row] = tagRows([{ account: 'Example IRP', ticker: 'X' }], map)
  assert.equal(row.account_wrapper, 'irp')
  assert.equal(row.owner, 'self')
  assert.equal(row.ticker, 'X')
})

test('a row that already carries a wrapper keeps it', () => {
  const [row] = tagRows([{ account: 'Anything', account_wrapper: 'pension_savings' }], loadAccountMap(undefined))
  assert.equal(row.account_wrapper, 'pension_savings')
})

test('a malformed map file fails closed with its path in the message', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'acct-map-'))
  const file = path.join(dir, 'accounts.local.json')
  writeFileSync(file, '{"accounts": {')
  assert.throws(() => loadAccountMap(file), (error) => {
    assert.ok(error instanceof Error)
    assert.ok(error.message.includes(file))
    assert.match(error.message, /is not valid JSON/)
    return true
  })
})
