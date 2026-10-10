import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

test('_num accepts currency symbols, parentheses and a trailing minus, and raises on other text', () => {
  const r = py(`
bad = False
try:
    m._num("abc")
except ValueError:
    bad = True
print(json.dumps([m._num("(5.00)"), m._num("$1,234.50"), m._num("₩-"), m._num("7.25-"), m._num("₩(1,000)"), bad]))`)
  assert.deepEqual(r, [-5, 1234.5, null, -7.25, -1000, true])
})

test('a malformed file becomes a finding and the other accounts are still written', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bank-main-'))
  mkdirSync(path.join(dir, 'bank-statements'))
  writeFileSync(path.join(dir, 'bank-statements', 'chase-checking-a-b.csv'),
    'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\nDEBIT,10/01/2026,"L",-5.00,ACH,945.00,,\n')
  writeFileSync(path.join(dir, 'bank-statements', 'boa-checking-a-b.csv'), 'not,a,statement\n1,2,3\n')
  const out = path.join(dir, 'out.json')
  execFileSync('python3', ['scripts/extract-bank-statements.py'], {
    cwd: ROOT,
    env: { ...process.env, STOCK_DATA_DIR: dir, STOCK_BANK_BALANCES_PATH: out, STOCK_ACCOUNT_MAP_PATH: path.join(dir, 'none.json') },
    encoding: 'utf8',
  })
  const doc = JSON.parse(readFileSync(out, 'utf8'))
  assert.equal(doc.accounts.length, 1)
  assert.equal(doc.accounts[0].institution, 'chase')
  assert.equal(doc.findings.length, 1)
  assert.match(doc.findings[0], /boa-checking-a-b\.csv: could not be parsed \(StopIteration/)
})

test('a bad anchor is a finding and the account gets no derived balances', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bank-anchor-'))
  mkdirSync(path.join(dir, 'bank-statements'))
  writeFileSync(path.join(dir, 'bank-statements', 'robinhood-bank-savings-a-b.csv'), 'Date,Description,Amount\n2026-09-01,"Y",30.00\n')
  writeFileSync(path.join(dir, 'map.json'), JSON.stringify({
    bankAccounts: [{ institution: 'robinhood-bank', kind: 'savings', currency: 'USD', alias: 'RH save' }],
    anchors: [{ alias: 'RH save', date: '2026-09-01', balance: 'lots' }],
  }))
  const out = path.join(dir, 'out.json')
  execFileSync('python3', ['scripts/extract-bank-statements.py'], {
    cwd: ROOT,
    env: { ...process.env, STOCK_DATA_DIR: dir, STOCK_BANK_BALANCES_PATH: out, STOCK_ACCOUNT_MAP_PATH: path.join(dir, 'map.json') },
    encoding: 'utf8',
  })
  const doc = JSON.parse(readFileSync(out, 'utf8'))
  assert.deepEqual(doc.accounts[0].balances, [])
  assert.match(doc.findings[0], /RH save: anchor is unusable/)
})

test('rows unique to a later overlapping file follow the earlier file on a shared day', () => {
  const r = py(`
head = "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #"
a = m.parse_chase("\\n".join([head,
 'DEBIT,10/01/2026,"B",-10.00,ACH,880.00,,',
 'DEBIT,10/01/2026,"A",-20.00,ACH,890.00,,',
 'CREDIT,09/30/2026,"P",910.00,ACH,910.00,,']))
b = m.parse_chase("\\n".join([head,
 'DEBIT,10/02/2026,"D",-1.00,ACH,869.00,,',
 'DEBIT,10/01/2026,"C",-10.00,ACH,870.00,,',
 'DEBIT,10/01/2026,"B",-10.00,ACH,880.00,,']))
t = m.merge_txns([a, b])
print(json.dumps({"eod": m.end_of_day(t), "breaks": m.continuity_breaks(t), "seq": [x["seq"] for x in t]}))`)
  assert.deepEqual(r.eod, [
    { date: '2026-09-30', balance: 910 },
    { date: '2026-10-01', balance: 870 },
    { date: '2026-10-02', balance: 869 },
  ])
  assert.deepEqual(r.breaks, [])
  assert.deepEqual(r.seq, [0, 1, 2, 3, 4])
})

// --- 토스뱅크 and the Fidelity CMA -------------------------------------------------

const TOSS_HEADER = ['거래 일시', '적요', '거래 유형', '거래 기관', '계좌번호', '거래 금액', '거래 후 잔액', '메모']

/** Write an openpyxl workbook shaped like a 토스뱅크 export; `rows` are newest first. */
function writeTossWorkbook(file: string, last4: string, rows: Array<[string, string, number, number]>) {
  const script = [
    'import json, sys, openpyxl',
    'file, last4, rows, header = sys.argv[1], sys.argv[2], json.loads(sys.argv[3]), json.loads(sys.argv[4])',
    'wb = openpyxl.Workbook(); ws = wb.active; ws.title = "토스뱅크 거래내역"',
    'ws.append(["토스뱅크 거래내역"]); ws.append(["성명", "Example Holder"]); ws.append(["계좌번호", f"****-****-{last4}"])',
    'ws.append(["조회기간", "2026.01.01 - 2026.10.10"])',
    'for _ in range(3): ws.append([])',
    'ws.append(header)',
    'for r in rows: ws.append([r[0], r[1], "입금", "", "", r[2], r[3], ""])',
    'wb.save(file)',
  ].join('\n')
  execFileSync('python3', ['-c', script, file, last4, JSON.stringify(rows), JSON.stringify(TOSS_HEADER)])
}

function extract(dir: string, map: object | null = null) {
  const out = path.join(dir, 'out.json')
  const mapPath = path.join(dir, 'map.json')
  if (map) writeFileSync(mapPath, JSON.stringify(map))
  execFileSync('python3', ['scripts/extract-bank-statements.py'], {
    cwd: ROOT,
    env: { ...process.env, STOCK_DATA_DIR: dir, STOCK_BANK_BALANCES_PATH: out, STOCK_ACCOUNT_MAP_PATH: map ? mapPath : path.join(dir, 'none.json') },
    encoding: 'utf8',
  })
  return JSON.parse(readFileSync(out, 'utf8'))
}

test('토스뱅크 rows, newest first with float cells, read in order with signed amounts and end-of-day balances', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'toss-rows-'))
  mkdirSync(path.join(dir, 'bank-statements'))
  writeTossWorkbook(path.join(dir, 'bank-statements', 'tossbank-0000-20260101-20261010.xlsx'), '0000', [
    ['2026.09.02 18:00:00', 'late', -300.0, 500.0],
    ['2026.09.02 09:30:00', 'early', -200.0, 800.0],
    ['2026.09.01 12:00:00', 'pay', 1000.0, 1000.0],
  ])
  const doc = extract(dir)
  assert.equal(doc.accounts.length, 1)
  const a = doc.accounts[0]
  assert.deepEqual([a.institution, a.account, a.kind, a.currency], ['tossbank', 'tossbank 0000', 'checking', 'KRW'])
  assert.deepEqual(a.balances, [{ date: '2026-09-01', balance: 1000 }, { date: '2026-09-02', balance: 500 }])
  assert.deepEqual(a.continuityBreaks, [])
})

test('토스뱅크 same-second rows keep their file order, and a gap is a continuity break', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'toss-gap-'))
  mkdirSync(path.join(dir, 'bank-statements'))
  writeTossWorkbook(path.join(dir, 'bank-statements', 'tossbank-0000-a-b.xlsx'), '0000', [
    ['2026.09.03 10:00:00', 'c', -50.0, 300.0],
    ['2026.09.02 10:00:00', 'b2', -100.0, 450.0],
    ['2026.09.02 10:00:00', 'b1', -450.0, 550.0],
    ['2026.09.01 10:00:00', 'a', 1000.0, 1000.0],
  ])
  const a = extract(dir).accounts[0]
  // 09-02 is consistent only if the same-second rows are read b1 then b2; 09-03 is the real gap.
  assert.equal(a.continuityBreaks.length, 1)
  assert.match(a.continuityBreaks[0], /2026-09-03/)
})

test('two 토스뱅크 last4 values give two accounts, and the map overrides kind and alias by last4', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'toss-two-'))
  mkdirSync(path.join(dir, 'bank-statements'))
  writeTossWorkbook(path.join(dir, 'bank-statements', 'tossbank-0000-a-b.xlsx'), '0000', [['2026.09.01 10:00:00', 'a', 10.0, 10.0]])
  writeTossWorkbook(path.join(dir, 'bank-statements', 'tossbank-1111-a-b.xlsx'), '1111', [['2026.09.01 10:00:00', 'a', 20.0, 20.0]])
  const doc = extract(dir, { bankAccounts: [{ institution: 'tossbank', last4: '1111', kind: 'savings', alias: 'Toss savings' }] })
  const byAlias = Object.fromEntries(doc.accounts.map((a: any) => [a.account, a]))
  assert.deepEqual(Object.keys(byAlias).sort(), ['Toss savings', 'tossbank 0000'])
  assert.equal(byAlias['Toss savings'].kind, 'savings')
  assert.equal(byAlias['tossbank 0000'].kind, 'checking')
  assert.deepEqual(byAlias['Toss savings'].balances, [{ date: '2026-09-01', balance: 20 }])
})

test('_alias also matches on last4 for any institution, and falls back to institution plus last4 for an unknown last4', () => {
  const r = py(`
rules = {"bankAccounts": [{"institution": "chase", "last4": "0000", "kind": "checking", "alias": "Chase main"},
                           {"institution": "tossbank", "last4": "1111", "kind": "savings", "alias": "Toss s"}]}
print(json.dumps([m._alias(rules, "chase", "checking"), m._alias(rules, "chase", "checking", "0000"),
                  m._alias(rules, "chase", "checking", "9999"), m._alias(rules, "tossbank", "checking", "1111"),
                  m._alias(rules, "tossbank", "checking", "2222")]))`)
  assert.deepEqual(r, ['Chase main', 'Chase main', 'chase 9999', 'Toss s', 'tossbank 2222'])
})

const CMA_HEAD = ['', '', 'Run Date,Action,Symbol,Description,Type,Price ($),Quantity,Commission ($),Fees ($),Accrued Interest ($),Amount ($),Cash Balance ($),Settlement Date']
const CMA_FOOT = ['', '"The data and information in this spreadsheet is provided to you solely for your use."', '', 'Date downloaded 10/09/2026 10:00 am']

test('a Fidelity CMA dividend and its core-fund reinvestment do not read as a continuity break', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cma-'))
  mkdirSync(path.join(dir, 'bank-statements'))
  const csv = [
    ...CMA_HEAD,
    '09/30/2026,"DEBIT CARD PURCHASE EXAMPLE SHOP",,"EXAMPLE",Cash,,0,,,,-10.00,"1051.93",',
    '09/30/2026," REINVESTMENT FIDELITY GOVERNMENT MONEY MARKET (SPAXX) (Cash)",SPAXX,"FIDELITY GOVERNMENT MONEY MARKET",Cash,1.000,61.930,,,,-61.93,"1061.93",09/30/2026',
    '09/30/2026," DIVIDEND RECEIVED FIDELITY GOVERNMENT MONEY MARKET (SPAXX) (Cash)",SPAXX,"FIDELITY GOVERNMENT MONEY MARKET",Cash,,0.000,,,,61.93,"1061.93",',
    '09/01/2026," Electronic Funds Transfer Received (Cash)",,"EXAMPLE",Cash,,0.000,,,,1000.00,"1000.00",',
    ...CMA_FOOT,
  ].join('\n')
  writeFileSync(path.join(dir, 'bank-statements', 'fidelity-cma-20260901-20260930.csv'), csv)
  const doc = extract(dir, { bankAccounts: [{ institution: 'fidelity', kind: 'cma', accountId: 'Z00000001', currency: 'USD', alias: 'Fidelity CMA' }] })
  assert.equal(doc.accounts.length, 1)
  const a = doc.accounts[0]
  assert.deepEqual([a.institution, a.account, a.kind, a.currency], ['fidelity', 'Fidelity CMA', 'cma', 'USD'])
  assert.deepEqual(a.continuityBreaks, [])
  assert.deepEqual(a.balances, [{ date: '2026-09-01', balance: 1000 }, { date: '2026-09-30', balance: 1051.93 }])
  assert.deepEqual(doc.findings, [])
})

test('a Fidelity CMA reinvestment into a non-core fund keeps its amount, because only core money-market funds are zeroed', () => {
  const r = py(`
text = "\\n".join(["", "", "Run Date,Action,Symbol,Description,Type,Price ($),Quantity,Commission ($),Fees ($),Accrued Interest ($),Amount ($),Cash Balance ($),Settlement Date",
 '09/30/2026," REINVESTMENT EXAMPLE FUND (EXMPL) (Cash)",EXMPL,"EXAMPLE",Cash,1.0,5.0,,,,-5.00,"95.00",',
 '09/01/2026," DEPOSIT (Cash)",,"EXAMPLE",Cash,,0,,,,100.00,"100.00",'])
t = m.parse_fidelity_cma(text)
print(json.dumps({"amounts": [x["amount"] for x in t], "breaks": m.continuity_breaks(t)}))`)
  assert.deepEqual(r.amounts, [100, -5])
  assert.deepEqual(r.breaks, [])
})
