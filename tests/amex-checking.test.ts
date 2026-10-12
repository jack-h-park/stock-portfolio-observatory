// American Express Rewards Checking statements: the extractor and the filer.
// Every name, number and amount is invented; the repository is public.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { amexPages, PY, ROOT, STATEMENT_APR, STATEMENT_FEB, STATEMENT_MAR } from './amex-fixtures'

const LOAD = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('bank', 'scripts/extract-bank-statements.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
pages = json.loads(sys.argv[1])
lines = [line for page in pages for line in page.split("\\n")]
`
const py = (pages: string[], body: string) =>
  JSON.parse(execFileSync(PY, ['-I', '-c', LOAD + body, JSON.stringify(pages)], { cwd: ROOT, encoding: 'utf8' }))

test('a statement is read into a summary and one row per printed line of the table, markers included', () => {
  const r = py(amexPages(STATEMENT_MAR), `
summary, rows = m.parse_amex_lines(lines)
print(json.dumps({"summary": summary, "rows": rows, "problems": m.amex_problems(summary, rows)}))`)
  assert.deepEqual(r.summary, {
    last4: '0042', begin_date: '2025-03-01', begin: 1000, end_date: '2025-03-31', end: 2176.12,
    credits: 1501.12, debits: -325, interest: 1.12,
  })
  assert.deepEqual(r.rows.map((t: any) => [t.date, t.amount, t.balance, t.marker]), [
    ['2025-03-01', 0, 1000, true],
    ['2025-03-05', 1500, 2500, false],
    ['2025-03-12', -250, 2250, false],
    ['2025-03-20', -75, 2175, false],
    ['2025-03-31', 1.12, 2176.12, false],
    ['2025-03-31', 0, 2176.12, true],
  ])
  assert.deepEqual(r.problems, [])
})

test('a wrapped description is one string, the bank reference line is dropped, and no page furniture leaks in', () => {
  const r = py(amexPages(STATEMENT_MAR), `
rows = m.parse_amex_lines(lines)[1]
print(json.dumps([t["description"] for t in rows]))`)
  assert.deepEqual(r, [
    'Beginning Balance',
    'Online Transfer / Payment: Credit EXAMPLE CO PAYROLL *****0001 XXXX0002 Example Holder External - EXAMPLE BANK, N.A.',
    'Online Transfer / Payment: Debit Robinhood Money Payment *****0003 EXAMPLE HOLDER External - EXAMPLE CREDIT UNION',
    'Zelle Payment To EXAMPLE FRIEND',
    'Interest Deposit',
    'Ending Balance',
  ])
})

test('a description that wraps across the page break is still one row', () => {
  // Page 1 ends after "EXAMPLE HOLDER External - EXAMPLE"; page 2 repeats its header and continues with "CREDIT UNION".
  const r = py(amexPages({ ...STATEMENT_MAR, split: 9 }), `
summary, rows = m.parse_amex_lines(lines)
print(json.dumps({"descriptions": [t["description"] for t in rows], "problems": m.amex_problems(summary, rows)}))`)
  assert.equal(r.descriptions[2], 'Online Transfer / Payment: Debit Robinhood Money Payment *****0003 EXAMPLE HOLDER External - EXAMPLE CREDIT UNION')
  assert.equal(r.descriptions.length, 6)
  assert.deepEqual(r.problems, [])
})

test('a statement with no transactions reads as its two balance markers and agrees with its summary', () => {
  const r = py(amexPages(STATEMENT_FEB), `
summary, rows = m.parse_amex_lines(lines)
print(json.dumps({"rows": [[t["date"], t["amount"], t["balance"], t["marker"]] for t in rows], "problems": m.amex_problems(summary, rows)}))`)
  assert.deepEqual(r.rows, [['2025-02-01', 0, 1000, true], ['2025-02-28', 0, 1000, true]])
  assert.deepEqual(r.problems, [])
})

test('every way the rows can disagree with the summary is named', () => {
  const bad = (rows: string[]) => py(amexPages({ ...STATEMENT_MAR, rows }), `
summary, rows = m.parse_amex_lines(lines)
print(json.dumps(m.amex_problems(summary, rows)))`)
  // A debit amount changed: the balance chain, the debit total and the closing balance no longer agree.
  const changed = STATEMENT_MAR.rows.map((r) => r.replace('-$250.00 $2,250.00', '-$251.00 $2,250.00'))
  assert.match(bad(changed).join(' | '), /credit and debit totals/)
  // A row dropped: the totals and the interest no longer add up.
  const dropped = STATEMENT_MAR.rows.filter((r) => !r.startsWith('03/31/2025 Interest Deposit') && r !== 'ID 000000000000004')
  assert.match(bad(dropped).join(' | '), /interest/)
  // No Ending Balance row: the table is cut short.
  const cut = STATEMENT_MAR.rows.slice(0, -1)
  assert.match(bad(cut).join(' | '), /Beginning\/Ending Balance rows/)
})

test('the debit sign is the printed one: a credit is never negated and "$0.00" debits read as zero', () => {
  const r = py(amexPages(STATEMENT_APR), `
summary, rows = m.parse_amex_lines(lines)
print(json.dumps({"debits": summary["debits"], "amounts": [t["amount"] for t in rows if not t["marker"]]}))`)
  assert.equal(r.debits, 0)
  assert.deepEqual(r.amounts, [300, 1.4])
})
