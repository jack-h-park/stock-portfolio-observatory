import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

function fileDownloads(files: Record<string, string | Buffer>, opts: { dryRun?: boolean; password?: string; dataDir?: string; map?: object } = {}) {
  const dataDir = opts.dataDir ?? mkdtempSync(path.join(tmpdir(), 'bank-inbox-'))
  mkdirSync(path.join(dataDir, 'inbox'), { recursive: true })
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dataDir, 'inbox', name), body)
  // Always point the filer at a map of the test's own, so a real data/accounts.local.json never leaks in.
  const mapPath = path.join(dataDir, opts.map ? 'map.json' : 'no-map.json')
  if (opts.map) writeFileSync(mapPath, JSON.stringify(opts.map))
  const result = spawnSync(process.env.STOCK_PYTHON_BIN || 'python3', ['scripts/file-downloads.py', ...(opts.dryRun === false ? [] : ['--dry-run'])], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, STOCK_DATA_DIR: dataDir, STOCK_TOSSBANK_PASSWORD: opts.password ?? '', STOCK_ACCOUNT_MAP_PATH: mapPath },
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

function encryptedWorkbook(dir: string, password: string, opts: { last4?: string; period?: string; layout?: 'toss' | 'plain' } = {}): Buffer {
  const plain = path.join(dir, `plain-${Math.random().toString(36).slice(2)}.xlsx`)
  const out = path.join(dir, `enc-${Math.random().toString(36).slice(2)}.xlsx`)
  const script = [
    'import sys, openpyxl',
    'from msoffcrypto.format.ooxml import OOXMLFile',
    'plain, out, password, last4, period, layout = sys.argv[1:7]',
    'wb = openpyxl.Workbook(); ws = wb.active; ws.title = "토스뱅크 거래내역"',
    'if layout == "toss":',
    '    # the real export puts everything one column in: column A is empty',
    '    ws.append([None, "토스뱅크 거래내역"]); ws.append([None, "성명", "Example Holder"]); ws.append([None, "계좌번호", f"****-****-{last4}"]); ws.append([None, "조회기간", period])',
    '    ws.append([]); ws.append([None, "※ example notice"]); ws.append([None, "※ example notice"]); ws.append([])',
    '    ws.append([None, "거래 일시", "적요", "거래 유형", "거래 기관", "계좌번호", "거래 금액", "거래 후 잔액", "메모"])',
    '    ws.append([None, "2026.09.01 10:00:00", "example", "입금", "", "", 100.0, 100.0, ""])',
    'else:',
    '    ws["A1"] = "example"; ws["B1"] = 42',
    'wb.save(plain)',
    'f = OOXMLFile(open(plain, "rb"))',
    'f.encrypt(password, open(out, "wb"))',
  ].join('\n')
  const r = spawnSync(PY, ['-c', script, plain, out, password, opts.last4 ?? '1234', opts.period ?? '2022.07.25 - 2026.10.10', opts.layout ?? 'toss'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return readFileSync(out)
}

test('토스뱅크 with a password set is planned by last4 and period, still decrypted on filing', { skip: !HAVE_CRYPTO }, () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'bank-enc-'))
  const body = encryptedWorkbook(scratch, PASSWORD, { last4: '1234', period: '2022.07.25 - 2026.10.10' })
  assert.match(fileDownloads({ '토스뱅크_거래내역.xlsx': body }, { password: PASSWORD }), /→ bank-statements\/tossbank-1234-20220725-20261010\.xlsx/)
})

test('two 토스뱅크 exports of different accounts, downloaded together, file under distinct names', { skip: !HAVE_CRYPTO }, () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'bank-inbox-'))
  const a = encryptedWorkbook(dataDir, PASSWORD, { last4: '0000', period: '2022.07.25 - 2026.10.10' })
  const b = encryptedWorkbook(dataDir, PASSWORD, { last4: '1111', period: '2024.01.01 - 2026.10.10' })
  const out = fileDownloads({ '토스뱅크_거래내역.xlsx': a, '토스뱅크_거래내역 (1).xlsx': b }, { dryRun: false, password: PASSWORD, dataDir })
  assert.deepEqual(readdirSync(path.join(dataDir, 'bank-statements')).sort(), ['tossbank-0000-20220725-20261010.xlsx', 'tossbank-1111-20240101-20261010.xlsx'], out)
  assert.doesNotMatch(out, /CONFLICT/)
})

test('토스뱅크 decrypts into bank-statements with the right password and removes the source', { skip: !HAVE_CRYPTO }, () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'bank-inbox-'))
  const body = encryptedWorkbook(dataDir, PASSWORD, { last4: '1234' })
  const out = fileDownloads({ '토스뱅크_거래내역.xlsx': body }, { dryRun: false, password: PASSWORD, dataDir })
  const filed = readdirSync(path.join(dataDir, 'bank-statements'))
  assert.deepEqual(filed, ['tossbank-1234-20220725-20261010.xlsx'], out)
  assert.equal(existsSync(path.join(dataDir, 'inbox', '토스뱅크_거래내역.xlsx')), false)
  const read = spawnSync(PY, ['-c', 'import sys, openpyxl; print(openpyxl.load_workbook(sys.argv[1]).active["B3"].value)', path.join(dataDir, 'bank-statements', filed[0])], { encoding: 'utf8' })
  assert.equal(read.stdout.trim(), '계좌번호', read.stderr)
})

test('토스뱅크 with a wrong password is refused by name of the cause, nothing filed, source kept', { skip: !HAVE_CRYPTO }, () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'bank-inbox-'))
  const body = encryptedWorkbook(dataDir, PASSWORD)
  const out = fileDownloads(
    { '토스뱅크_거래내역.xlsx': body, 'Chase0000_Activity_20261009.csv': CHASE_CHECKING },
    { dryRun: false, password: 'wrong-password', dataDir },
  )
  assert.deepEqual(readdirSync(path.join(dataDir, 'bank-statements')), ['chase-checking-20260915-20261001.csv'])
  assert.equal(existsSync(path.join(dataDir, 'inbox', '토스뱅크_거래내역.xlsx')), true)
  assert.match(out, /recognised but not filed[\s\S]*토스뱅크_거래내역\.xlsx[\s\S]*password is wrong/)
})

test('a decrypted 토스뱅크 workbook with an unexpected layout is refused as such', { skip: !HAVE_CRYPTO }, () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'bank-enc-'))
  const body = encryptedWorkbook(scratch, PASSWORD, { layout: 'plain' })
  assert.match(fileDownloads({ '토스뱅크_거래내역.xlsx': body }, { password: PASSWORD }), /recognised but not filed[\s\S]*unexpected layout/)
})

// --- Fidelity: a CMA is a deposit, a brokerage history is not, and only the file NAME can tell them apart ---
const FID_HEAD = ['', '', 'Run Date,Action,Symbol,Description,Type,Price ($),Quantity,Commission ($),Fees ($),Accrued Interest ($),Amount ($),Cash Balance ($),Settlement Date']
const FID_ROWS = [
  '09/30/2026," DIVIDEND RECEIVED FIDELITY GOVERNMENT MONEY MARKET (SPAXX) (Cash)",SPAXX,"FIDELITY GOVERNMENT MONEY MARKET",Cash,,0.000,,,,1.00,"101.00",',
  '09/01/2026," Electronic Funds Transfer Received (Cash)",,"EXAMPLE",Cash,,0.000,,,,100.00,"100.00",',
]
const FIDELITY_HISTORY = [...FID_HEAD, ...FID_ROWS, '', '"Disclaimer line."', '', 'Date downloaded 10/09/2026 10:00 am'].join('\n')
const CMA_MAP = { bankAccounts: [{ institution: 'fidelity', kind: 'cma', accountId: 'Z00000001', currency: 'USD', alias: 'Fidelity CMA' }] }

test('a Fidelity history named for a mapped CMA files as a deposit by its row dates, and is not also claimed as brokerage', () => {
  const out = fileDownloads({ 'History_for_Account_Z00000001.csv': FIDELITY_HISTORY }, { map: CMA_MAP })
  assert.match(out, /→ bank-statements\/fidelity-cma-20260901-20260930\.csv/)
  assert.doesNotMatch(out, /us-transactions|more than one detector/)
})

test('the numbered re-download name of a mapped CMA is a CMA too', () => {
  assert.match(fileDownloads({ 'History_for_Account_Z00000001-2.csv': FIDELITY_HISTORY }, { map: CMA_MAP }), /→ bank-statements\/fidelity-cma-/)
})

test('the same Fidelity file with no map, or an unmapped ID, is brokerage as before', () => {
  const noMap = fileDownloads({ 'History_for_Account_Z00000001.csv': FIDELITY_HISTORY })
  assert.match(noMap, /→ us-transactions\/fidelity-transactions-20260901-20260930\.csv/)
  assert.match(noMap, /no account map: filed as brokerage/)
  assert.match(fileDownloads({ 'History_for_Account_Z99999999.csv': FIDELITY_HISTORY }, { map: CMA_MAP }), /→ us-transactions\/fidelity-transactions-/)
})

test('a CMA name on a file without the Fidelity history header is not claimed', () => {
  const out = fileDownloads({ 'History_for_Account_Z00000001.csv': 'a,b,c\n1,2,3' }, { map: CMA_MAP })
  assert.match(out, /unidentified[\s\S]*History_for_Account_Z00000001\.csv/)
})

test('a corrupt account map refuses a CMA-named history, naming the map, and the rest of the inbox still files', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'bank-inbox-'))
  mkdirSync(path.join(dataDir, 'inbox'), { recursive: true })
  writeFileSync(path.join(dataDir, 'bad-map.json'), '{bad')
  writeFileSync(path.join(dataDir, 'inbox', 'History_for_Account_Z00000001.csv'), FIDELITY_HISTORY)
  writeFileSync(path.join(dataDir, 'inbox', 'Chase0000_Activity_20261009.csv'), CHASE_CHECKING)
  const result = spawnSync(PY, ['scripts/file-downloads.py'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, STOCK_DATA_DIR: dataDir, STOCK_ACCOUNT_MAP_PATH: path.join(dataDir, 'bad-map.json') },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.stderr, /Traceback|more than one detector/)
  assert.match(result.stdout, /recognised but not filed[\s\S]*History_for_Account_Z00000001\.csv[\s\S]*bad-map\.json could not be read/)
  assert.deepEqual(readdirSync(path.join(dataDir, 'bank-statements')), ['chase-checking-20260915-20261001.csv'])
  assert.equal(existsSync(path.join(dataDir, 'inbox', 'History_for_Account_Z00000001.csv')), true)
})
