// USD transfers between two accounts on file are paired when the rows name each
// other's institution. Every name and amount is invented.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { amexPages, PY, ROOT, runExtract, STATEMENT_MAR } from './amex-fixtures'

const HARNESS = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('bank', 'scripts/extract-bank-statements.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
def src(inst, alias, cur, rows):
    return (inst, alias, cur, [{"date": d, "seq": i, "description": desc, "amount": a, "balance": None} for i, (d, desc, a) in enumerate(rows)])
`
const run = (body: string) => JSON.parse(execFileSync(PY, ['-I', '-c', HARNESS + body], { cwd: ROOT, encoding: 'utf8' }))

test('a debit and a credit of the same size in two accounts pair when one names the other institution, in either date order', () => {
  const r = run(`
sources = [
  src("amex", "Amex", "USD", [("2025-03-12", "Online Transfer / Payment: Debit Robinhood Money Payment", -250.0)]),
  src("robinhood-bank", "RH", "USD", [("2025-03-11", "ACH Deposit from American Express", 250.0)]),
]
n = m.pair_usd_transfers(sources)
print(json.dumps({"n": n, "flags": [[t.get("ownTransfer", False) for t in s[3]] for s in sources]}))`)
  assert.equal(r.n, 1)
  assert.deepEqual(r.flags, [[true], [true]])
})

test('equal and opposite rows that name no institution are a coincidence and stay unmarked', () => {
  const r = run(`
sources = [
  src("amex", "Amex", "USD", [("2025-03-20", "Zelle Payment To EXAMPLE FRIEND", -75.0)]),
  src("chase", "Chase", "USD", [("2025-03-21", "Zelle payment from EXAMPLE OTHER", 75.0)]),
]
print(json.dumps({"n": m.pair_usd_transfers(sources), "flags": [[t.get("ownTransfer", False) for t in s[3]] for s in sources]}))`)
  assert.equal(r.n, 0)
  assert.deepEqual(r.flags, [[false], [false]])
})

test('three days apart pairs and four does not; a different amount by a cent does not', () => {
  const r = run(`
def case(gap_day, amount):
    sources = [
      src("amex", "Amex", "USD", [("2025-03-10", "Payment to Chase", -100.0)]),
      src("chase", "Chase", "USD", [(gap_day, "Deposit from American Express", amount)]),
    ]
    return m.pair_usd_transfers(sources)
print(json.dumps({"three": case("2025-03-13", 100.0), "four": case("2025-03-14", 100.0), "cent": case("2025-03-11", 100.01)}))`)
  assert.deepEqual(r, { three: 1, four: 0, cent: 0 })
})

test('with two equal credits and one debit only the nearest pairs', () => {
  const r = run(`
sources = [
  src("amex", "Amex", "USD", [("2025-03-10", "Payment to Robinhood", -500.0)]),
  src("robinhood-bank", "RH", "USD", [("2025-03-13", "ACH Deposit from American Express", 500.0), ("2025-03-11", "ACH Deposit from American Express", 500.0)]),
]
n = m.pair_usd_transfers(sources)
print(json.dumps({"n": n, "rh": [[t["date"], t.get("ownTransfer", False)] for t in sources[1][3]]}))`)
  assert.equal(r.n, 1)
  assert.deepEqual(r.rh, [['2025-03-13', false], ['2025-03-11', true]])
})

test('rows of one account never pair with each other, and KRW rows are left to the KRW pairing', () => {
  const r = run(`
usd = [src("chase", "Chase", "USD", [("2025-03-10", "Refund from Chase", 40.0), ("2025-03-10", "Chase card payment", -40.0)])]
krw = [
  src("tossbank", "T", "KRW", [("2025-03-10", "Chase", -100000.0)]),
  src("mg", "M", "KRW", [("2025-03-10", "Chase", 100000.0)]),
]
print(json.dumps({"usd": m.pair_usd_transfers(usd), "krw": m.pair_usd_transfers(krw)}))`)
  assert.deepEqual(r, { usd: 0, krw: 0 })
})

test('end to end: the Robinhood credit that follows an Amex debit is an own transfer, the employer credit is not', () => {
  const doc = runExtract(
    {
      'amex-checking-0042-20250301-20250331.pdf': amexPages(STATEMENT_MAR),
      'robinhood-bank-checking-20250311-20250321.csv': [
        'Date,Description,Amount',
        '2025-03-21,ACH Deposit from EXAMPLE FRIEND,75.00',
        '2025-03-11,ACH Deposit from American Express,250.00',
      ].join('\n'),
    },
    {
      bankAccounts: [
        { institution: 'amex', kind: 'checking', currency: 'USD', last4: '0042', alias: 'Example Amex checking' },
        { institution: 'robinhood-bank', kind: 'checking', currency: 'USD', alias: 'Example RH checking' },
      ],
      anchors: [{ alias: 'Example RH checking', date: '2025-03-21', balance: 400 }],
    },
  )
  const byDescription = Object.fromEntries(doc.inflows.map((f: any) => [f.description, f.ownTransfer]))
  assert.equal(byDescription['ACH Deposit from American Express'], true)
  assert.equal(byDescription['ACH Deposit from EXAMPLE FRIEND'], false)
  assert.equal(byDescription['Online Transfer / Payment: Credit EXAMPLE CO PAYROLL *****0001 XXXX0002 Example Holder External - EXAMPLE BANK, N.A.'], false)
  assert.ok(doc.notes.some((n: string) => /1 USD transfer/.test(n)), JSON.stringify(doc.notes))
})

test('an institution name inside another word is not evidence: "purchase" is not Chase', () => {
  const r = run(`
sources = [
  src("fidelity", "Fid", "USD", [("2025-03-05", "DEBIT CARD PURCHASE EXAMPLE STORE", -50.0)]),
  src("chase", "Chase", "USD", [("2025-03-06", "Zelle payment from EXAMPLE FRIEND", 50.0)]),
]
print(json.dumps({"n": m.pair_usd_transfers(sources), "flags": [[t.get("ownTransfer", False) for t in s[3]] for s in sources]}))`)
  assert.equal(r.n, 0)
  assert.deepEqual(r.flags, [[false], [false]])
})

test('paying a card issued by an institution is not a transfer to it, so a same-size credit stays income', () => {
  const r = run(`
def case(desc):
    sources = [
      src("chase", "Chase", "USD", [("2025-03-10", desc, -1200.0)]),
      src("amex", "Amex", "USD", [("2025-03-11", "Online Transfer / Payment: Credit EXAMPLE CO PAYROLL", 1200.0)]),
    ]
    return m.pair_usd_transfers(sources)
print(json.dumps({"card": case("AMERICAN EXPRESS ACH PMT"), "epay": case("AMEX EPAYMENT"), "autopay": case("AMERICAN EXPRESS AUTOPAY"),
                  "transfer": case("Online Transfer to American Express checking")}))`)
  assert.deepEqual(r, { card: 0, epay: 0, autopay: 0, transfer: 1 })
})
