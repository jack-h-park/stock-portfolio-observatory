import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

// A dollar trade in a Korean account carries its won amount on the certificate:
// 외화거래금액 times the 환율 the broker applied that day. The lot walk used to
// keep only the dollars, leaving the ingest to convert the cost at whatever date
// it had to hand, which was the SALE date. Every won gain on a dollar lot then
// lost the currency's move over the holding period: a QQQ share bought for
// ₩436,919 in 2021 was costed at ₩531,016, the 2025 rate.
//
// Same harness as kr-lot-notes: the module imports pdfplumber at load time, and
// nothing here reads a PDF.

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const PY = process.env.STOCK_PYTHON_BIN || 'python3'
const ACCOUNT = '미래에셋증권(종합)'

const TRANSACTION_COLUMNS = [
  'Date', 'Account', 'Type', 'Raw Type', 'Ticker', 'Name', 'Quantity',
  'Currency', 'Native Amount', 'FX Rate',
  'Amount (KRW)', 'Settlement (KRW)', 'Unit Price', 'Fee', 'Tax', 'Balance',
  'Source', 'Page',
]

let pageCounter = 0
function row(o) {
  const base = {
    Account: ACCOUNT, Ticker: 'QQQ', Name: 'INVESCO QQQ TRUST', Currency: 'USD',
    'Native Amount': 0, 'FX Rate': '', 'Amount (KRW)': '', 'Settlement (KRW)': '',
    'Unit Price': 0, Fee: 0, Tax: 0, Balance: 0,
    Source: 'test.pdf', Page: ++pageCounter,
  }
  const merged = { ...base, ...o }
  return Object.fromEntries(TRANSACTION_COLUMNS.map((c) => [c, merged[c] ?? '']))
}

const buy = (date, qty, usd, rate) => row({
  Date: date, Type: 'BUY', 'Raw Type': '해외주식매수입고', Quantity: qty,
  'Unit Price': usd / qty, 'Native Amount': usd, 'FX Rate': rate, 'Amount (KRW)': usd * rate,
})
const sell = (date, qty, usd, rate) => row({
  Date: date, Type: 'SELL', 'Raw Type': '해외주식매도출고', Quantity: qty,
  'Unit Price': usd / qty, 'Native Amount': usd, 'FX Rate': rate, 'Amount (KRW)': usd * rate,
})

const HARNESS = `
import importlib.util, json, sys, types
sys.modules.setdefault("pdfplumber", types.ModuleType("pdfplumber"))
spec = importlib.util.spec_from_file_location("kr_extract", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
payload = json.load(open(sys.argv[2]))
taxlots, realized, notes, carried = mod.build_lots(payload["transactions"], payload["asOf"])
print(json.dumps({"taxlots": taxlots, "realized": realized,
                  "notes": [{"kind": k, "detail": d} for k, d in notes]}, ensure_ascii=False, default=str))
`

function buildLots(transactions) {
  const dir = mkdtempSync(path.join(tmpdir(), 'kr-usd-lots-'))
  const harness = path.join(dir, 'harness.py')
  const payload = path.join(dir, 'payload.json')
  writeFileSync(harness, HARNESS, 'utf8')
  writeFileSync(payload, JSON.stringify({ transactions, asOf: { [ACCOUNT]: '2026-01-01' } }), 'utf8')
  const out = execFileSync(
    PY,
    [harness, path.join(REPO_ROOT, 'scripts/extract-kr-statements.py'), payload],
    { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  )
  return JSON.parse(out)
}

test('a dollar lot carries the won the broker booked on each leg', () => {
  const r = buildLots([
    buy('2021-08-31', 1, 400, 1_200),
    sell('2025-10-29', 1, 600, 1_400),
  ])

  assert.equal(r.realized.length, 1)
  const lot = r.realized[0]
  assert.equal(lot.Currency, 'USD')
  assert.equal(lot['Cost Basis (KRW)'], 480_000)
  assert.equal(lot['Proceeds (KRW)'], 840_000)
  // At one rate this was 200 × 1,400 = ₩280,000; the won also moved.
  assert.equal(lot['Realized G/L (KRW)'], 360_000)
})

test('a partial sale prorates the won cost and leaves the rest on the open lot', () => {
  const r = buildLots([
    buy('2021-08-31', 4, 1_600, 1_200),
    sell('2025-10-29', 1, 600, 1_400),
  ])

  assert.equal(r.realized[0]['Cost Basis (KRW)'], 480_000)
  assert.equal(r.taxlots.length, 1)
  assert.equal(r.taxlots[0]['Open Quantity'], 3)
  assert.equal(r.taxlots[0]['Cost Basis (KRW)'], 1_440_000)
  assert.equal(r.taxlots[0]['Unit Cost'], 480_000)
})

test('a split restates the won cost per share along with the dollar cost', () => {
  const r = buildLots([
    buy('2020-03-30', 1, 400, 1_200),
    row({ Date: '2020-08-31', Type: 'STOCK_SPLIT', 'Raw Type': '액면분할출고(해외)', Quantity: 1 }),
    row({ Date: '2020-08-31', Type: 'STOCK_SPLIT', 'Raw Type': '액면분할입고(해외)', Quantity: 4 }),
    sell('2025-10-29', 4, 2_400, 1_400),
  ])

  assert.equal(r.realized.length, 1)
  assert.equal(r.realized[0]['Cost Basis (KRW)'], 480_000)
  assert.equal(r.realized[0]['Proceeds (KRW)'], 3_360_000)
})

test('a lot with no won figure is left for the ingest to convert at its acquisition date', () => {
  const r = buildLots([
    row({ Date: '2021-08-31', Type: 'BUY', 'Raw Type': '해외주식매수입고', Quantity: 1, 'Unit Price': 400, 'Native Amount': 400 }),
    sell('2025-10-29', 1, 600, 1_400),
  ])

  assert.equal(r.realized[0]['Cost Basis (KRW)'], '')
  assert.equal(r.realized[0]['Proceeds (KRW)'], 840_000)
  // Without both legs in won there is no won gain to state here.
  assert.equal(r.realized[0]['Realized G/L (KRW)'], '')
})

test('a fractional share moved in with no cash leg takes the currency its trades are booked in', () => {
  // 소수해외대체입고 books no amount, so the certificate leaves the currency at
  // KRW while the 단가 is in dollars: BRK.B's $7.29 lot was costed at ₩7.
  const r = buildLots([
    row({
      Date: '2025-07-10', Type: 'TRANSFER_IN', 'Raw Type': '소수해외대체입고', Ticker: 'BRK.B',
      Name: '버크셔 해서웨이 B', Currency: 'KRW', Quantity: 0.0153, 'Unit Price': 477.47,
    }),
    sell('2025-10-29', 0.0153, 7.48, 1_400),
  ].map((r) => (r.Ticker === 'QQQ' ? { ...r, Ticker: 'BRK.B', Name: '버크셔 해서웨이 B' } : r)))

  assert.equal(r.realized.length, 1)
  assert.equal(r.realized[0].Currency, 'USD')
  assert.equal(r.realized[0]['Cost Basis (KRW)'], '')
  assert.equal(r.realized[0]['Proceeds (KRW)'], 10_472)
})
