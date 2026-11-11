import assert from 'node:assert/strict'
import test from 'node:test'
import { displayAccount, displayAccountKey, looksLikeAccountId, maskAccountLabel, maskAccountsIn } from '../lib/account-label'

// Every identifier below is invented.

test('a full account identifier is cut to its last four characters', () => {
  assert.equal(maskAccountLabel('Brokerage ABC-12345'), 'Brokerage …2345')
  assert.equal(maskAccountLabel('Example Securities 123-45-678901'), 'Example Securities …8901')
  assert.equal(maskAccountLabel('U9876543'), '…6543')
  assert.equal(maskAccountLabel('Broker 12345678 (taxable)'), 'Broker …5678 (taxable)')
  assert.equal(maskAccountLabel('AB12CD34EF'), '…34EF')
  assert.equal(maskAccountLabel('123456'), '…3456')
})

test('several identifiers in one label are each masked', () => {
  assert.equal(maskAccountLabel('Bank 111-222-3333 / Card 9999-8888-7777'), 'Bank …3333 / Card …7777')
})

test('short suffixes and plain names are left as they are', () => {
  for (const label of [
    'Brokerage ... 1234',
    'Brokerage ...1234',
    'Robinhood 1234',
    'Brokerage …1234',
    'Roth IRA',
    'Individual',
    'ISA-01',
    'acct-1',
    'Joint Brokerage Account',
    'Crypto wallet',
    'BrokerA',
  ]) {
    assert.equal(maskAccountLabel(label), label, label)
  }
})

test('years and dates are not identifiers', () => {
  for (const label of ['Pension2025', 'Plan 2024-2025', 'Opened 2026-01-15', 'Since 2026-03', 'Account 2024']) {
    assert.equal(maskAccountLabel(label), label, label)
  }
  assert.equal(looksLikeAccountId('2026-01-15'), false)
  assert.equal(looksLikeAccountId('20260115'), true, 'a bare 8-digit run is treated as an identifier')
})

test('Korean labels are untouched, and an identifier beside Korean text is still masked', () => {
  assert.equal(maskAccountLabel('연금저축'), '연금저축')
  assert.equal(maskAccountLabel('예시증권 종합'), '예시증권 종합')
  assert.equal(maskAccountLabel('예시증권 1234'), '예시증권 1234')
  assert.equal(maskAccountLabel('예시증권 123-45-67890'), '예시증권 …7890')
  assert.equal(maskAccountLabel('예시증권123456789'), '예시증권…6789')
})

test('masking is idempotent', () => {
  for (const label of ['Brokerage ABC-12345', 'Example 123-45-678901', 'U9876543', 'Robinhood 1234', '예시증권 123-45-67890']) {
    const once = maskAccountLabel(label)
    assert.equal(maskAccountLabel(once), once, label)
  }
})

test('empty input reads as empty', () => {
  assert.equal(maskAccountLabel(''), '')
  assert.equal(maskAccountLabel(null), '')
  assert.equal(maskAccountLabel(undefined), '')
})

test('displayAccount joins brokerage and account, masked', () => {
  assert.equal(displayAccount('Broker', 'Broker ABC-12345'), 'Broker · Broker …2345')
  assert.equal(displayAccount(null, 'XY-9876543'), '…6543')
  assert.equal(displayAccount('', 'Roth IRA'), 'Roth IRA')
  assert.equal(displayAccount('Broker', ''), '')
})

test('displayAccountKey splits brokerage::account', () => {
  assert.equal(displayAccountKey('Broker::ABC-12345'), 'Broker · …2345')
  assert.equal(displayAccountKey('::ABC-12345'), '…2345')
  assert.equal(displayAccountKey('Robinhood 1234'), 'Robinhood 1234')
})

test('maskAccountsIn replaces only the given raw account values', () => {
  const message = 'Broker ABC-12345: data is more than 30 days old (005930 held)'
  assert.equal(maskAccountsIn(message, ['Broker ABC-12345']), 'Broker …2345: data is more than 30 days old (005930 held)')
  assert.equal(maskAccountsIn(message, [undefined, null, '']), message)
  assert.equal(maskAccountsIn('Robinhood 1234 needs cash', ['Robinhood 1234']), 'Robinhood 1234 needs cash')
})
