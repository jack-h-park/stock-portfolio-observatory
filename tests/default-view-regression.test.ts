import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { GOLD, TAX_YEAR, writeScenario } from './pension-fixtures'

// The default (Stocks) view must not move by a single won when pension and gold
// inputs arrive. The same base fixture is ingested twice, from the same data
// directory so every path-bearing value is identical: once with only the stock
// account, once with the IRP, 삼성 pension-savings and 금현물 inputs added to
// the very same statement files, plus the snapshot CSV, evidence and map.
//
// Task 3's review left four leaks for this task to close, and each is pinned here:
//   (a) the gold account's open lots must not become a lot-derived KR stock holding;
//   (b) gold and pension INTEREST must not reach any stock income figure;
//   (c) DEPOSIT and TRUST_OUT must not show up as unmapped types;
//   (d) blank-ticker 삼성 rows must trip no lot or required-field check.

type Snapshot = Record<string, unknown>

function summarize(dbPath: string) {
  const db = new Database(dbPath, { readonly: true })
  const totals = {
    holdings: db.prepare('select count(*) as n, sum(base_cost) as cost, sum(base_market_value) as value from holdings').get(),
    tax_lots: db.prepare('select count(*) as n, sum(cost_basis_krw) as cost, sum(open_quantity) as qty from tax_lots').get(),
    realized_lots: db
      .prepare('select count(*) as n, sum(cost_basis_krw) as cost, sum(proceeds_krw) as proceeds, sum(realized_gl_krw) as gl from realized_lots')
      .get(),
    dividends: db.prepare('select count(*) as n, sum(amount_krw) as amount from dividends').get(),
    transactions: db.prepare('select count(*) as n, sum(amount_krw) as amount, sum(quantity) as qty from transactions').get(),
  }
  const snapshots = (db.prepare('select * from portfolio_snapshots order by snapshot_date').all() as Snapshot[]).map(
    ({ captured_at: _captured, id: _id, ...stock }) => stock
  )
  const meta = db.prepare(`select key, value from meta where key like '%realized%' or key like '%tax%' order by key`).all()
  const failingErrors = new Set(
    (db.prepare(`select name from validation_checks where status != 'pass' and severity = 'error'`).all() as { name: string }[]).map(
      (r) => r.name
    )
  )
  const check = (name: string) =>
    db.prepare('select status, detail from validation_checks where name = ?').get(name) as { status: string; detail: string } | undefined
  return { db, totals, snapshots, meta, failingErrors, check }
}

test('pension and gold inputs leave every Stocks-view figure exactly where it was', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'default-view-regression-'))

  const baseEnv = writeScenario(dir, { withPensions: false })
  const base = summarize(runIngest(dir, { env: { ...baseEnv, STOCK_DB_PATH: path.join(dir, 'base.db') }, allowFailure: true }))

  const fullEnv = writeScenario(dir, { withPensions: true })
  const full = summarize(runIngest(dir, { env: { ...fullEnv, STOCK_DB_PATH: path.join(dir, 'full.db') }, allowFailure: true }))

  // The base must hold something, or "unchanged" means nothing.
  const baseHoldings = base.totals.holdings as { n: number; value: number }
  assert.ok(baseHoldings.n > 0 && baseHoldings.value > 0, JSON.stringify(base.totals))
  assert.ok((base.totals.realized_lots as { n: number }).n > 0)
  assert.ok((base.totals.dividends as { n: number }).n > 0)
  assert.ok(base.snapshots.length > 0)
  // The realized-for-tax-year leak check only bites while the fixture's sales
  // fall in the tax year. The scenario pins that year in its tax-policy.json, so
  // this does not go quiet on 1 January 2027.
  const taxMeta = (run: typeof base) =>
    JSON.parse((run.meta as { key: string; value: string }[]).find((m) => m.key === 'us_ytd_realized_computed')!.value) as {
      taxYear: string
      lots: number
    }
  assert.equal(taxMeta(base).taxYear, TAX_YEAR)
  assert.ok(taxMeta(base).lots > 0, 'the base fixture must realize a lot in the pinned tax year')

  // And the second run must actually have taken the pension and gold rows in,
  // or the comparison is between two identical inputs.
  const stored = full.db.prepare(`select count(*) as n from transactions_all where account_wrapper in ('irp','pension_savings') or asset_class = 'gold'`).get() as { n: number }
  assert.equal(stored.n, 9)
  const pensionHoldings = full.db.prepare(`select count(*) as n from holdings_all where account_wrapper in ('irp','pension_savings')`).get() as { n: number }
  assert.ok(pensionHoldings.n > 0)

  assert.deepEqual(full.totals, base.totals)
  assert.deepEqual(full.snapshots, base.snapshots)
  assert.deepEqual(full.meta, base.meta)

  const newErrors = [...full.failingErrors].filter((name) => !base.failingErrors.has(name))
  assert.deepEqual(newErrors, [], `error checks that fail only with pensions: ${newErrors.join(', ')}`)

  // (a) The gold lots are stored, but no stock holding was summed from them.
  const goldLots = full.db.prepare(`select count(*) as n from tax_lots_all where account = ? and asset_class = 'gold'`).get(GOLD) as { n: number }
  assert.equal(goldLots.n, 1)
  const goldHoldings = full.db.prepare(`select count(*) as n from holdings_all where account = ? and source_system like 'korea_statement%'`).get(GOLD) as { n: number }
  assert.equal(goldHoldings.n, 0)
  // The gold holding itself comes from the purchases and the KRX price, stored in
  // holdings_all only; the identical totals and snapshots above prove it reached
  // no stock figure.
  const gold = full.db
    .prepare(`select quantity, base_cost, base_market_value, asset_class, valuation_source from holdings_all where account = ?`)
    .all(GOLD)
  assert.deepEqual(gold, [{ quantity: 10, base_cost: 1500000, base_market_value: 1600000, asset_class: 'gold', valuation_source: 'price' }])
  // (b) Gold and pension interest are stored and tagged, and out of the view.
  const income = full.db.prepare(`select account_wrapper, asset_class from dividends_all where account != '미래에셋증권(종합)' order by account`).all()
  assert.deepEqual(income, [
    { account_wrapper: 'taxable', asset_class: 'gold' },
    { account_wrapper: 'pension_savings', asset_class: 'security' },
  ])
  // (c) and (d)
  for (const name of [
    'transaction_types_mapped',
    'taxlots_required_fields',
    'holdings_required_fields',
    'transactions_required_fields',
    'reconcilable_holdings_vs_taxlots_quantity',
    'reconcilable_holdings_vs_taxlots_cost_basis',
    'dividend_rows_match_transactions',
  ]) {
    assert.equal(full.check(name)?.status, base.check(name)?.status, name)
  }
  assert.equal(full.check('transaction_types_mapped')?.status, 'pass', full.check('transaction_types_mapped')?.detail)
})
