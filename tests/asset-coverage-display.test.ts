import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { summarizeNetWorth } from '../lib/net-worth'
import { collectAssetCoverage } from '../lib/application/asset-coverage'
import { AssetCoverageNote } from '../components/AssetCoverageNote'

const summary = () => summarizeNetWorth({ stocksKrw: 100, cryptoKrw: 0, usdKrw: null, cash: [
  { institution: 'Example', account: 'Open', kind: 'bank', currency: 'KRW', asOfDate: '2026-07-10', balance: 50, derived: false },
  { institution: 'Example', account: 'Old zero', kind: 'bank', currency: 'KRW', asOfDate: '2024-01-01', balance: 0, derived: false },
] })
const readers = () => ({
  accounts: () => ({ rows: [
    { status: 'action_needed', statementPeriodEnd: '2026-06-30' },
    // Legacy lot/transaction cutoff is deliberately not a declared period end.
    { status: 'missing', statementCoveredThrough: '2026-11-11' },
  ] }),
  supplementary: () => ({ rows: [{ status: 'due_soon' }] }),
  checks: () => [{ status: 'fail' }, { status: 'pass' }],
  files: () => ({ summary: { fresh: 10, stale: 0, drift: 0, missing: 0 } }),
})

test('nonzero cash dates exclude zero history without changing rows or totals', () => {
  const s = summary()
  assert.equal(s.totalKrw, 150)
  assert.equal(s.cash.length, 2)
  assert.equal(s.asOfNotes.find(n => n.assetClass === 'cash')?.asOf, '2026-07-10')
  const review = collectAssetCoverage(s, readers())
  assert.deepEqual(review.cash, { oldest: '2026-07-10', newest: '2026-07-10', undated: 0, nonzero: 1, zero: 1 })
})

test('fresh files do not suppress missing evidence, supplementary due dates or failed checks', () => {
  const review = collectAssetCoverage(summary(), readers())
  assert.equal(review.accounts?.actionNeeded, 1)
  assert.equal(review.accounts?.missing, 1)
  assert.equal(review.supplementary?.dueSoon, 1)
  assert.equal(review.failedChecks, 1)
  assert.deepEqual(review.statementPeriods, { oldest: '2026-06-30', newest: '2026-06-30', undated: 1 })
  assert.equal(review.files?.fresh, 10)
})

test('empty or unreadable review sources remain unavailable independently', () => {
  const r = readers()
  r.accounts = () => { throw new Error('unreadable private source') }
  r.checks = () => []
  const result = collectAssetCoverage(summary(), r)
  assert.equal(result.accounts, null)
  assert.equal(result.statementPeriods, null)
  assert.equal(result.failedChecks, null)
  assert.equal(result.files?.fresh, 10)
  assert.equal(collectAssetCoverage(summary(), { ...readers(), accounts: () => ({ rows: [] }) }).accounts, null)
})

test('unknown cash dates remain explicit and zero-only history does not imply a current balance date', () => {
  const s = summary()
  s.cash[0].asOfDate = ''
  assert.equal(collectAssetCoverage(s, readers()).cash.undated, 1)
  s.cash[0].balance = 0
  assert.equal(collectAssetCoverage(s, readers()).cash.oldest, null)
})

test('both languages separate self totals from configured multi-owner review with read-only links', () => {
  const s = summary()
  s.coverage = { omittedAssetCount: 2, sourceCoverageConfirmed: false, liabilitiesSupported: false }
  for (const language of ['en', 'ko'] as const) {
    const markup = renderToStaticMarkup(React.createElement(AssetCoverageNote, { summary: s, language, review: collectAssetCoverage(s, readers()) }))
    assert.match(markup, /2026-07-10/)
    assert.match(markup, /2026-06-30/)
    for (const route of ['/health', '/accounts', '/data-ops', '/reconciliation']) assert.ok(markup.includes(`href="${route}"`))
    assert.doesNotMatch(markup, /<form|<button|100%|unreadable private source/)
    assert.match(markup, language === 'en' ? /may include other owners/ : /다른 소유자/)
    assert.match(markup, language === 'en' ? /2.*excluded/ : /2건/)
  }
})

test('actual read-only adapter preserves scoped totals and exposes date kinds without child dates or omitted values', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const { default: Database } = await import('better-sqlite3')
  const { config } = await import('../config')
  const root = mkdtempSync(path.join(tmpdir(), 'coverage-display-'))
  const previous = config.stockDbPath
  t.after(() => { config.stockDbPath = previous; rmSync(root, { recursive: true, force: true }) })
  const file = path.join(root, 'synthetic.db'), db = new Database(file)
  db.exec(`create table holdings_all (brokerage text, account text, owner text, market text, ticker text, account_wrapper text, asset_class text, base_market_value real, base_cost real, quantity real, as_of_date text, valuation_source text);
    insert into holdings_all values
    ('Example','self','self','KR','AAA','taxable','security',100,90,1,'2026-09-01','market'),
    ('Example','child','child:sample','KR','BBB','taxable','security',99999,90,1,'2020-01-01','market'),
    ('Example','self','self','KR','CONFLICT','taxable','security',200,90,1,'2026-10-01','snapshot'),
    ('Example','self','self','KR','CONFLICT','taxable','security',300,90,1,'2026-10-01','snapshot'),
    ('Example','self','self','KR','COST','taxable','security',null,40,1,null,'cost');
    create table cash_balances (institution text, account text, owner text, currency text, as_of_date text, balance real);
    insert into cash_balances values ('Example','open','self','KRW','2026-07-10',50),('Example','zero','self','KRW','2024-01-01',0);`)
  db.close()
  config.stockDbPath = file
  const { getNetWorth, getAssetCoverageReview } = await import('../lib/adapters/portfolio-db')
  const s = getNetWorth()
  assert.equal(s.totalKrw, 150)
  assert.equal(s.coverage?.omittedAssetCount, 2)
  assert.deepEqual(s.valuationDates?.market, { oldest: '2026-09-01', newest: '2026-09-01', undated: 0 })
  assert.equal(s.valuationDates?.snapshot?.oldest, null)
  assert.equal(s.asOfNotes.find(n => n.assetClass === 'cash')?.asOf, '2026-07-10')
  // A legacy/minimal database has no coverage/check tables: the page must still render uncertainty.
  const review = getAssetCoverageReview(s)
  assert.equal(review.accounts, null)
  assert.equal(review.failedChecks, null)
  assert.match(renderToStaticMarkup(React.createElement(AssetCoverageNote, { summary: s, language: 'en', review })), /Unavailable \/ unconfirmed/)
})

test('legacy KR as-of dates stay unconfirmed as declared periods, including transaction fallback and pinned overrides', async t => {
  const fs = await import('node:fs'), path = await import('node:path'), { tmpdir } = await import('node:os')
  const { default: Database } = await import('better-sqlite3'), { config } = await import('../config')
  const root = fs.mkdtempSync(path.join(tmpdir(), 'coverage-period-'))
  const oldDb = config.stockDbPath, oldDir = config.stockKrStatementsDir
  t.after(() => { config.stockDbPath = oldDb; config.stockKrStatementsDir = oldDir; fs.rmSync(root, { recursive: true, force: true }) })
  const file = path.join(root, 'synthetic.db'), db = new Database(file)
  db.exec(`create table source_files (name text, filename text);
    create table holdings (market text, brokerage text, account text, account_type text, as_of_date text, account_wrapper text);
    create table transactions (market text, brokerage text, account text, account_type text, date text, source_system text);
    create table tax_lots (market text, brokerage text, account text, account_type text, as_of_date text);
    create table validation_checks (name text, detail text, status text);
    insert into holdings values ('KR','Example','Synthetic','taxable','2026-10-01','taxable');`)
  db.close(); config.stockDbPath = file; config.stockKrStatementsDir = root
  const { getAccountCoverage } = await import('../lib/adapters/portfolio-db')
  // This file deliberately carries no declared-versus-inferred provenance.
  for (const asOf of ['2026-10-01', '2026-11-01']) {
    fs.writeFileSync(path.join(root, 'as-of.json'), JSON.stringify({ accounts: { Synthetic: asOf } }))
    const row = getAccountCoverage().rows[0]
    assert.equal(row.statementCoveredThrough, asOf)
    assert.equal(row.statementPeriodEnd, null)
  }
})
