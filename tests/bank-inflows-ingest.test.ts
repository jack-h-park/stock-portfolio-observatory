import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

function inflow(institution: string, account: string, currency: string, date: string, amount: number, description: string, ownTransfer = false) {
  return { institution, account, currency, date, amount, description, counterparty: '', ownTransfer }
}

const BANK = {
  accounts: [], estimatedAccounts: [], findings: [], notes: [],
  inflows: [
    inflow('mg', '새마을금고 자립예탁금', 'KRW', '2025-03-25', 3000000, '급여'),
    inflow('mg', '새마을금고 자립예탁금', 'KRW', '2025-03-26', 500000, '예적금만기 자동이체', true),
    inflow('chase', 'Chase checking', 'USD', '2025-03-14', 2500, 'EXAMPLE CO PAYROLL'),
    inflow('chase', 'Chase checking', 'USD', '2025-03-20', 400, 'TRANSFER FROM BROKERAGE'),
    inflow('tossbank', '토스뱅크', 'KRW', '2025-03-31', 1200, '이자 지급'),
    inflow('fidelity', 'Fidelity CMA', 'USD', '2025-04-03', 12.34, 'DIVIDEND RECEIVED'),
  ],
}
const MAPPINGS = {
  version: 1, incomeRules: [], dividendOverrides: [],
  bankInflowRules: [
    { id: 'salary-kr', match: { institution: 'mg', descriptionIncludes: '급여' }, category: 'salary' },
    { id: 'salary-us', match: { institution: 'chase', descriptionIncludes: 'PAYROLL' }, category: 'salary' },
  ],
}

function ingestBank(bank: unknown, mappings: unknown) {
  const dir = mkdtempSync(path.join(tmpdir(), 'bank-inflows-'))
  writeSheetPayloads(dir)
  writeFileSync(path.join(dir, 'bank-balances.json'), JSON.stringify(bank))
  writeFileSync(path.join(dir, 'manual-mappings.json'), JSON.stringify(mappings))
  return new Database(runIngest(dir, {
    allowFailure: true,
    env: {
      STOCK_BANK_BALANCES_PATH: path.join(dir, 'bank-balances.json'),
      STOCK_MANUAL_MAPPINGS_PATH: path.join(dir, 'manual-mappings.json'),
    },
  }), { readonly: true })
}

const checkOf = (db: Database.Database, name: string) =>
  db.prepare('select status, severity, detail from validation_checks where name = ?').get(name) as any

test('bank inflows are classified: rules, own transfers, dividends, interest, and the rest unclassified', () => {
  const db = ingestBank(BANK, MAPPINGS)
  const rows = db.prepare('select description, category, rule, usd_krw_rate from bank_inflows order by date, description').all() as any[]
  assert.deepEqual(rows.map((r) => [r.description, r.category]), [
    ['EXAMPLE CO PAYROLL', 'salary'],
    ['TRANSFER FROM BROKERAGE', 'unclassified'],
    ['급여', 'salary'],
    ['예적금만기 자동이체', 'transfer'],
    ['이자 지급', 'interest'],
    ['DIVIDEND RECEIVED', 'dividend'],
  ])
  assert.equal(rows[0].rule, 'salary-us')
  assert.equal(rows[2].rule, 'salary-kr')
  const check = checkOf(db, 'bank_inflows_classified')
  assert.equal(check.status, 'fail')
  assert.equal(check.severity, 'warning')
  assert.match(check.detail, /1 .*USD 400\.00/)
  assert.doesNotMatch(check.detail, /BROKERAGE/)
})

test('a rule with a category outside the allowed set is skipped and reported', () => {
  const db = ingestBank(BANK, {
    ...MAPPINGS,
    bankInflowRules: [{ id: 'bad', match: { institution: 'mg', descriptionIncludes: '급여' }, category: 'bonus' }, ...MAPPINGS.bankInflowRules],
  })
  const row = db.prepare("select category, rule from bank_inflows where description = '급여'").get() as any
  assert.equal(row.category, 'salary')
  assert.equal(row.rule, 'salary-kr')
  const check = checkOf(db, 'bank_inflow_rules_valid')
  assert.equal(check.status, 'fail')
  assert.equal(check.severity, 'warning')
  assert.match(check.detail, /bad/)
})

test('malformed inflow entries are dropped and reported', () => {
  const db = ingestBank(
    { ...BANK, inflows: [inflow('mg', 'a', 'EUR', '2025-01-01', 5, 'x'), inflow('mg', 'a', 'KRW', '2025-01-01', -5, 'x'), inflow('mg', 'a', 'KRW', '2025-01-01', 5, 'ok')] },
    MAPPINGS,
  )
  assert.equal((db.prepare('select count(*) n from bank_inflows').get() as any).n, 1)
  assert.equal(checkOf(db, 'cash_balances_readable').status, 'fail')
})

test('a rule with no usable match is skipped, never a catch-all', () => {
  for (const bad of [{ id: 'empty', match: {}, category: 'other' }, { id: 'typo', match: { descriptionInclude: '급여' }, category: 'other' }, { id: 'nomatch', category: 'other' }, { id: 'blank', match: { descriptionIncludes: '  ' }, category: 'other' }]) {
    const db = ingestBank(BANK, { ...MAPPINGS, bankInflowRules: [bad] })
    const row = db.prepare("select category, rule from bank_inflows where description = '급여'").get() as any
    assert.equal(row.category, 'unclassified', bad.id)
    assert.equal(row.rule, null)
    const check = checkOf(db, 'bank_inflow_rules_valid')
    assert.equal(check.status, 'fail')
    assert.equal(check.severity, 'warning')
    assert.match(check.detail, new RegExp(bad.id))
    assert.doesNotMatch(check.detail, /급여/)
  }
})

test('unclassified sums keep USD cents', () => {
  const bank = { ...BANK, inflows: [inflow('chase', 'Chase checking', 'USD', '2025-03-20', 12.34, 'MYSTERY')] }
  const db = ingestBank(bank, MAPPINGS)
  assert.match(checkOf(db, 'bank_inflows_classified').detail, /USD 12\.34/)
})

test('a rule with an unknown match key next to a valid one is rejected whole', () => {
  const db = ingestBank(BANK, {
    ...MAPPINGS,
    bankInflowRules: [{ id: 'half', match: { institution: 'mg', descriptionInclude: '급여' }, category: 'other' }],
  })
  const rows = db.prepare("select category, rule from bank_inflows where institution = 'mg'").all() as any[]
  assert.ok(rows.every((r) => r.rule === null))
  const check = checkOf(db, 'bank_inflow_rules_valid')
  assert.equal(check.status, 'fail')
  assert.match(check.detail, /half/)
  assert.doesNotMatch(check.detail, /급여/)
})

test('the interest default reads memos, not sender names', () => {
  const names = ['이자영', '이자영 안녕', '김이자']
  const memos = ['이자', '이자입금', '예금이자', '결산이자', '이자 지급', 'INTEREST PAYMENT', '자동 이자', '이자(모으기통장)', '예금이자(세후)', '적금이자', '보통예금이자']
  const bank = {
    ...BANK,
    inflows: [
      ...names.map((n, i) => inflow('tossbank', '토스뱅크', 'KRW', `2025-05-0${i + 1}`, 1000, n)),
      ...memos.map((n, i) => inflow('tossbank', '토스뱅크', 'KRW', `2025-06-0${i + 1}`, 1000, n)),
    ],
  }
  const db = ingestBank(bank, { ...MAPPINGS, bankInflowRules: [] })
  const cat = (d: string) => (db.prepare('select category from bank_inflows where description = ?').get(d) as any).category
  for (const n of names) assert.equal(cat(n), 'unclassified', n)
  for (const m of memos) assert.equal(cat(m), 'interest', m)
})

test('a rule can be limited to a date range and an amount range', () => {
  const bank = {
    ...BANK,
    inflows: [
      inflow('tossbank', '토스뱅크', 'KRW', '2025-09-19', 100000, '보낸사람A'),
      inflow('tossbank', '토스뱅크', 'KRW', '2025-09-30', 50000, '보낸사람B'),
      inflow('tossbank', '토스뱅크', 'KRW', '2025-10-01', 100000, '보낸사람A'),
      inflow('tossbank', '토스뱅크', 'KRW', '2025-09-20', 900000, '보낸사람C'),
      inflow('mg', '새마을금고', 'KRW', '2025-07-01', 1, '토스038'),
      inflow('mg', '새마을금고', 'KRW', '2025-07-02', 2, '토스039'),
    ],
  }
  const db = ingestBank(bank, { ...MAPPINGS, bankInflowRules: [
    { id: 'event-window', match: { institution: 'tossbank', dateFrom: '2025-09-18', dateTo: '2025-09-30', amountMax: 300000 }, category: 'other' },
    { id: 'one-won', match: { institution: 'mg', amountMax: 1 }, category: 'transfer' },
  ] })
  const rows = db.prepare('select date, description, category, rule from bank_inflows order by date, description').all() as any[]
  assert.deepEqual(rows.map((r) => [r.date, r.description, r.category]), [
    ['2025-07-01', '토스038', 'transfer'],
    ['2025-07-02', '토스039', 'unclassified'],
    ['2025-09-19', '보낸사람A', 'other'],
    ['2025-09-20', '보낸사람C', 'unclassified'],
    ['2025-09-30', '보낸사람B', 'other'],
    ['2025-10-01', '보낸사람A', 'unclassified'],
  ])
  assert.equal(checkOf(db, 'bank_inflow_rules_valid').status, 'pass')
})

test('a date or amount bound alone is not enough, and a malformed bound rejects the rule', () => {
  const bank = { ...BANK, inflows: [inflow('mg', '새마을금고', 'KRW', '2025-07-01', 1, '토스038')] }
  const db = ingestBank(bank, { ...MAPPINGS, bankInflowRules: [
    { id: 'bounds-only', match: { amountMax: 1 }, category: 'transfer' },
    { id: 'bad-date', match: { institution: 'mg', dateFrom: '2025/07/01' }, category: 'transfer' },
    { id: 'bad-amount', match: { institution: 'mg', amountMax: '1' }, category: 'transfer' },
    { id: 'reversed', match: { institution: 'mg', dateFrom: '2025-08-01', dateTo: '2025-07-01' }, category: 'transfer' },
  ] })
  assert.equal((db.prepare('select category from bank_inflows').get() as any).category, 'unclassified')
  const check = checkOf(db, 'bank_inflow_rules_valid')
  assert.equal(check.status, 'fail')
  assert.match(check.detail, /^4 rule\(s\) skipped/)
  for (const id of ['bounds-only', 'bad-date', 'bad-amount']) assert.match(check.detail, new RegExp(id))
})

test('an Amex-shaped interest credit is interest by default and an incentive credit waits for a rule', () => {
  const db = ingestBank(
    {
      accounts: [], estimatedAccounts: [], findings: [], notes: [],
      inflows: [
        inflow('amex', 'Example Amex checking', 'USD', '2025-03-31', 1.12, 'Interest Deposit'),
        inflow('amex', 'Example Amex checking', 'USD', '2025-04-15', 300, 'Customer Incentive Payment'),
      ],
    },
    { ...MAPPINGS, bankInflowRules: [] },
  )
  const rows = db.prepare('select description, category from bank_inflows order by date').all() as any[]
  assert.deepEqual(rows.map((r) => [r.description, r.category]), [
    ['Interest Deposit', 'interest'],
    ['Customer Incentive Payment', 'unclassified'],
  ])
})
