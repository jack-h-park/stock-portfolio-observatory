import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { groupAccountRanges, summarizeAccountRanges, type RangeRow } from '@/lib/account-ranges'

function row(partial: Partial<RangeRow> & Pick<RangeRow, 'kind' | 'account'>): RangeRow {
  return {
    market: 'US',
    brokerage: 'Robinhood',
    accountType: null,
    start: '2026-01-01',
    end: '2026-01-31',
    count: 1,
    ...partial,
  }
}

// Robinhood's snapshot names an account by its number ("Robinhood 1234") while
// its transaction CSVs name the same account by its type ("Robinhood Mid-term").
// Listed as two accounts, the one with transactions shows no holdings and the
// one with holdings shows no transactions, and neither is true.
test('a type-named account folds into the one numbered account of that type', () => {
  const accounts = groupAccountRanges([
    row({ kind: 'holdings', account: 'Robinhood 1234', accountType: 'Mid-term', start: '2026-05-01', end: '2026-05-01', count: 12 }),
    row({ kind: 'lots', account: 'Robinhood 1234', accountType: 'Mid-term', start: '2024-03-01', end: '2026-05-01', count: 80 }),
    row({ kind: 'transactions', account: 'Robinhood Mid-term', accountType: 'Mid-term', start: '2024-02-15', end: '2026-04-30', count: 300 }),
    row({ kind: 'realized', account: 'Robinhood Mid-term', start: '2025-06-02', end: '2025-06-03', count: 7 }),
  ])
  assert.equal(accounts.length, 1)
  const [account] = accounts
  assert.equal(account.name, 'Robinhood Mid-term')
  assert.deepEqual(account.aliases, ['Robinhood 1234'])
  assert.equal(account.accountType, 'Mid-term')
  assert.equal(account.ranges.transactions?.count, 300)
  assert.equal(account.ranges.holdings?.end, '2026-05-01')
  assert.equal(account.ranges.lots?.start, '2024-03-01')
  assert.equal(account.ranges.realized?.count, 7)
  assert.equal(account.firstDate, '2024-02-15')
  assert.equal(account.lastDate, '2026-05-01')
})

// Two numbered accounts of the same type cannot be told apart by the type-named
// one, so folding it into either would put one account's history under another.
test('a type-named account stays separate when two numbered accounts share the type', () => {
  const accounts = groupAccountRanges([
    row({ kind: 'holdings', account: 'Robinhood 1111', accountType: 'Individual' }),
    row({ kind: 'holdings', account: 'Robinhood 2222', accountType: 'Individual' }),
    row({ kind: 'transactions', account: 'Robinhood Individual', accountType: 'Individual' }),
  ])
  assert.deepEqual(accounts.map((a) => a.name).sort(), ['Robinhood 1111', 'Robinhood 2222', 'Robinhood Individual'])
})

// The same type in a different market is a different account: Robinhood's
// crypto account is not its equity account.
test('accounts never merge across markets or brokerages', () => {
  const accounts = groupAccountRanges([
    row({ kind: 'transactions', market: 'CRYPTO', account: 'Robinhood Crypto', accountType: 'Crypto' }),
    row({ kind: 'holdings', market: 'US', account: 'Robinhood 9999', accountType: 'Crypto' }),
    row({ kind: 'transactions', brokerage: 'Chase', account: 'Chase Brokerage', accountType: 'Brokerage' }),
    row({ kind: 'transactions', brokerage: 'Merrill', account: 'Merrill CMA', accountType: 'Brokerage' }),
  ])
  assert.equal(accounts.length, 4)
})

// realized_lots has no account_type column, and Merrill's holdings leave it
// blank. The type comes from whichever table recorded one.
test('the account type is taken from any table that records it', () => {
  const [account] = groupAccountRanges([
    row({ kind: 'holdings', brokerage: 'Merrill', account: 'Merrill CMA', accountType: '' }),
    row({ kind: 'transactions', brokerage: 'Merrill', account: 'Merrill CMA', accountType: 'Brokerage' }),
  ])
  assert.equal(account.accountType, 'Brokerage')
})

test('accounts sort KR, US, CRYPTO, then by brokerage and name', () => {
  const accounts = groupAccountRanges([
    row({ kind: 'transactions', market: 'CRYPTO', brokerage: 'Bithumb', account: 'Bithumb' }),
    row({ kind: 'transactions', market: 'US', brokerage: 'Fidelity', account: 'Fidelity Account' }),
    row({ kind: 'transactions', market: 'US', brokerage: 'Chase', account: 'Chase Brokerage' }),
    row({ kind: 'transactions', market: 'KR', brokerage: '토스증권', account: '토스증권' }),
    row({ kind: 'transactions', market: 'KR', brokerage: '미래에셋증권', account: '미래에셋증권(종합)' }),
    row({ kind: 'transactions', market: 'KR', brokerage: '미래에셋증권', account: '미래에셋증권(ISA)' }),
  ])
  assert.deepEqual(
    accounts.map((a) => a.name),
    ['미래에셋증권(ISA)', '미래에셋증권(종합)', '토스증권', 'Chase Brokerage', 'Fidelity Account', 'Bithumb']
  )
})

test('the summary counts accounts per market and spans every range', () => {
  const summary = summarizeAccountRanges(
    groupAccountRanges([
      row({ kind: 'transactions', market: 'KR', brokerage: '미래에셋증권', account: 'A', start: '2019-03-04', end: '2026-02-27' }),
      row({ kind: 'holdings', market: 'US', brokerage: 'Chase', account: 'B', start: '2026-03-02', end: '2026-03-02' }),
      row({ kind: 'transactions', market: 'US', brokerage: 'Fidelity', account: 'C', start: null, end: null, count: 0 }),
    ])
  )
  assert.equal(summary.total, 3)
  assert.deepEqual(summary.byMarket, { KR: 1, US: 2 })
  assert.equal(summary.firstDate, '2019-03-04')
  assert.equal(summary.lastDate, '2026-03-02')
})

test('cash balance spans are their own kind and do not merge with securities rows', () => {
  const rows = [
    { kind: 'balances' as const, market: 'CASH', brokerage: 'chase', account: 'Chase checking', accountType: 'checking', start: '2026-07-01', end: '2026-10-01', count: 40 },
  ]
  const [account] = groupAccountRanges(rows)
  assert.equal(account.ranges.balances?.count, 40)
  assert.equal(account.market, 'CASH')
})
