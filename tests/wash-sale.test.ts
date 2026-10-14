import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import {
  addCalendarDays,
  buildWashSaleWindows,
  calendarDaysBetween,
  washSaleLine,
  washSaleWindowEnd,
  type WashSaleBuy,
  type WashSaleLot,
} from '@/lib/wash-sale'

const lot = (l: Partial<WashSaleLot>): WashSaleLot => ({
  ticker: 'FIG',
  soldDate: '2026-10-09',
  acquiredDate: '2025-08-01',
  quantity: 1,
  realizedGl: -100,
  account: 'Robinhood Mid-term',
  ...l,
})
const buy = (b: Partial<WashSaleBuy>): WashSaleBuy => ({
  ticker: 'FIG',
  date: '2026-09-20',
  quantity: 1,
  account: 'Robinhood Agentic',
  ...b,
})

test('the window ends 30 calendar days after the sale, across month and year ends', () => {
  // The real case: four loss sales on 2026-10-09, blocked through 2026-11-08.
  assert.equal(washSaleWindowEnd('2026-10-09'), '2026-11-08')
  assert.equal(washSaleWindowEnd('2026-12-15'), '2027-01-14')
  assert.equal(washSaleWindowEnd('2028-02-10'), '2028-03-11') // leap year: Feb has 29 days
  assert.equal(washSaleWindowEnd('2027-02-10'), '2027-03-12')
  // Across the US DST change (2026-11-01) a local-time add would drift by an hour
  // and can land on the wrong day; the math is UTC calendar days.
  assert.equal(addCalendarDays('2026-10-20', 30), '2026-11-19')
  assert.equal(addCalendarDays('2026-10-09', -30), '2026-09-09')
  assert.equal(calendarDaysBetween('2026-10-13', '2026-11-08'), 26)
  assert.equal(calendarDaysBetween('2026-11-08', '2026-11-08'), 0)
})

test('a loss sale opens a window; days left count down to the last blocked day', () => {
  const [w] = buildWashSaleWindows({
    lots: [lot({ realizedGl: -112.59 }), lot({ realizedGl: -97.85 })],
    buys: [],
    today: '2026-10-13',
  })
  assert.equal(w.ticker, 'FIG')
  assert.equal(w.blockedThrough, '2026-11-08')
  assert.equal(w.clearFrom, '2026-11-09')
  assert.equal(w.daysLeft, 26)
  assert.ok(Math.abs(w.loss - -210.44) < 1e-9)
  assert.equal(w.possiblyDisallowed, 0)
  assert.equal(w.boughtSinceSale, false)
})

test('the window is open on its last day and gone the day after', () => {
  const lots = [lot({})]
  assert.equal(buildWashSaleWindows({ lots, buys: [], today: '2026-11-08' })[0].daysLeft, 0)
  assert.deepEqual(buildWashSaleWindows({ lots, buys: [], today: '2026-11-09' }), [])
})

test('gain lots do not open a window, and are not netted against the loss', () => {
  // FIG on 2026-10-09 had one lot at +10.99 among the losses.
  const windows = buildWashSaleWindows({
    lots: [lot({ realizedGl: -50 }), lot({ realizedGl: 10.99 }), lot({ ticker: 'TQQQ', realizedGl: 300 })],
    buys: [],
    today: '2026-10-13',
  })
  assert.deepEqual(windows.map((w) => w.ticker), ['FIG'])
  assert.equal(windows[0].loss, -50)
})

test('a later loss sale of the same ticker extends the block', () => {
  const [w] = buildWashSaleWindows({
    lots: [lot({ soldDate: '2026-10-01' }), lot({ soldDate: '2026-10-09', account: 'Chase' })],
    buys: [],
    today: '2026-10-13',
  })
  assert.equal(w.blockedThrough, '2026-11-08')
  assert.equal(w.sales.length, 2)
  assert.equal(w.loss, -200)
})

test('tickers sort by the longest block first, then by the larger loss', () => {
  const windows = buildWashSaleWindows({
    lots: [
      lot({ ticker: 'ADBE', realizedGl: -189.94 }),
      lot({ ticker: 'POOL', realizedGl: -1294.77 }),
      lot({ ticker: 'LCID', soldDate: '2026-10-01' }),
    ],
    buys: [],
    today: '2026-10-13',
  })
  assert.deepEqual(windows.map((w) => w.ticker), ['POOL', 'ADBE', 'LCID'])
})

test('a buy in the 30 days before the loss sale marks that part of the loss as possibly disallowed', () => {
  const [w] = buildWashSaleWindows({
    lots: [lot({ quantity: 10, realizedGl: -300 })],
    buys: [buy({ date: '2026-09-20', quantity: 4 }), buy({ date: '2026-09-08', quantity: 100 })], // 09-08 is 31 days before
    today: '2026-10-13',
  })
  const sale = w.sales[0]
  assert.deepEqual(sale.matchedBuys.map((b) => [b.date, b.side]), [['2026-09-20', 'before']])
  assert.equal(sale.replacementQuantity, 4)
  assert.ok(Math.abs(w.possiblyDisallowed - -120) < 1e-9) // 4 of 10 loss shares
  assert.equal(w.boughtSinceSale, false)
})

test('the window starts exactly 30 days before the sale, and a same-day buy counts as before', () => {
  const [w] = buildWashSaleWindows({
    lots: [lot({ quantity: 10, realizedGl: -100 })],
    buys: [buy({ date: '2026-09-09', quantity: 1 }), buy({ date: '2026-10-09', quantity: 1 })],
    today: '2026-10-13',
  })
  assert.deepEqual(w.sales[0].matchedBuys.map((b) => b.side), ['before', 'before'])
  assert.equal(w.sales[0].replacementQuantity, 2)
})

test('a dividend reinvestment is a buy, in any account', () => {
  const [w] = buildWashSaleWindows({
    lots: [lot({ ticker: 'POOL', quantity: 2, realizedGl: -40 })],
    buys: [buy({ ticker: 'POOL', date: '2026-09-28', quantity: 0.5, reinvested: true, account: 'Fidelity' })],
    today: '2026-10-13',
  })
  assert.equal(w.sales[0].matchedBuys[0].reinvested, true)
  assert.ok(Math.abs(w.possiblyDisallowed - -10) < 1e-9)
})

test('shares bought in the window and sold in the same sale are not replacement shares', () => {
  // Bought 5 on 09-20, then sold everything — those 5 included — on 10-09. Nothing
  // bought is still held, so nothing replaces the loss.
  const [w] = buildWashSaleWindows({
    lots: [lot({ quantity: 10, realizedGl: -300 }), lot({ acquiredDate: '2026-09-20', quantity: 5, realizedGl: -20 })],
    buys: [buy({ date: '2026-09-20', quantity: 5 })],
    today: '2026-10-13',
  })
  assert.equal(w.sales[0].matchedBuys.length, 1, 'the buy is still shown')
  assert.equal(w.sales[0].replacementQuantity, 0)
  assert.equal(w.possiblyDisallowed, 0)
})

test('a buy after the sale counts, but only once it has happened', () => {
  const lots = [lot({ quantity: 2, realizedGl: -50 })]
  const [w] = buildWashSaleWindows({
    lots,
    buys: [buy({ date: '2026-10-12', quantity: 5 }), buy({ date: '2026-10-20', quantity: 5 })],
    today: '2026-10-13',
  })
  assert.equal(w.boughtSinceSale, true)
  assert.deepEqual(w.sales[0].matchedBuys.map((b) => b.date), ['2026-10-12'])
  assert.equal(w.possiblyDisallowed, -50, 'capped at the whole loss')
})

test('another ticker\'s buy does not match', () => {
  const [w] = buildWashSaleWindows({
    lots: [lot({})],
    buys: [buy({ ticker: 'FIGS', date: '2026-09-20' })],
    today: '2026-10-13',
  })
  assert.equal(w.sales[0].matchedBuys.length, 0)
})

test('the briefing line groups tickers by the day they clear', () => {
  const windows = buildWashSaleWindows({
    lots: [
      lot({ ticker: 'FIG', realizedGl: -3918.51 }),
      lot({ ticker: 'POOL', realizedGl: -1294.77 }),
      lot({ ticker: 'LCID', realizedGl: -621.25 }),
      lot({ ticker: 'ADBE', realizedGl: -189.93 }),
      lot({ ticker: 'TSLA', soldDate: '2026-09-20' }),
    ],
    buys: [],
    today: '2026-10-13',
  })
  assert.equal(
    washSaleLine(windows),
    "Wash-sale window: TSLA through 2026-10-20 (7d left); FIG, POOL, LCID, ADBE through 2026-11-08 (26d left). A buy in any account, IRA or spouse's included, disallows the loss.",
  )
  assert.equal(washSaleLine([]), null)
})

test('the briefing line names a ticker already bought back', () => {
  const windows = buildWashSaleWindows({ lots: [lot({})], buys: [buy({ date: '2026-10-12' })], today: '2026-10-13' })
  assert.ok(washSaleLine(windows)!.endsWith('Already bought since the sale: FIG.'))
})
