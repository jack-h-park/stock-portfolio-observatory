import assert from 'node:assert/strict'
import test from 'node:test'
import { isSupplementarySource, periodEndFromSource } from '../lib/supplementary'

test('a filed statement reaches the last date in its name', () => {
  assert.equal(periodEndFromSource('mirae-gold-transactions-20230101-20261010.pdf'), '2026-10-10')
  assert.equal(periodEndFromSource('tossbank-0000-20220725-20261010.xlsx'), '2026-10-10')
  assert.equal(periodEndFromSource(' example-cma-20260105-20260811.csv'), '2026-08-11')
  assert.equal(periodEndFromSource('bank-balances.json'), null)
  assert.equal(periodEndFromSource(null), null)
})

test('supplementary freshness items are told apart from stock ones', () => {
  for (const key of ['source:bank_balances', 'source:pension_evidence', 'source:gold_prices', 'source:pension:irp-holdings-20260101.csv']) {
    assert.equal(isSupplementarySource(key), true, key)
  }
  for (const key of ['source:kr_holdings', 'kr_prices', 'source:robinhood_snapshot']) assert.equal(isSupplementarySource(key), false, key)
})
