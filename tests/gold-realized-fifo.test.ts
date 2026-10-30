import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { gainTotals, realizedRows } from '../lib/cli/tax-realized'
import { matchGoldLots } from '../scripts/gold-lots.mjs'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

// Invented figures throughout; the repository is public.

const near = (actual: number | null | undefined, expected: number, message?: string) =>
  assert.ok(actual != null && Math.abs(actual - expected) < 1e-6, `${message ?? 'value'}: ${actual} is not ${expected}`)

test('a sale takes grams from the oldest purchase first and splits its proceeds by grams', () => {
  const { realized, open, oversold } = matchGoldLots([
    { date: '2025-03-03', type: 'BUY', grams: 5, amountKrw: 500_000, feeKrw: 825 },
    { date: '2026-01-15', type: 'BUY', grams: 10, amountKrw: 1_500_000 },
    { date: '2026-09-01', type: 'SELL', grams: 12, amountKrw: 2_040_000, feeKrw: 3_366 },
  ])
  assert.equal(oversold, 0)
  assert.equal(realized.length, 2)
  const [old, recent] = realized
  assert.equal(old.acquiredDate, '2025-03-03')
  assert.equal(old.grams, 5)
  near(old.costKrw, 500_825, 'the purchase commission is in the cost')
  near(old.proceedsKrw, (2_040_000 - 3_366) * (5 / 12), 'the sale commission is netted from the proceeds')
  assert.equal(old.term, 'Long-term')
  assert.equal(recent.acquiredDate, '2026-01-15')
  near(recent.costKrw, 1_050_000, '7 of 10 grams')
  assert.equal(recent.term, 'Short-term')
  assert.deepEqual(open, [{ acquiredDate: '2026-01-15', grams: 3, costKrw: 450_000 }].map((lot) => ({ ...lot, costKrw: lot.costKrw })))
})

test('a year and a day is long-term, a year exactly is not; same-day purchases are matched before the sale', () => {
  const { realized } = matchGoldLots([
    { date: '2026-06-01', type: 'SELL', grams: 2, amountKrw: 400_000 },
    { date: '2025-06-01', type: 'BUY', grams: 1, amountKrw: 100_000 },
    { date: '2025-05-31', type: 'BUY', grams: 1, amountKrw: 100_000 },
    { date: '2026-06-01', type: 'BUY', grams: 1, amountKrw: 200_000 },
  ])
  assert.deepEqual(realized.map((lot) => [lot.acquiredDate, lot.holdingDays, lot.term]), [
    ['2025-05-31', 366, 'Long-term'],
    ['2025-06-01', 365, 'Short-term'],
  ])
})

test('grams sold with no purchase on file are reported, not invented', () => {
  const { realized, oversold } = matchGoldLots([
    { date: '2026-01-01', type: 'BUY', grams: 1, amountKrw: 100_000 },
    { date: '2026-02-01', type: 'SELL', grams: 3, amountKrw: 600_000 },
  ])
  assert.equal(realized.length, 1)
  assert.equal(oversold, 2)
})

const TRANSACTION_COLUMNS = [
  'Date', 'Account', 'Type', 'Raw Type', 'Ticker', 'Name', 'Quantity',
  'Currency', 'Native Amount', 'FX Rate',
  'Amount (KRW)', 'Settlement (KRW)', 'Unit Price', 'Fee', 'Tax', 'Balance',
  'Source', 'Page',
]
const tsv = (columns: string[], rows: Record<string, string | number>[]) =>
  [columns.join('\t'), ...rows.map((r) => columns.map((c) => String(r[c] ?? '')).join('\t'))].join('\n') + '\n'

const GOLD = '미래에셋증권(금현물)'
const SOURCE = 'mirae-gold-transactions-20230101-20261027.pdf'
const txn = (row: Record<string, string | number>) => ({
  Account: GOLD, Ticker: 'M04020000', Name: 'Gold 99.99 1Kg', Currency: 'KRW', 'FX Rate': 1, Fee: 0, Tax: 0, Balance: 0, Source: SOURCE, Page: 1, ...row,
})

function ingestGold() {
  const dir = mkdtempSync(path.join(tmpdir(), 'gold-fifo-'))
  writeSheetPayloads(dir)
  const kr = path.join(dir, 'kr-statements')
  mkdirSync(kr, { recursive: true })
  writeFileSync(
    path.join(kr, 'transactions.tsv'),
    tsv(TRANSACTION_COLUMNS, [
      txn({ Date: '2025-03-03', Type: 'BUY', 'Raw Type': '금현물매수입고', Quantity: 5, 'Native Amount': 500_000, 'Amount (KRW)': 500_000, 'Unit Price': 100_000, Fee: 750, Tax: 75 }),
      txn({ Date: '2026-01-15', Type: 'BUY', 'Raw Type': '금현물매수입고', Quantity: 10, 'Native Amount': 1_500_000, 'Amount (KRW)': 1_500_000, 'Unit Price': 150_000 }),
      txn({ Date: '2026-09-01', Type: 'SELL', 'Raw Type': '금현물매도출고', Quantity: 12, 'Native Amount': 2_040_000, 'Amount (KRW)': 2_040_000, 'Unit Price': 170_000, Fee: 3_060, Tax: 306 }),
    ]),
    'utf8'
  )
  const fxPath = path.join(dir, 'historical-fx-rates.json')
  writeFileSync(
    fxPath,
    JSON.stringify({ rates: [{ price_date: '2025-03-03', rate: 1400 }, { price_date: '2026-01-15', rate: 1450 }, { price_date: '2026-09-01', rate: 1500 }].map((r) => ({ ...r, source: 'test' })) }),
    'utf8'
  )
  const policyPath = path.join(dir, 'tax-policy.json')
  writeFileSync(policyPath, JSON.stringify({ jurisdictions: [{ code: 'US', manualAssumptions: { taxInputYear: 2026 } }] }), 'utf8')
  const dbPath = runIngest(dir, {
    env: { STOCK_KR_STATEMENTS_DIR: kr, STOCK_HISTORICAL_FX_RATES_PATH: fxPath, STOCK_TAX_POLICY_PATH: policyPath },
    allowFailure: true,
  })
  return new Database(dbPath, { readonly: true })
}

test('the ingest writes one gold realized row per purchase lot, in won and in dollars, outside the stock view', () => {
  const db = ingestGold()
  const rows = db
    .prepare(
      `select acquired_date, sold_date, quantity_sold, cost_basis_krw, proceeds_krw, realized_gl_krw, holding_days, tax_term,
              acquisition_cost_usd, proceeds_usd, realized_gl_usd, tax_year, asset_class
         from realized_lots_all where asset_class = 'gold' order by acquired_date`
    )
    .all() as Record<string, any>[]
  assert.equal(rows.length, 2)
  const [old, recent] = rows
  const oldProceeds = (2_040_000 - 3_366) * (5 / 12)
  near(old.cost_basis_krw, 500_825)
  near(old.proceeds_krw, oldProceeds)
  near(old.realized_gl_krw, oldProceeds - 500_825)
  assert.equal(old.tax_term, 'Long-term')
  assert.equal(old.tax_year, '2026')
  // Dollar cost at the purchase-date rate, proceeds at the sale-date rate.
  near(old.acquisition_cost_usd, 500_825 / 1400)
  near(old.proceeds_usd, oldProceeds / 1500)
  near(old.realized_gl_usd, oldProceeds / 1500 - 500_825 / 1400)
  const recentProceeds = (2_040_000 - 3_366) * (7 / 12)
  near(recent.acquisition_cost_usd, 1_050_000 / 1450)
  near(recent.realized_gl_usd, recentProceeds / 1500 - 1_050_000 / 1450)
  assert.equal(recent.tax_term, 'Short-term')

  // The stock view never sees gold, and the remaining 3 g is held at its FIFO cost.
  assert.equal((db.prepare("select count(*) as n from realized_lots where ticker = 'M04020000'").get() as { n: number }).n, 0)
  const holding = db.prepare("select quantity, base_cost from holdings_all where asset_class = 'gold'").get() as { quantity: number; base_cost: number }
  assert.equal(holding.quantity, 3)
  near(holding.base_cost, 450_000)
  const check = db.prepare("select status from validation_checks where name = 'gold_sales_matched'").get() as { status: string }
  assert.equal(check.status, 'pass')
})

function cliDb() {
  const db = new Database(':memory:')
  db.exec(`
    create table realized_lots_all (
      id integer primary key, market text, account text, brokerage text, ticker text, sold_date text, acquired_date text,
      quantity_sold real, native_proceeds real, native_realized_gl real, tax_term text, basis text, superseded_by text,
      owner text default 'self', asset_class text default 'security',
      acquisition_cost_usd real, proceeds_usd real, realized_gl_usd real
    );
    create view realized_lots as select * from realized_lots_all where asset_class = 'security';
    insert into realized_lots_all (market, account, brokerage, ticker, sold_date, quantity_sold, native_proceeds, native_realized_gl, tax_term, basis)
      values ('US', 'Example Taxable', 'Example', 'AAA', '2026-09-02', 3, 1000, 250, 'Long-term', 'replay');
    insert into realized_lots_all (market, account, brokerage, ticker, sold_date, acquired_date, quantity_sold, tax_term, basis, asset_class, acquisition_cost_usd, proceeds_usd, realized_gl_usd)
      values ('KR', '미래에셋증권(금현물)', '미래에셋증권', 'M04020000', '2026-09-01', '2025-03-03', 5, 'Long-term', 'replay', 'gold', 357.73, 565.73, 208);
    insert into realized_lots_all (market, account, brokerage, ticker, sold_date, acquired_date, quantity_sold, tax_term, basis, asset_class, acquisition_cost_usd, proceeds_usd, realized_gl_usd)
      values ('KR', '미래에셋증권(금현물)', '미래에셋증권', 'M04020000', '2026-09-01', '2026-01-15', 7, 'Short-term', 'replay', 'gold', 724.14, 792.02, 67.88);
  `)
  return db
}

test('tax:realized leaves gold out by default and lists it as a collectible with --include-gold', () => {
  const db = cliDb()
  assert.deepEqual(realizedRows(db, '2026-01-01', '2026-12-31').map((row) => row.ticker), ['AAA'])

  const rows = realizedRows(db, '2026-01-01', '2026-12-31', true)
  assert.deepEqual(rows.map((row) => [row.soldDate, row.kind, row.collectible]), [
    ['2026-09-01', 'gold', true],
    ['2026-09-01', 'gold', true],
    ['2026-09-02', 'security', false],
  ])
  const longGold = rows[0]
  assert.equal(longGold.proceedsUsd, 565.73)
  assert.equal(longGold.costUsd, 357.73)
  assert.equal(longGold.gainUsd, 208)
  assert.equal(longGold.term, 'long')

  assert.deepEqual(gainTotals(rows), {
    shortTermUsd: 0,
    longTermUsd: 250,
    collectibleShortTermUsd: 67.88,
    collectibleLongTermUsd: 208,
    unclassifiedUsd: 0,
  })
})
