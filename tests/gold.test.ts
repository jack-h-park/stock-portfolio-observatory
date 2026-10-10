import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { buildGoldPriceDocument, parseGoldHistory, parseGoldLatest, parsePrice, seoulDate } from '../scripts/gold-price.mjs'
import { runIngest } from './ingest-harness'
import { GOLD, STOCK_INPUTS, TAXLOT_COLUMNS, TRANSACTION_COLUMNS, tsv, writeScenario } from './pension-fixtures'
import { PAYLOAD_HEADERS } from './sheet-payloads'

// Invented fixtures throughout. The two Naver files keep the shape of the real
// responses (fetched once to learn it) with made-up prices.
const fixture = (name: string) => JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8'))

test('the price parser reads a comma-grouped KRW/g string and the Seoul trading date', () => {
  assert.equal(parsePrice('177,480'), 177480)
  assert.equal(parsePrice('1,234.5'), 1234.5)
  assert.equal(parsePrice('-'), null)
  assert.equal(parsePrice(''), null)
  assert.equal(parsePrice(undefined), null)
  assert.equal(parsePrice('0'), null)
  // The date is the calendar day in Seoul, whatever offset the timestamp carries.
  assert.equal(seoulDate('2026-03-05T15:19:36+09:00'), '2026-03-05')
  assert.equal(seoulDate('2026-03-04T16:00:00Z'), '2026-03-05')
  assert.equal(seoulDate('not a date'), null)

  assert.deepEqual(parseGoldLatest(fixture('naver-gold-product-detail.json')), { date: '2026-03-05', price: 177480 })
})

test('the latest-price parser refuses a response for another code, unit, or a failed call', () => {
  const good = fixture('naver-gold-product-detail.json')
  assert.equal(parseGoldLatest({ ...good, isSuccess: false }), null)
  assert.equal(parseGoldLatest({ ...good, result: { ...good.result, reutersCode: 'GCcv1' } }), null)
  assert.equal(parseGoldLatest({ ...good, result: { ...good.result, unit: '달러/트로이온스' } }), null)
  assert.equal(parseGoldLatest({ ...good, result: { ...good.result, closePrice: '-' } }), null)
  assert.equal(parseGoldLatest(null), null)
})

test('the history parser returns dated prices oldest first and skips rows without a price', () => {
  assert.deepEqual(parseGoldHistory(fixture('naver-gold-prices.json')), [
    { date: '2026-03-03', price: 176000 },
    { date: '2026-03-04', price: 178480 },
    { date: '2026-03-05', price: 177480 },
  ])
  assert.deepEqual(parseGoldHistory({ isSuccess: false, result: [] }), null)
  assert.deepEqual(parseGoldHistory({ isSuccess: true, result: 'nope' }), null)
})

test('the document carries the code, unit, latest and history', () => {
  const doc = buildGoldPriceDocument({
    latest: { date: '2026-03-05', price: 177480 },
    history: [{ date: '2026-03-04', price: 178480 }],
    fetchedAt: '2026-03-05T07:00:00.000Z',
  })
  assert.equal(doc.code, 'M04020000')
  assert.equal(doc.unit, 'KRW/g')
  assert.equal(doc.fetchedAt, '2026-03-05T07:00:00.000Z')
  assert.match(doc.source, /Naver/)
  assert.deepEqual(doc.latest, { date: '2026-03-05', price: 177480 })
  assert.deepEqual(doc.history, [{ date: '2026-03-04', price: 178480 }])
})

// --- ingest -----------------------------------------------------------------

function tx(row: Record<string, string | number>) {
  return { Currency: 'KRW', 'FX Rate': 1, Fee: 0, Tax: 0, Balance: 0, Page: 1, ...row }
}
const SOURCE = 'mirae-gold-transactions-20230101-20261008.pdf'
/** Two purchases (their 매수출금 cash legs already dropped by the extractor) and a storage fee. */
const GOLD_TRANSACTIONS = [
  tx({ Date: '2026-01-15', Account: GOLD, Type: 'BUY', 'Raw Type': '금현물매수입고', Ticker: 'M04020000', Name: 'Gold 99.99 1Kg', Quantity: 10, 'Native Amount': 1000000, 'Amount (KRW)': 1000000, 'Settlement (KRW)': 1000000, 'Unit Price': 100000, Source: SOURCE }),
  tx({ Date: '2026-02-16', Account: GOLD, Type: 'BUY', 'Raw Type': '금현물매수입고', Ticker: 'M04020000', Name: 'Gold 99.99 1Kg', Quantity: 5, 'Native Amount': 600000, 'Amount (KRW)': 600000, 'Settlement (KRW)': 600000, 'Unit Price': 120000, Source: SOURCE }),
  tx({ Date: '2026-03-01', Account: GOLD, Type: 'FEE', 'Raw Type': '금현물보관수수료', 'Native Amount': 300, 'Amount (KRW)': 300, 'Settlement (KRW)': 300, Source: SOURCE }),
]
const GOLD_LOTS = [10, 5].map((grams, i) => ({
  Account: GOLD, Ticker: 'M04020000', Name: 'Gold 99.99 1Kg', 'Acquired Date': i ? '2026-02-16' : '2026-01-15', 'Open Quantity': grams,
  Currency: 'KRW', 'Native Cost Basis': grams * (i ? 120000 : 100000), 'Native Unit Cost': i ? 120000 : 100000,
  'Cost Basis (KRW)': grams * (i ? 120000 : 100000), 'Unit Cost': i ? 120000 : 100000, 'Holding Days': 200,
  'As Of Date': '2026-10-08', 'Tax Term': 'Short-term', Source: SOURCE,
}))

type GoldHolding = {
  account: string
  ticker: string
  name: string
  market: string
  quantity: number
  base_cost: number
  base_market_value: number
  current_price: number | null
  as_of_date: string
  account_wrapper: string
  asset_class: string
  valuation_source: string
  source_system: string
}

function ingestGold({ price, extra }: { price?: number; extra?: (dir: string) => void } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gold-ingest-'))
  const env = writeScenario(dir, { withPensions: false })
  const kr = env.STOCK_KR_STATEMENTS_DIR
  writeFileSync(path.join(kr, 'transactions.tsv'), tsv(TRANSACTION_COLUMNS, [...STOCK_INPUTS.transactions, ...GOLD_TRANSACTIONS]), 'utf8')
  writeFileSync(path.join(kr, 'taxlots.tsv'), tsv(TAXLOT_COLUMNS, [...STOCK_INPUTS.taxlots, ...GOLD_LOTS]), 'utf8')
  if (price != null) {
    const doc = buildGoldPriceDocument({
      latest: { date: '2026-10-08', price },
      history: [{ date: '2026-10-07', price: price - 1000 }, { date: '2026-10-08', price }],
      fetchedAt: '2026-10-08T07:00:00.000Z',
    })
    writeFileSync(path.join(dir, 'gold-prices.json'), JSON.stringify(doc), 'utf8')
    env.STOCK_GOLD_PRICES_PATH = path.join(dir, 'gold-prices.json')
  }
  extra?.(dir)
  const db = new Database(runIngest(dir, { env, allowFailure: true }), { readonly: true })
  const holdings = db
    .prepare(
      `select account, ticker, name, market, quantity, base_cost, base_market_value, current_price, as_of_date,
              account_wrapper, asset_class, valuation_source, source_system
         from holdings_all where account = ?`
    )
    .all(GOLD) as GoldHolding[]
  return {
    db,
    holdings,
    check: (name: string) =>
      db.prepare('select status, detail, severity from validation_checks where name = ?').get(name) as
        | { status: string; detail: string; severity: string }
        | undefined,
  }
}

test('the gold holding is built from the purchases, marked at the KRX price, and kept out of the Stocks view', () => {
  const { db, holdings, check } = ingestGold({ price: 130000 })
  assert.equal(holdings.length, 1)
  const [gold] = holdings
  assert.equal(gold.market, 'KR')
  assert.equal(gold.ticker, 'M04020000')
  assert.equal(gold.name, 'KRX 금현물')
  assert.equal(gold.account_wrapper, 'taxable')
  assert.equal(gold.asset_class, 'gold')
  assert.equal(gold.quantity, 15)
  assert.equal(gold.base_cost, 1600000) // the storage fee is not cost
  assert.equal(gold.base_market_value, 1950000)
  assert.equal(gold.current_price, 130000)
  assert.equal(gold.valuation_source, 'price')
  assert.equal(gold.as_of_date, '2026-10-08')

  const visible = db.prepare('select count(*) as n from holdings where account = ? or ticker = ?').get(GOLD, 'M04020000') as { n: number }
  assert.equal(visible.n, 0)

  const priced = check('gold_priced')!
  assert.equal(priced.status, 'pass')
  assert.equal(priced.severity, 'warning')
  assert.match(priced.detail, /2026-10-08/)

  // The purchases are stored, tagged gold, and out of the view; they open no lot
  // beyond the certificate's own open-lot rows.
  const buys = db.prepare(`select count(*) as n from transactions_all where account = ? and type = 'BUY' and asset_class = 'gold'`).get(GOLD) as { n: number }
  assert.equal(buys.n, 2)
  const visibleBuys = db.prepare('select count(*) as n from transactions where account = ?').get(GOLD) as { n: number }
  assert.equal(visibleBuys.n, 0)
  const lots = db.prepare(`select count(*) as n, sum(open_quantity) as grams from tax_lots_all where account = ?`).get(GOLD) as { n: number; grams: number }
  assert.deepEqual(lots, { n: 2, grams: 15 })
})

test('with no gold price the holding is valued at cost and gold_priced warns', () => {
  const { holdings, check } = ingestGold()
  assert.equal(holdings.length, 1)
  const [gold] = holdings
  assert.equal(gold.quantity, 15)
  assert.equal(gold.base_cost, 1600000)
  assert.equal(gold.base_market_value, 1600000)
  assert.equal(gold.current_price, null)
  assert.equal(gold.valuation_source, 'cost')
  assert.equal(gold.as_of_date, '2026-02-16') // the last purchase, not a price date
  const priced = check('gold_priced')!
  assert.equal(priced.status, 'fail')
  assert.equal(priced.severity, 'warning')
  assert.match(priced.detail, /at cost/)
})

test('no gold account means no gold holding and a passing gold_priced', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gold-none-'))
  const env = writeScenario(dir, { withPensions: false })
  const db = new Database(runIngest(dir, { env, allowFailure: true }), { readonly: true })
  const n = db.prepare(`select count(*) as n from holdings_all where asset_class = 'gold'`).get() as { n: number }
  assert.equal(n.n, 0)
  const priced = db.prepare(`select status from validation_checks where name = 'gold_priced'`).get() as { status: string }
  assert.equal(priced.status, 'pass')
})

test('a sheet row for the gold account is dropped once the gold holding is inserted', () => {
  const { holdings } = ingestGold({
    price: 130000,
    extra: (dir) =>
      writeFileSync(
        path.join(dir, '.codex_sheet_payloads', 'summary.noapost.tsv'),
        PAYLOAD_HEADERS['summary.noapost.tsv'] + '\n' + [GOLD, 'M04020000', 'Gold', 3, 100000, 300000, '', '', '', '', '', '', '', ''].join('\t') + '\n',
        'utf8'
      ),
  })
  assert.equal(holdings.length, 1)
  assert.equal(holdings[0].source_system, 'gold_certificate')
  assert.equal(holdings[0].quantity, 15)
})
