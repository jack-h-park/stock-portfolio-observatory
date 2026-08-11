import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

// `build_lots` had two different problems sharing one output channel, and that
// channel ended at stderr. Nothing turned them into a check, so on 2026-08-10 a
// split stopped being restatable, the run printed `split not restatable` six
// times, and every check passed. It surfaced only because #90 happened to add a
// dividend-attribution check that tripped over the same broken date — the
// holding period had been wrong the whole time.
//
// The notes are now `(kind, detail)` pairs that go through `report()` like every
// other finding. These tests drive the real `build_lots` rather than asserting
// on the prose: what matters is which kind comes out of which situation, and
// that the situation the fix exists for produces no note at all.
//
// The lot engine is Python and this repo's runner is `tsx --test`, so the test
// drives it through a harness. `extract-kr-statements.py` imports pdfplumber at
// module level for the parsers it also holds; the harness stubs that import
// rather than requiring the dependency, because nothing under test reads a PDF.

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const PY = process.env.STOCK_PYTHON_BIN || 'python3'

const TRANSACTION_COLUMNS = [
  'Date', 'Account', 'Type', 'Raw Type', 'Ticker', 'Name', 'Quantity',
  'Currency', 'Native Amount', 'FX Rate',
  'Amount (KRW)', 'Settlement (KRW)', 'Unit Price', 'Fee', 'Tax', 'Balance',
  'Source', 'Page',
]

let pageCounter = 0

/** One transaction row; only the fields the lot walk reads need naming. */
function row(o) {
  const base = {
    Account: '미래에셋증권(종합)', Ticker: 'APL', Name: '애플', Currency: 'KRW',
    'Native Amount': 0, 'FX Rate': '', 'Amount (KRW)': 0, 'Settlement (KRW)': 0,
    'Unit Price': 0, Fee: 0, Tax: 0, Balance: 0,
    Source: 'test.pdf', Page: ++pageCounter,
  }
  const merged = { ...base, ...o }
  return Object.fromEntries(TRANSACTION_COLUMNS.map((c) => [c, merged[c] ?? '']))
}

const HARNESS = `
import importlib.util, json, sys, types

# Nothing under test reads a PDF; the parsers that do are imported by the same
# module. Stub the dependency instead of requiring it to run a pure function.
for name in ("pdfplumber",):
    sys.modules.setdefault(name, types.ModuleType(name))

spec = importlib.util.spec_from_file_location("kr_extract", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
sys.modules["kr_extract"] = mod
spec.loader.exec_module(mod)

payload = json.load(open(sys.argv[2]))
taxlots, realized, notes, carried = mod.build_lots(payload["transactions"], payload["asOf"])
print(json.dumps({
    "taxlots": taxlots,
    "realized": realized,
    "notes": [{"kind": k, "detail": d} for k, d in notes],
    "carried": carried,
}, ensure_ascii=False, default=str))
`

function buildLots(transactions, asOf = { '미래에셋증권(종합)': '2026-01-01' }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'kr-lots-'))
  const harness = path.join(dir, 'harness.py')
  const payload = path.join(dir, 'payload.json')
  writeFileSync(harness, HARNESS, 'utf8')
  writeFileSync(payload, JSON.stringify({ transactions, asOf }), 'utf8')
  const out = execFileSync(
    PY,
    [harness, path.join(REPO_ROOT, 'scripts/extract-kr-statements.py'), payload],
    { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  )
  return JSON.parse(out)
}

const kinds = (r) => r.notes.map((n) => n.kind).sort()

test('a split with an open lot keeps the acquisition date and reports nothing', () => {
  // The real 2020 Apple 4-for-1, and the case the whole mechanism exists for.
  // Booked as an out and an in, replayed literally it would close the 2020-03-30
  // lot and open one dated 2020-08-31 — which is what decides long versus short
  // term on the eventual sale.
  const r = buildLots([
    row({ Date: '2020-03-30', Type: 'BUY', 'Raw Type': '해외주식매수입고', Quantity: 1, 'Unit Price': 100, 'Native Amount': 100 }),
    row({ Date: '2020-08-31', Type: 'STOCK_SPLIT', 'Raw Type': '액면분할출고(해외)', Quantity: 1 }),
    row({ Date: '2020-08-31', Type: 'STOCK_SPLIT', 'Raw Type': '액면분할입고(해외)', Quantity: 4 }),
    row({ Date: '2021-01-04', Type: 'SELL', 'Raw Type': '해외주식매도출고', Quantity: 4, 'Unit Price': 30, 'Native Amount': 120 }),
  ])

  assert.deepEqual(r.notes, [], `expected no notes, got ${JSON.stringify(r.notes)}`)
  assert.equal(r.realized.length, 1)
  assert.equal(r.realized[0]['Acquired Date'], '2020-03-30')
  assert.equal(Number(r.realized[0]['Quantity Sold']), 4)
  // The restatement is announced on the `carried` channel — an event the
  // statement declared and the walk handled, not a problem.
  assert.match(r.carried.join('\n'), /restated x4\.0.*acquisition dates kept/)
})

test('a split with nothing open to restate is reported under its own kind', () => {
  // One side only: the inbound shares are real, so they are replayed as a
  // movement — and the acquisition date becomes the split date. That is the
  // silent wrong answer the note exists to name.
  const r = buildLots([
    row({ Date: '2020-08-31', Type: 'STOCK_SPLIT', 'Raw Type': '액면분할입고(해외)', Quantity: 4, 'Unit Price': 25 }),
  ])

  assert.deepEqual(kinds(r), ['split-not-restatable'])
  assert.match(r.notes[0].detail, /split not restatable/)
  // The consequence is stated in the note, not left to be rediscovered.
  assert.match(r.notes[0].detail, /acquisition date becomes the split date/)
})

test('a disposal with no open lot is a different finding, not the same one', () => {
  // Both used to print under one heading that described only this case, so a
  // split note was actively mislabelled. Distinct kinds are the fix.
  const r = buildLots([
    row({ Date: '2024-03-28', Type: 'SELL', 'Raw Type': '주식매도출고', Quantity: 5, 'Unit Price': 10, 'Native Amount': 50 }),
  ])

  assert.deepEqual(kinds(r), ['disposal-without-open-lot'])
  assert.match(r.notes[0].detail, /5 unit\(s\) disposed with no matching open lot/)
})

test('the two kinds are reported separately when both happen in one run', () => {
  const r = buildLots([
    row({ Date: '2020-08-31', Type: 'STOCK_SPLIT', 'Raw Type': '액면분할입고(해외)', Quantity: 4, 'Unit Price': 25, Ticker: 'APL' }),
    row({ Date: '2024-03-28', Type: 'SELL', 'Raw Type': '주식매도출고', Quantity: 5, 'Unit Price': 10, 'Native Amount': 50, Ticker: 'SPY', Name: 'SPY' }),
  ])

  assert.deepEqual(kinds(r), ['disposal-without-open-lot', 'split-not-restatable'])
})
