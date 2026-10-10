import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

function fileDownloads(files: Record<string, string | Buffer>, opts: { dryRun?: boolean; password?: string; dataDir?: string } = {}) {
  const dataDir = opts.dataDir ?? mkdtempSync(path.join(tmpdir(), 'bank-inbox-'))
  mkdirSync(path.join(dataDir, 'inbox'), { recursive: true })
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dataDir, 'inbox', name), body)
  const result = spawnSync(process.env.STOCK_PYTHON_BIN || 'python3', ['scripts/file-downloads.py', ...(opts.dryRun === false ? [] : ['--dry-run'])], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, STOCK_DATA_DIR: dataDir, STOCK_TOSSBANK_PASSWORD: opts.password ?? '' },
  })
  assert.equal(result.status, 0, `filer exited ${result.status}: ${result.stderr}`)
  return result.stdout
}

const CHASE_CHECKING = [
  'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #',
  'DEBIT,10/01/2026,"EXAMPLE UTILITY PAYMENT",-50.00,ACH_DEBIT,950.00,,',
  'CREDIT,09/15/2026,"EXAMPLE PAYROLL",1000.00,ACH_CREDIT,1000.00,,',
].join('\n')

const BOA = [
  'Description,,Summary Amt.',
  'Beginning balance as of 06/01/2025,,"100.00"',
  'Total credits,,"50.00"',
  'Total debits,,"-20.00"',
  'Ending balance as of 06/30/2025,,"130.00"',
  '',
  'Date,Description,Amount,Running Bal.',
  '06/01/2025,Beginning balance as of 06/01/2025,,"100.00"',
  '06/02/2025,"EXAMPLE DEPOSIT","50.00","150.00"',
  '06/30/2025,"EXAMPLE CARD","-20.00","130.00"',
].join('\n')

// Interest payments and transfers to brokerage show up in both kinds, so both fixtures carry them.
const RH_CHECKING = [
  'Date,Description,Amount',
  '2026-10-05,"Inter-Entity Transfer to Brokerage",-10.00',
  '2026-10-02,"Payment to Robinhood Credit Card",-25.00',
  '2026-09-30,"Interest Payment",0.50',
  '2026-09-01,"Example Deposit",30.00',
].join('\n')
const RH_CHECKING_FID = ['Date,Description,Amount', '2026-09-15,"FID BKG SVC LLC MONEYLINE",-40.00', '2026-09-30,"Interest Payment",0.50'].join('\n')
const RH_SAVINGS = [
  'Date,Description,Amount',
  '2026-09-30,"Interest Payment",1.00',
  '2026-09-20,"Inter-Entity Transfer to Brokerage",-5.00',
  '2026-09-01,"Internal Transfer from Personal Checking",20.00',
].join('\n')
const RH_UNKNOWN = ['Date,Description,Amount', '2026-09-30,"Something",1.00'].join('\n')
const RH_INTEREST_ONLY = ['Date,Description,Amount', '2026-08-31,"Interest Payment",1.00', '2026-09-30,"Interest Payment",1.10'].join('\n')
const RH_BOTH = ['Date,Description,Amount', '2026-09-02,"Payment to Robinhood Credit Card",-25.00', '2026-09-01,"Internal Transfer from Personal Checking",20.00'].join('\n')

test('a Chase checking activity export files into bank-statements by its row dates', () => {
  assert.match(fileDownloads({ 'Chase0000_Activity_20261009.csv': CHASE_CHECKING }), /→ bank-statements\/chase-checking-20260915-20261001\.csv/)
})

test('a Bank of America statement CSV files by its declared period', () => {
  assert.match(fileDownloads({ 'stmt.csv': BOA }), /→ bank-statements\/boa-checking-20250601-20250630\.csv/)
})

test('Robinhood bank exports are told apart by what their rows say, and refused when they say nothing', () => {
  assert.match(fileDownloads({ 'a.csv': RH_CHECKING }), /→ bank-statements\/robinhood-bank-checking-20260901-20261005\.csv/)
  assert.match(fileDownloads({ 'b.csv': RH_SAVINGS }), /→ bank-statements\/robinhood-bank-savings-20260901-20260930\.csv/)
  assert.match(fileDownloads({ 'c.csv': RH_UNKNOWN }), /recognised but not filed[\s\S]*c\.csv[\s\S]*checking or savings/)
})

test('Robinhood bank markers shared by both kinds (interest, transfers to brokerage) do not decide the kind', () => {
  assert.match(fileDownloads({ 'd.csv': RH_CHECKING_FID }), /→ bank-statements\/robinhood-bank-checking-20260915-20260930\.csv/)
  assert.match(fileDownloads({ 'e.csv': RH_INTEREST_ONLY }), /recognised but not filed[\s\S]*e\.csv[\s\S]*checking or savings/)
  assert.match(fileDownloads({ 'f.csv': RH_BOTH }), /recognised but not filed[\s\S]*f\.csv[\s\S]*checking or savings/)
})

test('a 새마을금고 거래내역조회 .xls files by its 조회기간', () => {
  const cfb = Buffer.concat([
    Buffer.from('d0cf11e0a1b11ae1', 'hex'),
    Buffer.alloc(505), // odd length: the UTF-16 run starts on an odd offset
    Buffer.from('거래내역조회', 'utf16le'),
    Buffer.alloc(16),
    Buffer.from('통장(상품)명', 'utf16le'),
    Buffer.alloc(16),
    Buffer.from('조회기간 : 2023.01.01 ~ 2026.10.09', 'utf16le'),
  ])
  assert.match(fileDownloads({ 'export.xls': cfb }), /→ bank-statements\/mg-deposit-20230101-20261009\.xls/)
})

test('an encrypted 토스뱅크 export without a password is refused with the variable to set', () => {
  // CFB magic + the EncryptedPackage stream name is enough for the detector; the body is not decrypted here.
  const cfb = Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(504), Buffer.from('EncryptedPackage', 'utf16le')])
  assert.match(fileDownloads({ '토스뱅크_거래내역.xlsx': cfb }), /STOCK_TOSSBANK_PASSWORD/)
})

// --- real-work path: needs msoffcrypto + openpyxl in the python the filer uses ---
const PY = process.env.STOCK_PYTHON_BIN || 'python3'
const HAVE_CRYPTO = spawnSync(PY, ['-c', 'import msoffcrypto, openpyxl']).status === 0
const PASSWORD = 'dummy-test-password'

function encryptedWorkbook(dir: string, password: string): Buffer {
  const plain = path.join(dir, 'plain.xlsx')
  const out = path.join(dir, 'enc.xlsx')
  const script = [
    'import sys, openpyxl',
    'from msoffcrypto.format.ooxml import OOXMLFile',
    'wb = openpyxl.Workbook(); wb.active["A1"] = "example"; wb.active["B1"] = 42; wb.save(sys.argv[1])',
    'f = OOXMLFile(open(sys.argv[1], "rb"))',
    'f.encrypt(sys.argv[3], open(sys.argv[2], "wb"))',
  ].join('\n')
  const r = spawnSync(PY, ['-c', script, plain, out, password], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return readFileSync(out)
}

test('토스뱅크 with a password set is planned as tossbank-<date>.xlsx', { skip: !HAVE_CRYPTO }, () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'bank-enc-'))
  const body = encryptedWorkbook(scratch, PASSWORD)
  assert.match(fileDownloads({ '토스뱅크_거래내역.xlsx': body }, { password: PASSWORD }), /→ bank-statements\/tossbank-\d{8}\.xlsx/)
})

test('토스뱅크 decrypts into bank-statements with the right password and removes the source', { skip: !HAVE_CRYPTO }, () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'bank-inbox-'))
  const body = encryptedWorkbook(dataDir, PASSWORD)
  const out = fileDownloads({ '토스뱅크_거래내역.xlsx': body }, { dryRun: false, password: PASSWORD, dataDir })
  const filed = readdirSync(path.join(dataDir, 'bank-statements'))
  assert.equal(filed.length, 1, out)
  assert.match(filed[0], /^tossbank-\d{8}\.xlsx$/)
  assert.equal(existsSync(path.join(dataDir, 'inbox', '토스뱅크_거래내역.xlsx')), false)
  const read = spawnSync(PY, ['-c', 'import sys, openpyxl; print(openpyxl.load_workbook(sys.argv[1]).active["A1"].value)', path.join(dataDir, 'bank-statements', filed[0])], { encoding: 'utf8' })
  assert.equal(read.stdout.trim(), 'example', read.stderr)
})

test('토스뱅크 with a wrong password leaves nothing filed, keeps the source and says so', { skip: !HAVE_CRYPTO }, () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'bank-inbox-'))
  const body = encryptedWorkbook(dataDir, PASSWORD)
  const out = fileDownloads(
    { '토스뱅크_거래내역.xlsx': body, 'Chase0000_Activity_20261009.csv': CHASE_CHECKING },
    { dryRun: false, password: 'wrong-password', dataDir },
  )
  assert.deepEqual(readdirSync(path.join(dataDir, 'bank-statements')), ['chase-checking-20260915-20261001.csv'])
  assert.equal(existsSync(path.join(dataDir, 'inbox', '토스뱅크_거래내역.xlsx')), true)
  assert.match(out, /FAILED[\s\S]*토스뱅크_거래내역\.xlsx/)
})
