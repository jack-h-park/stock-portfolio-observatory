import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

const HOLDING_INSERT = `insert into holdings_all (market, currency, base_currency, account, ticker, name, quantity, native_cost, total_cost_krw,
       base_cost, base_market_value, native_market_value, account_wrapper)
     values ('KR','KRW','KRW',?,?,?,10,1000,1000,1000,5000,5000,?)`

test('rows outside the stock wrappers do not change the default overview or holdings totals', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'default-view-'))
  writeSheetPayloads(dir)
  const dbPath = runIngest(dir, { allowFailure: true })
  process.env.STOCK_DB_PATH = dbPath

  // A taxable holding first, so the totals being compared are not all zero.
  const seed = new Database(dbPath)
  seed.prepare(HOLDING_INSERT).run('Example Brokerage', '005930', 'EXAMPLE TAXABLE CO', 'taxable')
  seed.close()

  const adapter = await import('../lib/adapters/portfolio-db')
  const before = JSON.stringify(adapter.getOverview().totals)
  assert.ok(adapter.getOverview().totals.global_base_market_value > 0, 'the baseline must be non-zero to mean anything')
  const reviewBefore = JSON.stringify(adapter.getPortfolioReview().totals)

  const db = new Database(dbPath)
  db.prepare(HOLDING_INSERT).run('Example IRP', '069500', 'EXAMPLE IRP ETF', 'irp')
  db.prepare(
    `insert into cash_balances (institution, account, owner, kind, currency, as_of_date, balance, source, derived) values ('x','A','self','checking','KRW','2026-10-01',99999,'t',0)`
  ).run()
  // A duplicate (account, date) row: the latest-balance read must still return one row, the higher id.
  db.prepare(
    `insert into cash_balances (institution, account, owner, kind, currency, as_of_date, balance, source, derived) values ('x','A','self','checking','KRW','2026-10-01',100000,'t',0)`
  ).run()
  // The same account label at another institution is a different account, with its own latest balance.
  db.prepare(
    `insert into cash_balances (institution, account, owner, kind, currency, as_of_date, balance, source, derived) values ('y','A','self','checking','KRW','2026-09-01',7,'t',0)`
  ).run()
  db.close()

  assert.equal(JSON.stringify(adapter.getOverview().totals), before)
  assert.equal(JSON.stringify(adapter.getPortfolioReview().totals), reviewBefore)
  assert.ok(!adapter.getTopHoldings().some((row) => row.ticker === '069500'), 'top holdings must not list the IRP ticker')
  assert.ok(!adapter.getHoldings().some((row) => row.ticker === '069500'), 'the holdings list must not include the IRP ticker')
  assert.ok(adapter.getHoldings().some((row) => row.ticker === '005930'))
  // The cash row shows up in net worth, never in the stock figures.
  assert.equal(adapter.getNetWorth().cash.length, 2)
  assert.equal(adapter.getNetWorth().byClass.cash, 100007)
  // A precomputed overview is accepted and gives the same answer.
  assert.deepEqual(adapter.getNetWorth(adapter.getOverview()), adapter.getNetWorth())
  // The overview's deposits series reads the same rows: each account's last balance on or before the date.
  assert.deepEqual(adapter.getDepositsSeries(['2026-08-31', '2026-09-15', '2026-10-02']), {
    series: [
      { date: '2026-08-31', krw: null },
      { date: '2026-09-15', krw: 7 },
      { date: '2026-10-02', krw: 100007 },
    ],
    since: '2026-09-01',
  })
})
