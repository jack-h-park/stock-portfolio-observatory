# Net Worth Phase 1: Foundation and Deposits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag every securities row with an account wrapper and owner, collect bank deposit balances into a new `cash_balances` table, and add a "Stocks / All assets" switch plus a `/net-worth` page. The default view must show exactly what it shows today.

**Architecture:**
- **Wrapper tagging.** The ingest tags rows centrally inside `insertMany`. The rule comes from `scripts/account-map.mjs`, which reads a gitignored local account map.
- **Bank statements.** New detectors in `scripts/file-downloads.py` file bank statements into `bank-statements/`. A new `scripts/extract-bank-statements.py` turns them into `data/bank-balances.json`, and the ingest loads that into `cash_balances`.
- **Adapter.** It keeps every existing total on the stock wrappers through one SQL helper, and adds `getNetWorth()`. The pure math lives in `lib/net-worth.ts`.
- **Switch.** It copies the currency switch: a cookie, a server getter, and a segmented control in the sidebar.

**Tech Stack:** Node 24 + TypeScript (Next.js app, `tsx --test`), better-sqlite3, Python 3 (stdlib, `openpyxl`, `pdfplumber`; `msoffcrypto` on the laptop only), LibreOffice `soffice` for `.xls`.

**Spec:** `docs/superpowers/specs/2026-10-09-net-worth-and-pension-design.md` (phase 1 of 4).

## Global Constraints

- **Default view is fixed.** The Stocks view must produce byte-for-byte the figures it produces today: taxable and ISA securities only.
- **Wrappers.** `account_wrapper` values are exactly `taxable` | `isa` | `irp` | `pension_savings`. `owner` is `self` for now. `asset_class` is `security` | `gold`.
- **`cash_balances.kind`** is exactly `checking` | `savings` | `cma` | `deposit`. `currency` is `KRW` | `USD`.
- **Private data stays local.** Account numbers, institution aliases and anchor balances live only in the gitignored `data/accounts.local.json` (`STOCK_ACCOUNT_MAP_PATH`). Never put them in the repo, test fixtures, commit messages or PR text. The repo is public.
- **New validation checks do not fail the refresh.** They use severity `warning`.
- **Text rules.** Repo text is English only. Korean appears only as data, such as document markers that detectors match.
- **Testing on the laptop.** Run the test suite with Node 24: `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH pnpm test`. In a fresh worktree, first copy `better_sqlite3.node` from the main checkout (see the repo memory note). Use `/usr/bin/grep`; the interactive shell's `grep` function has dropped matches on large files.
- **Coverage cadence** for deposit statements is 90 days, but it is wired in phase 4, not here.

## Review Focus

1. **A statement downloaded again with an overlapping date range.** The same transaction must count once. One balance per account per day, taken from the last transaction of that day.
2. **Newest-first exports** (Chase, Robinhood bank). The end-of-day balance must come from the chronologically last transaction of the day, not the first row in the file.
3. **A USD deposit with no USD/KRW rate available.** Net worth must mark it unpriced and leave it out of the total. It must not count it as ₩0 or as $1 = ₩1.
4. **No `data/accounts.local.json` at all** (CI, sample mode, a fresh checkout). Ingest, extract and the app must all still run. Bank accounts get generic aliases (institution + kind).
5. **An anchor dated outside the transaction window, or no anchor.** For Robinhood bank, the walk works in both directions. With no anchor, it produces no derived balances and raises a `cash_anchor_present` warning. It must not crash.

Each line has a test in the task that owns that code (Tasks 1, 3, 4, 6).

---

## File map

| File | Status | Responsibility |
| --- | --- | --- |
| `scripts/account-map.mjs` | create | Load the local account map; `wrapperFor`, `ownerFor`, `tagRows` |
| `data/accounts.local.example.json` | create | Documented shape of the gitignored map, with invented values |
| `.gitignore` | modify | Ignore `data/accounts.local.json` and `data/bank-balances.json` |
| `scripts/ingest-stock-data.mjs` | modify | New columns, central tagging in `insertMany`, `cash_balances`, new checks |
| `scripts/seed-sample.mjs` | modify | Same schema for sample mode (CI builds it) |
| `tests/ingest-harness.ts` | modify | Name the two new input paths |
| `scripts/file-downloads.py` | modify | Detectors: Chase checking, BoA, Robinhood bank, 새마을금고 `.xls`, 토스뱅크 (encrypted) |
| `scripts/extract-bank-statements.py` | create | Parse `bank-statements/*` into `data/bank-balances.json` |
| `scripts/extract-bank-statements.mjs` | create | npm wrapper, the same as `extract-fx-ledger.mjs` |
| `package.json`, `scripts/refresh.mjs` | modify | `extract:bank-statements` script and refresh step |
| `lib/net-worth.ts` | create | Pure net-worth math |
| `lib/adapters/portfolio-db.ts` | modify | `STOCK_WRAPPER_SQL`; apply it to holdings totals; `getNetWorth()`; `/accounts` balance spans |
| `lib/account-ranges.ts` | modify | `RangeKind` gains `balances` |
| `lib/asset-view.ts`, `lib/asset-view-server.ts` | create | Cookie and normaliser for the view switch |
| `components/LanguageSwitcher.tsx`, `components/Sidebar.tsx`, `app/layout.tsx` | modify | `AssetViewSwitcher` in the sidebar |
| `app/page.tsx`, `lib/ui-copy/pages/overview.tsx` | modify | Total-assets card in the All-assets view |
| `app/net-worth/page.tsx`, `lib/ui-copy/pages/netWorth.ts` | create | The new page |
| `lib/ui-copy/pages/index.ts`, `lib/ui-copy/pages/sidebar.ts`, `lib/page-names.ts`, `scripts/mobile-audit.mjs`, `scripts/snap-ui.mjs` | modify | Register the route |
| `app/accounts/page.tsx`, `lib/ui-copy/pages/accounts.ts` | modify | Show balance spans; drop the "not collected" note for deposits |
| `docs/data-sources.md` | modify | New sources and destination directory |
| `tests/account-map.test.mjs`, `tests/bank-filing.test.ts`, `tests/bank-statements.test.ts`, `tests/cash-balances-ingest.test.ts`, `tests/net-worth.test.ts`, `tests/default-view.test.ts`, `tests/asset-view.test.ts` | create | Tests per task |

---

### Task 1: Account map and wrapper rule

**Files:**
- Create: `scripts/account-map.mjs`, `data/accounts.local.example.json`, `tests/account-map.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces:
  - `STOCK_WRAPPERS: readonly ['taxable','isa']`
  - `loadAccountMap(file?: string): { accounts: Record<string,{wrapper?:string; owner?:string}>; bankAccounts: BankAccountRule[]; anchors: Anchor[] }`
  - `wrapperFor(row: {account?: string}, map): string`
  - `ownerFor(row, map): string`
  - `tagRows<T>(rows: T[], map): (T & {account_wrapper: string; owner: string})[]`
- Map file shape (also read by Python in Task 4):
  - `bankAccounts[]`: `{ institution, last4?, kind, currency, alias }`
  - `anchors[]`: `{ alias, date, balance }`

- [ ] **Step 1: Write the failing test** — `tests/account-map.test.mjs`

```js
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { STOCK_WRAPPERS, loadAccountMap, tagRows, wrapperFor } from '../scripts/account-map.mjs'

test('no map file is an empty map, not an error', () => {
  const map = loadAccountMap(path.join(tmpdir(), 'does-not-exist.json'))
  assert.deepEqual(map, { accounts: {}, bankAccounts: [], anchors: [] })
})

test('ISA is recognised from the account label; everything else defaults to taxable', () => {
  const map = loadAccountMap(undefined)
  assert.equal(wrapperFor({ account: '미래에셋증권(ISA)' }, map), 'isa')
  assert.equal(wrapperFor({ account: 'Robinhood 1111' }, map), 'taxable')
  assert.deepEqual([...STOCK_WRAPPERS], ['taxable', 'isa'])
})

test('the local map overrides the label rule and sets the owner', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'acct-map-'))
  const file = path.join(dir, 'accounts.local.json')
  writeFileSync(file, JSON.stringify({ accounts: { 'Example IRP': { wrapper: 'irp', owner: 'self' } } }))
  const map = loadAccountMap(file)
  const [row] = tagRows([{ account: 'Example IRP', ticker: 'X' }], map)
  assert.equal(row.account_wrapper, 'irp')
  assert.equal(row.owner, 'self')
  assert.equal(row.ticker, 'X')
})

test('a row that already carries a wrapper keeps it', () => {
  const [row] = tagRows([{ account: 'Anything', account_wrapper: 'pension_savings' }], loadAccountMap(undefined))
  assert.equal(row.account_wrapper, 'pension_savings')
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH node --test tests/account-map.test.mjs`
Expected: FAIL, `Cannot find module '../scripts/account-map.mjs'`.

- [ ] **Step 3: Implement** — `scripts/account-map.mjs`

```js
// account-map.mjs — which wrapper and owner each account belongs to.
//
// Account numbers and institution aliases are private, and this repository is
// public, so the mapping lives in a gitignored file (STOCK_ACCOUNT_MAP_PATH,
// default data/accounts.local.json). Its absence is normal: CI, sample mode and a
// fresh checkout have none, and every account then falls back to the label rule.
import fs from 'node:fs'

/** The wrappers the default (Stocks) view shows. Everything else needs the All-assets view. */
export const STOCK_WRAPPERS = Object.freeze(['taxable', 'isa'])

const EMPTY = Object.freeze({ accounts: {}, bankAccounts: [], anchors: [] })

export function loadAccountMap(file) {
  if (!file || !fs.existsSync(file)) return { accounts: {}, bankAccounts: [], anchors: [] }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  return {
    accounts: raw.accounts ?? EMPTY.accounts,
    bankAccounts: raw.bankAccounts ?? [],
    anchors: raw.anchors ?? [],
  }
}

export function wrapperFor(row, map) {
  const override = map.accounts?.[row.account]?.wrapper
  if (override) return override
  // 미래에셋 labels its ISA account "미래에셋증권(ISA)"; that is the only ISA today.
  return /ISA/i.test(String(row.account ?? '')) ? 'isa' : 'taxable'
}

export function ownerFor(row, map) {
  return map.accounts?.[row.account]?.owner ?? 'self'
}

export function tagRows(rows, map) {
  return rows.map((row) => ({
    ...row,
    account_wrapper: row.account_wrapper ?? wrapperFor(row, map),
    owner: row.owner ?? ownerFor(row, map),
  }))
}
```

`data/accounts.local.example.json` (invented values only):

```json
{
  "accounts": {
    "Example Pension IRP": { "wrapper": "irp", "owner": "self" }
  },
  "bankAccounts": [
    { "institution": "chase", "last4": "0000", "kind": "checking", "currency": "USD", "alias": "Chase checking" },
    { "institution": "robinhood-bank", "kind": "checking", "currency": "USD", "alias": "Robinhood checking" },
    { "institution": "robinhood-bank", "kind": "savings", "currency": "USD", "alias": "Robinhood savings" }
  ],
  "anchors": [
    { "alias": "Robinhood checking", "date": "2026-01-31", "balance": 100.0 }
  ]
}
```

Append to `.gitignore`:

```
# Private account map (numbers, aliases, anchor balances) — see data/accounts.local.example.json
data/accounts.local.json
# Generated by extract:bank-statements; carries balances
data/bank-balances.json
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH node --test tests/account-map.test.mjs`
Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/account-map.mjs data/accounts.local.example.json tests/account-map.test.mjs .gitignore
git commit -m "feat(accounts): local account map and the wrapper rule"
```

---

### Task 2: Wrapper columns in the ingest and the sample schema

**Files:**
- Modify: `scripts/ingest-stock-data.mjs` (path constants near line 24; the `create table` block near line 640; `insertMany` near line 562; checks after line 4300), `scripts/seed-sample.mjs`, `tests/ingest-harness.ts`
- Test: `tests/cash-balances-ingest.test.ts` (created here, extended in Task 5)

**Interfaces:**
- Consumes: `loadAccountMap`, `tagRows` from Task 1.
- Produces:
  - DB columns `account_wrapper text not null default 'taxable'` and `owner text not null default 'self'` on `holdings`, `tax_lots`, `realized_lots`, `transactions` and `dividends`.
  - `asset_class text not null default 'security'` on `holdings`.
  - Validation check `wrapper_assigned` (warning).
  - Env var `STOCK_ACCOUNT_MAP_PATH`.

- [ ] **Step 1: Write the failing test** — `tests/cash-balances-ingest.test.ts`

```ts
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'

// An ingest over empty inputs fails some unrelated checks and exits non-zero
// while still writing the database, so allowFailure is set and the tests read
// the tables and checks they care about.
function ingest(env: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cash-ingest-'))
  return new Database(runIngest(dir, { env, allowFailure: true }), { readonly: true })
}

test('securities tables carry account_wrapper and owner; holdings carry asset_class', () => {
  const db = ingest()
  for (const table of ['holdings', 'tax_lots', 'realized_lots', 'transactions', 'dividends']) {
    const cols = (db.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
    assert.ok(cols.includes('account_wrapper'), `${table}.account_wrapper`)
    assert.ok(cols.includes('owner'), `${table}.owner`)
  }
  const holdingCols = (db.prepare('pragma table_info(holdings)').all() as { name: string }[]).map((c) => c.name)
  assert.ok(holdingCols.includes('asset_class'))
  const check = db.prepare("select status, severity from validation_checks where name = 'wrapper_assigned'").get() as any
  assert.equal(check.status, 'pass')
  assert.equal(check.severity, 'warning')
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH node_modules/.bin/tsx --test tests/cash-balances-ingest.test.ts`
Expected: FAIL on `holdings.account_wrapper`.

- [ ] **Step 3: Implement**

In `scripts/ingest-stock-data.mjs`:

1. Add the import at the top: `import { loadAccountMap, tagRows } from './account-map.mjs'`.
2. Next to the other path constants (around line 24):

```js
const accountMapPath = process.env.STOCK_ACCOUNT_MAP_PATH || path.join(process.cwd(), 'data/accounts.local.json')
const accountMap = loadAccountMap(accountMapPath)
```

3. In each of the five `create table` statements (`holdings`, `tax_lots`, `realized_lots`, `transactions`, `dividends`), add these two lines before the closing `);`. For `holdings`, also add `asset_class`.

```sql
  account_wrapper text not null default 'taxable',
  owner text not null default 'self'
```
```sql
  asset_class text not null default 'security',
```

   Mind the trailing comma on the line before them.

4. Replace `insertMany` (around line 562) with this:

```js
// Every securities row gets its wrapper and owner here, in one place, so no
// call site can forget to tag a row and leak a pension position into the
// default (Stocks) view.
const WRAPPED_TABLES = new Set(['holdings', 'tax_lots', 'realized_lots', 'transactions', 'dividends'])

function insertMany(db, table, rows, columns) {
  if (rows.length === 0) return
  if (WRAPPED_TABLES.has(table)) {
    rows = tagRows(rows, accountMap)
    columns = [...columns.filter((c) => c !== 'account_wrapper' && c !== 'owner'), 'account_wrapper', 'owner']
  }
  const placeholders = columns.map(() => '?').join(', ')
  const stmt = db.prepare(`insert into ${table} (${columns.join(', ')}) values (${placeholders})`)
  const tx = db.transaction((items) => {
    for (const item of items) stmt.run(columns.map((col) => item[col] ?? null))
  })
  tx(rows)
}
```

   The path constants (item 2) sit near the top of the file, above `insertMany` (around line 562), so `accountMap` is initialised before the first insert.

5. After `function check(...)` (around line 4301), add:

```js
const unwrapped = ['holdings', 'tax_lots', 'realized_lots', 'transactions', 'dividends'].map((table) => [
  table,
  db.prepare(`select count(*) as n from ${table} where account_wrapper is null or account_wrapper = ''`).get().n,
])
check(
  'wrapper_assigned',
  unwrapped.every(([, n]) => n === 0),
  unwrapped.every(([, n]) => n === 0)
    ? 'every securities row has an account wrapper'
    : unwrapped.filter(([, n]) => n > 0).map(([t, n]) => `${t}: ${n} row(s) without a wrapper`).join('; '),
  'warning'
)
```

6. Register the map as a source file next to the `robinhood_snapshot` registration (around line 1133). Use the same pattern and record only the fingerprint, never the contents:

```js
if (fs.existsSync(accountMapPath)) {
  const fp = fingerprint(accountMapPath)
  db.prepare(
    'insert into source_files (name, filename, path, bytes, mtime_ms, sha256, row_count) values (?, ?, ?, ?, ?, ?, ?)'
  ).run('account_map', fp.basename, fp.path, fp.bytes, fp.mtimeMs, fp.sha256, Object.keys(accountMap.accounts).length)
}
```

In `scripts/seed-sample.mjs`, add the same columns to the same five `create table` statements. Sample rows get the defaults.

In `tests/ingest-harness.ts`, add `STOCK_ACCOUNT_MAP_PATH: 'accounts.local.json'` to `INGEST_PATHS`.

- [ ] **Step 4: Run it and confirm it passes, and that nothing else broke**

Run: `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH pnpm test`
Expected: everything passes, including the new test.

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest-stock-data.mjs scripts/seed-sample.mjs tests/ingest-harness.ts tests/cash-balances-ingest.test.ts
git commit -m "feat(ingest): tag securities rows with account wrapper and owner"
```

---

### Task 3: Bank statement detectors in the filer

**Files:**
- Modify: `scripts/file-downloads.py` (constants near line 97, `Plan` near line 431, `DETECTORS` near line 1199, the move step in `main` near line 1277)
- Test: `tests/bank-filing.test.ts`

**Interfaces:**
- Produces:
  - Destination dir `DIR_BANK = "bank-statements"`.
  - File names: `chase-checking-<from>-<to>.csv`, `boa-checking-<from>-<to>.csv`, `robinhood-bank-<checking|savings>-<from>-<to>.csv`, `mg-deposit-<from>-<to>.xls`, `tossbank-<from>-<to>.xlsx`. Dates are `YYYYMMDD` taken from the rows.
  - `Plan(..., transform="tossbank-decrypt")`: the move step writes a decrypted copy instead of renaming.

- [ ] **Step 1: Write the failing test** — `tests/bank-filing.test.ts`. Copy the `fileDownloads()` helper from `tests/source-filing.test.ts` (lines 71–84). Fixtures are the real headers with invented rows.

```ts
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

function fileDownloads(files: Record<string, string | Buffer>) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'bank-inbox-'))
  mkdirSync(path.join(dataDir, 'inbox'), { recursive: true })
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dataDir, 'inbox', name), body)
  const result = spawnSync(process.env.STOCK_PYTHON_BIN || 'python3', ['scripts/file-downloads.py', '--dry-run'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, STOCK_DATA_DIR: dataDir, STOCK_TOSSBANK_PASSWORD: '' },
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

const RH_CHECKING = ['Date,Description,Amount', '2026-10-05,"Inter-Entity Transfer to Brokerage",-10.00', '2026-09-01,"Example Deposit",30.00'].join('\n')
const RH_SAVINGS = ['Date,Description,Amount', '2026-09-30,"Interest Payment",1.00', '2026-09-01,"Internal Transfer from Personal Checking",20.00'].join('\n')
const RH_UNKNOWN = ['Date,Description,Amount', '2026-09-30,"Something",1.00'].join('\n')

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

test('an encrypted 토스뱅크 export without a password is refused with the variable to set', () => {
  // CFB magic + the EncryptedPackage stream name is enough for the detector; the body is not decrypted here.
  const cfb = Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(504), Buffer.from('EncryptedPackage', 'utf16le')])
  assert.match(fileDownloads({ '토스뱅크_거래내역.xlsx': cfb }), /STOCK_TOSSBANK_PASSWORD/)
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH node_modules/.bin/tsx --test tests/bank-filing.test.ts`
Expected: FAIL (each file is "unidentified").

- [ ] **Step 3: Implement** in `scripts/file-downloads.py`

1. Add `DIR_BANK = "bank-statements"` next to the other `DIR_` constants, and `TOSSBANK_PASSWORD = os.environ.get("STOCK_TOSSBANK_PASSWORD", "")` next to `PDF_PASSWORD`. `load_local_env()` already loads `.env.local`, so the value is available after it runs. Read it inside the detector, not at import, if `load_local_env` runs later.
2. Add `transform=None` to `Plan.__init__` and store it as `self.transform`.
3. Add the detectors:

```python
def _row_dates(lines, parse):
    found = []
    for line in lines:
        cell = line.split(",", 1)[0].strip().strip('"')
        day = parse(cell)
        if day:
            found.append(day)
    return found


def detect_chase_checking(doc):
    """Chase deposit-account activity → bank-statements/chase-checking-<first>-<last>.csv

    Different header from the brokerage exports detect_chase claims. Rows are
    newest first; the name uses the earliest and latest row dates.
    """
    if doc.suffix != ".csv" or not doc.lines:
        return None
    if not doc.lines[0].startswith("Details,Posting Date,Description,Amount,Type,Balance"):
        return None
    days = []
    for line in doc.lines[1:]:
        parts = line.split(",")
        if len(parts) > 1:
            day = parse_mdy(parts[1].strip())
            if day:
                days.append(day)
    if not days:
        return Refusal("Chase deposit activity with no dated rows")
    return Plan(DIR_BANK, f"chase-checking-{compact(min(days))}-{compact(max(days))}.csv",
                [f"rows {iso(min(days))} … {iso(max(days))}", "header Details,Posting Date,…,Balance"])


def detect_boa(doc):
    """Bank of America statement CSV → bank-statements/boa-checking-<begin>-<end>.csv"""
    if doc.suffix != ".csv" or not doc.lines:
        return None
    if not doc.lines[0].startswith("Description,,Summary Amt."):
        return None
    text = "\n".join(doc.lines[:6])
    begin = re.search(r"Beginning balance as of (\d{2}/\d{2}/\d{4})", text)
    end = re.search(r"Ending balance as of (\d{2}/\d{2}/\d{4})", text)
    if not (begin and end):
        return Refusal("Bank of America CSV without its Beginning/Ending balance lines")
    start, stop = parse_mdy(begin.group(1)), parse_mdy(end.group(1))
    return Plan(DIR_BANK, f"boa-checking-{compact(start)}-{compact(stop)}.csv",
                [f"declared period {iso(start)} … {iso(stop)}"])


ROBINHOOD_BANK_CHECKING = ("to robinhood credit card", "to brokerage", "fid bkg svc")
ROBINHOOD_BANK_SAVINGS = ("from personal checking", "interest payment")


def detect_robinhood_bank(doc):
    """Robinhood checking / savings CSV → bank-statements/robinhood-bank-<kind>-<first>-<last>.csv

    The export has no account column and no balance, so the kind is read off the
    rows. When the rows do not say, it is refused rather than guessed.
    """
    if doc.suffix != ".csv" or not doc.lines or doc.lines[0].strip() != "Date,Description,Amount":
        return None
    days = _row_dates(doc.lines[1:], lambda s: parse_ymd(s))
    body = "\n".join(doc.lines[1:]).lower()
    savings = any(marker in body for marker in ROBINHOOD_BANK_SAVINGS)
    checking = any(marker in body for marker in ROBINHOOD_BANK_CHECKING)
    if savings == checking or not days:
        return Refusal("Robinhood bank CSV: the rows do not say whether this is checking or savings — "
                       "name it bank-statements/robinhood-bank-<checking|savings>-<first>-<last>.csv by hand")
    kind = "savings" if savings else "checking"
    return Plan(DIR_BANK, f"robinhood-bank-{kind}-{compact(min(days))}-{compact(max(days))}.csv",
                [f"rows {iso(min(days))} … {iso(max(days))}", f"kind {kind} from the row descriptions"])


def _utf16_contains(path, *needles):
    raw = path.read_bytes()
    return all(needle.encode("utf-16-le") in raw for needle in needles)


def detect_mg_deposit(doc):
    """새마을금고 거래내역조회 (.xls) → bank-statements/mg-deposit-<from>-<to>.xls

    An .xls is not read cell by cell here (that needs soffice); its strings are
    stored as UTF-16, so the title and the period line are found in the bytes.
    """
    if doc.suffix != ".xls":
        return None
    if not _utf16_contains(doc.path, "거래내역조회", "통장(상품)명"):
        return None
    raw = doc.path.read_bytes().decode("utf-16-le", errors="ignore")
    period = re.search(r"조회기간\s*:\s*(\d{4})\.(\d{2})\.(\d{2})\s*~\s*(\d{4})\.(\d{2})\.(\d{2})", raw)
    if not period:
        return Refusal("새마을금고 거래내역조회 without a 조회기간 line")
    g = [int(x) for x in period.groups()]
    start, stop = date(g[0], g[1], g[2]), date(g[3], g[4], g[5])
    return Plan(DIR_BANK, f"mg-deposit-{compact(start)}-{compact(stop)}.xls", [f"조회기간 {iso(start)} … {iso(stop)}"])


def detect_tossbank(doc):
    """토스뱅크 거래내역 (.xlsx, password-protected) → bank-statements/tossbank-….xlsx, decrypted."""
    if doc.suffix != ".xlsx":
        return None
    raw = doc.path.read_bytes()[:1 << 20]
    if not (raw.startswith(bytes.fromhex("d0cf11e0a1b11ae1")) and "EncryptedPackage".encode("utf-16-le") in raw):
        return None
    if "토스뱅크" not in nfc(doc.path.name):
        return None  # an encrypted workbook from somewhere else is not ours to claim
    password = os.environ.get("STOCK_TOSSBANK_PASSWORD", "")
    if not password:
        return Refusal("토스뱅크 export is password-protected — set STOCK_TOSSBANK_PASSWORD in .env.local")
    try:
        import msoffcrypto  # laptop only; the ops host never sees the encrypted file
    except ImportError:
        return Refusal("토스뱅크 export is encrypted and msoffcrypto is not installed on this machine")
    return Plan(DIR_BANK, f"tossbank-{compact(doc.downloaded)}.xlsx",
                ["password-protected; filed decrypted", f"download {iso(doc.downloaded)}"],
                transform="tossbank-decrypt")
```

   `detect_tossbank` reads the file *name*, which every other detector avoids. The contents are encrypted, so the name is the only signal left. Say so in the docstring.

4. Register them in `DETECTORS`, after the Robinhood transactions entry:

```python
    ("Chase deposit activity CSV", detect_chase_checking),
    ("Bank of America statement CSV", detect_boa),
    ("Robinhood checking / savings CSV", detect_robinhood_bank),
    ("새마을금고 거래내역조회 (.xls)", detect_mg_deposit),
    ("토스뱅크 거래내역 (.xlsx, encrypted)", detect_tossbank),
```

   Confirm that `detect_robinhood_transactions` does not also claim a `Date,Description,Amount` file; it expects a headerless brokerage export. If it does, `identify()` reports a double claim and the test fails. Fix it there.

5. In `main`, where a plan is executed (not in `--dry-run`), add a branch before the rename:

```python
if plan.transform == "tossbank-decrypt":
    import msoffcrypto
    with source.open("rb") as handle:
        office = msoffcrypto.OfficeFile(handle)
        office.load_key(password=os.environ["STOCK_TOSSBANK_PASSWORD"])
        with destination.open("wb") as out:
            office.decrypt(out)
    source.unlink()
    continue
```

   Name the variables after the ones `main` already uses for the source path and the destination path.

- [ ] **Step 4: Run it and confirm it passes**

Run: `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH node_modules/.bin/tsx --test tests/bank-filing.test.ts tests/source-filing.test.ts`
Expected: all pass. The existing filing tests must not regress.

- [ ] **Step 5: Commit**

```bash
git add scripts/file-downloads.py tests/bank-filing.test.ts
git commit -m "feat(file-downloads): file bank deposit statements into bank-statements/"
```

---

### Task 4: Bank statement extractor

**Files:**
- Create: `scripts/extract-bank-statements.py`, `scripts/extract-bank-statements.mjs`, `tests/bank-statements.test.ts`
- Modify: `package.json` (scripts), `scripts/refresh.mjs` (steps list, line ~82)

**Interfaces:**
- Consumes: `bank-statements/*` from Task 3; `bankAccounts` and `anchors` from the map (Task 1); `soffice_binary` and `soffice_convert_args` from `scripts/extract-fx-ledger.py`, loaded with importlib.
- Produces: `data/bank-balances.json` (`STOCK_BANK_BALANCES_PATH`):

```json
{
  "generatedAt": "ISO",
  "accounts": [
    { "institution": "chase", "account": "Chase checking", "kind": "checking", "currency": "USD", "owner": "self",
      "derived": false, "sources": ["chase-checking-….csv"],
      "balances": [{ "date": "2026-10-01", "balance": 950.0 }],
      "continuityBreaks": [] }
  ],
  "findings": ["…"]
}
```

  Python functions, which the tests call directly:
  - `parse_chase(text) -> list[Txn]`
  - `parse_boa(text) -> list[Txn]`
  - `parse_robinhood_bank(text) -> list[Txn]`
  - `parse_mg_rows(rows) -> list[Txn]`
  - `end_of_day(txns) -> list[{date, balance}]`
  - `walk_from_anchor(txns, anchor_date, anchor_balance) -> list[{date, balance}]`
  - `continuity_breaks(txns) -> list[str]`

  `Txn` is a dict with keys `date` (ISO), `seq` (int, chronological order within the file), `amount` (float) and `balance` (float | None).

- [ ] **Step 1: Write the failing test** — `tests/bank-statements.test.ts`, in the same `runPython` style as `tests/fx-ledger.test.ts`.

```ts
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH node_modules/.bin/tsx --test tests/bank-statements.test.ts`
Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Implement** — `scripts/extract-bank-statements.py`

```python
#!/usr/bin/env python3
"""Bank deposit statements in bank-statements/ → data/bank-balances.json.

Balances, not spending: each statement is reduced to one end-of-day balance per
account per day. Statements that print a running balance are read as printed and
checked for continuity; Robinhood's export prints none, so its history is walked
from one anchor balance kept in the gitignored account map.
"""
from __future__ import annotations

import csv, io, importlib.util, json, os, re, subprocess, tempfile
from datetime import date, datetime, timezone
from pathlib import Path

DATA_DIR = Path(os.environ.get("STOCK_DATA_DIR", Path.cwd() / "private-data"))
SOURCE_DIR = DATA_DIR / "bank-statements"
OUT_PATH = Path(os.environ.get("STOCK_BANK_BALANCES_PATH", Path.cwd() / "data" / "bank-balances.json"))
MAP_PATH = Path(os.environ.get("STOCK_ACCOUNT_MAP_PATH", Path.cwd() / "data" / "accounts.local.json"))


def _num(text):
    text = (text or "").replace(",", "").replace('"', "").strip()
    return float(text) if text not in ("", "-") else None


def _mdy(text):
    m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", (text or "").strip())
    return f"{m.group(3)}-{m.group(1)}-{m.group(2)}" if m else None


def _csv_rows(text):
    return list(csv.reader(io.StringIO(text)))


def parse_chase(text):
    rows = _csv_rows(text)[1:]
    out = []
    for i, r in enumerate(reversed(rows)):  # the file is newest first
        if len(r) < 6 or not _mdy(r[1]):
            continue
        out.append({"date": _mdy(r[1]), "seq": i, "description": r[2], "amount": _num(r[3]) or 0.0, "balance": _num(r[5])})
    return out


def parse_boa(text):
    rows = _csv_rows(text)
    start = next(i for i, r in enumerate(rows) if r[:2] == ["Date", "Description"])
    out = []
    for i, r in enumerate(rows[start + 1:]):
        if len(r) < 4 or not _mdy(r[0]):
            continue
        out.append({"date": _mdy(r[0]), "seq": i, "description": r[1], "amount": _num(r[2]) or 0.0, "balance": _num(r[3])})
    return out


def parse_robinhood_bank(text):
    rows = _csv_rows(text)[1:]
    out = []
    for i, r in enumerate(reversed(rows)):  # newest first
        if len(r) < 3 or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", r[0].strip()):
            continue
        out.append({"date": r[0].strip(), "seq": i, "description": r[1], "amount": _num(r[2]) or 0.0, "balance": None})
    return out


def parse_mg_rows(rows):
    """Rows of the converted 새마을금고 sheet: header 거래일자, 거래시간, …, 출금액, 입금액, 잔액."""
    header_at = next(i for i, r in enumerate(rows) if "거래일자" in [c.strip() for c in r])
    header = [c.strip() for c in rows[header_at]]
    col = {name: header.index(name) for name in ("거래일자", "거래시간", "출금액", "입금액", "잔액")}
    parsed = []
    for r in rows[header_at + 1:]:
        day = (r[col["거래일자"]] if len(r) > col["거래일자"] else "").strip().replace(".", "-")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
            continue
        out_amt = _num(r[col["출금액"]]) or 0.0
        in_amt = _num(r[col["입금액"]]) or 0.0
        parsed.append((day, r[col["거래시간"]].strip(), in_amt - out_amt, _num(r[col["잔액"]])))
    parsed.sort(key=lambda t: (t[0], t[1]))
    return [{"date": d, "seq": i, "description": "", "amount": a, "balance": b} for i, (d, _, a, b) in enumerate(parsed)]


def merge_txns(groups):
    """Concatenate statements chronologically; a transaction already seen is dropped."""
    seen, merged = set(), []
    for txn in sorted((t for g in groups for t in g), key=lambda t: (t["date"], t["seq"])):
        key = (txn["date"], txn.get("description", ""), round(txn["amount"], 2), txn["balance"])
        if key in seen:
            continue
        seen.add(key)
        merged.append(txn)
    return merged


def end_of_day(txns):
    last = {}
    for txn in sorted(txns, key=lambda t: (t["date"], t["seq"])):
        if txn["balance"] is not None:
            last[txn["date"]] = txn["balance"]
    return [{"date": d, "balance": b} for d, b in sorted(last.items())]


def walk_from_anchor(txns, anchor_date, anchor_balance):
    """End-of-day balances from one known balance at the end of `anchor_date`.

    The opening balance is the anchor minus everything up to and including the
    anchor day; a running sum from there reproduces the anchor on its own day and
    walks forwards past it. An anchor after the last transaction works the same.
    """
    ordered = sorted(txns, key=lambda t: (t["date"], t["seq"]))
    opening = anchor_balance - sum(t["amount"] for t in ordered if t["date"] <= anchor_date)
    running, by_day = opening, {}
    for txn in ordered:
        running += txn["amount"]
        by_day[txn["date"]] = round(running, 2)
    return [{"date": d, "balance": b} for d, b in sorted(by_day.items())]


def continuity_breaks(txns):
    breaks, previous = [], None
    for txn in sorted(txns, key=lambda t: (t["date"], t["seq"])):
        if txn["balance"] is None:
            continue
        if previous is not None and abs(previous + txn["amount"] - txn["balance"]) > 0.005:
            breaks.append(f"{txn['date']}: {previous:.2f} + {txn['amount']:.2f} ≠ {txn['balance']:.2f}")
        previous = txn["balance"]
    return breaks


def _fx_ledger_module():
    spec = importlib.util.spec_from_file_location("fx_ledger", Path(__file__).with_name("extract-fx-ledger.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _xls_rows(source, findings):
    fx = _fx_ledger_module()
    binary = fx.soffice_binary()
    if not binary:
        findings.append(f"{source.name}: no soffice binary; XLS rows were not read")
        return []
    with tempfile.TemporaryDirectory(prefix="bank-xls-") as temp_dir:
        try:
            subprocess.run(fx.soffice_convert_args(binary, temp_dir, source), capture_output=True, text=True,
                           timeout=fx.SOFFICE_TIMEOUT_SECONDS, check=True)
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as error:
            findings.append(f"{source.name}: XLS conversion failed ({type(error).__name__}); rows were not read")
            return []
        converted = Path(temp_dir) / f"{source.stem}.csv"
        return _csv_rows(converted.read_text(encoding="utf-8", errors="replace"))


FAMILIES = [
    # (filename prefix, institution, kind, currency, parser)
    ("chase-checking-", "chase", "checking", "USD", lambda p, f: parse_chase(p.read_text(encoding="utf-8-sig"))),
    ("boa-checking-", "boa", "checking", "USD", lambda p, f: parse_boa(p.read_text(encoding="utf-8-sig"))),
    ("robinhood-bank-checking-", "robinhood-bank", "checking", "USD", lambda p, f: parse_robinhood_bank(p.read_text(encoding="utf-8-sig"))),
    ("robinhood-bank-savings-", "robinhood-bank", "savings", "USD", lambda p, f: parse_robinhood_bank(p.read_text(encoding="utf-8-sig"))),
    ("mg-deposit-", "mg", "deposit", "KRW", lambda p, f: parse_mg_rows(_xls_rows(p, f))),
]


def _alias(account_map, institution, kind):
    for rule in account_map.get("bankAccounts", []):
        if rule.get("institution") == institution and rule.get("kind") == kind:
            return rule.get("alias") or f"{institution} {kind}"
    return f"{institution} {kind}"


def main():
    account_map = json.loads(MAP_PATH.read_text(encoding="utf-8")) if MAP_PATH.exists() else {}
    findings, accounts = [], []
    for prefix, institution, kind, currency, parse in FAMILIES:
        files = sorted(SOURCE_DIR.glob(f"{prefix}*")) if SOURCE_DIR.exists() else []
        if not files:
            continue
        txns = merge_txns([parse(path, findings) for path in files])
        alias = _alias(account_map, institution, kind)
        derived = all(t["balance"] is None for t in txns)
        if derived:
            anchor = next((a for a in account_map.get("anchors", []) if a.get("alias") == alias), None)
            if anchor is None:
                findings.append(f"{alias}: no anchor balance in the account map; balances not derived")
                balances = []
            else:
                balances = walk_from_anchor(txns, anchor["date"], float(anchor["balance"]))
        else:
            balances = end_of_day(txns)
        accounts.append({
            "institution": institution, "account": alias, "kind": kind, "currency": currency, "owner": "self",
            "derived": derived, "sources": [p.name for p in files], "balances": balances,
            "continuityBreaks": [] if derived else continuity_breaks(txns),
        })
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    document = {"generatedAt": datetime.now(timezone.utc).isoformat(), "accounts": accounts, "findings": findings}
    OUT_PATH.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"bank balances: {len(accounts)} account(s), {len(findings)} finding(s) → {OUT_PATH}")


if __name__ == "__main__":
    main()
```

`scripts/extract-bank-statements.mjs` is `scripts/extract-fx-ledger.mjs` with `extract-fx-ledger.py` replaced by `extract-bank-statements.py`.

In `package.json` scripts: `"extract:bank-statements": "node scripts/extract-bank-statements.mjs",`.

In `scripts/refresh.mjs`, after `{ name: 'extract:fx-ledger', … }`:

```js
  // Bank deposit balances for the All-assets view. Optional: a broken bank parser
  // must not stop the stock refresh, and the cash_balances freshness shows its age.
  { name: 'extract:bank-statements', args: ['extract:bank-statements'], optional: true },
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH node_modules/.bin/tsx --test tests/bank-statements.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/extract-bank-statements.py scripts/extract-bank-statements.mjs package.json scripts/refresh.mjs tests/bank-statements.test.ts
git commit -m "feat(bank): extract end-of-day deposit balances from bank statements"
```

---

### Task 5: `cash_balances` in the ingest

**Files:**
- Modify: `scripts/ingest-stock-data.mjs`, `scripts/seed-sample.mjs`, `tests/ingest-harness.ts`, `tests/cash-balances-ingest.test.ts`

**Interfaces:**
- Consumes: `data/bank-balances.json` (Task 4); the existing `fxLedger.balances` (Hana USD).
- Produces:
  - Table `cash_balances(id, institution, account, owner, kind, currency, as_of_date, balance, source, derived)`.
  - Checks `cash_balance_continuity` and `cash_anchor_present` (warning).
  - Env var `STOCK_BANK_BALANCES_PATH`.

- [ ] **Step 1: Add the failing test** to `tests/cash-balances-ingest.test.ts`

```ts
import { writeFileSync } from 'node:fs'

test('bank balances and the Hana USD balances land in cash_balances; findings become warnings', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cash-src-'))
  const file = path.join(dir, 'bank-balances.json')
  writeFileSync(file, JSON.stringify({
    accounts: [
      { institution: 'chase', account: 'Chase checking', kind: 'checking', currency: 'USD', owner: 'self', derived: false,
        sources: ['chase-checking-x.csv'], balances: [{ date: '2026-10-01', balance: 945 }], continuityBreaks: ['2026-09-20: gap'] },
    ],
    findings: ['Robinhood checking: no anchor balance in the account map; balances not derived'],
  }))
  const db = ingest({ STOCK_BANK_BALANCES_PATH: file })
  const rows = db.prepare('select account, kind, currency, as_of_date, balance, derived from cash_balances').all()
  assert.deepEqual(rows, [{ account: 'Chase checking', kind: 'checking', currency: 'USD', as_of_date: '2026-10-01', balance: 945, derived: 0 }])
  const checks = Object.fromEntries((db.prepare("select name, status, severity from validation_checks where name like 'cash_%'").all() as any[]).map((c) => [c.name, c]))
  assert.equal(checks.cash_balance_continuity.status, 'fail')
  assert.equal(checks.cash_balance_continuity.severity, 'warning')
  assert.equal(checks.cash_anchor_present.status, 'fail')
})

test('no bank-balances file is an empty table and passing checks', () => {
  const db = ingest()
  assert.equal((db.prepare('select count(*) as n from cash_balances').get() as any).n, 0)
  const statuses = (db.prepare("select status from validation_checks where name like 'cash_%'").all() as any[]).map((c) => c.status)
  assert.deepEqual(statuses, ['pass', 'pass'])
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH node_modules/.bin/tsx --test tests/cash-balances-ingest.test.ts`
Expected: FAIL, `no such table: cash_balances`.

- [ ] **Step 3: Implement**

In `scripts/ingest-stock-data.mjs`:

```js
const bankBalancesPath = process.env.STOCK_BANK_BALANCES_PATH || path.join(process.cwd(), 'data/bank-balances.json')
const bankBalances = fs.existsSync(bankBalancesPath) ? JSON.parse(fs.readFileSync(bankBalancesPath, 'utf8')) : { accounts: [], findings: [] }
```

Add to the `create table` block, after `fx_account_balances`:

```sql
create table cash_balances (
  id integer primary key,
  institution text not null,
  account text not null,
  owner text not null default 'self',
  kind text not null,
  currency text not null,
  as_of_date text not null,
  balance real not null,
  source text not null,
  derived integer not null default 0
);
```

After the `fx_account_balances` insert (around line 4240):

```js
// Deposits for the All-assets view. The Hana USD account is a deposit too, so it
// is copied here from the FX ledger; fx_account_balances stays for /fx, which
// reads it, until a later phase moves that page over.
const cashRows = [
  ...(bankBalances.accounts ?? []).flatMap((account) =>
    (account.balances ?? []).map((b) => ({
      institution: account.institution,
      account: account.account,
      owner: account.owner || 'self',
      kind: account.kind,
      currency: account.currency,
      as_of_date: b.date,
      balance: b.balance,
      source: (account.sources ?? []).join(', ') || path.basename(bankBalancesPath),
      derived: account.derived ? 1 : 0,
    }))
  ),
  ...(fxLedger.balances ?? []).map((b) => ({
    institution: b.institution,
    account: b.account,
    owner: 'self',
    kind: 'deposit',
    currency: 'USD',
    as_of_date: b.as_of_date,
    balance: b.balance_usd,
    source: b.source,
    derived: 0,
  })),
]
insertMany(db, 'cash_balances', cashRows, ['institution', 'account', 'owner', 'kind', 'currency', 'as_of_date', 'balance', 'source', 'derived'])
```

With the checks:

```js
const continuityBreaks = (bankBalances.accounts ?? []).flatMap((a) => (a.continuityBreaks ?? []).map((b) => `${a.account} ${b}`))
check(
  'cash_balance_continuity',
  continuityBreaks.length === 0,
  continuityBreaks.length === 0 ? 'every running-balance statement is continuous' : `${continuityBreaks.length} break(s): ${continuityBreaks.slice(0, 5).join('; ')}`,
  'warning'
)
const anchorFindings = (bankBalances.findings ?? []).filter((f) => f.includes('no anchor balance'))
check(
  'cash_anchor_present',
  anchorFindings.length === 0,
  anchorFindings.length === 0 ? 'every account without a balance column has an anchor' : anchorFindings.join('; '),
  'warning'
)
```

Register `bank_balances` in `source_files` with the same pattern as the account map in Task 2, using `row_count = cashRows.length`. Add the `cash_balances` table to `scripts/seed-sample.mjs`; one invented KRW row is enough for the sample build. Add `STOCK_BANK_BALANCES_PATH: 'bank-balances.json'` to `INGEST_PATHS` in `tests/ingest-harness.ts`.

- [ ] **Step 4: Run it and confirm it passes**

Run: `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH pnpm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest-stock-data.mjs scripts/seed-sample.mjs tests/ingest-harness.ts tests/cash-balances-ingest.test.ts
git commit -m "feat(ingest): load deposit balances into cash_balances"
```

---

### Task 6: Default-view filter and net-worth math

**Files:**
- Create: `lib/net-worth.ts`, `tests/net-worth.test.ts`, `tests/default-view.test.ts`
- Modify: `lib/adapters/portfolio-db.ts`, `tests/overview-term.test.ts`, `tests/overview-realized-trend.test.ts`, `tests/account-coverage.test.ts`. Their hand-made `holdings` (and other) schemas gain `account_wrapper text not null default 'taxable'`.

**Interfaces:**
- Produces:
  - In `portfolio-db.ts`: `export const STOCK_WRAPPER_SQL = "account_wrapper in ('taxable','isa')"` and `export function getNetWorth(): NetWorth`.
  - In `lib/net-worth.ts`:

```ts
export type CashAccountBalance = { institution: string; account: string; kind: string; currency: 'KRW' | 'USD'; asOfDate: string; balance: number; derived: boolean }
export type NetWorth = {
  totalKrw: number
  byClass: { stocks: number; crypto: number; cash: number; pension: number; gold: number }
  cash: (CashAccountBalance & { krw: number | null })[]
  unpricedCash: string[]
  history: { month: string; stocks: number | null; cash: number }[]
}
export function summarizeNetWorth(input: { stocksKrw: number; cryptoKrw: number; cash: CashAccountBalance[]; usdKrw: number | null }): Omit<NetWorth, 'history'>
export function monthEndCash(series: { account: string; currency: 'KRW' | 'USD'; date: string; balance: number }[], rateAt: (date: string) => number | null): { month: string; cash: number }[]
```

- [ ] **Step 1: Write the failing tests**

`tests/net-worth.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { monthEndCash, summarizeNetWorth } from '../lib/net-worth'

const cash = (over: object) => ({ institution: 'x', account: 'A', kind: 'checking', currency: 'KRW' as const, asOfDate: '2026-10-01', balance: 1000, derived: false, ...over })

test('KRW and USD deposits add to cash; stocks and crypto keep their own classes', () => {
  const r = summarizeNetWorth({ stocksKrw: 10_000, cryptoKrw: 500, usdKrw: 1300, cash: [cash({}), cash({ account: 'B', currency: 'USD', balance: 2 })] })
  assert.equal(r.byClass.cash, 1000 + 2600)
  assert.equal(r.totalKrw, 10_000 + 500 + 3600)
  assert.deepEqual(r.unpricedCash, [])
})

test('a USD deposit with no rate is unpriced, not zero and not one-to-one', () => {
  const r = summarizeNetWorth({ stocksKrw: 0, cryptoKrw: 0, usdKrw: null, cash: [cash({ account: 'B', currency: 'USD', balance: 2 })] })
  assert.equal(r.byClass.cash, 0)
  assert.equal(r.cash[0].krw, null)
  assert.deepEqual(r.unpricedCash, ['B'])
})

test('month-end cash takes each account’s last balance on or before the month end', () => {
  const r = monthEndCash(
    [
      { account: 'A', currency: 'KRW', date: '2026-08-10', balance: 100 },
      { account: 'A', currency: 'KRW', date: '2026-09-05', balance: 300 },
      { account: 'B', currency: 'USD', date: '2026-09-20', balance: 1 },
    ],
    () => 1000
  )
  assert.deepEqual(r, [{ month: '2026-08', cash: 100 }, { month: '2026-09', cash: 1300 }])
})
```

`tests/default-view.test.ts` checks that a pension row and a cash row do not move any default total:

```ts
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'

test('rows outside the stock wrappers do not change the default overview or holdings totals', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'default-view-'))
  const dbPath = runIngest(dir, { allowFailure: true })
  process.env.STOCK_DB_PATH = dbPath
  const adapter = await import('../lib/adapters/portfolio-db')
  const before = JSON.stringify(adapter.getOverview().totals)

  const db = new Database(dbPath)
  db.prepare(
    `insert into holdings (market, currency, base_currency, account, ticker, name, quantity, native_cost, total_cost_krw,
       base_cost, base_market_value, native_market_value, account_wrapper)
     values ('KR','KRW','KRW','Example IRP','069500','EXAMPLE ETF',10,1000,1000,1000,5000,5000,'irp')`
  ).run()
  db.prepare(
    `insert into cash_balances (institution, account, kind, currency, as_of_date, balance, source) values ('x','A','checking','KRW','2026-10-01',99999,'t')`
  ).run()
  db.close()

  assert.equal(JSON.stringify(adapter.getOverview().totals), before)
})
```

If the empty fixture gives all-zero totals, make the test meaningful: also insert one `taxable` holding before taking `before`, and assert that `before` is non-zero.

- [ ] **Step 2: Run them and confirm they fail**

Run: `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH node_modules/.bin/tsx --test tests/net-worth.test.ts tests/default-view.test.ts`
Expected: `net-worth` fails because the module is missing. `default-view` fails because the IRP row moves the totals.

- [ ] **Step 3: Implement**

`lib/net-worth.ts`:

```ts
/**
 * Net worth across asset classes, kept free of the database so the conversion
 * rules can be tested on their own. A USD balance with no USD/KRW rate is listed
 * as unpriced and left out of the total — never counted as zero, never at 1:1.
 */
export type CashAccountBalance = { institution: string; account: string; kind: string; currency: 'KRW' | 'USD'; asOfDate: string; balance: number; derived: boolean }
export type NetWorth = {
  totalKrw: number
  byClass: { stocks: number; crypto: number; cash: number; pension: number; gold: number }
  cash: (CashAccountBalance & { krw: number | null })[]
  unpricedCash: string[]
  history: { month: string; stocks: number | null; cash: number }[]
}

const toKrw = (currency: 'KRW' | 'USD', amount: number, usdKrw: number | null) =>
  currency === 'KRW' ? amount : usdKrw && usdKrw > 0 ? amount * usdKrw : null

export function summarizeNetWorth(input: { stocksKrw: number; cryptoKrw: number; cash: CashAccountBalance[]; usdKrw: number | null }): Omit<NetWorth, 'history'> {
  const cash = input.cash.map((row) => ({ ...row, krw: toKrw(row.currency, row.balance, input.usdKrw) }))
  const cashKrw = cash.reduce((sum, row) => sum + (row.krw ?? 0), 0)
  const byClass = { stocks: input.stocksKrw, crypto: input.cryptoKrw, cash: cashKrw, pension: 0, gold: 0 }
  return {
    totalKrw: byClass.stocks + byClass.crypto + byClass.cash + byClass.pension + byClass.gold,
    byClass,
    cash,
    unpricedCash: cash.filter((row) => row.krw == null).map((row) => row.account),
  }
}

export function monthEndCash(
  series: { account: string; currency: 'KRW' | 'USD'; date: string; balance: number }[],
  rateAt: (date: string) => number | null
): { month: string; cash: number }[] {
  const months = [...new Set(series.map((row) => row.date.slice(0, 7)))].sort()
  const accounts = [...new Set(series.map((row) => row.account))]
  return months.map((month) => {
    let cash = 0
    for (const account of accounts) {
      const last = series.filter((row) => row.account === account && row.date.slice(0, 7) <= month).sort((a, b) => a.date.localeCompare(b.date)).at(-1)
      if (!last) continue
      const krw = toKrw(last.currency, last.balance, rateAt(last.date))
      if (krw != null) cash += krw
    }
    return { month, cash }
  })
}
```

In `lib/adapters/portfolio-db.ts`:

1. Add near the top:

```ts
/** The default (Stocks) view: taxable and ISA securities only. Every holdings total goes through this. */
export const STOCK_WRAPPER_SQL = "account_wrapper in ('taxable','isa')"
```

2. Add `where ${STOCK_WRAPPER_SQL}` to every `from holdings` read in `getOverview`, `getTopHoldings`, `getMarketBreakdown`, `getPortfolioReview`, `getRebalanceReview` and the holdings-list functions. Use `and ${STOCK_WRAPPER_SQL}` where a `where` already exists, and qualify the column (`h.account_wrapper`) where the table is aliased. To list them, run:
   `/usr/bin/grep -n "from holdings" lib/adapters/portfolio-db.ts`
   Leave `tax_lots`, `transactions`, `dividends` and `realized_lots` reads as they are in this phase. No non-stock rows reach those tables until phase 2, which adds their filter together with the first pension rows.

3. Add `getNetWorth()`:

```ts
export function getNetWorth(): NetWorth {
  const overview = getOverview()
  const conn = db()
  try {
    const latest = conn
      .prepare(
        `select c.institution, c.account, c.kind, c.currency, c.as_of_date as asOfDate, c.balance, c.derived
           from cash_balances c
           join (select account, max(as_of_date) as d from cash_balances group by account) m
             on m.account = c.account and m.d = c.as_of_date
          group by c.account`
      )
      .all() as any[]
    const usd = conn.prepare("select rate from fx_rates where from_currency = 'USD' and to_currency = 'KRW' order by as_of_date desc limit 1").get() as { rate: number } | undefined
    const summary = summarizeNetWorth({
      stocksKrw: (overview.totals.kr_base_market_value ?? 0) + (overview.totals.us_base_market_value ?? 0),
      cryptoKrw: overview.totals.crypto_base_market_value ?? 0,
      usdKrw: usd?.rate ?? null,
      cash: latest.map((row) => ({ ...row, derived: Boolean(row.derived) })),
    })
    const series = conn.prepare('select account, currency, as_of_date as date, balance from cash_balances order by as_of_date').all() as any[]
    const rates = conn.prepare('select price_date, rate from historical_fx_rates order by price_date').all() as { price_date: string; rate: number }[]
    const rateAt = (date: string) => rates.filter((r) => r.price_date <= date).at(-1)?.rate ?? usd?.rate ?? null
    const stocksByMonth = new Map(
      (conn.prepare('select substr(snapshot_date,1,7) as month, global_base_market_value as v from portfolio_snapshots order by snapshot_date').all() as any[]).map((r) => [r.month, r.v])
    )
    const history = monthEndCash(series, rateAt).map((row) => ({ ...row, stocks: stocksByMonth.get(row.month) ?? null }))
    return { ...summary, history }
  } finally {
    conn.close()
  }
}
```

   `stocksByMonth` keeps the last snapshot of each month because the query is ordered and the Map overwrites earlier entries. `global_base_market_value` includes crypto. That is fine for a history line; label it "Stocks and crypto" on the page.

4. Update the three hand-made test schemas to include `account_wrapper text not null default 'taxable'` on every table they create that the adapter now filters.

- [ ] **Step 4: Run the full suite and confirm it passes**

Run: `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH pnpm test && pnpm typecheck`
Expected: all pass, and the typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add lib/net-worth.ts lib/adapters/portfolio-db.ts tests/net-worth.test.ts tests/default-view.test.ts tests/overview-term.test.ts tests/overview-realized-trend.test.ts tests/account-coverage.test.ts
git commit -m "feat(net-worth): stock-wrapper filter for default totals; net-worth summary"
```

---

### Task 7: The Stocks / All assets switch

**Files:**
- Create: `lib/asset-view.ts`, `lib/asset-view-server.ts`, `tests/asset-view.test.ts`
- Modify: `components/LanguageSwitcher.tsx`, `components/Sidebar.tsx`, `app/layout.tsx`, `lib/ui-copy/pages/sidebar.ts`, `app/page.tsx`, `lib/ui-copy/pages/overview.tsx`

**Interfaces:**
- Produces:
  - `ASSET_VIEWS = ['stocks','all'] as const`
  - `type AssetView`
  - `ASSET_VIEW_COOKIE = 'stock-observatory-asset-view'`
  - `normalizeAssetView(v: unknown): AssetView`, which defaults to `'stocks'`
  - `getAssetView(): Promise<AssetView>`
  - `<AssetViewSwitcher assetView=… />`
- Consumes: `getNetWorth()` (Task 6).

- [ ] **Step 1: Write the failing test** — `tests/asset-view.test.ts`

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeAssetView } from '../lib/asset-view'

test('the asset view defaults to stocks for anything but "all"', () => {
  assert.equal(normalizeAssetView('all'), 'all')
  for (const junk of [undefined, '', 'ALL', 'everything', 1]) assert.equal(normalizeAssetView(junk), 'stocks')
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH node_modules/.bin/tsx --test tests/asset-view.test.ts`
Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement**

`lib/asset-view.ts`:

```ts
export const ASSET_VIEWS = ['stocks', 'all'] as const
export type AssetView = (typeof ASSET_VIEWS)[number]
export const ASSET_VIEW_COOKIE = 'stock-observatory-asset-view'
export function normalizeAssetView(value: unknown): AssetView {
  return value === 'all' ? 'all' : 'stocks'
}
```

`lib/asset-view-server.ts`:

```ts
import { cookies } from 'next/headers'
import { ASSET_VIEW_COOKIE, normalizeAssetView, type AssetView } from '@/lib/asset-view'

export async function getAssetView(): Promise<AssetView> {
  const cookieStore = await cookies()
  return normalizeAssetView(cookieStore.get(ASSET_VIEW_COOKIE)?.value)
}
```

In `components/LanguageSwitcher.tsx`, add:

```tsx
export function AssetViewSwitcher({ assetView, labels }: { assetView: AssetView; labels: Record<AssetView, string> }) {
  const router = useRouter()
  return (
    <SegmentedControl
      label="Assets"
      value={assetView}
      options={ASSET_VIEWS.map((option) => ({ value: option, label: labels[option] }))}
      onChange={(next) => {
        persist(ASSET_VIEW_COOKIE, next)
        router.refresh()
      }}
    />
  )
}
```

   Import `ASSET_VIEWS`, `ASSET_VIEW_COOKIE` and `AssetView` from `@/lib/asset-view`.

In `lib/ui-copy/pages/sidebar.ts`, add `assets: 'Assets'` and `assetViews: { stocks: 'Stocks', all: 'All assets' }` to `en`, and `assets: '자산'` and `assetViews: { stocks: '주식', all: '전체 자산' }` to `ko`.

In `components/Sidebar.tsx`:
- Add an `assetView: AssetView` prop.
- After the currency block (around line 118), render:

```tsx
          <div>
            <div className="mb-1.5 px-0.5 text-micro font-medium text-ink-3">{copy.assets}</div>
            <AssetViewSwitcher assetView={assetView} labels={copy.assetViews} />
          </div>
```

In `app/layout.tsx`, call `const assetView = await getAssetView()` and pass `assetView={assetView}` to `<Sidebar>`.

In `app/page.tsx`:
- Call `const assetView = await getAssetView()`.
- When `assetView === 'all'`, call `getNetWorth()` and render one `Card` directly under the hero `CardRow` (after line ~352). It shows the total in the display currency (use the existing money formatter `createMoneyFormatter(currencyPreferences)` the page already builds) and one line per class with its share of the total.
- Add the strings to `lib/ui-copy/pages/overview.tsx`: `totalAssets: 'Total assets'` / `'총자산'`, and class labels `stocks`, `crypto`, `cash`, `pension`, `gold` in both languages, plus `openNetWorth: 'Open net worth'` / `'순자산 열기'`.
- Link the card to `/net-worth` with `TextLink`.
- When `assetView === 'stocks'`, render nothing new.

- [ ] **Step 4: Run the tests, typecheck, and look at the page**

Run: `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH pnpm test && pnpm typecheck`
Expected: pass. Then `pnpm seed:sample && pnpm dev`. Open `/` and confirm the Stocks view is unchanged. Switch to All assets and confirm the card appears.

- [ ] **Step 5: Commit**

```bash
git add lib/asset-view.ts lib/asset-view-server.ts tests/asset-view.test.ts components/LanguageSwitcher.tsx components/Sidebar.tsx app/layout.tsx lib/ui-copy/pages/sidebar.ts app/page.tsx lib/ui-copy/pages/overview.tsx
git commit -m "feat(ui): Stocks / All assets switch with a total-assets card on the overview"
```

---

### Task 8: `/net-worth` page and `/accounts` balance spans

**Files:**
- Create: `app/net-worth/page.tsx`, `lib/ui-copy/pages/netWorth.ts`
- Modify: `lib/ui-copy/pages/index.ts`, `lib/ui-copy/pages/sidebar.ts`, `lib/page-names.ts`, `tests/page-headings.test.ts`, `scripts/mobile-audit.mjs`, `scripts/snap-ui.mjs`, `lib/account-ranges.ts`, `lib/adapters/portfolio-db.ts` (`getAccountDataRanges`), `app/accounts/page.tsx`, `lib/ui-copy/pages/accounts.ts`, `docs/data-sources.md`

**Interfaces:**
- Consumes: `getNetWorth()` (Task 6) and `RangeKind`.
- Produces:
  - Route `/net-worth`.
  - `RangeKind` gains `'balances'`.

- [ ] **Step 1: Write the failing test.** Add `'/net-worth': 'netWorth'` to `COPY_FOR` in `tests/page-headings.test.ts`, and add a case to `tests/account-ranges.test.ts`:

```ts
test('cash balance spans are their own kind and do not merge with securities rows', () => {
  const rows = [
    { kind: 'balances' as const, market: 'CASH', brokerage: 'chase', account: 'Chase checking', accountType: 'checking', start: '2026-07-01', end: '2026-10-01', count: 40 },
  ]
  const [account] = groupAccountRanges(rows)
  assert.equal(account.ranges.balances?.count, 40)
  assert.equal(account.market, 'CASH')
})
```

   `groupAccountRanges` is exported from `lib/account-ranges.ts`; import it if the test file does not already.

- [ ] **Step 2: Run them and confirm they fail**

Run: `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH node_modules/.bin/tsx --test tests/page-headings.test.ts tests/account-ranges.test.ts`
Expected: FAIL. The route is unknown, and `'balances'` is not a `RangeKind`.

- [ ] **Step 3: Implement**

1. `lib/account-ranges.ts`: change `RangeKind` to `'transactions' | 'dividends' | 'holdings' | 'lots' | 'realized' | 'balances'`.

2. `getAccountDataRanges()` in `portfolio-db.ts`: after the securities spans, add:

```ts
    const balanceSpans = conn
      .prepare(
        `select 'CASH' as market, institution as brokerage, account, max(kind) as account_type,
                min(as_of_date) as start, max(as_of_date) as end, count(*) as count
           from cash_balances group by institution, account`
      )
      .all() as { market: string; brokerage: string; account: string; account_type: string | null; start: string | null; end: string | null; count: number }[]
    for (const row of balanceSpans) {
      rows.push({ kind: 'balances', market: row.market, brokerage: row.brokerage, account: row.account, accountType: row.account_type, start: isoDate(row.start), end: isoDate(row.end), count: row.count })
    }
```

3. `app/accounts/page.tsx` and `lib/ui-copy/pages/accounts.ts`:
   - Add a "Balances" column rendered with the existing `span()` helper.
   - Rewrite the note that says pension, IRP and bank deposits are not collected. It should say bank deposits are collected, and pension and IRP arrive in a later phase.

4. `lib/ui-copy/pages/netWorth.ts`: a `defineCopy` with these keys, in both languages:
   - `title`: `'Net Worth'` / `'순자산'`
   - `emphasis`: `'Worth'` / `'순자산'`
   - `subtitle(asOf)`
   - `total`, `byClass`
   - `classes { stocks, crypto, cash, pension, gold }`
   - `balances`
   - `columns { institution, account, kind, asOf, balance, krw }`
   - `kinds { checking, savings, cma, deposit }`
   - `derived`: `'Derived from an anchor balance'` / `'기준 잔고에서 역산'`
   - `unpriced(list)`
   - `history`
   - `historyNote`: `'Stocks line includes crypto (portfolio snapshots)'` / `'주식 선에는 crypto가 포함됩니다 (포트폴리오 snapshot)'`
   - `empty`: `'No deposit balances collected yet'` / `'아직 수집된 예금 잔고가 없습니다'`

   Register it in `lib/ui-copy/pages/index.ts`, the same way `accounts` is.

5. `app/net-worth/page.tsx`, following the structure of `app/accounts/page.tsx`:
   - `PageHeader` with `routeSection('/net-worth', language)`.
   - A `CardRow` with the total and one `MetricField` per class.
   - A `DataTable` of `netWorth.cash`. Show the as-of date with `fmtDate`, the native balance with `formatUsd`/`formatKrw`, the KRW value or "—" when unpriced, and a `Badge` for derived rows.
   - The history as a small table: month, stocks, cash.
   - `export const dynamic = 'force-dynamic'` and `export const generateMetadata = routeMetadata('/net-worth')`.

6. Register the route:
   - `lib/page-names.ts`: add `'/net-worth'` to `ROUTE_HREFS` after `'/'`.
   - `lib/ui-copy/pages/sidebar.ts`: add `{ href: '/net-worth', label: 'Net Worth' }` / `{ href: '/net-worth', label: '순자산' }` under Core Workflows, after Portfolio Overview.
   - `scripts/mobile-audit.mjs` and `scripts/snap-ui.mjs`: add `/net-worth` to their route lists, the same way #180 added `/accounts`.

7. `docs/data-sources.md`:
   - Add a "Bank deposits" row to the sources table: the source files, `bank-statements/`, how they are refreshed (manual download, then `extract:bank-statements`).
   - Add the file-name conventions from Task 3.
   - Add the two env vars, `STOCK_ACCOUNT_MAP_PATH` and `STOCK_BANK_BALANCES_PATH`.
   - Note that `STOCK_TOSSBANK_PASSWORD` is read on the laptop only.

- [ ] **Step 4: Run everything**

Run: `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH pnpm test && pnpm typecheck && pnpm build`
Expected: all pass, and the sample-mode build succeeds. CI runs "Sample mode build".

- [ ] **Step 5: Commit**

```bash
git add app/net-worth lib/ui-copy/pages/netWorth.ts lib/ui-copy/pages/index.ts lib/ui-copy/pages/sidebar.ts lib/page-names.ts tests/page-headings.test.ts tests/account-ranges.test.ts scripts/mobile-audit.mjs scripts/snap-ui.mjs lib/account-ranges.ts lib/adapters/portfolio-db.ts app/accounts/page.tsx lib/ui-copy/pages/accounts.ts docs/data-sources.md
git commit -m "feat(net-worth): /net-worth page; deposit spans on /accounts"
```

---

### Task 9: Deploy and file the real statements

Operational. No code.

- [ ] **Step 1: Open the PR and merge it after CI passes.** CI runs `check` and `Sample mode build`.
- [ ] **Step 2: Create the account map on the ops host.** Write `data/accounts.local.json` there (`ssh ops-host`, account `runtime`, mode 600), with:
  - the real bank aliases,
  - the Robinhood checking and savings anchors (the current balance and date, supplied by the account owner).

  Do not echo the contents back into chat or logs.
- [ ] **Step 3: File the inbox on the laptop.** With `STOCK_TOSSBANK_PASSWORD` in the laptop `.env.local` (set by the owner), run `make file-downloads-dry`, check the plan, then run `make file-downloads`. The hourly push carries the files to the host.
- [ ] **Step 4: Deploy and refresh on the host.** Run `git pull && make redeploy`, then `pnpm refresh`.
- [ ] **Step 5: Verify.**
  - `cash_balances` has one account per filed statement family.
  - `cash_balance_continuity` passes, or names a real gap.
  - `/net-worth` shows the deposits.
  - The Stocks view on `/` shows the same totals as before the deploy. Compare against the `briefing-summary.json` `portfolio` block written by the previous refresh.

---

## Self-review notes

- **Spec coverage.** This plan covers these spec items:
  - `account_wrapper`, `owner` and `asset_class` (Task 2)
  - the single filter helper (Task 6)
  - `cash_balances` (Task 5)
  - the bank detectors (Task 3)
  - the anchor walk-back (Task 4)
  - the view switch (Task 7)
  - `/net-worth` without the FBAR table (Task 8)
  - `/accounts` (Task 8)
  - the checks `wrapper_assigned`, `cash_balance_continuity` and `cash_anchor_present` (Tasks 2 and 5)
  - the default-view regression (Task 6)
  - the privacy rules (Tasks 1 and 9)
- **Deferred to later phases by the spec.** Pensions, gold, `wrapperTreatment`, FBAR and coverage cadence.
- **Phase-1 gaps.**
  - The 토스뱅크 *parser* is missing. The filer decrypts and files the workbook, but its column layout cannot be read until a decrypted sample exists. The extractor ignores `tossbank-*` until a follow-up adds its family to `FAMILIES`.
  - The CMA account is unidentified, which the spec lists as an open item.
- **Folding `fx_account_balances`.** In this phase it is copied into `cash_balances`, not removed. `/fx` still reads the old table.
