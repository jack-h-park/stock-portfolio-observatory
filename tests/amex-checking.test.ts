// American Express Rewards Checking statements: the extractor and the filer.
// Every name, number and amount is invented; the repository is public.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { amexPages, HOLDER, MAP, PY, ROOT, runExtract, STATEMENT_APR, STATEMENT_FEB, STATEMENT_MAR } from './amex-fixtures'

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

const FILES = {
  'amex-checking-0042-20250201-20250228.pdf': amexPages(STATEMENT_FEB),
  'amex-checking-0042-20250301-20250331.pdf': amexPages(STATEMENT_MAR),
  'amex-checking-0042-20250401-20250430.pdf': amexPages(STATEMENT_APR),
}

test('three consecutive statements are one USD checking account named by its map entry, with continuous balances', () => {
  const doc = runExtract(FILES)
  assert.deepEqual(doc.findings, [])
  assert.equal(doc.accounts.length, 1)
  const a = doc.accounts[0]
  assert.deepEqual([a.institution, a.account, a.kind, a.currency, a.derived, a.owner], ['amex', 'Example Amex checking', 'checking', 'USD', false, 'self'])
  assert.deepEqual(a.continuityBreaks, [])
  assert.equal(a.sources.length, 3)
  assert.deepEqual(a.balances, [
    { date: '2025-02-01', balance: 1000 },
    { date: '2025-02-28', balance: 1000 },
    { date: '2025-03-01', balance: 1000 },
    { date: '2025-03-05', balance: 2500 },
    { date: '2025-03-12', balance: 2250 },
    { date: '2025-03-20', balance: 2175 },
    { date: '2025-03-31', balance: 2176.12 },
    { date: '2025-04-01', balance: 2176.12 },
    { date: '2025-04-15', balance: 2476.12 },
    { date: '2025-04-30', balance: 2477.52 },
  ])
})

test('a statement with no transactions still writes its balances and raises no finding', () => {
  const doc = runExtract({ 'amex-checking-0042-20250201-20250228.pdf': amexPages(STATEMENT_FEB) })
  assert.deepEqual(doc.findings, [])
  assert.deepEqual(doc.accounts[0].balances, [{ date: '2025-02-01', balance: 1000 }, { date: '2025-02-28', balance: 1000 }])
  assert.deepEqual(doc.inflows, [])
})

test('only credits become inflows; balance markers and debits never do, and the reference line is not in a description', () => {
  const doc = runExtract(FILES)
  assert.deepEqual(doc.inflows.map((f: any) => [f.date, f.amount, f.ownTransfer, f.institution, f.account, f.currency]), [
    ['2025-03-05', 1500, false, 'amex', 'Example Amex checking', 'USD'],
    ['2025-03-31', 1.12, false, 'amex', 'Example Amex checking', 'USD'],
    ['2025-04-15', 300, false, 'amex', 'Example Amex checking', 'USD'],
    ['2025-04-30', 1.4, false, 'amex', 'Example Amex checking', 'USD'],
  ])
  assert.ok(doc.inflows.every((f: any) => !/ID \d{6,}/.test(f.description)))
  assert.equal(doc.inflows[1].description, 'Interest Deposit')
})

test('the same statement downloaded twice counts once', () => {
  const doc = runExtract({
    'amex-checking-0042-20250301-20250331.pdf': amexPages(STATEMENT_MAR),
    'amex-checking-0042-20250301-20250331-1.pdf': amexPages(STATEMENT_MAR),
  })
  assert.deepEqual(doc.findings, [])
  assert.equal(doc.inflows.length, 2)
  assert.deepEqual(doc.accounts[0].continuityBreaks, [])
  assert.equal(doc.accounts[0].balances.length, 5)
})

test('with no map entry the account is named amex <last4>', () => {
  const doc = runExtract({ 'amex-checking-0042-20250301-20250331.pdf': amexPages(STATEMENT_MAR) }, { bankAccounts: [] })
  assert.equal(doc.accounts[0].account, 'amex 0042')
  assert.equal(doc.accounts[0].kind, 'checking')
})

test('a statement that disagrees with its own summary is skipped whole, with a finding that names the file', () => {
  const tampered = { ...STATEMENT_MAR, rows: STATEMENT_MAR.rows.map((r) => r.replace('-$250.00 $2,250.00', '-$251.00 $2,250.00')) }
  const doc = runExtract({ 'amex-checking-0042-20250301-20250331.pdf': amexPages(tampered) })
  assert.deepEqual(doc.accounts, [])
  assert.deepEqual(doc.inflows, [])
  assert.equal(doc.findings.length, 1)
  assert.match(doc.findings[0], /amex-checking-0042-20250301-20250331\.pdf/)
  assert.match(doc.findings[0], /skipped/)
})

test('a file named for one last4 that prints another is skipped with a finding', () => {
  const doc = runExtract({ 'amex-checking-0099-20250301-20250331.pdf': amexPages(STATEMENT_MAR) })
  assert.deepEqual(doc.accounts, [])
  assert.equal(doc.findings.length, 1)
  assert.match(doc.findings[0], /0099/)
  assert.match(doc.findings[0], /0042/)
})

test('a statement that does not follow its predecessor is reported as a continuity break, not hidden', () => {
  const gap = { ...STATEMENT_APR, begin: ['04/01/2025', '$9,999.00'] as [string, string], rows: STATEMENT_APR.rows.map((r) => r.replace('04/01/2025 Beginning Balance $2,176.12', '04/01/2025 Beginning Balance $9,999.00')) }
  // The summary still adds up only if its own opening balance is edited too, so the file is
  // internally consistent and the break is between two statements.
  const doc = runExtract({
    'amex-checking-0042-20250301-20250331.pdf': amexPages(STATEMENT_MAR),
    'amex-checking-0042-20250401-20250430.pdf': amexPages({ ...gap, end: ['04/30/2025', '$10,300.40'], rows: gap.rows.map((r) => r.replace('$2,476.12', '$10,299.00').replace('$2,477.52', '$10,300.40')) }),
  })
  assert.equal(doc.accounts[0].continuityBreaks.length > 0, true)
})

function detect(detector: string, pages: string[], map: object = MAP) {
  const dir = mkdtempSync(path.join(tmpdir(), 'amex-filer-'))
  const mapPath = path.join(dir, 'map.json')
  writeFileSync(mapPath, JSON.stringify(map))
  const program = `
import importlib.util, json, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('filer', 'scripts/file-downloads.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
pages = json.loads(sys.argv[1])
class Doc:
    path = Path('statement.pdf')
    suffix = '.pdf'
    def page_text(self, i):
        return pages[i] if i < len(pages) else ''
out = getattr(m, sys.argv[2])(Doc())
if out is None:
    print(json.dumps(None))
elif isinstance(out, m.Plan):
    print(json.dumps({'plan': out.subdir + '/' + out.name, 'evidence': out.evidence}))
else:
    print(json.dumps({'reason': out.reason, 'remedy': out.remedy}))
`
  return JSON.parse(execFileSync(PY, ['-c', program, JSON.stringify(pages), detector], { cwd: ROOT, env: { ...process.env, STOCK_ACCOUNT_MAP_PATH: mapPath }, encoding: 'utf8' }))
}

test('the filer names a statement by its last four digits and the window its summary declares', () => {
  const out = detect('detect_amex_checking', amexPages(STATEMENT_MAR))
  assert.equal(out.plan, 'bank-statements/amex-checking-0042-20250301-20250331.pdf')
  assert.ok(out.evidence.some((e: string) => /2025-03-01/.test(e) && /2025-03-31/.test(e)))
  assert.doesNotMatch(JSON.stringify(out), new RegExp(HOLDER))
})

test('a quiet statement is named by its declared window too, not as a year-to-date', () => {
  const out = detect('detect_amex_checking', amexPages({ ...STATEMENT_FEB, begin: ['01/01/2025', '$1,000.00'], end: ['02/28/2025', '$1,000.00'] }))
  assert.equal(out.plan, 'bank-statements/amex-checking-0042-20250101-20250228.pdf')
})

test('an unmapped last4 is still filed, and the evidence says which entry to add', () => {
  const out = detect('detect_amex_checking', amexPages(STATEMENT_MAR), { bankAccounts: [] })
  assert.equal(out.plan, 'bank-statements/amex-checking-0042-20250301-20250331.pdf')
  assert.ok(out.evidence.some((e: string) => /bankAccounts/.test(e)))
})

test('a mapped entry that is not a checking account refuses the file', () => {
  const map = { bankAccounts: [{ institution: 'amex', kind: 'savings', currency: 'USD', last4: '0042', alias: 'Example Amex savings' }] }
  const out = detect('detect_amex_checking', amexPages(STATEMENT_MAR), map)
  assert.equal(out.plan, undefined)
  assert.match(out.reason, /savings/)
})

test('an Amex statement for a product that is not checking is refused, naming the printed product', () => {
  const out = detect('detect_amex_checking', amexPages({ ...STATEMENT_MAR, name: 'High Yield Savings' }))
  assert.equal(out.plan, undefined)
  assert.match(out.reason, /High Yield Savings/)
})

test('a statement with no declared window or no last four digits is refused, not guessed', () => {
  const noWindow = amexPages(STATEMENT_MAR).map((t) => t.replace(/Beginning Balance as of \S+ \$[\d,.]+/, 'Beginning Balance'))
  assert.match(detect('detect_amex_checking', noWindow).reason, /period/)
  const noLast4 = amexPages(STATEMENT_MAR).map((t) => t.replace('Account Ending: *0042', 'Account Ending:'))
  assert.match(detect('detect_amex_checking', noLast4).reason, /last four/)
})

test('documents that are not an Amex checking statement are not claimed, and the 토스뱅크 and 빗썸 detectors leave it alone', () => {
  assert.equal(detect('detect_amex_checking', ['Some other bank statement\nDate Description Amount Balance']), null)
  const pages = amexPages(STATEMENT_MAR)
  assert.equal(detect('detect_tossbank_pdf', pages), null)
  assert.equal(detect('detect_bithumb_statement', pages), null)
  assert.equal(detect('detect_toss_transactions', pages), null)
})

test('a dated line inside a description that ends in an amount cannot become a balance row unnoticed', () => {
  const rows = [...STATEMENT_MAR.rows]
  rows.splice(4, 0, '03/04/2025 invoice ref $50.00')
  const r = py(amexPages({ ...STATEMENT_MAR, rows }), `
summary, rows = m.parse_amex_lines(lines)
print(json.dumps(m.amex_problems(summary, rows)))`)
  assert.match(r.join(' | '), /running balance/)
})
