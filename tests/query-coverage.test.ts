import assert from 'node:assert/strict'
import test from 'node:test'
import { cryptoStatementCoverageEnd, strictIsoDate } from '../lib/domain/assets/query-coverage'

const selection = { venue: 'Robinhood Crypto', account: 'Example', category: 'robinhood_crypto_statement', today: '2026-11-13' }
const doc = (start: string, end: string, extra = {}) => ({ ...selection, rowCount: 0, metrics: { periodStart: start, periodEnd: end }, ...extra })
const through = (documents: unknown[]) => cryptoStatementCoverageEnd({ documents }, selection)

test('quiet monthly crypto statements establish coverage independently of transactions', () => {
  assert.equal(through([doc('2026-09-01', '2026-09-30'), doc('2026-10-01', '2026-10-31')]), '2026-10-31')
})

test('overlapping and duplicate periods are accepted in any order', () => {
  assert.equal(through([doc('2026-10-01', '2026-10-31'), doc('2026-09-01', '2026-10-05'), doc('2026-10-01', '2026-10-31')]), '2026-10-31')
})

test('gaps, reversed dates, future periods and invalid dates cannot confirm coverage', () => {
  assert.equal(through([doc('2026-08-01', '2026-08-31'), doc('2026-10-01', '2026-10-31')]), null)
  for (const [start, end] of [['2026-10-31', '2026-10-01'], ['2026-11-01', '2026-11-30'], ['2026-02-01', '2026-02-30'], ['2026-01-01', '2026-1-31']]) {
    assert.equal(through([doc(start, end)]), null)
  }
  assert.equal(through([doc('2026-10-01', '2026-10-31'), doc('', '')]), null)
})

test('only the selected venue, account and document category count', () => {
  const unrelated = [doc('', '', { account: 'Another' }), doc('', '', { venue: 'Another' }), doc('', '', { category: 'ledger' })]
  assert.equal(through(unrelated), null)
  assert.equal(through([...unrelated, doc('2026-10-01', '2026-10-31')]), '2026-10-31')
  for (const value of [null, {}, { documents: {} }]) assert.equal(cryptoStatementCoverageEnd(value, selection), null)
})

test('Bithumb requires full asset and transaction scope in every selected statement', () => {
  const filter = { venue: 'Bithumb', account: 'Example', category: 'bithumb_statement', today: selection.today }
  const base = { ...filter, rowCount: 0, metrics: { periodStart: '2026-10-01', periodEnd: '2026-10-31', scopeAssets: '전체', scopeTypes: '매수/매도/입금/출금' } }
  assert.equal(cryptoStatementCoverageEnd({ documents: [base] }, filter), '2026-10-31')
  for (const change of [{ scopeAssets: 'BTC' }, { scopeTypes: '매수/매도' }, { scopeAssets: undefined }]) {
    assert.equal(cryptoStatementCoverageEnd({ documents: [base, { ...base, metrics: { ...base.metrics, ...change } }] }, filter), null)
  }
  assert.equal(cryptoStatementCoverageEnd({ documents: [doc('2026-10-01', '2026-10-31')] }, { ...selection, category: 'ledger' }), null)
})

test('strict ISO dates reject normalized invalid days, timestamps and invalid today', () => {
  assert.equal(strictIsoDate('2024-02-29'), '2024-02-29')
  for (const value of ['2026-02-29', '2026-04-31', '2026-01-01T00:00:00Z', '', null, 20260101]) assert.equal(strictIsoDate(value), null)
  assert.equal(cryptoStatementCoverageEnd({ documents: [doc('2026-10-01', '2026-10-31')] }, { ...selection, today: 'invalid' }), null)
})
