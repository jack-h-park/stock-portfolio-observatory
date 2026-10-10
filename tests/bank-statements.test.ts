import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')
const LOAD = `
import importlib.util, json
spec=importlib.util.spec_from_file_location('bank', 'scripts/extract-bank-statements.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
`
const py = (body: string) => JSON.parse(execFileSync('python3', ['-c', LOAD + body], { cwd: ROOT, encoding: 'utf8' }))

test('newest-first Chase rows give the end-of-day balance of the chronologically last transaction', () => {
  const r = py(`
text = "\\n".join([
 "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
 "DEBIT,10/01/2026,\\"LATE\\",-5.00,ACH_DEBIT,945.00,,",
 "DEBIT,10/01/2026,\\"EARLY\\",-50.00,ACH_DEBIT,950.00,,",
 "CREDIT,09/15/2026,\\"PAY\\",1000.00,ACH_CREDIT,1000.00,,"])
print(json.dumps(m.end_of_day(m.parse_chase(text))))`)
  assert.deepEqual(r, [{ date: '2026-09-15', balance: 1000 }, { date: '2026-10-01', balance: 945 }])
})

test('an overlapping second download of the same statement counts each transaction once', () => {
  const r = py(`
a = m.parse_robinhood_bank("Date,Description,Amount\\n2026-09-02,\\"X\\",-10.00\\n2026-09-01,\\"Y\\",30.00")
b = m.parse_robinhood_bank("Date,Description,Amount\\n2026-09-03,\\"Z\\",5.00\\n2026-09-02,\\"X\\",-10.00")
merged = m.merge_txns([a, b])
print(json.dumps([t["amount"] for t in merged]))`)
  assert.deepEqual(r, [30, -10, 5])
})

test('an anchor balance walks both backwards and forwards through rows without a balance', () => {
  const r = py(`
t = m.merge_txns([m.parse_robinhood_bank("Date,Description,Amount\\n2026-09-03,\\"Z\\",5.00\\n2026-09-02,\\"X\\",-10.00\\n2026-09-01,\\"Y\\",30.00")])
print(json.dumps(m.walk_from_anchor(t, "2026-09-02", 100.0)))`)
  // 09-01 end: 110 (100 + 10 undone); 09-02 end: 100; 09-03 end: 105
  assert.deepEqual(r, [{ date: '2026-09-01', balance: 110 }, { date: '2026-09-02', balance: 100 }, { date: '2026-09-03', balance: 105 }])
})

test('an anchor dated after every transaction still walks back', () => {
  const r = py(`
t = m.merge_txns([m.parse_robinhood_bank("Date,Description,Amount\\n2026-09-01,\\"Y\\",30.00")])
print(json.dumps(m.walk_from_anchor(t, "2026-10-09", 130.0)))`)
  assert.deepEqual(r, [{ date: '2026-09-01', balance: 130 }])
})

test('a gap in a running-balance statement is reported as a continuity break', () => {
  const r = py(`
text = "\\n".join(["Description,,Summary Amt.","Beginning balance as of 06/01/2025,,\\"100.00\\"","","","","",
 "Date,Description,Amount,Running Bal.",
 "06/01/2025,Beginning balance as of 06/01/2025,,\\"100.00\\"",
 "06/02/2025,\\"A\\",\\"50.00\\",\\"150.00\\"",
 "06/03/2025,\\"B\\",\\"-20.00\\",\\"200.00\\""])
print(json.dumps(m.continuity_breaks(m.parse_boa(text))))`)
  assert.equal(r.length, 1)
  assert.match(r[0], /2025-06-03/)
})

test('two identical rows inside one file stay two, and an overlapping second download adds nothing', () => {
  const r = py(`
a = m.parse_robinhood_bank("Date,Description,Amount\\n2026-09-02,\\"X\\",-10.00\\n2026-09-02,\\"X\\",-10.00\\n2026-09-01,\\"Y\\",30.00")
b = m.parse_robinhood_bank("Date,Description,Amount\\n2026-09-03,\\"Z\\",5.00\\n2026-09-02,\\"X\\",-10.00")
merged = m.merge_txns([a, b])
print(json.dumps([t["amount"] for t in merged]))`)
  assert.deepEqual(r, [30, -10, -10, 5])
})

test('parse_mg_rows orders rows chronologically, signs the amounts, and end_of_day takes the later time', () => {
  const r = py(`
rows = [
 ["title row"],
 ["번호", "거래일자", "거래시간", "적요", "출금액", "입금액", "잔액"],
 ["3", "2026.09.02", "15:00:00", "B", "0", "200", "1300"],
 ["2", "2026.09.02", "09:00:00", "A", "100", "0", "1100"],
 ["1", "2026.09.01", "10:00:00", "C", "0", "1200", "1200"],
]
t = m.parse_mg_rows(rows)
print(json.dumps({"order": [x["date"] for x in t], "amounts": [x["amount"] for x in t], "eod": m.end_of_day(t)}))`)
  assert.deepEqual(r.order, ['2026-09-01', '2026-09-02', '2026-09-02'])
  assert.deepEqual(r.amounts, [1200, -100, 200])
  assert.deepEqual(r.eod, [{ date: '2026-09-01', balance: 1200 }, { date: '2026-09-02', balance: 1300 }])
})
