import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

// The orders bridge closes statement lots FIFO for every sale after the newest
// 거래내역서, and it used to leave each fully consumed lot behind at quantity 0.
// The ingest's own checks skip those, but /health's holdings ↔ tax lots query
// does not: a position sold in full after the statement has a lot row and no
// holding, which it counts as a lot-only break. Five of the six Toss breaks
// /health showed were exactly that — positions sold in full on the API side and
// correctly closed by the bridge.

const TRANSACTION_COLUMNS = [
  'Date', 'Account', 'Type', 'Raw Type', 'Ticker', 'Name', 'Quantity',
  'Currency', 'Native Amount', 'FX Rate',
  'Amount (KRW)', 'Settlement (KRW)', 'Unit Price', 'Fee', 'Tax', 'Balance',
  'Source', 'Page',
]
const TAXLOT_COLUMNS = [
  'Account', 'Ticker', 'Name', 'Acquired Date', 'Open Quantity',
  'Currency', 'Native Cost Basis', 'Native Unit Cost',
  'Cost Basis (KRW)', 'Unit Cost', 'Holding Days', 'As Of Date', 'Tax Term', 'Source',
]

function tsv(columns: string[], rows: Record<string, string | number>[]) {
  return [columns.join('\t'), ...rows.map((r) => columns.map((c) => String(r[c] ?? '')).join('\t'))].join('\n') + '\n'
}

const ACCOUNT = '토스증권'
const SOURCE = 'toss-transactions-20260801.pdf'

function buy(ticker: string, date: string, quantity: number, unit: number) {
  return {
    Date: date, Account: ACCOUNT, Type: 'BUY', 'Raw Type': '구매', Ticker: ticker, Name: ticker,
    Quantity: quantity, Currency: 'KRW', 'Native Amount': quantity * unit, 'Amount (KRW)': quantity * unit,
    'Settlement (KRW)': -quantity * unit, 'Unit Price': unit, Fee: 0, Tax: 0, Balance: quantity,
    Source: SOURCE, Page: 1,
  }
}

function lot(ticker: string, date: string, quantity: number, unit: number) {
  return {
    Account: ACCOUNT, Ticker: ticker, Name: ticker, 'Acquired Date': date, 'Open Quantity': quantity,
    Currency: 'KRW', 'Native Cost Basis': quantity * unit, 'Native Unit Cost': unit,
    'Cost Basis (KRW)': quantity * unit, 'Unit Cost': unit, 'Holding Days': 30,
    'As Of Date': '2026-07-31', 'Tax Term': 'Short-term', Source: SOURCE,
  }
}

function sell(symbol: string, date: string, quantity: number, price: number) {
  return {
    symbol, side: 'SELL', status: 'FILLED', orderType: 'MARKET', currency: 'KRW', orderedAt: `${date}T01:00:00Z`,
    execution: { filledAt: `${date}T01:00:05Z`, filledQuantity: quantity, filledAmount: quantity * price,
      averageFilledPrice: price, commission: 0, tax: 0 },
  }
}

function holding(symbol: string, quantity: number, unit: number) {
  return {
    symbol, name: symbol, currency: 'KRW', marketCountry: 'KR', quantity, averagePurchasePrice: unit,
    lastPrice: unit, marketValue: { purchaseAmount: quantity * unit, amount: quantity * unit },
    profitLoss: { amount: 0, rate: 0 },
  }
}

function ingest(soldQuantity = 10) {
  const dir = mkdtempSync(path.join(tmpdir(), 'toss-bridge-'))
  writeSheetPayloads(dir)
  const kr = path.join(dir, 'kr-statements')
  mkdirSync(kr, { recursive: true })
  // SOLD is sold in full after the cutoff; KEPT is half sold, half still held.
  writeFileSync(
    path.join(kr, 'transactions.tsv'),
    tsv(TRANSACTION_COLUMNS, [buy('SOLD', '2026-07-01', 10, 1000), buy('KEPT', '2026-07-02', 4, 2000)]),
    'utf8'
  )
  writeFileSync(
    path.join(kr, 'taxlots.tsv'),
    tsv(TAXLOT_COLUMNS, [lot('SOLD', '2026-07-01', 10, 1000), lot('KEPT', '2026-07-02', 4, 2000)]),
    'utf8'
  )
  const snapshot = path.join(dir, 'toss-snapshot.json')
  writeFileSync(
    snapshot,
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      accounts: [{
        holdings: { items: [holding('KEPT', 2, 2000)] },
        orders: [sell('SOLD', '2026-09-23', soldQuantity, 1500), sell('KEPT', '2026-09-23', 2, 2500)],
      }],
    }),
    'utf8'
  )
  const dbPath = runIngest(dir, {
    env: { STOCK_KR_STATEMENTS_DIR: kr, STOCK_TOSS_SNAPSHOT_PATH: snapshot },
    allowFailure: true,
  })
  const db = new Database(dbPath, { readonly: true })
  return {
    lots: db
      .prepare('select ticker, open_quantity, cost_basis_krw from tax_lots where account = ? order by ticker')
      .all(ACCOUNT) as { ticker: string; open_quantity: number; cost_basis_krw: number }[],
    realized: db
      .prepare('select ticker, quantity_sold, realized_gl_krw from realized_lots where account = ? order by ticker')
      .all(ACCOUNT) as { ticker: string; quantity_sold: number; realized_gl_krw: number }[],
    check: (name: string) =>
      db.prepare('select status, detail from validation_checks where name = ?').get(name) as
        | { status: string; detail: string }
        | undefined,
  }
}

test('a lot the bridge sells in full leaves tax_lots instead of staying at zero', () => {
  const { lots, realized, check } = ingest()

  assert.deepEqual(lots.map((l) => l.ticker), ['KEPT'])
  assert.equal(lots[0].open_quantity, 2)
  assert.equal(lots[0].cost_basis_krw, 4000)

  // The sale itself is still on the books — only the empty lot is gone.
  assert.deepEqual(
    realized.map((r) => [r.ticker, r.quantity_sold, r.realized_gl_krw]),
    [['KEPT', 2, 1000], ['SOLD', 10, 5000]]
  )
  assert.equal(check('toss_holdings_lots_provenance')?.status, 'pass')
})

// The real break among the six, kept visible: the API sold fewer shares than the
// statements hold, and the API no longer lists the position. The bridge cannot
// explain the rest (an after-hours fill is not in /api/v1/orders), so the
// leftover lot must still be named rather than tidied away with the empty ones.
test('a lot the bridge only partly closes, with no live position, is still named', () => {
  const { lots, check } = ingest(6)

  assert.deepEqual(lots.map((l) => [l.ticker, l.open_quantity]), [['KEPT', 2], ['SOLD', 4]])
  const provenance = check('toss_holdings_lots_provenance')
  assert.equal(provenance?.status, 'fail')
  assert.match(String(provenance?.detail), /1 open lot\(s\) have no live position at all \(SOLD\)/)
})
