import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

// The Robinhood orders bridge (docs/robinhood-orders-bridge.md).
//
// Positions come from the MCP snapshot and trades from CSVs downloaded by hand,
// so a sale made after the newest CSV left the replay holding shares the broker
// says are gone: `robinhood_replay_missing_disposal` failed and the sale's gain
// was absent from realized_lots. The bridge fills that window from the order
// history in the snapshot — and only that window, so the CSV stays the
// authority for every day it covers. It must also not paper over a disposal
// that orders cannot explain.
//
// Every row below is invented. ACME is the position traded in the window; KEEP
// is a quiet second position whose lots keep the snapshot's lot count above
// zero, which is what arms the replay checks.

const CSV_HEADER =
  '"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"'

function trade(date: string, ticker: string, code: 'Buy' | 'Sell', qty: number, price: number) {
  const amount = qty * price
  const money = code === 'Buy' ? `($${amount.toFixed(2)})` : `$${amount.toFixed(2)}`
  return `"${date}","${date}","${date}","${ticker}","${ticker} Corp\nCUSIP: 000000000","${code}","${qty}","$${price.toFixed(2)}","${money}"`
}

/** Robinhood writes newest-first; so do these. */
function csv(rows: string[]) {
  return [CSV_HEADER, ...[...rows].reverse()].join('\n') + '\n'
}

// The cash dividend on 08-11 is the CSV's last row, so the cutoff is 08-11. It
// is not a trade, which is the point: the cutoff is where the file stops, not
// where its last trade was.
const BASE_ROWS = [
  trade('6/12/2026', 'KEEP', 'Buy', 4, 25),
  trade('6/12/2026', 'ACME', 'Buy', 10, 40),
  '"8/11/2026","8/11/2026","8/11/2026","KEEP","Cash Div: R/D 2026-08-01 P/D 2026-08-11 - 4 shares at 0.1","CDIV","","","$0.40"',
]

type Execution = { timestamp: string; quantity: string; price: string; fees?: string }

function order(id: string, side: 'buy' | 'sell', symbol: string | null, executions: Execution[], extra = {}) {
  return {
    id,
    side,
    ...(symbol ? { symbol } : {}),
    instrument_id: `11111111-1111-4111-8111-${symbol === 'KEEP' ? '000000000002' : '000000000001'}`,
    state: 'filled',
    placed_agent: 'user',
    executions: executions.map((e) => ({ fees: '0.00', ...e })),
    ...extra,
  }
}

const sell = (id: string, timestamp: string, quantity: number, price: number, fees = 0) =>
  order(id, 'sell', 'ACME', [{ timestamp, quantity: String(quantity), price: String(price), fees: fees.toFixed(2) }])

type Account = {
  nickname: string
  acme: number
  orders?: unknown[]
  ordersMeta?: { complete?: boolean; createdAtGte?: string }
}

function account({ nickname, acme, orders, ordersMeta }: Account, index: number) {
  const positions = [{ symbol: 'KEEP', name: 'Keep Corp', quantity: '4', instrument_id: '11111111-1111-4111-8111-000000000002' }]
  const lots = [
    {
      symbol: 'KEEP',
      lots: [{ open_lot_id: `keep-${index}`, quantity: '4', cost_basis: '100.00', acquired_date: '2026-06-12' }],
    },
  ]
  // A position the broker reports as gone is simply absent from the snapshot.
  if (acme > 0) {
    positions.push({ symbol: 'ACME', name: 'Acme Corp', quantity: String(acme), instrument_id: '11111111-1111-4111-8111-000000000001' })
    lots.push({
      symbol: 'ACME',
      lots: [{ open_lot_id: `acme-${index}`, quantity: String(acme), cost_basis: (acme * 40).toFixed(2), acquired_date: '2026-06-12' }],
    })
  }
  return {
    accountNumber: `00000000${index}`,
    nickname,
    positions,
    lots,
    ...(orders
      ? { orders: { createdAtGte: '2026-08-01', complete: true, ...ordersMeta, items: orders } }
      : {}),
  }
}

function ingest(csvFiles: Record<string, string[]>, accounts: Account[]) {
  const dir = mkdtempSync(path.join(tmpdir(), 'rh-orders-bridge-'))
  mkdirSync(path.join(dir, 'us-transactions'), { recursive: true })
  for (const [name, rows] of Object.entries(csvFiles)) {
    writeFileSync(path.join(dir, 'us-transactions', name), csv(rows), 'utf8')
  }
  writeSheetPayloads(dir)
  const snapshotPath = path.join(dir, 'robinhood-snapshot.json')
  writeFileSync(
    snapshotPath,
    JSON.stringify({ fetchedAt: '2026-10-10T02:00:00Z', accounts: accounts.map(account) }),
    'utf8'
  )
  const dbPath = runIngest(dir, { env: { STOCK_ROBINHOOD_SNAPSHOT_PATH: snapshotPath }, allowFailure: true })
  const db = new Database(dbPath, { readonly: true })
  // Read in full and closed here: a handle left for the collector to finalize
  // aborts the process under Node 24 once enough of them pile up.
  const checks = new Map(
    (db.prepare('select name, status, severity, detail from validation_checks').all() as
      { name: string; status: string; severity: string; detail: string }[]).map((c) => [c.name, c])
  )
  const result = {
    bridged: db
      .prepare(
        `select date, account, type, ticker, quantity, native_amount, fee, placed_agent, source from transactions
         where source_system = 'robinhood_mcp_orders' order by date, type`
      )
      .all() as Record<string, unknown>[],
    csvRows: (db.prepare(
      `select count(*) as n from transactions where brokerage = 'Robinhood' and source like 'robinhood-transactions-%'`
    ).get() as { n: number }).n,
    realized: db
      .prepare(
        `select ticker, sold_date, round(quantity_sold, 6) as q, round(native_proceeds, 2) as proceeds,
                round(native_realized_gl, 2) as gl, source from realized_lots
         where brokerage = 'Robinhood' and ticker = 'ACME' order by sold_date`
      )
      .all() as Record<string, unknown>[],
    check: (name: string) => checks.get(name),
  }
  db.close()
  return result
}

const MIDTERM_CSV = 'robinhood-transactions-midterm-20260811.csv'

test('a sale after the newest CSV closes the replay position and books its gain from orders', () => {
  const out = ingest(
    { [MIDTERM_CSV]: BASE_ROWS },
    [{ nickname: 'Mid-term', acme: 0, orders: [sell('o-1', '2026-10-09T14:31:02Z', 10, 55, 0.03)] }]
  )

  assert.deepEqual(out.bridged, [
    {
      date: '2026-10-09', account: 'Robinhood Mid-term', type: 'SELL', ticker: 'ACME', quantity: 10,
      native_amount: 549.97, fee: 0.03, placed_agent: 'user', source: 'robinhood-snapshot.json',
    },
  ])
  // Proceeds net of the fee, against the CSV's $40 basis; and the row says
  // where it came from.
  assert.deepEqual(out.realized, [
    { ticker: 'ACME', sold_date: '2026-10-09', q: 10, proceeds: 549.97, gl: 149.97, source: 'robinhood-snapshot.json' },
  ])

  const disposal = out.check('robinhood_replay_missing_disposal')
  assert.equal(disposal?.status, 'pass')
  assert.match(disposal?.detail ?? '', /1 sale\(s\) after the newest CSV come from order fills/)

  const bridge = out.check('robinhood_orders_bridge_csv')
  assert.equal(bridge?.status, 'pass', bridge?.detail)
  assert.match(bridge?.detail ?? '', /Robinhood Mid-term: CSV through 2026-08-11, 1 execution\(s\) bridged/)
  assert.match(bridge?.detail ?? '', /sales from orders: Robinhood Mid-term 2026-10-09 ACME 10/)
})

test('a snapshot with no orders behaves as before, and both checks say the orders were never fetched', () => {
  const out = ingest({ [MIDTERM_CSV]: BASE_ROWS }, [{ nickname: 'Mid-term', acme: 0 }])

  assert.deepEqual(out.bridged, [])
  assert.deepEqual(out.realized, [])
  const disposal = out.check('robinhood_replay_missing_disposal')
  assert.equal(disposal?.status, 'fail')
  assert.equal(disposal?.severity, 'error')
  assert.match(disposal?.detail ?? '', /the snapshot holds no orders/)

  const bridge = out.check('robinhood_orders_bridge_csv')
  assert.equal(bridge?.status, 'fail')
  assert.equal(bridge?.severity, 'warning')
  assert.match(bridge?.detail ?? '', /never fetched/)
})

test('a disposal orders cannot explain still fails the replay check', () => {
  // The broker reports ACME gone, but orders show only 6 of the 10 sold. The
  // other 4 left some way that is not an order — a transfer out, say — and the
  // bridge must not make that look settled.
  const out = ingest(
    { [MIDTERM_CSV]: BASE_ROWS },
    [{ nickname: 'Mid-term', acme: 0, orders: [sell('o-1', '2026-10-09T14:31:02Z', 6, 55)] }]
  )

  assert.equal(out.bridged.length, 1)
  const disposal = out.check('robinhood_replay_missing_disposal')
  assert.equal(disposal?.status, 'fail')
  assert.match(disposal?.detail ?? '', /Robinhood ACME: replay 4 vs holdings 0/)
  assert.match(disposal?.detail ?? '', /what is still missing is not an order/)
})

test('on the cutoff day, a fill the CSV already holds is not counted twice and one it lacks is bridged', () => {
  // The CSV was downloaded mid-session on 08-11: it holds the first sale of
  // that day and not the second.
  const out = ingest(
    { [MIDTERM_CSV]: [...BASE_ROWS, trade('8/11/2026', 'ACME', 'Sell', 2, 50)] },
    [
      {
        nickname: 'Mid-term',
        acme: 7,
        orders: [sell('o-2', '2026-08-11T18:40:00Z', 1, 51), sell('o-1', '2026-08-11T14:00:00Z', 2, 50)],
      },
    ]
  )

  assert.deepEqual(
    out.bridged.map((r) => [r.date, r.type, r.quantity, r.native_amount]),
    [['2026-08-11', 'SELL', 1, 51]]
  )
  // The seam pass never sees bridged rows, so every CSV row survives.
  assert.equal(out.csvRows, 4)
  assert.equal(out.check('robinhood_replay_missing_disposal')?.status, 'pass')
  assert.equal(out.check('robinhood_holdings_replay_provenance')?.status, 'pass')
  assert.match(out.check('robinhood_orders_bridge_csv')?.detail ?? '', /1 on the cutoff day already in the CSV/)
})

test('a cutoff-day fill that matches a CSV row on everything but the amount is named, not bridged', () => {
  // Same day, side and quantity, a cent apart: the same trade with its fee
  // netted differently. Bridging it would sell the shares twice.
  const out = ingest(
    { [MIDTERM_CSV]: [...BASE_ROWS, trade('8/11/2026', 'ACME', 'Sell', 2, 50)] },
    [{ nickname: 'Mid-term', acme: 8, orders: [sell('o-1', '2026-08-11T14:00:00Z', 2, 50, 0.01)] }]
  )

  assert.deepEqual(out.bridged, [])
  const bridge = out.check('robinhood_orders_bridge_csv')
  assert.equal(bridge?.status, 'fail')
  assert.match(bridge?.detail ?? '', /matches a CSV row on the cutoff day except for the amount/)
})

test('a newer CSV covering the window removes every bridged row', () => {
  const orders = [sell('o-1', '2026-10-09T14:31:02Z', 10, 55)]
  const out = ingest(
    {
      [MIDTERM_CSV]: BASE_ROWS,
      'robinhood-transactions-midterm-20261009.csv': [...BASE_ROWS, trade('10/9/2026', 'ACME', 'Sell', 10, 55)],
    },
    [{ nickname: 'Mid-term', acme: 0, orders }]
  )

  assert.deepEqual(out.bridged, [])
  assert.deepEqual(
    out.realized.map((r) => [r.sold_date, r.q, r.source]),
    [['2026-10-09', 10, 'robinhood-transactions-midterm-20261009.csv']]
  )
  assert.equal(out.check('robinhood_replay_missing_disposal')?.status, 'pass')
  assert.match(out.check('robinhood_orders_bridge_csv')?.detail ?? '', /CSV through 2026-10-09, 0 execution\(s\) bridged/)
})

test('a fill at 00:30 UTC is dated the previous Eastern day', () => {
  const out = ingest(
    { [MIDTERM_CSV]: BASE_ROWS },
    [{ nickname: 'Mid-term', acme: 0, orders: [sell('o-1', '2026-10-10T00:30:00Z', 10, 55)] }]
  )
  assert.equal(out.bridged[0]?.date, '2026-10-09')
})

test('an order without a symbol is resolved through its instrument, and a repeated page counts once', () => {
  // The position is gone, so only another order can say which symbol the
  // instrument is: here the June purchase, which is before the cutoff and is
  // itself not bridged.
  const named = order('o-0', 'buy', 'ACME', [{ timestamp: '2026-06-12T14:00:00Z', quantity: '10', price: '40' }])
  const unnamed = order('o-1', 'sell', null, [{ timestamp: '2026-10-09T14:31:02Z', quantity: '10', price: '55' }])
  const out = ingest(
    { [MIDTERM_CSV]: BASE_ROWS },
    [{ nickname: 'Mid-term', acme: 0, orders: [unnamed, unnamed, named] }]
  )
  assert.deepEqual(out.bridged.map((r) => [r.ticker, r.quantity]), [['ACME', 10]])
  assert.equal(out.check('robinhood_replay_missing_disposal')?.status, 'pass')
})

test('an order whose instrument cannot be resolved is named, and the sale stays missing', () => {
  const unnamed = order('o-1', 'sell', null, [{ timestamp: '2026-10-09T14:31:02Z', quantity: '10', price: '55' }])
  const out = ingest({ [MIDTERM_CSV]: BASE_ROWS }, [{ nickname: 'Mid-term', acme: 0, orders: [unnamed] }])
  assert.deepEqual(out.bridged, [])
  assert.match(out.check('robinhood_orders_bridge_csv')?.detail ?? '', /no symbol for instrument/)
  assert.equal(out.check('robinhood_replay_missing_disposal')?.status, 'fail')
})

test('an account with no CSV bridges nothing, and the check says why', () => {
  const out = ingest(
    { [MIDTERM_CSV]: BASE_ROWS },
    [
      { nickname: 'Mid-term', acme: 10, orders: [] },
      {
        nickname: 'Long Term',
        acme: 0,
        orders: [order('o-9', 'buy', 'KEEP', [{ timestamp: '2026-09-01T15:00:00Z', quantity: '4', price: '25' }])],
      },
    ]
  )
  assert.deepEqual(out.bridged, [])
  assert.match(out.check('robinhood_orders_bridge_csv')?.detail ?? '', /Robinhood Long-term: no CSV, so nothing is bridged/)
})

test('a pull cut short, or fetched from after the cutoff, fails the bridge check', () => {
  const short = ingest(
    { [MIDTERM_CSV]: BASE_ROWS },
    [{ nickname: 'Mid-term', acme: 10, orders: [], ordersMeta: { complete: false } }]
  )
  assert.equal(short.check('robinhood_orders_bridge_csv')?.status, 'fail')
  assert.match(short.check('robinhood_orders_bridge_csv')?.detail ?? '', /not marked complete/)

  const late = ingest(
    { [MIDTERM_CSV]: BASE_ROWS },
    [{ nickname: 'Mid-term', acme: 10, orders: [], ordersMeta: { createdAtGte: '2026-09-01' } }]
  )
  assert.equal(late.check('robinhood_orders_bridge_csv')?.status, 'fail')
  assert.match(late.check('robinhood_orders_bridge_csv')?.detail ?? '', /fetched from 2026-09-01, after the CSV cutoff 2026-08-11/)
})
