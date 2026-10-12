# Cash Inflow View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/cash-inflow` page that shows new money arriving each month and each year (salary, dividends, interest, other) at the KRW/USD rate of the day it arrived, and move `/income` onto the same dated rate.

**Architecture:** Two data changes feed one shared query helper. (1) Every dividend row gets the USD/KRW rate of its own date at ingest. (2) The bank extractor stops discarding incoming transactions: it writes them to `bank-balances.json` with a flag for transfers between the user's own accounts, and the ingest classifies them into a new `bank_inflows` table. A new adapter function sums both sources by period in the display currency. A new page renders the result.

**Tech Stack:** Next.js (app router, server components), better-sqlite3, Python 3 extractor (`scripts/extract-bank-statements.py`), Node ingest (`scripts/ingest-stock-data.mjs`), recharts, `tsx --test`.

**Spec:** No separate spec doc. The decisions were made in conversation on 2026-10-11 and are fixed below under Global Constraints.

## Global Constraints

- Amounts are what actually arrived: dividends **net of withholding**, salary as deposited.
- Currency conversion uses the **USD/KRW rate on the row's own date** from `historical_fx_rates`, falling back to the closest earlier date. A row with no dated rate uses the current snapshot rate and is **counted and shown**, never silently mixed in.
- Categories: `salary`, `dividend`, `interest`, `other`, `unclassified`. Bank rows can also be `transfer` (own-account move) or `duplicate` (the same payout `dividends` already has). These two never count.
- The headline total is salary + dividend + interest + other. `unclassified` is shown next to it with a count, and is not in the total.
- Dividends come from the `dividends` view (taxable + ISA securities): the same set `/income` reads, so the two pages agree.
- In-kind income (`SHARE_REWARD`, `STAKING_REWARD`) is not cash and is excluded from `/cash-inflow`.
- Bank inflows are shown whatever the asset view (stocks / all). The asset-view toggle does not filter this page.
- `/income` keeps its gross amounts. Only its FX basis changes.
- This repo is public: no employer names, people's names or full account numbers in code, fixtures, docs, commits or PR text. Salary-matching rules live in `data/manual-mappings.json` (gitignored), with an invented example in `data/manual-mappings.example.json`.
- No command runs on the ops host (`ops-host`) without the user confirming that exact command first, diagnostics included.
- All UI copy goes through `lib/ui-copy` in both `en` and `ko`.

## Review Focus

1. **A transfer between the user's own accounts read as income.** A USD transfer from Robinhood brokerage to Robinhood checking, or a 파킹통장 withdrawal back to 토스뱅크, must not appear as `other` or `salary`. Task 4 marks the KRW cases. USD own transfers have no pairing, so they land in `unclassified`, never in the total. Task 5 pins this with a test.
2. **The same dividend counted twice.** A Fidelity CMA or 미래에셋 CMA statement prints a dividend that `dividends` already holds. Task 5's duplicate match must catch it. The test uses a payout that settles two days after the dividend date.
3. **A month with no dated FX rate.** Salary from before the first `historical_fx_rates` date shown in USD. It must convert at the current rate and raise the "converted at current rate" count, not drop to 0 or vanish. Task 2 and Task 6 test this.
4. **Gross vs net mismatch per source.** If a source's `native_amount` is already net, subtracting `native_tax_withheld` again understates it. Task 1 settles this per source before any formula is written.
5. **The asset-view toggle and the display-currency toggle on the new page.** Switching to USD must not leave a ₩ axis or reconvert dated values at today's rate. Task 7 checks both toggles in the browser.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/ingest-stock-data.mjs` | `usdKrwOn(date)`; dividend rate columns; `bank_inflows` table, validation, classification, check |
| `scripts/extract-bank-statements.py` | Emit `inflows[]` with an `ownTransfer` flag |
| `lib/adapters/income-fx.ts` (new) | `datedAmountSql(display, amountExpr)`: the one SQL expression both pages use |
| `lib/adapters/portfolio-db.ts` | `getIncomeReview(display)` on dated amounts; new `getCashInflow`, `getCashInflowRows` |
| `components/charts.tsx` | New `StackedBarChart` |
| `app/cash-inflow/page.tsx` (new) | The page |
| `app/income/page.tsx` | Stop reconverting income at today's rate |
| `lib/ui-copy/pages/cashInflow.ts` (new), `lib/ui-copy/pages/index.ts`, `lib/ui-copy/pages/sidebar.ts`, `lib/ui-copy/pages/income.ts` | Copy, sidebar entry, chart notes |
| `lib/page-names.ts` | Register `/cash-inflow` |
| `data/manual-mappings.example.json` | Invented `bankInflowRules` example |
| `docs/data-sources.md` | Document inflows, rules, and the dated-FX rule |
| `tests/income-dated-fx.test.ts`, `tests/bank-inflows-extract.test.ts`, `tests/bank-inflows-ingest.test.ts`, `tests/cash-inflow-adapter.test.ts` (new), `tests/page-headings.test.ts` | Tests |

---

### Task 1: Settle what each source's dividend amount means (investigation, no code)

The net formula depends on whether `native_amount` is gross or net, and that differs by source. It also needs to know which bank statements repeat dividends. This task fixes both from the real data before any code depends on them.

**Files:**
- Modify: `docs/superpowers/plans/2026-10-11-cash-inflow.md` (fill in the table at the end of this task)

- [ ] **Step 1: Find the local database.** Run from the main checkout, not the worktree, because the worktree has no real `data/`:

```bash
cd ~/workspace/code/core/jackhpark-stock-observatory && command grep -n -a "stockDbPath" config.ts && ls -la data/*.db
```

If there is no local DB, stop and ask the user whether to read the one on `ops-host`. Give them the exact read-only `sqlite3 -readonly` command and run nothing there without a yes.

- [ ] **Step 2: Per source, compare withholding to amount.** Read-only:

```bash
sqlite3 -readonly data/portfolio.db "
select source_system, brokerage, currency, type, count(*) n,
  sum(native_tax_withheld is not null and native_tax_withheld != 0) with_tax,
  round(sum(native_amount),2) amt, round(sum(coalesce(native_tax_withheld,0)),2) tax
from dividends_all group by 1,2,3,4 order by 1,2,3,4;"
```

- [ ] **Step 3: Check for separate withholding rows.** Some brokers book tax as its own negative row:

```bash
sqlite3 -readonly data/portfolio.db "
select brokerage, type, income_category, count(*), round(sum(native_amount),2)
from dividends_all where native_amount < 0 or upper(type) like '%TAX%' or type like '%세%' group by 1,2,3;"
```

- [ ] **Step 4: Pick one payout per source and match it to the broker statement.** One US source with `native_tax_withheld`, one Korean statement source. Note whether the statement's 입금액 equals `native_amount` (already net) or `native_amount - native_tax_withheld` (gross).

- [ ] **Step 5: Find bank rows that repeat dividends.** This needs the extractor's raw rows. With the main checkout's data, run in Python:

```bash
python3 -I -c "
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('b', 'scripts/extract-bank-statements.py'); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
from pathlib import Path
for prefix, inst, kind, cur, parse, _ in m.FAMILIES:
    for p in sorted(m.SOURCE_DIR.glob(prefix + '*'))[:2]:
        try: rows = parse(p, [], [])
        except Exception as e: print(inst, p.name, 'ERR', e); continue
        hits = [r for r in rows or [] if r['amount'] > 0 and any(w in r['description'].upper() for w in ('DIV', '배당', 'INTEREST', '이자'))]
        print(inst, kind, p.name, len(hits), [ (h['date'], h['amount'], h['description'][:30]) for h in hits[:3] ])
"
```

- [ ] **Step 6: Record the result.** Fill in this table, and set `NET_DIVIDEND_SQL` (used in Task 6) and `BROKERAGE_CASH_INSTITUTIONS` (used in Task 5) from it:

| Source (`source_system` / brokerage) | `native_amount` is | Net expression |
|---|---|---|
| `korea_statement`, Mirae / Samsung / Toss, KRW dividends, distributions, deposit interest and usage fees | gross (the statement's transaction amount; the net deposit is the settlement column) | `native_amount - coalesce(native_tax_withheld, 0)`, once the tax is carried (see surprises) |
| `korea_statement`, Mirae, USD foreign dividends | gross (withholding is printed on the same row and the deposit is gross minus it) | `native_amount - coalesce(native_tax_withheld, 0)`, once the tax is carried |
| `korea_statement`, Toss, KRW foreign-stock dividends (type `외화증권배당금입금`) | net (transaction amount equals settlement; the tax column is informational) | `native_amount` |
| `korea_statement`, refund rows (types containing `환급`) | net, a positive refund as received | `native_amount` |
| Chase transactions CSV | as received; the CSV has a withholding column and every row is zero | `native_amount - coalesce(native_tax_withheld, 0)` (equals `native_amount`) |
| Fidelity, Merrill, Robinhood CSVs | as received; no withholding column or row exists | `native_amount - coalesce(native_tax_withheld, 0)` (equals `native_amount`) |
| Bithumb and Robinhood crypto statements | as received; no tax is withheld | `native_amount - coalesce(native_tax_withheld, 0)` (equals `native_amount`) |

`NET_DIVIDEND_SQL` is one SQL `case` over `source_system`/`brokerage`, with the default branch `native_amount - coalesce(native_tax_withheld, 0)`. `BROKERAGE_CASH_INSTITUTIONS` lists the bank `institution` codes whose statements repeat `dividends` rows (expected: `fidelity`, `mirae`).

NET_DIVIDEND_SQL: `case when source_system = 'korea_statement' and type = '외화증권배당금입금' then native_amount when type like '%환급%' then native_amount else native_amount - coalesce(native_tax_withheld, 0) end`

BROKERAGE_CASH_INSTITUTIONS: none (empty list). No bank statement checked repeats a `dividends` row, so the expected `fidelity` and `mirae` do not hold.

- Surprise, blocking for the formula: the ingest never fills `native_tax_withheld` for `korea_statement` rows (always null), although the extractor's transactions table carries the tax for the same payouts. Until a later task carries that tax into the dividends rows, the default branch returns the gross amount for every Korean row except the foreign-stock Toss type. The fix belongs in the ingest, where the dividend row is built from the statement row.
- Surprise: no source books withholding as a separate negative row. The only tax-named rows are positive refunds, filed with `income_category` other.
- Surprise: Fidelity's cash-management statements hold money-market dividends that `dividends` does not (that account's payouts are not in the transactions CSV), so they are new inflows, not duplicates. Their description reads `DIVIDEND RECEIVED`, which Task 5's rule 4 (`이자|INTEREST`) does not match, so they would fall to `unclassified` unless a rule or the regex covers them.
- Surprise: the Mirae cash-management statement is encrypted and could not be opened here. It is an interest-bearing note account separate from the general account, so a repeat is unlikely, but it is unverified.
- The local database predates the plan's schema: it has a `dividends` table and no `dividends_all`, and the figures above were read from it.


- [ ] **Step 7: Commit the filled-in plan**

```bash
git add docs/superpowers/plans/2026-10-11-cash-inflow.md
git commit -m "docs(plan): record dividend amount semantics per source"
```

---

### Task 1b: Carry Korean withholding into the dividend rows

Task 1 found that every `korea_statement` dividend row has `native_tax_withheld` null, although the KR extractor reads the tax (`Tax`) on the very transaction row each dividend is copied from. Without it, the net formula returns the gross amount for every Korean row.

**Files:**
- Modify: `scripts/extract-kr-statements.py:681-684` (`DIVIDEND_COLUMNS`), and the three `dividends.append({...})` blocks (미래에셋 at ~`:1606`, Toss at ~`:1638`, 삼성 at ~`:1665`)
- Modify: `scripts/ingest-stock-data.mjs:2106-2123` (`dividendRows` from `datasets.dividends.rows`)
- Test: an existing KR extractor/ingest test that writes `dividends.tsv` (find it with `command grep -rln -a "dividends.tsv" tests`), plus a new assertion

**Interfaces:**
- Produces: `dividends.tsv` gains a `Tax` column (after `Amount (KRW)`), the same value as the `Tax` of the transaction row it was copied from (native currency, may be empty). `dividends_all.native_tax_withheld` is that number for Korean rows (null when empty).
- Unchanged: `native_amount`, `amount_krw`, and everything `/income` reads. For Toss `외화증권배당금입금` the tax is informational (the amount is already net); the net formula's type branch handles it, so the value is still carried as printed.

- [ ] **Step 1: Write the failing test.** An ingest test with a `dividends.tsv` row carrying `Tax` 7700 for a `Native Amount` 50000 KRW `배당금입금`, asserting `select native_tax_withheld from dividends_all` is 7700. A second row with an empty `Tax` asserts null. An extractor-level test (if one exists for the 미래에셋/Toss/삼성 appends) asserts the `Tax` key is present on each dividend row equal to the transaction row's `Tax`.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement.** Add `"Tax"` to `DIVIDEND_COLUMNS` after `"Amount (KRW)"`; add `"Tax": row["Tax"],` to each of the three appends; in the ingest set `native_tax_withheld: number(r.Tax)` instead of `null`. An older `dividends.tsv` without the column must still ingest (`number(undefined)` → null).
- [ ] **Step 4: Run tests.** `pnpm exec tsx --test <the tests you touched>` then `pnpm test`.
- [ ] **Step 5: Commit** `feat(kr): carry withholding tax into the dividend rows`.

---

### Task 2: Dated USD/KRW rate on every dividend row

**Files:**
- Modify: `scripts/ingest-stock-data.mjs:1364-1374` (`krwOn`), `:1119-1143` (`dividends_all` schema), `:4999-5019` (`insertMany(db, 'dividends', …)`)
- Test: `tests/income-dated-fx.test.ts` (new)

**Interfaces:**
- Produces: `dividends_all.usd_krw_rate real` (null only when no FX exists at all), `dividends_all.usd_krw_rate_dated integer` (1 = rate of that date or the closest earlier one, 0 = current snapshot). Ingest function `usdKrwOn(date) -> { rate: number, dated: boolean } | null`.
- Produces: validation check `income_fx_dated` (severity `warning`; status `warn` when any dividend row has `usd_krw_rate_dated = 0`; detail names the count and the earliest such date).

- [ ] **Step 1: Write the failing test.** Use the ingest harness with a Korean statement dividend in USD (the path that already reads historical FX) and a historical FX file that starts after one of the rows:

```ts
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

function ingestWith(rates: { price_date: string; rate: number }[], dividends: Record<string, string>[]) {
  const dir = mkdtempSync(path.join(tmpdir(), 'income-fx-'))
  writeSheetPayloads(dir)
  const kr = path.join(dir, 'kr-statements')
  mkdirSync(kr, { recursive: true })
  const cols = ['Date', 'Account', 'Symbol', 'Name', 'Currency', 'Native Amount', 'Amount (KRW)', 'Type', 'Source', 'Page']
  writeFileSync(path.join(kr, 'dividends.tsv'), [cols.join('\t'), ...dividends.map((d) => cols.map((c) => d[c] ?? '').join('\t'))].join('\n') + '\n')
  const fx = path.join(dir, 'historical-fx-rates.json')
  writeFileSync(fx, JSON.stringify({ rates: rates.map((r) => ({ ...r, source: 'test' })) }))
  return new Database(runIngest(dir, { env: { STOCK_HISTORICAL_FX_RATES_PATH: fx }, allowFailure: true }), { readonly: true })
}

const div = (date: string) => ({ Date: date, Account: 'Invented Broker(주식종합)', Symbol: 'AAA', Name: 'Invented ETF', Currency: 'USD', 'Native Amount': '10', 'Amount (KRW)': '', Type: '배당', Source: 'invented.pdf', Page: '1' })

test('a dividend carries the USD/KRW rate of its own date, or the closest earlier one', () => {
  const db = ingestWith([{ price_date: '2025-01-02', rate: 1400 }, { price_date: '2025-03-03', rate: 1450 }], [div('2025-03-01'), div('2025-03-03')])
  const rows = db.prepare('select date, usd_krw_rate, usd_krw_rate_dated from dividends_all order by date').all()
  assert.deepEqual(rows, [
    { date: '2025-03-01', usd_krw_rate: 1400, usd_krw_rate_dated: 1 },
    { date: '2025-03-03', usd_krw_rate: 1450, usd_krw_rate_dated: 1 },
  ])
})

test('a dividend older than every dated rate is marked undated and the check says so', () => {
  const db = ingestWith([{ price_date: '2025-01-02', rate: 1400 }], [div('2024-06-01')])
  const row = db.prepare('select usd_krw_rate_dated from dividends_all').get() as { usd_krw_rate_dated: number }
  assert.equal(row.usd_krw_rate_dated, 0)
  const check = db.prepare("select status, detail from validation_checks where name = 'income_fx_dated'").get() as { status: string; detail: string }
  assert.equal(check.status, 'warn')
  assert.match(check.detail, /1 .*2024-06-01/)
})
```

Before running, open `tests/kr-split-dividends.test.ts` and copy the exact file name and column set it writes for Korean dividends. Adjust `dividends.tsv` and `cols` above to match it, so the fixture goes through the real path.

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec tsx --test tests/income-dated-fx.test.ts`
Expected: FAIL. `no such column: usd_krw_rate`.

- [ ] **Step 3: Implement.** Replace `krwOn` with a rate lookup it calls:

```js
// The USD/KRW rate on `date`: the historical table's rate for that day or the
// closest earlier one. Older than the table, it is today's snapshot rate and
// says so (`dated: false`), so a view can count what it could not date.
function usdKrwOn(date) {
  let best = null
  for (const entry of historicalFxDates) {
    if (entry.date > date) break
    best = entry
  }
  if (best) return { rate: best.rate, dated: true }
  const current = fxRate('USD')?.rate ?? null
  return current == null ? null : { rate: current, dated: false }
}

function krwOn(nativeAmount, currency, date) {
  if (nativeAmount == null) return null
  if (!currency || currency === 'KRW') return nativeAmount
  const fx = usdKrwOn(date)
  return fx == null ? null : nativeAmount * fx.rate
}
```

Add to the `dividends_all` schema after `amount_krw real not null,`:

```sql
  usd_krw_rate real,
  usd_krw_rate_dated integer not null default 0,
```

Right before `insertMany(db, 'dividends', dividendRows, [...])`, stamp each row and add both names to that column list:

```js
for (const row of dividendRows) {
  const fx = usdKrwOn(row.date)
  row.usd_krw_rate = fx?.rate ?? null
  row.usd_krw_rate_dated = fx?.dated ? 1 : 0
}
```

Add the check next to the other dividend checks. Use the same helper the neighbouring checks use to insert into `validation_checks`, found by searching for `'dividend_rows_match_transactions'`:

```js
const undatedIncome = dividendRows.filter((r) => !r.usd_krw_rate_dated).map((r) => r.date).sort()
// helper(name, status, severity, detail) — use the neighbouring checks' exact call shape
addCheck('income_fx_dated', undatedIncome.length ? 'warn' : 'pass', 'warning',
  undatedIncome.length
    ? `${undatedIncome.length} income row(s) have no dated USD/KRW rate and convert at today's rate; earliest ${undatedIncome[0]}`
    : 'every income row converts at the USD/KRW rate of its own date')
```

- [ ] **Step 4: Run it and see it pass**

Run: `pnpm exec tsx --test tests/income-dated-fx.test.ts`
Expected: PASS (2 tests). Then run `pnpm test` and confirm nothing else changed. The `realized_lots` and Korean statement tests call `krwOn` and must stay green.

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest-stock-data.mjs tests/income-dated-fx.test.ts
git commit -m "feat(ingest): stamp each income row with the USD/KRW rate of its own date"
```

---

### Task 3: `/income` reads the dated amounts

**Files:**
- Create: `lib/adapters/income-fx.ts`
- Modify: `lib/adapters/portfolio-db.ts:2429-2548` (`getIncomeReview`), `app/income/page.tsx:20-60,155-172`, `lib/ui-copy/pages/income.ts` (`chartNote`, `chartNoteUsd`, `baseIncomeHint`, both languages)
- Test: `tests/income-dated-fx.test.ts` (add an adapter test)

**Interfaces:**
- Consumes: `dividends.usd_krw_rate`, `dividends.usd_krw_rate_dated` (Task 2).
- Produces: `datedAmountSql(display: 'KRW' | 'USD', amount?: string): string`. `getIncomeReview(display: 'KRW' | 'USD'): IncomeReview`. Every `*_base_income` field is now in `display`. `IncomeReview` gains `currency: 'KRW' | 'USD'` and `totals.undated_count: number`.

- [ ] **Step 1: Write the failing adapter test.** Build a DB by hand, following `tests/overview-realized-trend.test.ts`:

```ts
test('income totals convert each row at its own rate, in either display currency', async () => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'income-adapter-')), 'portfolio.db')
  const db = new Database(dbPath)
  db.exec(`
    create table holdings (base_market_value real, base_cost real, total_cost_krw real, account_wrapper text, market text, ticker text);
    create table dividends (market text, currency text, date text, ticker text, name text, type text, native_amount real,
      native_tax_withheld real, amount_krw real, income_category text, usd_krw_rate real, usd_krw_rate_dated integer);
  `)
  const ins = db.prepare('insert into dividends values (?,?,?,?,?,?,?,?,?,?,?,?)')
  ins.run('US', 'USD', '2025-01-10', 'AAA', 'A', 'DIVIDEND', 10, 0, 15000, 'dividend', 1300, 1)
  ins.run('US', 'USD', '2025-02-10', 'AAA', 'A', 'DIVIDEND', 10, 0, 15000, 'dividend', 1400, 1)
  ins.run('KR', 'KRW', '2025-02-11', 'BBB', 'B', '배당', 28000, 0, 28000, 'dividend', 1400, 1)
  db.close()
  process.env.STOCK_DB_PATH = dbPath
  const { getIncomeReview } = await import('../lib/adapters/portfolio-db')
  const krw = getIncomeReview('KRW')
  assert.deepEqual(krw.byMonth.map((m) => [m.month, m.base_income]), [['2025-01', 13000], ['2025-02', 42000]])
  const usd = getIncomeReview('USD')
  assert.deepEqual(usd.byMonth.map((m) => [m.month, m.base_income]), [['2025-01', 10], ['2025-02', 30]])
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec tsx --test tests/income-dated-fx.test.ts`
Expected: FAIL. January is 15000 (the stored current-rate figure), not 13000.

- [ ] **Step 3: Implement the helper**

```ts
// lib/adapters/income-fx.ts
export type DisplayCurrency = 'KRW' | 'USD'

/**
 * A native amount in the display currency, at the USD/KRW rate of the row's own
 * date (`usd_krw_rate`, stamped at ingest). Both /income and /cash-inflow use
 * this one expression so the two pages cannot convert differently.
 */
export function datedAmountSql(display: DisplayCurrency, amount = 'native_amount') {
  return display === 'KRW'
    ? `(case when currency = 'KRW' then ${amount} else ${amount} * usd_krw_rate end)`
    : `(case when currency = 'USD' then ${amount} else ${amount} / usd_krw_rate end)`
}
```

In `getIncomeReview`, take `display: DisplayCurrency` and set `const v = datedAmountSql(display)`. In `totals`, `byMonth`, `byYear`, `byMarket`, `byPosition` and `tickerless`, replace every `amount_krw` with `${v}`. Add `sum(case when usd_krw_rate_dated = 0 then 1 else 0 end) as undated_count` to `totals`. Yields divide by KRW `holdings` values, so compute the trailing-12-month figure for them a second time with `datedAmountSql('KRW')`, and leave the yield formulas unchanged. Return `currency: display`.

- [ ] **Step 4: Update the page.** In `app/income/page.tsx`, call `getIncomeReview(currencyPreferences.displayCurrency)`. Delete `displayBaseValue` and format every income money value with `money(value, income.currency)`, so the formatter does not convert again. The chart becomes `Math.round(row.base_income / chartDivisor)`. When `income.totals.undated_count > 0`, show a `Badge tone="warning"` with new copy `undatedRows(count)`:
  - en: `` `${count} row(s) at today's rate` ``
  - ko: `` `오늘 환율 적용 ${count}건` ``

  Change copy:
  - `chartNote`: en `'Values are KRW thousands at each payment date's USD/KRW rate.'`, ko `'지급일 환율을 적용한 천 원 단위 값입니다.'`
  - `chartNoteUsd`: en `'Values are USD at each payment date's USD/KRW rate.'`, ko `'지급일 환율을 적용한 달러 값입니다.'`
  - `baseIncomeHint`: en `'Converted at each payment date's rate'`, ko `'지급일 환율로 환산'`

  Search for other `getIncomeReview(` callers (`command grep -rn -a "getIncomeReview(" app lib components`) and pass the display currency there too.

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `pnpm exec tsx --test tests/income-dated-fx.test.ts && pnpm typecheck && pnpm test`
Expected: PASS. For lint in a worktree, see memory `worktree-lint-and-env`.

- [ ] **Step 6: Verify in the browser.** Start the dev server with `preview_start`, open `/income` in KRW and then in USD, and confirm the chart axis follows the toggle and the cards change. Take before and after screenshots. Then compare the before and after values of 평가금액 대비 수익률 and 취득원가 대비 수익률 and report the change to the user.

- [ ] **Step 7: Commit**

```bash
git add lib/adapters/income-fx.ts lib/adapters/portfolio-db.ts app/income/page.tsx lib/ui-copy/pages/income.ts tests/income-dated-fx.test.ts
git commit -m "feat(income): convert each payment at its own date's USD/KRW rate"
```

---

### Task 4: The bank extractor keeps incoming transactions

**Files:**
- Modify: `scripts/extract-bank-statements.py` (`main` at `:913-991`, `estimate_closed_accounts` at `:869-910`)
- Test: `tests/bank-inflows-extract.test.ts` (new)

**Interfaces:**
- Produces: `bank-balances.json` gains `inflows: [{ institution, account, currency, date, amount, description, counterparty, ownTransfer }]`, one per row with `amount > 0`. `ownTransfer` is `true` when the row is one leg of a paired transfer, a `term` row, or a return from an `ESTIMATE_ALIASES` bucket (파킹통장, 예적금, 미래에셋 기타 계좌).

- [ ] **Step 1: Write the failing test.** Reuse the `extract()` helper pattern from `tests/mg-term-deposits.test.ts` (copy it; do not import from another test file). Fixtures are invented: a 새마을금고 export with `급여` 입금 3,000,000 and `예적금만기 자동이체` 입금 5,084,600, and a 토스뱅크 workbook with a `파킹통장` 입금 of 1,000,000:

```ts
test('incoming rows are kept, and a return from a 예적금 or 파킹통장 is marked as an own transfer', () => {
  const doc = extract({ 'mg-deposit-20230101-20231231.xls': MG_ROWS, 'tossbank-1234-20230101-20231231.xlsx': TOSS })
  const byDesc = Object.fromEntries(doc.inflows.map((f: any) => [f.description, f]))
  assert.equal(byDesc['급여'].amount, 3000000)
  assert.equal(byDesc['급여'].ownTransfer, false)
  assert.equal(byDesc['예적금만기 자동이체'].ownTransfer, true)
  assert.equal(doc.inflows.find((f: any) => f.counterparty === '파킹통장').ownTransfer, true)
  assert.ok(doc.inflows.every((f: any) => f.amount > 0))
})

test('a 토스뱅크 → 새마을금고 transfer marks both legs, so the arriving leg is not income', () => {
  const doc = extract({ 'mg-deposit-20230101-20231231.xls': MG_WITH_TRANSFER_IN, 'tossbank-1234-20230101-20231231.xlsx': TOSS_WITH_TRANSFER_OUT })
  const arrived = doc.inflows.find((f: any) => f.institution === 'mg' && f.amount === 700000)
  assert.equal(arrived.ownTransfer, true)
})
```

Build the 토스뱅크 fixtures the way `tests/bank-statements.test.ts` builds its `.xlsx` (search it for `openpyxl` or the workbook helper). For the transfer pair: 토스뱅크 `거래 금액` -700000 with `거래 기관` `MG새마을금고` on 2023-04-03, and 새마을금고 입금 700000 on 2023-04-04.

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec tsx --test tests/bank-inflows-extract.test.ts`
Expected: FAIL. `doc.inflows` is undefined.

- [ ] **Step 3: Implement.** In `estimate_closed_accounts`, carry the source row on each flow and copy the decision back to it:

```python
            flows.append({..., "paired": bool(t.get("term")), "txn": t})
    pair_transfers(flows)
    for f in flows:
        if f["paired"]:
            f["txn"]["ownTransfer"] = True
    buckets = {}
    for f in sorted((f for f in flows if not f["paired"]), key=lambda f: (f["date"], f["seq"])):
        key = _bucket(f)
        if key in ESTIMATE_ALIASES:
            f["txn"]["ownTransfer"] = True  # money coming back from an account no statement covers
        if key:
            buckets.setdefault(key, []).append((f["date"], -f["amount"]))
```

(`"txn"` is in-memory only. The flows are never written out.)

In `main`, collect `inflow_sources.append((institution, alias, currency, txns))` next to `accounts.append(...)`. After `estimate_closed_accounts(...)`, so that the `term` and `ownTransfer` marks are already set:

```python
    inflows = [{"institution": inst, "account": alias, "currency": cur, "date": t["date"], "amount": round(t["amount"], 2),
                "description": t.get("description", ""), "counterparty": t.get("counterparty", ""),
                "ownTransfer": bool(t.get("ownTransfer") or t.get("term"))}
               for inst, alias, cur, txns in inflow_sources for t in txns if t["amount"] > 0]
```

Add `"inflows": inflows` to `document`, and `{len(inflows)} inflow(s)` to the summary print.

- [ ] **Step 4: Run tests**

Run: `pnpm exec tsx --test tests/bank-inflows-extract.test.ts tests/mg-term-deposits.test.ts tests/bank-statements.test.ts`
Expected: PASS. The estimate tests must not change, because `"txn"` and `ownTransfer` add marks without changing the balances.

- [ ] **Step 5: Commit**

```bash
git add scripts/extract-bank-statements.py tests/bank-inflows-extract.test.ts
git commit -m "feat(bank): keep incoming transactions, marking own-account transfers"
```

---

### Task 5: Ingest and classify bank inflows

**Files:**
- Modify: `scripts/ingest-stock-data.mjs` (bank doc validator at `:60-138`, new table next to `cash_balances` at `:894`, insert next to `:4957`), `data/manual-mappings.example.json`
- Test: `tests/bank-inflows-ingest.test.ts` (new)

**Interfaces:**
- Consumes: `bank-balances.json` `inflows` (Task 4), `usdKrwOn` (Task 2), the dividend rows' net amounts (Task 1's `NET_DIVIDEND_SQL`, mirrored here in JS as `netDividend(row)`).
- Produces: table `bank_inflows(id, institution, account, currency, date, amount, description, counterparty, category, rule, usd_krw_rate, usd_krw_rate_dated)` with `category` in `salary | interest | other | transfer | duplicate | unclassified`. Validation check `bank_inflows_classified` (severity `warning`).
- Mapping format: `manual-mappings.json` → `bankInflowRules: [{ id, match: { institution?, accountIncludes?, descriptionIncludes?, counterpartyIncludes?, currency? }, category: 'salary' | 'interest' | 'other' | 'transfer', note? }]`. The first match wins.

Classification order, applied per row (amended after Task 1 — see the ledger ruling: no bank statement repeats a `dividends` row, so there is no duplicate rule and no `BROKERAGE_CASH_INSTITUTIONS`; Fidelity CMA money-market payouts are new money and read `DIVIDEND RECEIVED`):
1. `ownTransfer` → `transfer`.
2. The first `bankInflowRules` match → its `category`, `rule = id`.
3. Description matches `/배당|DIVIDEND/i` → `dividend`.
4. Description matches `/이자|INTEREST/i` → `interest`.
5. Otherwise `unclassified`.

Allowed bank categories: `salary | dividend | interest | other | transfer | unclassified`. Ignore every mention of `duplicate`, `BROKERAGE_CASH_INSTITUTIONS` and `netDividend` elsewhere in this task: they are superseded by this list. Replace the duplicate test with: a `fidelity` inflow described `DIVIDEND RECEIVED` is `dividend`.

- [ ] **Step 1: Write the failing test.** Write an invented `bank-balances.json` and `manual-mappings.json` into the scratch dir, point `STOCK_BANK_BALANCES_PATH` and `STOCK_MANUAL_MAPPINGS_PATH` at them, and use `runIngest` as in `tests/cash-balances-ingest.test.ts`:

```ts
const BANK = {
  accounts: [], estimatedAccounts: [], findings: [], notes: [],
  inflows: [
    { institution: 'mg', account: '새마을금고 자립예탁금', currency: 'KRW', date: '2025-03-25', amount: 3000000, description: '급여', counterparty: '', ownTransfer: false },
    { institution: 'mg', account: '새마을금고 자립예탁금', currency: 'KRW', date: '2025-03-26', amount: 500000, description: '예적금만기 자동이체', counterparty: '', ownTransfer: true },
    { institution: 'chase', account: 'Chase checking', currency: 'USD', date: '2025-03-14', amount: 2500, description: 'EXAMPLE CO PAYROLL', counterparty: '', ownTransfer: false },
    { institution: 'chase', account: 'Chase checking', currency: 'USD', date: '2025-03-20', amount: 400, description: 'TRANSFER FROM BROKERAGE', counterparty: '', ownTransfer: false },
    { institution: 'tossbank', account: '토스뱅크', currency: 'KRW', date: '2025-03-31', amount: 1200, description: '이자 지급', counterparty: '', ownTransfer: false },
  ],
}
const MAPPINGS = { version: 1, incomeRules: [], dividendOverrides: [], bankInflowRules: [
  { id: 'salary-kr', match: { institution: 'mg', descriptionIncludes: '급여' }, category: 'salary' },
  { id: 'salary-us', match: { institution: 'chase', descriptionIncludes: 'PAYROLL' }, category: 'salary' },
] }

test('bank inflows are classified: rules, own transfers, interest, and the rest unclassified', () => {
  const db = ingestBank(BANK, MAPPINGS)
  const rows = db.prepare('select description, category, rule from bank_inflows order by date, description').all()
  assert.deepEqual(rows.map((r: any) => [r.description, r.category]), [
    ['EXAMPLE CO PAYROLL', 'salary'],
    ['TRANSFER FROM BROKERAGE', 'unclassified'],
    ['급여', 'salary'],
    ['예적금만기 자동이체', 'transfer'],
    ['이자 지급', 'interest'],
  ])
  const check = db.prepare("select status, detail from validation_checks where name = 'bank_inflows_classified'").get() as any
  assert.equal(check.status, 'warn')
  assert.match(check.detail, /1 .*USD 400/)
})

test('a CMA credit that repeats a dividend already on file is a duplicate, two days late', () => {
  // A dividends row: Fidelity, USD, 2025-04-01, net 12.34. A fidelity bank inflow of 12.34 on 2025-04-03.
  // Build the dividend through the Fidelity transactions CSV path; copy the header from tests/us-transaction-types.test.ts.
  const db = ingestBankWithFidelityDividend()
  assert.equal((db.prepare("select category from bank_inflows where institution = 'fidelity'").get() as any).category, 'duplicate')
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec tsx --test tests/bank-inflows-ingest.test.ts`
Expected: FAIL. `no such table: bank_inflows`.

- [ ] **Step 3: Implement.** In the bank doc validator, accept an optional `inflows` array. Drop any entry that lacks string `institution`/`account`/`date`, a `KRW`/`USD` currency, or a finite positive `amount`, and add a `problems` line for it the way `accounts` does. Then add `inflows` to the returned `doc` and to every empty-doc literal (`:70`, `:142`, `:149`).

Schema:

```sql
-- Money arriving in a bank account, from bank-balances.json `inflows`. `category`
-- is decided at ingest: own-account moves are `transfer` and a CMA credit that
-- repeats a dividends row is `duplicate`; neither counts as new money.
create table bank_inflows (
  id integer primary key,
  institution text not null,
  account text not null,
  currency text not null,
  date text not null,
  amount real not null,
  description text not null default '',
  counterparty text not null default '',
  category text not null,
  rule text,
  usd_krw_rate real,
  usd_krw_rate_dated integer not null default 0
);
```

Classification (after `dividendRows` is final):

```js
const BROKERAGE_CASH_INSTITUTIONS = new Set(['fidelity', 'mirae']) // from the plan's Task 1 table
const bankInflowRules = manualMappings.bankInflowRules ?? []
const inflowMatches = (row, match = {}) =>
  includesText(row.institution, match.institution) &&
  includesText(row.account, match.accountIncludes) &&
  includesText(row.description, match.descriptionIncludes) &&
  includesText(row.counterparty, match.counterpartyIncludes) &&
  includesText(row.currency, match.currency)
const unmatchedDividends = dividendRows.map((d) => ({ date: d.date, currency: d.currency, net: netDividend(d), used: false }))
const bankInflowRows = bankBalances.inflows.map((f) => {
  let category = null, rule = null
  if (f.ownTransfer) category = 'transfer'
  if (!category && BROKERAGE_CASH_INSTITUTIONS.has(f.institution)) {
    const hit = unmatchedDividends.find((d) => !d.used && d.currency === f.currency && Math.abs(d.net - f.amount) < 0.01 &&
      daysBetween(d.date, f.date) >= 0 && daysBetween(d.date, f.date) <= 5)
    if (hit) { hit.used = true; category = 'duplicate' }
  }
  if (!category) {
    const r = bankInflowRules.find((x) => inflowMatches(f, x.match))
    if (r) { category = r.category; rule = r.id ?? null }
  }
  if (!category) category = /이자|INTEREST/i.test(f.description) ? 'interest' : 'unclassified'
  const fx = usdKrwOn(f.date)
  return { ...f, category, rule, usd_krw_rate: fx?.rate ?? null, usd_krw_rate_dated: fx?.dated ? 1 : 0 }
})
insertMany(db, 'bank_inflows', bankInflowRows, ['institution', 'account', 'currency', 'date', 'amount', 'description', 'counterparty', 'category', 'rule', 'usd_krw_rate', 'usd_krw_rate_dated'])
```

Search the file for an existing day-difference helper before adding `daysBetween(a, b)` (whole days from `a` to `b`, signed). `netDividend(d)` is the JS form of Task 1's `NET_DIVIDEND_SQL`. Define both next to each other with a comment saying they must agree.

Add the `bank_inflows_classified` check: `warn` when any row is `unclassified`. The detail is `` `${n} bank inflow(s) match no rule: ${per-currency sums, e.g. "KRW 1,200,000 · USD 400"}` ``, and never includes descriptions, because check details reach the UI and logs.

Add to `data/manual-mappings.example.json`:

```json
  "bankInflowRules": [
    {
      "id": "salary-example",
      "match": { "institution": "chase", "descriptionIncludes": "EXAMPLE CO PAYROLL" },
      "category": "salary",
      "note": "Classify a bank credit for /cash-inflow. First match wins. Categories: salary, interest, other, transfer (an own-account move, never counted). A credit no rule matches shows as unclassified."
    }
  ]
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec tsx --test tests/bank-inflows-ingest.test.ts && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest-stock-data.mjs data/manual-mappings.example.json tests/bank-inflows-ingest.test.ts
git commit -m "feat(ingest): load and classify bank inflows for the cash inflow view"
```

---

### Task 6: `getCashInflow` adapter

**Files:**
- Modify: `lib/adapters/portfolio-db.ts` (new functions after `getIncomeReview`)
- Test: `tests/cash-inflow-adapter.test.ts` (new)

**Interfaces:**
- Consumes: `datedAmountSql` (Task 3), `bank_inflows` (Task 5), `dividends` view with rate columns (Task 2), `NET_DIVIDEND_SQL` (Task 1).
- Produces:

```ts
export type CashInflowCategory = 'salary' | 'dividend' | 'interest' | 'other' | 'unclassified'
export type CashInflowPeriod = { period: string; salary: number; dividend: number; interest: number; other: number; unclassified: number; total: number }
export type CashInflow = {
  currency: DisplayCurrency
  granularity: 'month' | 'year'
  periods: CashInflowPeriod[]            // oldest first; month = 'YYYY-MM', year = 'YYYY'
  totals: { trailing12m: number; ytd: number; monthlyAverage12m: number; salaryShare12m: number | null }
  unclassifiedCount: number
  undatedCount: number
  hasBankData: boolean
}
export type CashInflowRow = { date: string; source: 'bank' | 'dividend'; category: CashInflowCategory; label: string; account: string; currency: string; native: number; amount: number }
export function getCashInflow(granularity: 'month' | 'year', display: DisplayCurrency): CashInflow
export function getCashInflowRows(period: string, display: DisplayCurrency): CashInflowRow[]
```

`NET_DIVIDEND_SQL` is exported from `lib/adapters/income-fx.ts`, with the exact expression Task 1 recorded. Bank rows with category `dividend` count under `dividend`. `total` excludes `unclassified`. `trailing12m` covers the last 12 calendar months including the current one. `salaryShare12m = salary12m / trailing12m` (null when 0). Bank rows with category `transfer` are never read. Dividend rows with `upper(type)` in `('SHARE_REWARD','STAKING_REWARD')` are excluded. Dividend `income_category` maps as `dividend` → dividend, `interest` → interest, anything else → other.

- [ ] **Step 1: Write the failing test.** Hand-built DB, as in Task 3:

```ts
test('periods add salary and net dividends at their own rates; transfers, duplicates and in-kind rewards never count', async () => {
  // bank_inflows: salary KRW 3,000,000 (2025-03); salary USD 2,000 @1400 (2025-03); transfer KRW 500,000; Fidelity CMA dividend USD 12.34 @1400 (bank, category dividend);
  //               unclassified USD 400 @1400.
  // dividends:    USD 10 gross, 1.5 withheld @1300 (2025-03, dividend); KRW 5,000 SHARE_REWARD (2025-03).
  const { getCashInflow } = await import('../lib/adapters/portfolio-db')
  const m = getCashInflow('month', 'KRW')
  const march = m.periods.find((p) => p.period === '2025-03')!
  assert.equal(march.salary, 3_000_000 + 2_000 * 1400)
  assert.equal(march.dividend, 8.5 * 1300 + 12.34 * 1400) // net of withholding at the payment date's rate, plus the bank dividend
  assert.equal(march.unclassified, 400 * 1400)
  assert.equal(march.total, march.salary + march.dividend)
  assert.equal(m.unclassifiedCount, 1)
  const y = getCashInflow('year', 'USD')
  assert.equal(y.periods.find((p) => p.period === '2025')!.salary, 3_000_000 / 1400 + 2_000)
})

test('a row with no dated rate still converts, and is counted', async () => {
  // one bank salary USD 1,000 with usd_krw_rate 1500, usd_krw_rate_dated 0
  const r = getCashInflow('month', 'KRW')
  assert.equal(r.undatedCount, 1)
  assert.ok(r.periods.some((p) => p.salary === 1_500_000))
})
```

If Task 1 found the tested source's `native_amount` already net, change the `8.5` expectation to match that formula.

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec tsx --test tests/cash-inflow-adapter.test.ts`
Expected: FAIL. `getCashInflow` is not exported.

- [ ] **Step 3: Implement.** One union query, grouped in SQL:

```ts
export function getCashInflow(granularity: 'month' | 'year', display: DisplayCurrency): CashInflow {
  const conn = db()
  try {
    const len = granularity === 'month' ? 7 : 4
    const bankAmt = datedAmountSql(display, 'amount')
    const divAmt = datedAmountSql(display, NET_DIVIDEND_SQL)
    const hasBank = hasTable('bank_inflows')
    const bank = hasBank
      ? `select date, category, ${bankAmt} as amount, usd_krw_rate_dated as dated from bank_inflows where category != 'transfer'`
      : `select null as date, null as category, 0 as amount, 1 as dated where 0`
    const flows = `${bank}
      union all
      select date,
        case income_category when 'dividend' then 'dividend' when 'interest' then 'interest' else 'other' end,
        ${divAmt}, usd_krw_rate_dated
      from dividends where upper(coalesce(type, '')) not in ('SHARE_REWARD', 'STAKING_REWARD')`
    const periods = conn.prepare(
      `select substr(date, 1, ${len}) as period,
        ${['salary', 'dividend', 'interest', 'other', 'unclassified'].map((c) => `coalesce(sum(case when category = '${c}' then amount end), 0) as ${c}`).join(',\n')}
       from (${flows}) group by period order by period`
    ).all() as Omit<CashInflowPeriod, 'total'>[]
    // totals: compute from a month-grained run of the same query (trailing 12 months, YTD), plus counts:
    // unclassifiedCount from bank_inflows, undatedCount = rows in (flows) with dated = 0.
    // ...
  } finally {
    conn.close()
  }
}
```

Write the totals out in full: run the month-grained query once, and slice the last 12 months and the current year in TypeScript. `hasTable` is the existing helper this file uses for `historical_fx_rates`; reuse it as it is called there. `getCashInflowRows(period)` runs the same union filtered on `substr(date, 1, length(?)) = ?`, ordered by date. It returns the label (bank `description`, or dividend `coalesce(name, ticker)`), the account and the native amount, and includes `unclassified` rows so the user can see what to write a rule for.

- [ ] **Step 4: Run tests**

Run: `pnpm exec tsx --test tests/cash-inflow-adapter.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/adapters/portfolio-db.ts tests/cash-inflow-adapter.test.ts
git commit -m "feat(cash-inflow): sum salary, dividends, interest and other by month and year"
```

---

### Task 7: The `/cash-inflow` page and its menu entry

**Files:**
- Create: `app/cash-inflow/page.tsx`, `lib/ui-copy/pages/cashInflow.ts`
- Modify: `components/charts.tsx` (add `StackedBarChart`), `lib/ui-copy/pages/index.ts`, `lib/ui-copy/pages/sidebar.ts` (en and ko Core Workflows, after `/income`), `lib/page-names.ts` (`ROUTE_HREFS`), `tests/page-headings.test.ts` (`COPY_FOR`)
- Test: `tests/page-headings.test.ts`

**Interfaces:**
- Consumes: `getCashInflow`, `getCashInflowRows` (Task 6).
- Produces: route `/cash-inflow?view=month|year&detail=<period>`. `StackedBarChart({ data, xKey, series: { key, label, color }[], height?, yAxisPrefix?, yAxisSuffix?, yAxisLabel? })`.

- [ ] **Step 1: Register the route and copy, and see the heading test fail.** Add `'/cash-inflow': 'cashInflow'` to `COPY_FOR` in `tests/page-headings.test.ts` and `'/cash-inflow'` to `ROUTE_HREFS` after `'/income'`.

Run: `pnpm exec tsx --test tests/page-headings.test.ts`
Expected: FAIL. There is no sidebar label or copy for `/cash-inflow`.

- [ ] **Step 2: Add the copy and the sidebar entry.** Sidebar en: `{ href: '/cash-inflow', label: 'Cash Inflow' }`, ko: `{ href: '/cash-inflow', label: '현금 유입' }`, both right after the `/income` item. `lib/ui-copy/pages/cashInflow.ts`:

```ts
import { defineCopy } from '@/lib/ui-copy/define'

export const cashInflow = defineCopy({
  en: {
    title: 'Cash Inflow', emphasis: 'Inflow',
    subtitle: 'New money that arrived: salary, dividends net of withholding, interest and other credits, at the rate of the day each arrived.',
    monthly: 'Monthly', yearly: 'Yearly',
    trailing12m: 'Last 12 months', ytd: 'Year to date', monthlyAverage: 'Monthly average', salaryShare: 'Salary share',
    trailing12mInfo: 'Salary, dividends, interest and other credits over the last twelve months. Unclassified credits and transfers between your own accounts are not included.',
    categories: { salary: 'Salary', dividend: 'Dividends', interest: 'Interest', other: 'Other', unclassified: 'Unclassified' },
    trendCard: 'Inflow by period', tableCard: 'Periods', detailCard: (period: string) => `Inflows in ${period}`,
    unclassified: (count: string) => `${count} unclassified credit(s)`,
    unclassifiedHint: 'Not in the totals. Add a bankInflowRules entry in manual-mappings.json to classify one.',
    undated: (count: string) => `${count} row(s) at today's rate`,
    noBankData: 'No bank statements on file: showing dividends and interest only.',
    chartNote: 'Each credit converted at the USD/KRW rate of the day it arrived.',
    axisKrw: 'KRW thousand', axisUsd: 'USD',
    columns: { period: 'Period', total: 'Total', date: 'Date', category: 'Category', label: 'Description', account: 'Account', native: 'Native', amount: 'Amount' },
  },
  ko: {
    title: '현금 유입', emphasis: '유입',
    subtitle: '새로 들어온 돈입니다. 급여, 원천징수 후 배당, 이자, 기타 입금을 입금일 환율로 환산했습니다.',
    monthly: '월간', yearly: '연간',
    trailing12m: '최근 12개월', ytd: '연초 이후', monthlyAverage: '월평균', salaryShare: '급여 비중',
    trailing12mInfo: '최근 12개월의 급여, 배당, 이자, 기타 입금입니다. 미분류 입금과 내 계좌 간 이체는 포함하지 않습니다.',
    categories: { salary: '급여', dividend: '배당', interest: '이자', other: '기타', unclassified: '미분류' },
    trendCard: '기간별 유입', tableCard: '기간별 합계', detailCard: (period: string) => `${period} 입금 내역`,
    unclassified: (count: string) => `미분류 입금 ${count}건`,
    unclassifiedHint: '합계에 포함되지 않습니다. manual-mappings.json의 bankInflowRules에 규칙을 추가하면 분류됩니다.',
    undated: (count: string) => `오늘 환율 적용 ${count}건`,
    noBankData: '은행 거래내역이 없어 배당과 이자만 표시합니다.',
    chartNote: '각 입금을 입금일의 원/달러 환율로 환산했습니다.',
    axisKrw: '천 원', axisUsd: '달러',
    columns: { period: '기간', total: '합계', date: '날짜', category: '분류', label: '내용', account: '계좌', native: '원 통화 금액', amount: '금액' },
  },
})
```

Register `cashInflow` in `lib/ui-copy/pages/index.ts` the way `income` is. Rerun Step 1's test and expect PASS.

- [ ] **Step 3: Add `StackedBarChart`** to `components/charts.tsx`, using the same recharts imports, `AXIS` tick style and grid as `TrendBarChart`. Render one `<Bar dataKey={s.key} stackId="a" fill={s.color} name={s.label} />` per series, plus a `<Legend />` and a `<Tooltip />`. Category colors: salary `var(--brand-blue)`, dividend `var(--accent-success)`, interest `var(--accent-warning)`, other `var(--ink-3)`. If a token is missing, look in `styles/` for the existing token names. `unclassified` is not a bar, because it is not in the total.

- [ ] **Step 4: Write the page.** Follow `app/income/page.tsx` for structure (`PageHeader`, `CardRow`, `MetricHeroCard`, `KpiBand`, `MetricField`, `DataTable`, `Badge`) and for `export const dynamic = 'force-dynamic'` and `generateMetadata = routeMetadata('/cash-inflow')`. In order:
  - Read `searchParams.view` (`'year'` → yearly, anything else → monthly) and `searchParams.detail`. Call `getCashInflow(view, displayCurrency)`.
  - `PageHeader` with an `action` that is two `Button`s, `?view=month` and `?view=year`, with the current one `variant="solid"`.
  - Badges: `unclassified(count)` in warning tone, with `unclassifiedHint` as its title, when the count is over 0. `undated(count)` in warning tone when it is over 0.
  - `noBankData` note when `!hasBankData`.
  - Hero: `trailing12m` with a `KpiBand` of `ytd`, `monthlyAverage`, `salaryShare` (via `fmtPct`). Format all money with `money(value, data.currency)`, so it is not converted again.
  - The `StackedBarChart` of the last 24 months (monthly) or all years (yearly). Divide by 1000 for KRW, as `/income` does, and set `chartNote` under it.
  - A `DataTable` of periods, newest first. Columns: period (a `Link` to `?view=…&detail=<period>`), each category, then total.
  - When `detail` is set: a card `detailCard(period)` with a `DataTable` of `getCashInflowRows(detail, displayCurrency)`.

- [ ] **Step 5: Run checks**

Run: `pnpm exec tsx --test tests/page-headings.test.ts && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 6: Verify in the browser.** Seed with `node scripts/seed-sample.mjs` if the worktree has no DB, and add sample `bank_inflows` rows and rate columns to `seed-sample.mjs` so the page has something to show. Then `preview_start`, and on `/cash-inflow`:
  - monthly and yearly toggle
  - KRW and USD display (the axis prefix follows; values do not jump)
  - a detail link
  - stocks and all-assets views (the page does not change)
  - a 375px width (no horizontal scroll)
  - dark mode

  Check `read_console_messages` for errors and take screenshots.

- [ ] **Step 7: Commit**

```bash
git add app/cash-inflow components/charts.tsx lib/ui-copy lib/page-names.ts tests/page-headings.test.ts scripts/seed-sample.mjs
git commit -m "feat(cash-inflow): monthly and yearly view of salary, dividends, interest and other"
```

---

### Task 8: Docs, review, and rollout

**Files:**
- Modify: `docs/data-sources.md` (new "Bank inflows" subsection after "Accounts no statement covers"; a "Dated FX for income" note next to the Korean-statement USD dividend explanation)

- [ ] **Step 1: Document.** Cover: what `inflows` holds and which rows are marked `ownTransfer`; the classification order from Task 5; the `bankInflowRules` format; the duplicate rule and `BROKERAGE_CASH_INSTITUTIONS`; and that USD own-account transfers are not paired and show as unclassified until a `transfer` rule covers them. Also note the known gap that a 예적금 payout's interest is counted as part of the transfer, not as 이자. For the FX rule, document `usd_krw_rate`, the fallback to today's rate, and the `income_fx_dated` check. Use no real names.

- [ ] **Step 2: Full check**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: all PASS.

- [ ] **Step 3: Whole-branch review.** Use `superpowers:requesting-code-review`, and go through the Review Focus list above line by line.

- [ ] **Step 4: Commit, push, open the PR.** The PR body describes behavior with invented examples only. Then bind the PR with the ccd_pr tools.

- [ ] **Step 5: Rollout (needs the user's yes for each command).** After merge, propose to the user, without running anything yet:
  1. Pull and redeploy on `ops-host`. Follow memory `redeploy-blocked-by-refresh` if `make redeploy` stops on an unrelated check.
  2. A refresh, so `bank-balances.json` gains `inflows` and the DB gains the new columns.
  3. Writing the real `bankInflowRules` into `ops-host`'s `data/manual-mappings.json`. The user supplies the employer strings. Claude does not write them into any tracked file.

  Then read `/cash-inflow` and the `bank_inflows_classified` check on prod, and report the unclassified count and the change in the `/income` totals.

- [ ] **Step 6: Finish the branch** with `superpowers:finishing-a-development-branch`.
