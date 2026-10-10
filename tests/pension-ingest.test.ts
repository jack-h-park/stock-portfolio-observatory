import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { PAYLOAD_HEADERS } from './sheet-payloads'
import { IRP, SAMSUNG_PENSION, writeScenario } from './pension-fixtures'

type Holding = {
  account: string
  ticker: string
  name: string
  quantity: number
  base_cost: number
  base_market_value: number
  as_of_date: string
  account_wrapper: string
  asset_class: string
  valuation_source: string | null
}

function ingest(options: { etfPriced?: boolean; extra?: (dir: string) => void } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pension-ingest-'))
  const env = writeScenario(dir, { withPensions: true, etfPriced: options.etfPriced ?? true })
  options.extra?.(dir)
  const db = new Database(runIngest(dir, { env, allowFailure: true }), { readonly: true })
  const holdingsAll = db
    .prepare(
      `select account, ticker, name, quantity, base_cost, base_market_value, as_of_date, account_wrapper, asset_class, valuation_source
         from holdings_all where account_wrapper in ('irp','pension_savings') order by account, ticker`
    )
    .all() as Holding[]
  return {
    db,
    holdingsAll,
    check: (name: string) =>
      db.prepare('select status, detail, severity from validation_checks where name = ?').get(name) as
        | { status: string; detail: string; severity: string }
        | undefined,
  }
}

test('pension snapshots land in holdings_all, tagged, and never in the holdings view', () => {
  const { db, holdingsAll } = ingest()
  const irp = holdingsAll.filter((h) => h.account === IRP)
  assert.equal(irp.length, 3)
  assert.ok(irp.every((h) => h.account_wrapper === 'irp' && h.asset_class === 'security' && h.as_of_date === '2026-10-08'))
  const etf = irp.find((h) => h.ticker === '069500')!
  assert.equal(etf.valuation_source, 'price')
  assert.equal(etf.base_market_value, 360000) // 10 x the fixture price, not the snapshot's 350000
  assert.equal(etf.base_cost, 300000)
  const fund = irp.find((h) => h.name === 'Example TDF fund')!
  assert.equal(fund.ticker, 'PENSION:irp:2')
  assert.equal(fund.valuation_source, 'snapshot')
  assert.equal(fund.base_market_value, 1100000)
  const cash = irp.find((h) => h.name === 'Example cash sweep')!
  assert.equal(cash.ticker, 'PENSION:irp:cash:3')
  assert.equal(cash.valuation_source, 'snapshot')
  assert.equal(cash.base_market_value, 50000)

  // 삼성 has no CSV, so its balance certificate's products are the snapshot,
  // plus the certificate's cash, which is not a product.
  const samsung = holdingsAll.filter((h) => h.account === SAMSUNG_PENSION)
  assert.equal(samsung.length, 3)
  assert.ok(samsung.every((h) => h.account_wrapper === 'pension_savings' && h.valuation_source === 'snapshot'))
  assert.ok(samsung.every((h) => h.as_of_date === '2025-12-31'))
  assert.equal(samsung.reduce((s, h) => s + h.base_market_value, 0), 1050000)

  const leaked = db
    .prepare(`select count(*) as n from holdings where account in (?, ?) or ticker like 'PENSION:%'`)
    .get(IRP, SAMSUNG_PENSION) as { n: number }
  assert.equal(leaked.n, 0)
})

test('pension_flows has one contribution per account and nothing internal', () => {
  const { db } = ingest()
  const flows = db.prepare('select account, account_wrapper, owner, date, kind, amount_krw, source from pension_flows order by account').all() as {
    account: string; account_wrapper: string; owner: string; kind: string; amount_krw: number
  }[]
  assert.deepEqual(
    flows.map((f) => [f.account, f.account_wrapper, f.kind, f.amount_krw]),
    [
      [IRP, 'irp', 'contribution', 1000000],
      [SAMSUNG_PENSION, 'pension_savings', 'contribution', 500000],
    ]
  )
  assert.ok(flows.every((f) => f.owner === 'self'))
})

test('a trade after the 삼성 snapshot is stored, warned about, and does not move the holdings', () => {
  const { db, holdingsAll, check } = ingest()
  const after = check('pension_trades_after_snapshot')!
  assert.equal(after.status, 'fail')
  assert.equal(after.severity, 'warning')
  assert.match(after.detail, /1 trade/)
  assert.match(after.detail, /2025-12-31/)
  assert.match(after.detail, new RegExp(SAMSUNG_PENSION.replace(/[()]/g, '\\$&')))
  // The holdings are still exactly the certificate's.
  const fundA = holdingsAll.find((h) => h.account === SAMSUNG_PENSION && h.name === 'Example equity fund A')!
  assert.equal(fundA.quantity, 600000)
  assert.equal(fundA.base_market_value, 700000)
  // And the trade itself is in transactions_all, out of the view.
  const stored = db.prepare(`select count(*) as n from transactions_all where account = ? and type = 'BUY'`).get(SAMSUNG_PENSION) as { n: number }
  assert.equal(stored.n, 1)
  const visible = db.prepare(`select count(*) as n from transactions where account = ?`).get(SAMSUNG_PENSION) as { n: number }
  assert.equal(visible.n, 0)
})

test('an unpriced pension ETF is kept at its snapshot value and named', () => {
  assert.equal(ingest().check('pension_etf_unpriced')?.status, 'pass')
  const { holdingsAll, check } = ingest({ etfPriced: false })
  const unpriced = check('pension_etf_unpriced')!
  assert.equal(unpriced.status, 'fail')
  assert.equal(unpriced.severity, 'warning')
  assert.match(unpriced.detail, /069500/)
  const etf = holdingsAll.find((h) => h.ticker === '069500')!
  assert.equal(etf.valuation_source, 'snapshot')
  assert.equal(etf.base_market_value, 350000)
})

test('year-end certificates are compared with a like-dated snapshot only', () => {
  // The IRP certificate is 2025-12-31 and the only IRP snapshot is 2026-10-08,
  // so there is nothing like-dated to compare; the 삼성 certificate is its own snapshot.
  const ok = ingest().check('pension_snapshot_matches_year_end')!
  assert.equal(ok.status, 'pass')
  assert.equal(ok.severity, 'warning')
  assert.match(ok.detail, /no snapshot at 2025-12-31 to compare/)

  // A like-dated IRP snapshot that disagrees with the certificate by more than
  // max(0.5%, ₩10,000) fails it.
  const off = ingest({
    extra: (dir) =>
      writeFileSync(
        path.join(dir, 'pension', 'irp-holdings-20251231.csv'),
        'type,name,ticker,quantity,cost_krw,value_krw\nFUND,Example TDF fund,,,1000000,1900000\n',
        'utf8'
      ),
  }).check('pension_snapshot_matches_year_end')!
  assert.equal(off.status, 'fail')
  assert.match(off.detail, /irp/)
  assert.match(off.detail, /2025-12-31/)
})

test('pension transaction types are mapped, and US wrapper treatment defaults to undecided', () => {
  const { check } = ingest()
  assert.equal(check('transaction_types_mapped')?.status, 'pass')
  const us = check('us_wrapper_treatment_decided')!
  assert.equal(us.severity, 'warning')
  assert.equal(us.status, 'fail')
  assert.match(us.detail, /irp/)
  assert.match(us.detail, /pension_savings/)
})

test('an ETF with a price but no quantity is named with that reason, not as unpriced', () => {
  const { holdingsAll, check } = ingest({
    extra: (dir) =>
      writeFileSync(
        path.join(dir, 'pension', 'irp-holdings-20261008.csv'),
        'type,name,ticker,quantity,cost_krw,value_krw\nETF,Example 200 ETF,069500,,300000,350000\n',
        'utf8'
      ),
  })
  const unpriced = check('pension_etf_unpriced')!
  assert.equal(unpriced.status, 'fail')
  assert.match(unpriced.detail, /069500 \(no quantity\)/)
  assert.doesNotMatch(unpriced.detail, /no KR price/)
  const etf = holdingsAll.find((h) => h.ticker === '069500')!
  assert.equal(etf.valuation_source, 'snapshot')
  assert.equal(etf.base_market_value, 350000)

  // The other two reasons, each named for what it is.
  const noPrice = ingest({ etfPriced: false }).check('pension_etf_unpriced')!
  assert.match(noPrice.detail, /069500 \(no KR price\)/)
  const noTicker = ingest({
    extra: (dir) =>
      writeFileSync(
        path.join(dir, 'pension', 'irp-holdings-20261008.csv'),
        'type,name,ticker,quantity,cost_krw,value_krw\nETF,Example 200 ETF,,10,300000,350000\n',
        'utf8'
      ),
  }).check('pension_etf_unpriced')!
  assert.match(noTicker.detail, /'Example 200 ETF' \(no ticker\)/)
})

test('a sheet row for a pension account is dropped once its snapshot is inserted', () => {
  const { db, holdingsAll } = ingest({
    extra: (dir) =>
      writeFileSync(
        path.join(dir, '.codex_sheet_payloads', 'summary.noapost.tsv'),
        PAYLOAD_HEADERS['summary.noapost.tsv'] + '\n' + [IRP, '069500', 'Example 200 ETF', 7, 30000, 210000, '', '', '', '', '', '', '', ''].join('\t') + '\n',
        'utf8'
      ),
  })
  const irp = holdingsAll.filter((h) => h.account === IRP)
  assert.equal(irp.length, 3)
  assert.equal(irp.find((h) => h.ticker === '069500')!.quantity, 10)
  const sheet = db.prepare(`select count(*) as n from holdings_all where account = ? and source_system like 'korea_sheet%'`).get(IRP) as { n: number }
  assert.equal(sheet.n, 0)
})
