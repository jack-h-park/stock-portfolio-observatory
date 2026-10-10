import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { STOCK_WRAPPERS, assetClassFor, loadAccountMap, tagRows, wrapperFor } from '../scripts/account-map.mjs'

test('no map file is an empty map, not an error', () => {
  const map = loadAccountMap(path.join(tmpdir(), 'does-not-exist.json'))
  assert.deepEqual(map, { accounts: {}, bankAccounts: [], anchors: [], pensionAccounts: [], brokerageAccounts: [] })
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

const empty = { accounts: {}, bankAccounts: [], anchors: [], pensionAccounts: [], brokerageAccounts: [] }

test('an unmapped pension or gold account is classified by its label, never as taxable', () => {
  assert.equal(wrapperFor({ account: '미래에셋증권(IRP)' }, empty), 'irp')
  assert.equal(wrapperFor({ account: '미래에셋증권(퇴직연금_개인IRP)' }, empty), 'irp')
  assert.equal(wrapperFor({ account: '삼성증권(연금저축)' }, empty), 'pension_savings')
  assert.equal(wrapperFor({ account: '미래에셋증권(ISA)' }, empty), 'isa')
  assert.equal(wrapperFor({ account: '미래에셋증권(종합)' }, empty), 'taxable')
  assert.equal(assetClassFor({ account: '미래에셋증권(금현물)' }, empty), 'gold')
  assert.equal(assetClassFor({ account: '미래에셋증권(종합)' }, empty), 'security')
})

test('the map overrides the label', () => {
  const map = { ...empty, accounts: { 'Odd label': { wrapper: 'irp', assetClass: 'gold' } } }
  assert.equal(wrapperFor({ account: 'Odd label' }, map), 'irp')
  assert.equal(assetClassFor({ account: 'Odd label' }, map), 'gold')
})

test('tagRows sets the asset class from the label, and keeps one a row already carries', () => {
  const [gold, stock, kept] = tagRows(
    [{ account: '미래에셋증권(금현물)' }, { account: '미래에셋증권(종합)' }, { account: '미래에셋증권(금현물)', asset_class: 'security' }],
    empty
  )
  assert.equal(gold.asset_class, 'gold')
  assert.equal(gold.account_wrapper, 'taxable')
  assert.equal(stock.asset_class, 'security')
  assert.equal(kept.asset_class, 'security')
})

test('the map file supplies pensionAccounts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'acct-map-'))
  const file = path.join(dir, 'accounts.local.json')
  const pensionAccounts = [{ token: 'irp', account: '예시증권(IRP)', wrapper: 'irp', institution: '예시증권' }]
  writeFileSync(file, JSON.stringify({ pensionAccounts }))
  assert.deepEqual(loadAccountMap(file).pensionAccounts, pensionAccounts)
})

test('a pensionAccounts entry sets the wrapper of its account, even when the label says nothing', () => {
  const map = {
    ...empty,
    pensionAccounts: [
      { token: 'irp', account: 'Example Securities 0000', wrapper: 'irp' },
      { token: 'pension-savings', account: 'Example Securities 1111', wrapper: 'pension_savings' },
    ],
  }
  assert.equal(wrapperFor({ account: 'Example Securities 0000' }, map), 'irp')
  assert.equal(wrapperFor({ account: 'Example Securities 1111' }, map), 'pension_savings')
  assert.equal(wrapperFor({ account: 'Example Securities 2222' }, map), 'taxable')
  // An explicit accounts entry still wins over the pension list.
  const both = { ...map, accounts: { 'Example Securities 0000': { wrapper: 'isa' } } }
  assert.equal(wrapperFor({ account: 'Example Securities 0000' }, both), 'isa')
  // A pension entry without a wrapper falls through to the label rule.
  const noWrapper = { ...empty, pensionAccounts: [{ token: 'x', account: '예시증권(연금저축)' }] }
  assert.equal(wrapperFor({ account: '예시증권(연금저축)' }, noWrapper), 'pension_savings')
})
