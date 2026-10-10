# Net Worth Phase 2: Pensions and Gold — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring three kinds of account into the database without moving a single number in the default (Stocks) view:
- the 미래에셋 IRP;
- the 삼성증권 pension-savings account;
- the 미래에셋 physical-gold account.

They show up in the All-assets view, on `/net-worth`, and on a new `/pension` page.

**Architecture:**
- The five securities tables become physical `*_all` tables. Under the old names sit SQLite views that keep only stock rows (`account_wrapper in ('taxable','isa') and asset_class = 'security'`). The 44 existing stock-only reads are then safe by construction. Only code that should see everything reads `*_all`.
- Pension and gold rows are tagged with their wrapper and asset class when they are built in the ingest, not at insert. The ingest's own stock computations then filter them out in memory.
- New inputs:
  - pension holdings snapshots, as CSV files in `pension/`;
  - 미래에셋 IRP and gold transaction certificates, through the existing 미래에셋 parser;
  - the 삼성 pension-savings ledger;
  - year-end balance certificates, which feed validation only;
  - a KRX gold price, from a new fetch step.

**Tech Stack:** Node 24 ESM scripts, better-sqlite3, Next.js 15 / React (App Router, server components), TypeScript, Python 3 with pdfplumber, and `node --test` with tsx.

**Spec:** `docs/superpowers/specs/2026-10-09-net-worth-and-pension-design.md`. This plan covers phase 2 (pensions) and pulls in phase 3's gold certificate and gold price step at the maintainer's request. It leaves out the FBAR / Form 8938 table (still phase 3) and coverage rows (phase 4).

## Global Constraints

- The repository is PUBLIC. No real account number, balance, name, resident number or holding quantity may appear in code, tests, fixtures, docs, commit messages or PR text. Invent them, e.g. account `000-000000-00`, last4 `0000`.
- Repo text is English only. Korean appears only as matched data (column headers, 거래종류 values, titles) and in the existing `ko` UI copy objects.
- Use `/usr/bin/grep -a`, never bare `grep`. A NUL byte in `scripts/ingest-stock-data.mjs` makes bare grep skip the file silently.
- Run tests on Node 24: `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH pnpm test`. Also run `pnpm typecheck`, and `pnpm build` for UI tasks.
- A fresh worktree needs `pnpm install --frozen-lockfile`. Then copy `better_sqlite3.node` from the main checkout's `node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/build/Release/` into the same path in the worktree.
- Ingest tests go through `tests/ingest-harness.ts` `runIngest`. Every path is named there and the inherited env is stripped. When you add a new input path env var, add it to `INGEST_PATHS` in the harness.
- **Default-view promise (spec, "Default-view regression"):** "The overview total, holdings count and every tax-page total in the Stocks view must match exactly."
- **Wrapper values (spec):** `taxable` | `isa` | `irp` | `pension_savings`. **Asset classes:** `security` | `gold`.
- **US tax treatment (spec):** `undecided` keeps an account out of the jurisdiction's tax estimate, and `taxable` moves it in. Ruling for this plan: the US entry for `isa` stays `"taxable"` in the example policy, because ISA lots are in the US estimate today and the default-view promise outranks the spec's default. `irp` and `pension_savings` default to `"undecided"`. The `us_wrapper_treatment_decided` check lists every wrapper still `undecided`.
- **Cadence (spec):** pension snapshots 180 days. Coverage rows themselves are phase 4 and are NOT built here.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **An unmapped pension account must never read as `taxable`.** A 미래에셋 IRP certificate filed with no `accounts.local.json` entry must still land as `irp`, because its label says IRP/퇴직연금. The 삼성 연금저축 ledger likewise lands as `pension_savings` and the 금현물 certificate as `asset_class = 'gold'`. Owned by Task 2 (the label rule) and pinned there.
2. **Some code writes to a securities table after the rename.** Every `insert into`, `update` or `delete from` on the five names must target `*_all`, because a write to a view fails at run time. Owned by Task 1. Its grep step and its test, which inserts through the ingest harness, pin this.
3. **An ETF row in a pension snapshot has no ticker, or one Yahoo cannot price.** It is valued at the snapshot's `value_krw` as of the snapshot date and named in a warning. It is never dropped, and never valued at 0. Owned by Task 4.
4. **The pension-savings ledger runs past its latest holdings snapshot.** The trades after the snapshot are stored, the holdings stay at the snapshot, and a warning names the count and the snapshot date. Holdings must not be silently replayed or doubled. Owned by Task 4.
5. **The gold certificate's paired rows.** 금현물매수입고 carries the grams; 금현물매수출금 is the cash leg of the same purchase. Counting both doubles the cost. Storage fees (금현물보관수수료, and its 세금 row) are fees, not purchases. Owned by Task 5.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `scripts/ingest-stock-data.mjs` | Physical `*_all` tables and stock views, early tagging, pension/gold rows, `pension_flows`, new checks | 1, 4, 5 |
| `lib/adapters/portfolio-db.ts` | `allAssetsTable()` helper; all-assets reads (`getNetWorth`, `getAccountDataRanges`, `getPensionAccounts`) | 1, 7 |
| `scripts/account-map.mjs` | Label rule for `irp` / `pension_savings`, `assetClassFor` for gold | 2 |
| `scripts/file-downloads.py` | Detectors: IRP certificate, gold certificate, 삼성 pension ledger, pension snapshot CSV, year-end pension evidence | 2 |
| `scripts/extract-kr-statements.py` (+ `scripts/samsung_statements.py` if that is where the 삼성 parser lives) | IRP and gold certificates through `records()`; the 삼성 pension ledger | 3 |
| `scripts/extract-pension-evidence.py` (new) | Year-end 잔고현황 / 잔고증명서 → `data/pension-evidence.json`, which also carries the pension-savings snapshot fallback | 3 |
| `scripts/fetch-gold-price.mjs` (new) | KRX gold per gram, current plus daily history → `data/gold-prices.json` | 5 |
| `scripts/refresh.mjs`, `package.json` | New steps: `extract:pension-evidence`, `fetch:gold-price` | 3, 5 |
| `scripts/fetch-kr-prices.mjs` | Also price pension ETF tickers read from `pension/*.csv` | 4 |
| `data/tax-policy.example.json`, `lib/tax-policy.ts` | `wrapperTreatment`, `pensionTaxCredit` limits | 6 |
| `lib/tax-planning.ts`, tax pages | Needs-review block; a `taxable` wrapper moves into the estimate | 6 |
| `app/pension/page.tsx` (new), `lib/ui-copy/pages/pension.tsx` (new), sidebar copy | The `/pension` page | 7 |
| `lib/net-worth.ts`, `app/net-worth/page.tsx`, `app/page.tsx` | Pensions and gold in the totals and allocation | 7 |
| `scripts/push-sources.sh` | Carry `pension/` | 2 |
| `docs/data-sources.md` | The pension snapshot CSV format, the new files, the env vars | 2, 4, 5 |

---

### Task 1: Stock-only views over physical `*_all` tables

**Files:**
- Modify: `scripts/ingest-stock-data.mjs`:
  - the DDL for `holdings`, `tax_lots`, `transactions`, `dividends`, `realized_lots`;
  - the `WRAPPED_TABLES` set and `insertMany`;
  - the wrapper checks at about `:4802` and `:4875`.
- Modify: `lib/adapters/portfolio-db.ts`: add `allAssetsTable()`. Switch `getAccountDataRanges` (about `:2543`) and the holdings part of `getNetWorth` to `*_all`.
- Test: `tests/stock-views.test.ts` (new).

**Interfaces:**
- Produces:
  - **Tables:** `holdings_all`, `tax_lots_all`, `transactions_all`, `dividends_all`, `realized_lots_all`. Each has `account_wrapper`, `owner` and `asset_class`. `asset_class` is now on all five, `not null default 'security'`.
  - **Views:** `holdings`, `tax_lots`, `transactions`, `dividends`, `realized_lots`, each `select * from <t>_all where account_wrapper in ('taxable','isa') and asset_class = 'security'`.
  - **`STOCK_ROW_SQL`:** in `portfolio-db.ts`, a string constant holding exactly that predicate. `STOCK_WRAPPER_SQL` stays, so the existing reads keep compiling.
  - **`allAssetsTable(conn, name)`:** returns `` `${name}_all` `` when that table exists and `name` otherwise. Older and fixture databases have only the plain table.

- [ ] **Step 1: Find every write to the five table names**

Run:
`/usr/bin/grep -rn -a -E "(insert into|update|delete from|insertMany\(db, ')\s*'?(holdings|tax_lots|transactions|dividends|realized_lots)\b" scripts lib app`

Every hit must end up targeting `<t>_all`. Write the list into the commit message body. If any script other than the ingest writes to these tables, make it write `_all` too and add it to the test below.

- [ ] **Step 2: Write the failing test**

```ts
// tests/stock-views.test.ts
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

// The default view's safety must not depend on 44 call sites each remembering a
// filter. The five securities tables are views over *_all tables, so a row that
// is not a stock is invisible to every existing read by construction.
test('the five securities names are stock-only views over *_all tables', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'stock-views-'))
  writeSheetPayloads(dir)
  const dbPath = runIngest(dir, { allowFailure: true })
  const db = new Database(dbPath)
  for (const name of ['holdings', 'tax_lots', 'transactions', 'dividends', 'realized_lots']) {
    const kind = db.prepare("select type from sqlite_master where name = ?").get(name) as { type: string }
    assert.equal(kind.type, 'view', name)
    const all = db.prepare("select type from sqlite_master where name = ?").get(`${name}_all`) as { type: string }
    assert.equal(all.type, 'table', `${name}_all`)
    const cols = (db.prepare(`pragma table_info(${name}_all)`).all() as { name: string }[]).map((c) => c.name)
    for (const col of ['account_wrapper', 'owner', 'asset_class']) assert.ok(cols.includes(col), `${name}_all.${col}`)
  }
  const before = (db.prepare('select count(*) as n from holdings').get() as { n: number }).n
  const allBefore = (db.prepare('select count(*) as n from holdings_all').get() as { n: number }).n
  db.prepare(
    "insert into holdings_all (market, account, ticker, name, quantity, account_wrapper, owner, asset_class) values ('KR', 'x', 'X', 'x', 1, 'irp', 'self', 'security')"
  ).run()
  db.prepare(
    "insert into holdings_all (market, account, ticker, name, quantity, account_wrapper, owner, asset_class) values ('KR', 'y', 'Y', 'y', 1, 'taxable', 'self', 'gold')"
  ).run()
  assert.equal((db.prepare('select count(*) as n from holdings').get() as { n: number }).n, before)
  assert.equal((db.prepare('select count(*) as n from holdings_all').get() as { n: number }).n, allBefore + 2)
})
```

If the `holdings_all` insert fails on a NOT NULL column the test does not set, add that column to the insert with a dummy value. The test exists to prove view filtering, not schema completeness.

- [ ] **Step 3: Run it to verify it fails**

Run: `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH node --test --import tsx tests/stock-views.test.ts`
Expected: FAIL. `holdings` is a table, not a view.

- [ ] **Step 4: Implement**

- **DDL:** rename each `create table <t> (` to `create table <t>_all (`. Add `asset_class text not null default 'security'` to the four tables that lack it; `holdings` already has it, at about `:883`. After the DDL block, create the five views:

```js
// The default (Stocks) view is enforced here, not at 44 call sites: every
// existing read names the view, and only code that should see pensions and gold
// names *_all. Keep the predicate in step with STOCK_ROW_SQL in
// lib/adapters/portfolio-db.ts.
const STOCK_ROW_PREDICATE = "account_wrapper in ('taxable', 'isa') and asset_class = 'security'"
for (const t of ['holdings', 'tax_lots', 'transactions', 'dividends', 'realized_lots']) {
  db.exec(`create view ${t} as select * from ${t}_all where ${STOCK_ROW_PREDICATE}`)
}
```

- **`insertMany`:** when `table` is one of the five plain names, insert into `` `${table}_all` ``. Keep the call sites unchanged and keep `WRAPPED_TABLES` keyed by plain name, so the tagging still applies. Also add `asset_class` to the tagged columns, `row.asset_class ?? 'security'` for now; Task 2 replaces this with `assetClassFor`.
- **Ingest wrapper checks** (`wrapper_assigned`, `non_stock_wrappers_absent` and similar): read `*_all`. That is where a bad wrapper can be found at all.
- **Adapter:**

```ts
/** Keep in step with STOCK_ROW_PREDICATE in scripts/ingest-stock-data.mjs. */
export const STOCK_ROW_SQL = "account_wrapper in ('taxable', 'isa') and asset_class = 'security'"

/** The unfiltered table behind a stock-only view, or the plain table in a database older than the views. */
function allAssetsTable(conn: Database.Database, name: 'holdings' | 'tax_lots' | 'transactions' | 'dividends' | 'realized_lots') {
  const found = conn.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(`${name}_all`)
  return found ? `${name}_all` : name
}
```

`getAccountDataRanges` uses `allAssetsTable(conn, span.table)`, because `/accounts` must list pension accounts. Leave `getNetWorth`'s holdings read for Task 7. It stays stock-only until pension valuation exists.

- [ ] **Step 5: Run the test and the full suite**

Run the new test (expect PASS), then `pnpm test` and `pnpm typecheck`. All 233+ tests must pass unchanged. That is the regression proof that every existing read still sees the same rows.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(db): securities tables are stock-only views over *_all tables

<list of writes found in step 1>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Classification — label rule, account map, filer detectors, push

**Files:**
- Modify: `scripts/account-map.mjs`: `wrapperFor` label rule and the new `assetClassFor`. `tagRows` also sets `asset_class`.
- Modify: `scripts/ingest-stock-data.mjs`: `insertMany` uses `assetClassFor`.
- Modify: `scripts/file-downloads.py`: the detectors below.
- Modify: `scripts/push-sources.sh`: add `pension` to `SOURCES`.
- Modify: `data/accounts.local.example.json`, `docs/data-sources.md`.
- Test: `tests/account-map.test.mjs` (extend it, or create it if absent); the Python filer tests (find the existing ones with `/usr/bin/grep -rln -a "file-downloads" tests`).

**Interfaces:**
- Produces:
  - `wrapperFor(row, map)`: the map override wins. Otherwise, in order:
    - label matches `/IRP|퇴직연금/i` → `'irp'`;
    - `/연금저축/` → `'pension_savings'`;
    - `/ISA/i` → `'isa'`;
    - else `'taxable'`.
  - `assetClassFor(row, map)`: `map.accounts[row.account]?.assetClass`, else label `/금현물/` → `'gold'`, else `'security'`.
  - Account labels the extractors (Task 3) must emit:
    - `미래에셋증권(IRP)`
    - `삼성증권(연금저축)`
    - `미래에셋증권(금현물)`
  - Filed names:
    - `kr-statements/mirae-irp-transactions-<YYYYMMDD from>-<YYYYMMDD to>.pdf`
    - `kr-statements/mirae-gold-transactions-<from>-<to>.pdf`
    - `kr-statements/samsung-pension-transactions-<from>-<to>.pdf`
    - `pension/<token>-holdings-<YYYYMMDD>.csv`
    - `pension/evidence/<token>-<kind>-<YYYYMMDD>.pdf`, where kind is `balance-status` for 잔고현황 and `balance-certificate` for 잔고증명서.
  - Map additions, in `accounts.local.json` (gitignored):

```json
"pensionAccounts": [
  { "token": "irp", "account": "미래에셋증권(IRP)", "wrapper": "irp", "institution": "미래에셋증권" },
  { "token": "pension-savings", "account": "삼성증권(연금저축)", "wrapper": "pension_savings", "institution": "삼성증권" }
]
```

`loadAccountMap` returns `pensionAccounts: raw.pensionAccounts ?? []`.

- [ ] **Step 1: Failing tests for the label rule**

```js
// tests/account-map.test.mjs (add)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { wrapperFor, assetClassFor } from '../scripts/account-map.mjs'

const empty = { accounts: {}, bankAccounts: [], anchors: [], pensionAccounts: [] }

test('an unmapped pension or gold account is classified by its label, never as taxable', () => {
  assert.equal(wrapperFor({ account: '미래에셋증권(IRP)' }, empty), 'irp')
  assert.equal(wrapperFor({ account: '미래에셋증권(퇴직연금_개인IRP)' }, empty), 'irp')
  assert.equal(wrapperFor({ account: '삼성증권(연금저축)' }, empty), 'pension_savings')
  assert.equal(wrapperFor({ account: '미래에셋증권(ISA)' }, empty), 'isa')
  assert.equal(wrapperFor({ account: '미래에셋증권(종합)' }, empty), 'taxable')
  assert.equal(assetClassFor({ account: '미래에셋증권(금현물)' }, empty), 'gold')
  assert.equal(assetClassFor({ account: '미래에셋증권(종합)' }, empty), 'security')
})

test('the map overrides the label', () => {
  const map = { ...empty, accounts: { 'Odd label': { wrapper: 'irp', assetClass: 'gold' } } }
  assert.equal(wrapperFor({ account: 'Odd label' }, map), 'irp')
  assert.equal(assetClassFor({ account: 'Odd label' }, map), 'gold')
})
```

- [ ] **Step 2: Run, verify FAIL; implement `wrapperFor` / `assetClassFor` / `tagRows`; wire `insertMany`; run, verify PASS.**

```js
export function wrapperFor(row, map) {
  const override = map.accounts?.[row.account]?.wrapper
  if (override) return override
  const label = String(row.account ?? '')
  // A pension account the map does not know must still never read as taxable:
  // the label is the fallback, and both issuers put the account type in it.
  if (/IRP|퇴직연금/i.test(label)) return 'irp'
  if (/연금저축/.test(label)) return 'pension_savings'
  return /ISA/i.test(label) ? 'isa' : 'taxable'
}

export function assetClassFor(row, map) {
  return map.accounts?.[row.account]?.assetClass ?? (/금현물/.test(String(row.account ?? '')) ? 'gold' : 'security')
}
```

`tagRows` adds `asset_class: row.asset_class ?? assetClassFor(row, map)`.

- [ ] **Step 3: Filer detectors, test first.** Mirror the existing tests that build PDFs or CSVs in a temp dir. Five cases:
  1. **미래에셋 certificates.** `detect_mirae` (the function returning the `Refusal` "names neither 계좌유형 ISA/종합 nor a 계좌번호 this repo has seen") accepts page 2's `계좌유형 퇴직연금_개인IRP` → `mirae-irp-transactions-…` and `계좌유형 금현물` → `mirae-gold-transactions-…`. The window comes from `mirae_period_window`, unchanged.
  2. **삼성 pension ledger.** The title is `LEDGER A/C TRANSACTIONS DETAIL` and the account string contains `연금저축`. File it as `samsung-pension-transactions-<from>-<to>.pdf`, with the period from the ledger's own period line. Read the real file's layout in the scratch notes the controller provides; do not guess.
  3. **Pension holdings snapshot CSV.**
     - The header must be exactly `type,name,ticker,quantity,cost_krw,value_krw` or the legacy `type,name,quantity,cost_krw,value_krw`.
     - Name and date come from the inbox file name `^(<token>)-holdings-(\d{8})\.csv$`, where `<token>` is a `pensionAccounts[].token` in the map.
     - Refuse with a message naming the expected file name when the token is unknown. The CSV holds no account, and the name is the only place it lives, the same reason the Robinhood CSV is named by hand.
  4. **Year-end evidence PDFs.**
     - Title `퇴직연금 잔고현황` with `개인형IRP` → `pension/evidence/irp-balance-status-<YYYYMMDD>.pdf`.
     - Title `잔 고 증 명 서` or `특 정 (종 목) 잔 고 증 명 서`, with `개인형IRP` on page 2 → `pension/evidence/irp-balance-certificate-<YYYYMMDD>.pdf`.
     - 삼성 잔고증명서 with `구분 수익증권` → `pension/evidence/pension-savings-balance-certificate-<YYYYMMDD>.pdf`. This one has no account type; recognise it by issuer 삼성증권, title 잔고증명서, and an account string matching the `pensionAccounts` entry for `삼성증권`.
     - The date is the certificate's own 기준일 (e.g. `기준일자 YY.12.31`).
  5. **No double claim.** The new detectors run before the generic 미래에셋/삼성 ones, or those skip when the new one matches.

- [ ] **Step 4: `push-sources.sh`.** Add `pension` to `SOURCES`. Read how it handles a missing directory first.

- [ ] **Step 5: Docs.** `docs/data-sources.md` gets a "Pension accounts and gold" section covering:
  - the CSV format: `type` ∈ `ETF|FUND|CASH`; `ticker` required for `ETF`, empty otherwise; `quantity` empty for FUND/CASH; `cost_krw`, `value_krw` in won;
  - the file names;
  - the `pensionAccounts` map entry.

  `data/accounts.local.example.json` gets an invented `pensionAccounts` block.

- [ ] **Step 6: Full suite, then commit** (`feat(filing): pension and gold certificates, pension snapshots and evidence`).

---

### Task 3: Extraction — IRP/gold certificates, 삼성 pension ledger, year-end evidence

**Files:**
- Modify: `scripts/extract-kr-statements.py`, plus the module that holds `samsung_statements.parse`.
- Create: `scripts/extract-pension-evidence.py`.
- Modify: `scripts/refresh.mjs`: add an `extract:pension-evidence` step after `extract:kr-statements`, `optional: true`. Add the script to `package.json`.
- Test: Python tests beside the existing extractor tests, with synthetic PDFs or text fixtures built the way the existing 미래에셋 tests build them. Find those with `/usr/bin/grep -rln -a "records(" tests`.

**Interfaces:**
- **Consumes:** the filed names from Task 2.
- **Produces:**
  - The KR transaction payload rows the ingest already merges, with `Account` set to `미래에셋증권(IRP)`, `미래에셋증권(금현물)` or `삼성증권(연금저축)`. These must match the Task 2 labels exactly.
  - `data/pension-evidence.json`, path from env `STOCK_PENSION_EVIDENCE_PATH` (add it to the harness `INGEST_PATHS` in Task 4):

```json
{
  "generatedAt": "ISO",
  "certificates": [
    {
      "token": "irp", "kind": "balance-status", "asOf": "2025-12-31",
      "totalKrw": 0, "contributionsCumulativeKrw": 0, "employerCumulativeKrw": 0, "ownCumulativeKrw": 0,
      "products": [{ "name": "…", "quantity": null, "costKrw": 0, "valueKrw": 0 }],
      "source": "pension/evidence/irp-balance-status-20251231.pdf"
    }
  ],
  "findings": []
}
```

`products` is filled where the document has a per-product table: the 잔고현황, and the 삼성 잔고증명서 page 2 (종목명, 구분, 수량, 가격, 평가금액, 매입금액). It is empty for the IRP 잔고증명서, which has a single 신탁 line.

**Facts from the real documents** (structure only; a masked survey is in the controller's scratch notes, ask for it):
- **IRP certificate:** the same 12-column, 3-row record layout as the 종합 certificate, so `records()` works unchanged. Its only rows are 계좌대체입금 (cash in from another own account) and 신탁계약출금 (cash moved into the trust that holds the products).
- **Gold certificate:** 거래종류 values: 금현물매수입고, 금현물매수출금, 금현물보관수수료, 금현물보관수수료세금, 예탁금이용료입금, 계좌대체입금, 이체송금, 계좌대체출금.
  - 종목번호 is `M04020000`, the KRX gold code. 거래수량 is grams and 단가 is KRW per gram; 거래금액 = 수량 × 단가.
  - 유가잔고 is the running gram balance on each 입고 row.
  - 매수출금 is the cash leg of the same purchase.
- **삼성 pension ledger:**
  - English headers in stacked 2–3 line cells.
  - Types: Buy, Sell, After Hours Sell, Deposit, Interest, Reinvestment.
  - The totals line is `Total Deposit(A) / Total Debit(B) / Balance(A-B)`.
  - `samsung_statements.parse` reads the same stacked 12-column layout. It needs English type mapping, an `Account No.` match, and the `Total Deposit` totals check. `check_share_balances` does not apply: col5's second line is the fund price, not a share balance. Fund names wrap past line 2.

- [ ] **Step 1: Failing tests:**
  - (a) an IRP fixture whose 계좌대체입금 maps to type `DEPOSIT` with Account `미래에셋증권(IRP)`, and whose 신탁계약출금 maps to `TRUST_OUT`. Add `TRUST_OUT` to `TYPE_MAP`; Task 4 reads it as an internal move, not a flow.
  - (b) a gold fixture with two purchases plus their 매수출금 legs and one storage fee pair. Expect two `BUY` rows, ticker `M04020000`, quantity in grams, amount = qty × price; the 매수출금 rows dropped as `CASH_LEG_TYPES`; fee rows as `FEE`.
  - (c) a 삼성 ledger fixture covering one each of Buy, Sell, Deposit, Interest and Reinvestment. They map to `BUY`, `SELL`, `DEPOSIT`, `INTEREST`, `REINVEST`, with Account `삼성증권(연금저축)`. The totals check passes.
  - (d) `extract-pension-evidence.py` on text fixtures of a 잔고현황 (합 계 row, 납입원본 누계, 사용자부담금, 가입자부담금) and a 삼성 잔고증명서 (총 잔고 / 합계, six products). Expect the JSON above.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement.**
  - In `account_label()`, normalise `미래에셋증권(퇴직연금_개인IRP)` → `미래에셋증권(IRP)`, keep `미래에셋증권(금현물)`, and map 삼성 `연금저축 …` → `삼성증권(연금저축)`.
  - Extend the filename discovery glob to the Task 2 names.
  - For the evidence script, page-2 footer text spills into one 잔고현황 table row. Parse the 합 계 row by label, not by row index.
- [ ] **Step 4: Run tests, verify PASS; run the full suite.**
- [ ] **Step 5: Local real-data dry run.**
  - Run the extractors against `~/workspace/data/stock-management`, using a temp output path for evidence JSON.
  - Report the counts per account and per type, and whether each evidence total parsed. Print NO amounts.
  - The controller places the real files first. If they are absent, say so.
- [ ] **Step 6: Commit** (`feat(extract): IRP, gold and pension-savings certificates; year-end pension evidence`).

---

### Task 4: Ingest — pension holdings, transactions, flows, stock-only computations, checks

**Files:**
- Modify: `scripts/ingest-stock-data.mjs`, `scripts/fetch-kr-prices.mjs`, `tests/ingest-harness.ts` (new paths), `docs/data-sources.md`.
- Test: `tests/pension-ingest.test.ts` (new), `tests/default-view-regression.test.ts` (new).

**Interfaces:**
- **Consumes:**
  - `pension/*-holdings-*.csv` (dir `STOCK_PENSION_DIR`, default `<dataDir>/pension`);
  - `data/pension-evidence.json`;
  - the Task 3 transaction rows;
  - `map.pensionAccounts`.
- **Produces:**
  - `holdings_all` rows for pension positions:
    - `market: 'KR'`, `account` = the map entry's `account`, `account_wrapper` from the entry;
    - `asset_class: 'security'`;
    - `as_of_date` = the snapshot date;
    - `quantity`, `base_cost` = `cost_krw`;
    - `ticker` for ETFs, a stable synthetic id `PENSION:<token>:<n>` for funds and cash.
    - A `valuation_source` column (new, nullable): `'price'` for a priced ETF, `'snapshot'` for anything valued at `value_krw`.
  - `pension_flows` table: `account, account_wrapper, owner, date, kind, amount_krw, source`.
    - Kind is `contribution` | `employer_contribution` | `withdrawal` | `transfer_in` | `transfer_out`.
    - Mapping:
      - IRP `DEPOSIT` (계좌대체입금) → `contribution`;
      - 삼성 `DEPOSIT` → `contribution`;
      - `TRUST_OUT`, `INTEREST` and `REINVEST` are internal and not flows;
      - a withdrawal type, if one ever appears → `withdrawal`.
  - Checks:
    - `pension_snapshot_matches_year_end` (warning);
    - `pension_trades_after_snapshot` (warning);
    - `pension_etf_unpriced` (warning);
    - `us_wrapper_treatment_decided` (warning; Task 6 supplies the policy, and this task reads `wrapperTreatment.US` with the default `{irp:'undecided', pension_savings:'undecided'}` when absent).

- [ ] **Step 1: Failing ingest test.** Use `runIngest` with:
  - a map holding the two `pensionAccounts`;
  - `pension/irp-holdings-20261008.csv` with 1 ETF (ticker `069500`), 1 FUND and 1 CASH row;
  - a KR price fixture pricing `069500`;
  - an IRP transactions payload with one `DEPOSIT` and one `TRUST_OUT`;
  - a 삼성 payload with one `DEPOSIT`, one `BUY` dated after the 삼성 snapshot, and one `INTEREST`;
  - `pension-evidence.json` with an IRP 2025-12-31 certificate, and a 삼성 balance certificate with `products` acting as that account's snapshot.

  Assert:
  - `holdings_all` has 3 IRP rows tagged `irp` plus the 삼성 rows tagged `pension_savings`. The ETF is `valuation_source = 'price'`; the FUND and CASH rows are `'snapshot'`, valued at `value_krw`.
  - `holdings` (the view) has none of them.
  - `pension_flows` has exactly 2 `contribution` rows, one per account.
  - `pension_trades_after_snapshot` fails, names 1 trade and the 삼성 snapshot date, and the 삼성 holdings are unchanged by that BUY.
  - `pension_etf_unpriced` passes. A second run with the ETF price removed fails it, with the ETF still present and valued at `value_krw`.
- [ ] **Step 2: Failing default-view regression test** (`tests/default-view-regression.test.ts`).
  - Run the same base fixture twice: once without any pension, gold or evidence inputs, once with all of them (gold inputs arrive in Task 5; add them there).
  - Assert identical: `select count(*), sum(base_cost), sum(base_market_value) from holdings`; the same over `tax_lots`, `realized_lots`, `dividends` and `transactions`; every `portfolio_snapshots` row's stock columns; and the `meta` keys the tax pages read (`us_ytd_realized_computed` and any other `meta` row whose name contains `realized` or `tax`).
  - Also assert that no ERROR check fails in the second run that did not fail in the first.
- [ ] **Step 3: Run, verify both FAIL.**
- [ ] **Step 4: Implement:**
  1. **Early tagging.** Right after `holdingRows`, `taxLotRows`, `transactionRows`, `dividendRows` and `realizedRows` are first assembled, and after every later push or concat into them, run `tagRows(rows, accountMap)`. A helper `retag(rows)` re-tags only the rows missing `account_wrapper`. Then define:

```js
// The ingest's own stock computations must not see pension or gold rows: the
// snapshot writer, the tax-year realized set, the holdings/lots check and the
// sheet freshness check all describe the Stocks view.
const isStockRow = (r) => (r.account_wrapper === 'taxable' || r.account_wrapper === 'isa') && (r.asset_class ?? 'security') === 'security'
const stockOnly = (rows) => rows.filter(isStockRow)
```

  2. Apply `stockOnly` to every in-memory computation the audit names:
     - the portfolio snapshot writer (`valuePortfolio(holdingRows)` and the cost, dividend and share-count columns, at about `:6342–6389`);
     - `realizedForTaxYear` (about `:5909`);
     - the KR holdings-versus-lots mismatch loop (about `:5139–5160`, error severity: a pension holding has no lots and would fail the refresh);
     - the sheet freshness checks;
     - the US replay and `usSalesThisYear`, which already filter `market === 'US'`. Add `isStockRow` anyway, so a future US pension row cannot slip in.

     The controller hands you the audit at `wrapper-audit.md` (section 3 lists them). Read it.
  3. **Pension snapshots.**
     - For each `pensionAccounts` entry, take the newest `pension/<token>-holdings-*.csv`. If there is none, take the newest evidence certificate for that token that has `products`, as of its `asOf`.
     - Build the holdings rows above.
     - **ETF value:** quantity × the KR price when the ticker is priced; otherwise `value_krw`, with `pension_etf_unpriced` naming it.
     - **FUND and CASH:** `value_krw`.
     - **Cost:** `cost_krw`.
  4. **Pension transactions.**
     - Task 3's IRP and 삼성 rows go to `transactions_all`, tagged by the label rule.
     - They are NOT fed to the KR tax-lot or realized replay; skip them with `isStockRow`.
     - `pension_flows` is derived from them as mapped above.
     - **`pension_trades_after_snapshot`:** count the BUY and SELL rows per account dated after that account's snapshot date, and report the count and the date.
  5. **`pension_snapshot_matches_year_end`.**
     - For each evidence certificate with `totalKrw`, find the snapshot for that token whose date is the certificate's `asOf`; a balance certificate's `products` IS one.
     - Compare `sum(value_krw)` with `totalKrw` within `max(0.5%, ₩10,000)`.
     - If the only snapshot is later than the certificate, say "no snapshot at <asOf> to compare" and pass. Rolling a snapshot back through fund price moves is not possible without NAVs; the spec's "within 0.5%" assumes like-dated values.
  6. **`fetch-kr-prices.mjs`.** Also collect `ticker` values from `pension/*.csv` rows with `type === 'ETF'`. The dir comes from `STOCK_PENSION_DIR` or `<STOCK_DATA_DIR>/pension`.
  7. **Harness.** Add `STOCK_PENSION_DIR: 'pension'` and `STOCK_PENSION_EVIDENCE_PATH: 'pension-evidence.json'` to `INGEST_PATHS`.
- [ ] **Step 5: Run both tests and the full suite; verify PASS.**
- [ ] **Step 6: Commit** (`feat(ingest): pension holdings, flows and checks, kept out of every stock computation`).

---

### Task 5: Gold — holding from the certificate, KRX gold price step

**Files:**
- Create: `scripts/fetch-gold-price.mjs`.
- Modify: `scripts/refresh.mjs` (`fetch:gold-price`, `optional: true`, before the ingest), `package.json`, `scripts/ingest-stock-data.mjs`, `tests/ingest-harness.ts` (`STOCK_GOLD_PRICES_PATH: 'gold-prices.json'`), `tests/default-view-regression.test.ts` (add the gold inputs), `docs/data-sources.md`.
- Test: `tests/gold.test.ts` (new); a unit test for the price parser.

**Interfaces:**
- **Consumes:** Task 3 rows with Account `미래에셋증권(금현물)`: `BUY` (grams, KRW) and `FEE`.
- **Produces:**
  - `data/gold-prices.json`: `{ "source": "…", "code": "M04020000", "unit": "KRW/g", "fetchedAt": "ISO", "latest": { "date": "YYYY-MM-DD", "price": 0 }, "history": [{ "date": "YYYY-MM-DD", "price": 0 }] }`.
  - One `holdings_all` row:
    - `market: 'KR'`, `account: '미래에셋증권(금현물)'`, `asset_class: 'gold'`, `account_wrapper: 'taxable'`;
    - `ticker: 'M04020000'`, `name: 'KRX 금현물'`;
    - `quantity` = grams held, `base_cost` = the sum of BUY amounts (fees excluded);
    - market value = grams × `latest.price`, `valuation_source: 'price'`.
    - With no price, the holding is valued at cost, `valuation_source: 'cost'`, and `gold_priced` fails as a warning.
  - Gold BUY rows go to `transactions_all` (`asset_class 'gold'`). They are not replayed into tax lots.
- **Price source:** Naver's KRX gold endpoints, public JSON with no key:
  - current: `https://m.stock.naver.com/front-api/marketIndex/productDetail?category=metals&reutersCode=M04020000`. Read `result.closePrice` (a string with commas) and `result.localTradedAt`.
  - daily history: `https://m.stock.naver.com/front-api/marketIndex/prices?category=metals&reutersCode=M04020000&page=1&pageSize=60`. `pageSize` must be at least 10. Inspect the response shape when implementing, and write the parser against a saved fixture of that shape with invented numbers.
  - Cache like `fetch-fx-rates.mjs`. On fetch failure, keep the previous file and exit non-zero; the step is optional.

- [ ] **Step 1: Failing tests:**
  - the price parser on a fixture (`"177,480"` → `177480`, the date from `localTradedAt` in Asia/Seoul);
  - an ingest fixture with two BUY rows (`10g × 100,000`, `5g × 120,000`), their cash legs already dropped by Task 3, one FEE row, and a gold price of `130,000`. Expect quantity 15, cost 1,600,000, value 1,950,000, `asset_class 'gold'`, absent from the `holdings` view;
  - a run without a price file: valued at cost and `gold_priced` failing as a warning;
  - the regression test extended with the gold inputs, still identical.
- [ ] **Step 2: Run, verify FAIL. Step 3: Implement. Step 4: Run, verify PASS, then the full suite.**
- [ ] **Step 5: Commit** (`feat(gold): KRX gold price step and the physical-gold holding`).

---

### Task 6: Tax policy — wrapper treatment, credit limits, needs-review block

**Files:**
- Modify: `data/tax-policy.example.json`, `lib/tax-policy.ts`, `lib/tax-planning.ts`, the US/KR tax pages under `app/tax*`.
- Modify: `lib/adapters/portfolio-db.ts`: add `getWrapperReview()`.
- Test: `tests/tax-wrapper-treatment.test.ts` (new).

**Interfaces:**
- **Produces:**
  - Policy keys:

```json
"wrapperTreatment": {
  "KR": { "isa": "exempt_within_limit", "irp": "deferred", "pension_savings": "deferred" },
  "US": { "isa": "taxable", "irp": "undecided", "pension_savings": "undecided" }
},
"pensionTaxCredit": {
  "source": "Korean Income Tax Act art. 59-3, as amended for tax years 2023 onward",
  "byYear": [
    { "fromYear": 2023, "pensionSavingsLimitKrw": 6000000, "combinedLimitKrw": 9000000 },
    { "fromYear": 2015, "pensionSavingsLimitKrw": 4000000, "combinedLimitKrw": 7000000 }
  ]
}
```

    Add a comment in `docs/data-sources.md` that the pre-2023 limits depended on income and age, and that the example records the common case only.
  - `lib/tax-policy.ts`:
    - `wrapperTreatment(policy, jurisdiction, wrapper)` returns `'taxable' | 'undecided' | 'deferred' | 'exempt_within_limit'`. When the key is absent it returns the spec's default, `'undecided'` for the US, except `isa: 'taxable'` (see Global Constraints).
    - `pensionCreditLimit(policy, year)` returns `{ pensionSavingsLimitKrw, combinedLimitKrw } | null`.
  - `getWrapperReview()` returns, for each non-`taxable`/`isa` wrapper account in `*_all`: account, wrapper, US treatment, realized gain KRW, dividends KRW, and the count of likely-PFIC positions (KR-market funds and ETFs: every `PENSION:` fund id plus every KR ETF ticker in that account).
  - In `lib/tax-planning.ts`, a wrapper whose US treatment is `taxable` has its lots added to the US estimate. These come from `tax_lots_all` filtered to that wrapper. For `undecided`, `deferred` and `exempt_within_limit` they stay out. Pension lots do not exist yet (the snapshot carries no lots), so the `taxable` path is exercised by a unit test with a synthetic lot only.

- [ ] **Step 1: Failing tests:**
  - `wrapperTreatment` defaults and overrides;
  - `pensionCreditLimit(2024)` → 6,000,000 / 9,000,000, and `(2021)` → 4,000,000 / 7,000,000;
  - the planner with one synthetic `irp` lot leaves the US estimate unchanged under `undecided` and includes the lot under `taxable`.
- [ ] **Step 2: Run, verify FAIL. Step 3: Implement.**
  - The tax pages render a "Needs review for US tax" card: one row per `getWrapperReview()` account, the treatment shown, and the spec's explanation that `undecided` keeps it out of the estimate until a preparer settles it. Hide the card when there are none.
  - Wire `us_wrapper_treatment_decided` (Task 4) to `wrapperTreatment`.
- [ ] **Step 4: Run, verify PASS, then the full suite plus `pnpm build`.**
- [ ] **Step 5: Commit** (`feat(tax): wrapper treatment policy and the needs-review block`).

---

### Task 7: `/pension`, and pensions and gold in the All-assets totals

**Files:**
- Create: `app/pension/page.tsx`, `lib/ui-copy/pages/pension.tsx`.
- Modify: `lib/ui-copy/pages/sidebar.ts` (nav entry under Tax, `/pension`, labels `Pension` / `연금`), `lib/net-worth.ts`, `lib/adapters/portfolio-db.ts` (`getNetWorth` reads pension and gold from `holdings_all`; new `getPensionAccounts()`), `app/net-worth/page.tsx`, `app/page.tsx`, `app/accounts/page.tsx` (remove the "pensions and deposits are not collected" note, as the spec says).
- Test: `tests/net-worth.test.ts` (extend), `tests/pension-page-data.test.ts` (new, adapter level).

**Interfaces:**
- **Consumes:** Tasks 4–6 tables; `pensionCreditLimit`; `getWrapperReview`.
- **Produces:**
  - `getNetWorth().byClass` gains `pensions` and `gold`. Stocks stay `holdings` (the view), and crypto stays as is. Rows valued from a snapshot or at cost carry their as-of date into a new `asOfNotes: { label: string; asOf: string }[]`.
  - `getPensionAccounts()` returns, per pension account:
    - `{ account, wrapper, valueKrw, costKrw, returnPct, snapshotDate, holdings: [{ name, kind: 'ETF'|'FUND'|'CASH', valueKrw, costKrw, valuationSource, asOf }] }`;
    - `contributionsByYear: [{ year, ownKrw, employerKrw }]` from `pension_flows`;
    - IRP employer contributions, if the evidence supplies them, otherwise only own.
- **`/pension` page:**
  - one card per account: value, cost (contributions), return, and the snapshot date shown next to the value;
  - a holdings table with the ETF/FUND/CASH split, and an as-of date on every snapshot-valued row;
  - contributions by year against `pensionCreditLimit` (own contributions across IRP plus pension savings vs `combinedLimitKrw`; pension savings alone vs `pensionSavingsLimitKrw`);
  - the needs-review block (reuse Task 6's component).
- **All-assets view:** the overview's Total assets block and `/net-worth` allocation include Pensions and Gold. Stocks mode stays byte-identical; the regression test from Task 4 covers the data side.

- [ ] **Step 1: Failing tests:**
  - `getNetWorth` on a fixture DB with one pension holding (snapshot-valued, as-of `2026-10-08`) and one gold holding: `byClass.pensions` and `byClass.gold` are set, `asOfNotes` names the pension snapshot date, and `byClass.stocks` is unchanged versus the same DB without them;
  - `getPensionAccounts` returns the contributions by year and the holdings split.
- [ ] **Step 2: Run, verify FAIL. Step 3: Implement. Step 4: Run, verify PASS, then the full suite, `pnpm typecheck` and `pnpm build`.**
- [ ] **Step 5: Commit** (`feat(ui): /pension, and pensions and gold in the All-assets totals`).

---

## After the tasks (controller, not a task)

1. **Prepare the real files on the laptop's data dir.** Do not commit them.
   - Add a `ticker` column to the IRP holdings CSV for every ETF row.
   - Put that CSV, the year-end evidence PDFs and the 삼성 ledger in the inbox.
   - Run the filer, then `push-sources`.
2. Add `pensionAccounts` to the laptop's `data/accounts.local.json`, then run `push-sources`.
3. Final whole-branch review, PR, CI green, merge, then `make redeploy` on the ops host. Check:
   - the `/pension` page;
   - the All-assets totals;
   - that the Stocks totals (cost basis and position count) are unchanged against the values recorded before the deploy.
