import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { config } from '@/config'
import { totalAssetsSeries } from '../lib/net-worth'
import { resolveTrendScope, singleTrendPoints, TREND_SCOPES } from '../lib/overview-trend'
import { runIngest } from './ingest-harness'
import { GOLD, IRP, SAMSUNG_PENSION, writeScenario } from './pension-fixtures'

// Invented figures throughout; the repository is public.

const empty = { stocks: {}, crypto: {}, cash: {}, pensionPoints: [], gold: { buys: [], prices: [] } }

test('pensions step: each account holds its latest point on or before the date, and adds nothing before its first', () => {
  const r = totalAssetsSeries({
    ...empty,
    dates: ['2025-06-30', '2025-12-31', '2026-03-31', '2026-10-08'],
    pensionPoints: [
      { date: '2025-12-31', account: 'A', valueKrw: 1_000 },
      { date: '2026-10-08', account: 'A', valueKrw: 1_500 },
      { date: '2026-03-31', account: 'B', valueKrw: 200 },
    ],
  })
  assert.deepEqual(
    r.points.map((p) => p.pensions),
    [null, 1_000, 1_200, 1_700]
  )
  assert.equal(r.startsOn.pensions, '2025-12-31')
})

test('gold: grams bought on or before the date times the latest price on or before it', () => {
  const r = totalAssetsSeries({
    ...empty,
    dates: ['2026-01-01', '2026-01-20', '2026-02-20', '2026-03-10'],
    gold: {
      buys: [
        { date: '2026-01-15', grams: 10, costKrw: 1_000_000 },
        { date: '2026-02-16', grams: 5, costKrw: 600_000 },
      ],
      prices: [
        { date: '2026-01-10', price: 100_000 },
        { date: '2026-02-18', price: 120_000 },
        { date: '2026-03-15', price: 999_999 },
      ],
    },
  })
  assert.deepEqual(
    r.points.map((p) => p.gold),
    [null, 10 * 100_000, 15 * 120_000, 15 * 120_000]
  )
  assert.equal(r.startsOn.gold, '2026-01-20')
})

test('gold with no price on or before the date is valued at the cost of the grams held', () => {
  const r = totalAssetsSeries({
    ...empty,
    dates: ['2026-01-20', '2026-02-20', '2026-04-01'],
    gold: {
      buys: [
        { date: '2026-01-15', grams: 10, costKrw: 1_000_000 },
        { date: '2026-02-16', grams: 5, costKrw: 600_000 },
      ],
      prices: [{ date: '2026-03-31', price: 130_000 }],
    },
  })
  assert.deepEqual(
    r.points.map((p) => p.gold),
    [1_000_000, 1_600_000, 15 * 130_000]
  )
  // The first purchase still marks where gold starts.
  assert.equal(r.startsOn.gold, '2026-01-20')
})

test('total is the sum of the non-null classes, and startsOn is each class first non-null date', () => {
  const r = totalAssetsSeries({
    dates: ['2026-01-01', '2026-02-01', '2026-03-01'],
    stocks: { '2026-01-01': 100, '2026-02-01': 110, '2026-03-01': null },
    crypto: { '2026-02-01': 5, '2026-03-01': 6 },
    cash: { '2026-01-01': null, '2026-02-01': null, '2026-03-01': 40 },
    pensionPoints: [{ date: '2026-02-15', account: 'A', valueKrw: 70 }],
    gold: { buys: [], prices: [] },
  })
  assert.deepEqual(r.points, [
    { date: '2026-01-01', stocks: 100, crypto: null, cash: null, pensions: null, gold: null, total: 100 },
    { date: '2026-02-01', stocks: 110, crypto: 5, cash: null, pensions: null, gold: null, total: 115 },
    { date: '2026-03-01', stocks: null, crypto: 6, cash: 40, pensions: 70, gold: null, total: 116 },
  ])
  assert.deepEqual(r.startsOn, { stocks: '2026-01-01', crypto: '2026-02-01', cash: '2026-03-01', pensions: '2026-03-01' })
})

// --- adapter ----------------------------------------------------------------

function ingest() {
  const dir = mkdtempSync(path.join(tmpdir(), 'total-assets-'))
  const env = writeScenario(dir, { withPensions: true })
  return runIngest(dir, { env, allowFailure: true })
}

test('the ingest stores pension points and gold prices; the adapter series ends on the Total assets figure', async () => {
  const dbPath = ingest()
  const db = new Database(dbPath)
  // Certificate totals and snapshot totals, one point per account and date.
  const points = db.prepare('select account, account_wrapper, date, value_krw, source from pension_points order by account, date').all() as {
    account: string; account_wrapper: string; date: string; value_krw: number; source: string
  }[]
  assert.deepEqual(
    points.map((p) => [p.account, p.account_wrapper, p.date, p.value_krw]),
    [
      [IRP, 'irp', '2025-12-31', 2_000_000],
      [IRP, 'irp', '2026-10-08', 1_500_000],
      [SAMSUNG_PENSION, 'pension_savings', '2025-12-31', 1_050_000],
    ]
  )
  assert.match(points[0].source, /certificate/)
  assert.match(points[1].source, /snapshot/)
  const prices = db.prepare('select date, price from gold_prices order by date').all()
  assert.deepEqual(prices, [
    { date: '2026-10-07', price: 159_000 },
    { date: '2026-10-08', price: 160_000 },
  ])
  // Two snapshot dates for the stock side, so the series has history to read.
  db.prepare('delete from portfolio_snapshots').run()
  const insert = db.prepare(
    `insert into portfolio_snapshots (snapshot_date, captured_at, global_base_cost, global_base_market_value, kr_market_value, us_market_value_base, crypto_market_value_base,
       kr_cost_basis, us_cost_basis_base, crypto_cost_basis_base, krw_cost, usd_cost, dividends_krw, dividends_usd, holding_count, share_count)
     values (?, ?, 0, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1)`
  )
  insert.run('2026-01-31', '2026-01-31T00:00:00Z', 500_000, 500_000)
  insert.run('2026-03-31', '2026-03-31T00:00:00Z', 600_000, 600_000)
  db.close()

  config.stockDbPath = dbPath
  const { getNetWorth, getTotalAssetsSeries } = await import('../lib/adapters/portfolio-db')
  const series = getTotalAssetsSeries(['2026-01-31', '2026-03-31'])
  const netWorth = getNetWorth()
  const last = series.points.at(-1)!
  assert.ok(last.date > '2026-03-31', 'today is appended after the snapshot dates')
  assert.equal(last.total, netWorth.totalKrw)
  assert.equal(last.stocks, netWorth.byClass.stocks)
  assert.equal(last.pensions, netWorth.byClass.pensions)
  assert.equal(last.gold, netWorth.byClass.gold)

  const [jan, mar] = series.points
  assert.equal(jan.stocks, 500_000)
  // Only the year-end certificates stand before 2026-10-08.
  assert.equal(jan.pensions, 2_000_000 + 1_050_000)
  assert.equal(mar.pensions, 2_000_000 + 1_050_000)
  // 10 g bought 2026-01-15, no price before 2026-10-07: at cost.
  assert.equal(jan.gold, 1_500_000)
  assert.equal(series.startsOn.gold, '2026-01-31')
  assert.equal(series.startsOn.pensions, '2026-01-31')
  assert.ok(GOLD)
})

test('as-of notes carry their asset class, and cash is dated by its oldest latest balance', async () => {
  const dbPath = ingest()
  const db = new Database(dbPath)
  const cash = db.prepare(
    `insert into cash_balances (institution, account, owner, kind, currency, as_of_date, balance, source, derived) values (?, ?, 'self', 'savings', 'KRW', ?, ?, 'example', 0)`
  )
  cash.run('Example Bank', 'Example Savings', '2026-06-30', 100)
  cash.run('Example Bank', 'Example Savings', '2026-09-30', 200)
  cash.run('Other Bank', 'Other Checking', '2026-08-31', 50)
  db.close()
  config.stockDbPath = dbPath
  const { getNetWorth } = await import('../lib/adapters/portfolio-db')
  const notes = getNetWorth().asOfNotes
  assert.deepEqual(notes.find((note) => note.assetClass === 'cash'), { assetClass: 'cash', label: 'Other Checking', asOf: '2026-08-31' })
  assert.deepEqual(
    notes.filter((note) => note.assetClass === 'pensions'),
    [
      { assetClass: 'pensions', label: IRP, asOf: '2026-10-08' },
      { assetClass: 'pensions', label: SAMSUNG_PENSION, asOf: '2025-12-31' },
    ]
  )
})

test('a snapshot dated today yields one point for today, and it is the Total assets figure', async () => {
  const dbPath = ingest()
  config.stockDbPath = dbPath
  const { getNetWorth, getTotalAssetsSeries, portfolioToday } = await import('../lib/adapters/portfolio-db')
  const today = portfolioToday()
  const db = new Database(dbPath)
  db.prepare('delete from portfolio_snapshots').run()
  const insert = db.prepare(
    `insert into portfolio_snapshots (snapshot_date, captured_at, global_base_cost, global_base_market_value, kr_market_value, us_market_value_base, crypto_market_value_base,
       kr_cost_basis, us_cost_basis_base, crypto_cost_basis_base, krw_cost, usd_cost, dividends_krw, dividends_usd, holding_count, share_count)
     values (?, ?, 0, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1)`
  )
  insert.run('2026-01-31', '2026-01-31T00:00:00Z', 500_000, 500_000)
  // A snapshot value that differs from the card, so a leaked snapshot point would show.
  insert.run(today, `${today}T00:00:00Z`, 123, 123)
  db.close()

  const netWorth = getNetWorth()
  const series = getTotalAssetsSeries(['2026-01-31', today])
  assert.equal(series.points.filter((point) => point.date === today).length, 1)
  assert.equal(series.points.at(-1)!.date, today)
  assert.equal(series.points.at(-1)!.total, netWorth.totalKrw)
  // A precomputed net worth gives the same series.
  assert.deepEqual(getTotalAssetsSeries(['2026-01-31', today], netWorth), series)
})

// --- overview stock trend ---------------------------------------------------

test('the overview stock trend is stock-only again: no deposits scope, and global is the snapshot value', () => {
  assert.deepEqual(TREND_SCOPES.map((scope) => scope.key), ['global', 'KR', 'US', 'CRYPTO'])
  assert.equal(resolveTrendScope('deposits'), 'global')
  assert.equal(resolveTrendScope('US'), 'US')
  assert.equal(resolveTrendScope(undefined), 'global')
  const snapshot = {
    snapshot_date: '2026-03-31',
    global_base_market_value: 1_000_000,
    market_value_coverage: 1,
  } as unknown as Parameters<typeof singleTrendPoints>[0][number]
  const points = singleTrendPoints([snapshot], 'global', 'market_value', (value) => value / 1_000_000)
  assert.deepEqual(points, [{ date: '2026-03-31', value: 1, coverage: 1 }])
})
