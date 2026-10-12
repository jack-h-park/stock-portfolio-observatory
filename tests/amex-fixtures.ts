// Invented American Express checking statements for the extractor and filer tests.
// Every name, number, date and amount is made up; the repository is public.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

export const ROOT = path.resolve(import.meta.dirname, '..')
export const PY = process.env.STOCK_PYTHON_BIN || 'python3'
export const HOLDER = 'Example Holder'

export const MAP = {
  bankAccounts: [{ institution: 'amex', kind: 'checking', currency: 'USD', last4: '0042', alias: 'Example Amex checking' }],
}

export type AmexOptions = {
  last4?: string
  name?: string
  begin: [string, string]
  end: [string, string]
  credits: string
  debits: string
  interest: string
  rows: string[]
  /** How many of `rows` stay on page 1; the rest follow the repeated header on page 2. */
  split?: number
}

/** The text pdfplumber reads off each page of a statement shaped like the real one. */
export function amexPages(o: AmexOptions): string[] {
  const split = o.split ?? o.rows.length
  const continued = split < o.rows.length
  const stamp = `Statement Date: ${o.end[0]} Account Ending: *${o.last4 ?? '0042'} Account Name: ${o.name ?? 'Rewards Checking'}`
  const head = [
    'American Express® Rewards Checking Statement', 'p. 1/2', HOLDER, stamp,
    'Statement Summary Interest Summary',
    `Beginning Balance as of ${o.begin[0]} ${o.begin[1]} Earned Period ${o.begin[0]} - ${o.end[0]}`,
    `Total Credits This Period ${o.credits} Days in Statement Period 30`,
    `Total Debits This Period ${o.debits} Interest Rate 1.00%`,
    `Ending Balance as of ${o.end[0]} ${o.end[1]} Annual Percentage Yield Earned 1.00%`,
    `Interest Earned This Period ${o.interest}`, 'Interest Paid This Year $0.00',
    'Account Activity', 'Date Description Credits Debits Balance',
  ]
  const footer = ['Account Details Contact Us', HOLDER, '1 EXAMPLE STREET', 'EXAMPLE CITY ST 00000', 'Accounts offered by Example National Bank. Member FDIC.']
  const notice = ['Important Notice', 'In Case of Errors or Questions About Your Electronic Transfers:', 'Accounts offered by Example National Bank. Member FDIC.']
  const page1 = [...head, ...o.rows.slice(0, split), ...(continued ? ['Continued on next page'] : []), ...footer]
  const page2 = [HOLDER, 'p. 2/2', stamp, ...(continued ? ['Date Description Credits Debits Balance', ...o.rows.slice(split)] : []), ...notice]
  return [page1.join('\n'), page2.join('\n')]
}

// February: no transactions, a balance carried through (a quiet month).
export const STATEMENT_FEB: AmexOptions = {
  begin: ['02/01/2025', '$1,000.00'], end: ['02/28/2025', '$1,000.00'],
  credits: '$0.00', debits: '$0.00', interest: '$0.00',
  rows: ['02/01/2025 Beginning Balance $1,000.00', '02/28/2025 Ending Balance $1,000.00'],
}

// March: an employer credit with a wrapped description, a debit whose description
// wraps four lines, a peer payment, and interest. 1,000 + 1,501.12 - 325 = 2,176.12.
export const STATEMENT_MAR: AmexOptions = {
  begin: ['03/01/2025', '$1,000.00'], end: ['03/31/2025', '$2,176.12'],
  credits: '$1,501.12', debits: '-$325.00', interest: '$1.12',
  rows: [
    '03/01/2025 Beginning Balance $1,000.00',
    '03/05/2025 Online Transfer / Payment: Credit $1,500.00 $2,500.00',
    'EXAMPLE CO PAYROLL',
    '*****0001 XXXX0002 Example Holder',
    'External - EXAMPLE BANK, N.A.',
    'ID 000000000000001',
    '03/12/2025 Online Transfer / Payment: Debit -$250.00 $2,250.00',
    'Robinhood Money Payment *****0003',
    'EXAMPLE HOLDER External - EXAMPLE',
    'CREDIT UNION',
    'ID 000000000000002',
    '03/20/2025 Zelle Payment To -$75.00 $2,175.00',
    'EXAMPLE FRIEND',
    'ID 000000000000003',
    '03/31/2025 Interest Deposit $1.12 $2,176.12',
    'ID 000000000000004',
    '03/31/2025 Ending Balance $2,176.12',
  ],
}

// April: an incentive credit and interest; no debits. 2,176.12 + 301.40 = 2,477.52.
export const STATEMENT_APR: AmexOptions = {
  begin: ['04/01/2025', '$2,176.12'], end: ['04/30/2025', '$2,477.52'],
  credits: '$301.40', debits: '$0.00', interest: '$1.40',
  rows: [
    '04/01/2025 Beginning Balance $2,176.12',
    '04/15/2025 Customer Incentive Payment $300.00 $2,476.12',
    'ID 000000000000005',
    '04/30/2025 Interest Deposit $1.40 $2,477.52',
    'ID 000000000000006',
    '04/30/2025 Ending Balance $2,477.52',
  ],
}

// pdfplumber replaced by a stub that reads page text from a JSON fixture, as in
// tossbank-pdf.test.ts and bank-inflows-extract.test.ts.
const PDFPLUMBER_STUB = `
import builtins, json

class _Page:
    def __init__(self, data):
        self._data = data
    def extract_text(self):
        return self._data.get("text", "")
    def extract_tables(self):
        return []

class _Pdf:
    def __init__(self, data):
        self.pages = [_Page(p) for p in data["pages"]]
        self.metadata = {}
    def __enter__(self):
        return self
    def __exit__(self, *exc):
        return False
    def close(self):
        pass

def open(path, password=None):
    with builtins.open(path, encoding="utf-8") as fh:
        return _Pdf(json.load(fh))
`

/**
 * Run scripts/extract-bank-statements.py over files written into bank-statements/.
 * A `string[]` value is a PDF (its page texts, read through the stub); a `string`
 * value is a text file (a CSV) written as is.
 */
export function runExtract(files: Record<string, string | string[]>, map: object = MAP) {
  const dir = mkdtempSync(path.join(tmpdir(), 'amex-extract-'))
  const stub = path.join(dir, 'stub')
  mkdirSync(stub)
  writeFileSync(path.join(stub, 'pdfplumber.py'), PDFPLUMBER_STUB, 'utf8')
  mkdirSync(path.join(dir, 'bank-statements'))
  for (const [name, body] of Object.entries(files)) {
    const text = typeof body === 'string' ? body : JSON.stringify({ pages: body.map((t) => ({ text: t })) })
    writeFileSync(path.join(dir, 'bank-statements', name), text, 'utf8')
  }
  const mapPath = path.join(dir, 'map.json')
  writeFileSync(mapPath, JSON.stringify(map))
  const out = path.join(dir, 'bank-balances.json')
  const result = spawnSync(PY, ['scripts/extract-bank-statements.py'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: stub, STOCK_DATA_DIR: dir, STOCK_BANK_BALANCES_PATH: out, STOCK_ACCOUNT_MAP_PATH: mapPath, STOCK_ALLOW_NO_ACCOUNT_MAP: '', STOCK_PDF_PASSWORD: '' },
  })
  assert.equal(result.status, 0, `bank extractor exited ${result.status}: ${result.stderr}`)
  return JSON.parse(readFileSync(out, 'utf8'))
}
