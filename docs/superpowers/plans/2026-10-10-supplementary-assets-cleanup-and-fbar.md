# Supplementary Assets: Cleanup, Total-Assets Trend, Freshness and FBAR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Treat deposits, pensions and gold as supplementary data, used only to see total assets. Concretely:
- their warnings leave the stock surfaces and the daily alerts;
- every "total assets" figure has one definition;
- a separate stacked total-assets trend chart is added;
- their freshness appears in the weekly reminder;
- an FBAR / Form 8938 maximum-balance table is added.

**Architecture:**
- Validation checks gain a `scope` (`stock` | `supplementary`). The badge, the printed validation line and the daily refresh alert read only the `stock` scope.
- A pure `totalAssetsSeries` in `lib/net-worth.ts` is the single definition of total assets by date. Both the new Overview chart and `/net-worth` use it.
- The existing Overview trend chart goes back to stock-only.
- A `supplementaryCoverage` block, freshness only and no amounts, feeds the weekly reminder.
- The FBAR table is computed from data already in the DB, plus a tracked Treasury reporting-rate file.

**Tech Stack:** Node 24 ESM scripts, better-sqlite3, Next.js 15 / React server components, recharts 2, TypeScript, `node --test` with tsx.

**Spec:** `docs/superpowers/specs/2026-10-09-net-worth-and-pension-design.md`, as amended by the structure review (2026-10-10) and the maintainer's decisions:
- (1) build the FBAR table;
- (2) include pensions and gold in the total-assets trend;
- (3) no net-worth data in the briefing summary;
- (4) supplementary warnings go to the weekly reminder only, never to the daily alert.

Task 5 writes these amendments into the spec.

## Global Constraints

- The repository is PUBLIC. No real account number, balance, name or holding may appear in code, tests, fixtures, docs, commits or PR text. Invent fixtures.
- Repo text is English. Korean appears only in the `ko` UI copy objects and as matched data.
- Use `/usr/bin/grep -a`, never bare `grep`.
- Run tests on Node 24: `PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH pnpm test`, plus `pnpm typecheck`, and `pnpm build` for UI tasks.
- A fresh worktree needs `pnpm install --frozen-lockfile`. Then copy `better_sqlite3.node` from the main checkout's `node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/build/Release/`.
- **Stocks mode stays stock-centric.** Every Stocks-mode figure is unchanged, except the badge count, which drops supplementary warnings. `tests/default-view-regression.test.ts` must keep passing.
- **Principles from the review:**
  - R1: stock surfaces are unaffected by supplementary data.
  - R2: supplementary data appears only in total-assets contexts, with one definition.
  - R3: always with its as-of date.
  - R4: low upkeep (long cadences, no analytics).
  - R5: nothing supplementary leaves the app. Sheets, briefing and trading review stay stock-only; the summary may carry freshness metadata for the reminder, never amounts.
- **Cadences:** deposit, CMA and gold statement 90 days; pension snapshot 180 days; gold price 7 days.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit with explicit paths.

## Review Focus

1. **Badge and alert.** A supplementary warning (e.g. `gold_priced` failing) must not change the Overview badge, the printed `Validation: X/Y` line, or the refresh cron's alert. It must appear in the weekly reminder. Owned by Tasks 1 and 3.
2. **One total.** For the latest date, the stacked chart's total must equal the Total assets card. A test asserts it. Owned by Task 2.
3. **Before a class's data starts** (pension before its first certificate, gold before its first purchase or before the price history), the class contributes nothing on that date. The chart notes where each class starts. It is never drawn as 0 mid-series, and never interpolated. Owned by Task 2.
4. **FBAR completeness.** An account whose year has gaps (only month-end or year-end points, or the history starts mid-year) is flagged "maximum may be understated". It is never shown as complete. US accounts are excluded. Owned by Task 4.
5. **Stocks mode is byte-identical** apart from the badge count. The reverted Overview stock chart matches what it was before #198. Owned by Tasks 1 and 2.

---

### Task 1: Check scope, and supplementary data off the stock surfaces

**Files:**
- `scripts/ingest-stock-data.mjs`: `check()`, `validation_checks` DDL, the printed validation lines.
- `lib/adapters/portfolio-db.ts`: `failedChecks`, `getValidationChecks`, `getTaxPlanningLots`.
- `scripts/write-briefing-summary.ts`: `health.issues`.
- `deploy/hermes/observatory-refresh-cron.sh`: verify only; it parses the stock line.
- `app/tax-planning/page.tsx`, `app/tax-settings/page.tsx`: replace `WrapperReviewCard` with a one-line link.
- `app/health/page.tsx`: label the scope.
- `lib/ui-copy/pages/sidebar.ts`, `components/Sidebar.tsx`, `app/layout.tsx`: a new "All assets" section.
- `app/net-worth/page.tsx`, `app/pension/page.tsx`: display currency.
- Tests: new `tests/check-scope.test.ts`, plus extensions where noted.

**Interfaces:**
- **Produces:** `check(name, ok, detail, severity = 'error', scope = 'stock')`, and `validation_checks.scope text not null default 'stock'`.
  - Scope `supplementary` applies to: `cash_balances_readable`, `cash_balance_continuity`, `cash_anchor_present`, `cash_statements_parsed`, `pension_trades_after_snapshot`, `pension_etf_unpriced`, `pension_snapshot_matches_year_end`, `gold_priced`, `us_wrapper_treatment_decided`, and any check Task 3 adds for supplementary data.
  - `wrapper_assigned` and `non_stock_wrappers_absent` stay `stock`, because they guard the stock view.
- **Printed lines:**
  - `Validation: <passing>/<total> checks passing`, counting `stock` scope only. The cron greps this line.
  - Then a new line, `Supplementary: <passing>/<total> checks passing`.
  - The exit code is unchanged: any failing `error` check in either scope. There are no supplementary errors today.
- **`getOverview().failedChecks`:** counts failing `stock` checks only.
- **`getValidationChecks()`:** rows gain `scope`. Reading an older DB without the column defaults to `stock`.
- **Summary `health.issues`:** excludes `validation:<name>` for supplementary checks, and excludes the `source:bank_balances` drift item. These go to Task 3's block instead.
- **Sidebar:**
  - A section `All assets` / `전체 자산` holds `/net-worth` and `/pension`, removed from Core Workflows and Tax. It sits after Detailed Records and before Operations & Data.
  - It is hidden when the DB has no supplementary data: no `cash_balances` rows, and no non-stock rows in `holdings_all`. Use a cheap adapter call, `hasSupplementaryAssets(): boolean`, in `app/layout.tsx`.
- **`getTaxPlanningLots`:** `isa` lots follow `wrapperTreatment(policy,'US','isa')`, like the pension wrappers. The default `taxable` keeps today's lots. Test: `isa: 'undecided'` removes ISA lots.
- **Tax pages:** in place of the card, one line, `"<n> pension account(s) are outside the US estimate — see Pension"` (`ko`: `"연금 계좌 <n>개는 미국 세금 추정에서 제외 → 연금 페이지"`), linking to `/pension`. Hidden when n = 0.
- **`/net-worth` and `/pension`:** format money with the display-currency formatter used by the Overview (`createMoneyFormatter(currencyPreferences)`).

- [ ] **Step 1: Failing tests.**
  - An ingest fixture where `gold_priced` fails (gold inputs without a price file; reuse `tests/pension-fixtures.ts`). Assert:
    - its row has `scope = 'supplementary'`;
    - the stdout `Validation:` line equals the line from the same fixture without gold;
    - a `Supplementary:` line is printed;
    - `getOverview().failedChecks` is unchanged.
  - `getTaxPlanningLots` with `isa: 'undecided'` excludes ISA lots.
  - `hasSupplementaryAssets()` returns false on a stock-only fixture DB and true with one `cash_balances` row.
- [ ] **Step 2: Run, verify FAIL. Step 3: Implement. Step 4: Run, verify PASS, then the full suite, typecheck and build.**
- [ ] **Step 5: Commit** (`feat(checks): supplementary scope; supplementary data off the stock surfaces`).

---

### Task 2: One total-assets definition, a stacked trend chart, the stock chart reverted

**Files:**
- `lib/net-worth.ts`: `totalAssetsSeries`.
- `lib/adapters/portfolio-db.ts`: `getTotalAssetsSeries`, `getNetWorth` as-of notes, `getAccountDataRanges` asset-type column.
- `components/charts.tsx`: a new `StackedAssetChart`.
- `app/page.tsx`: revert the deposits merge and the `deposits` scope; add the new card in All-assets mode.
- `app/net-worth/page.tsx`: the chart, plus a month-end table with a total column.
- `app/accounts/page.tsx`: asset-type column.
- `scripts/ingest-stock-data.mjs`: stable pension fund ids.
- `scripts/fetch-gold-price.mjs`: accumulate history.
- Copy files.
- Tests: `tests/net-worth.test.ts` (extend), `tests/total-assets.test.ts` (new), and the gold price tests.

**Interfaces:**
- **Produces:**

```ts
export type AssetClassKey = 'stocks' | 'crypto' | 'cash' | 'pensions' | 'gold'
export type TotalAssetsPoint = { date: string; stocks: number | null; crypto: number | null; cash: number | null; pensions: number | null; gold: number | null; total: number }
export type TotalAssetsSeries = { points: TotalAssetsPoint[]; startsOn: Partial<Record<AssetClassKey, string>> }
export function totalAssetsSeries(input: {
  dates: string[]
  stocks: Record<string, number | null>          // KR+US base market value per date (portfolio_snapshots)
  crypto: Record<string, number | null>          // crypto_market_value_base per date
  cash: Record<string, number | null>            // depositsSeries totals per date
  pensionPoints: { date: string; account: string; valueKrw: number }[]   // year-end certificate totals, snapshot totals
  gold: { buys: { date: string; grams: number; costKrw: number }[]; prices: { date: string; price: number }[] }
}): TotalAssetsSeries
```

- **Rules:**
  - **Pensions:** per account, the value on a date is that of the latest point on or before it (a step), and nothing before the first point.
  - **Gold:** grams held on a date are the purchases on or before it. The value is grams × the latest price on or before the date. Without a price on or before the date, it is valued at cost on that date (cost of the grams held), and `startsOn.gold` still marks the first purchase.
  - **Total:** the sum of the non-null classes.
  - **`startsOn`:** each class's first non-null date.
- `getTotalAssetsSeries(dates: string[]): TotalAssetsSeries` is built from `portfolio_snapshots`, `getDepositsSeries`, `pension-evidence` (the year-end totals; the adapter reads the stored certificate totals the ingest writes, so add a `pension_points` table in the ingest if the evidence is not in the DB), the pension snapshot totals from `holdings_all`, gold BUY rows from `transactions_all`, and gold price history.
- **Latest point:** append today's date, using the current `getNetWorth()` classes, so the last point equals the Total assets card.
- **`StackedAssetChart({ points, startsOn, currency })`:** a recharts `AreaChart`, one stacked `Area` per class (stocks, crypto, cash, pensions, gold) in fixed colours with tokens from the theme, and a tooltip showing every class plus the total. Follow `PortfolioMultiTrendChart`'s conventions.
- **Overview, All-assets mode only:** a new card "Total assets trend" (`ko` `자산 현황 추이`) right after the stock trend card, with the same range buttons. A note under it lists `startsOn` per class and says pensions move only on certificate and snapshot dates.
- **Overview stock trend chart:** revert exactly to its pre-#198 behaviour in BOTH modes. Remove the `deposits` scope, the deposits merge into `global`, and the "Deposits included from" note. A `?scope=deposits` URL falls back to `global`. `depositsSeries` and `getDepositsSeries` stay; they now feed `totalAssetsSeries`.
- **`/net-worth`:** the same chart above the balances. The month-end table becomes Month, Stocks, Crypto, Cash, Pensions, Gold and Total, built from `totalAssetsSeries` over month-end dates (from `portfolio_snapshots`), not over cash dates.
- **`getNetWorth().asOfNotes`:** gains `{ assetClass: AssetClassKey; label: string; asOf: string }`. It includes the cash class with its OLDEST latest balance date across accounts. The Total assets card shows the notes per class next to each amount.
- **`getAccountDataRanges` rows:** gain `assetType: 'stock' | 'pension' | 'gold' | 'cash'`. `/accounts` shows it as a column (`ko` `자산 종류`).
- **Stable pension ids:** a fund's ticker is `PENSION:<token>:<slug>`, where `<slug>` is the first 10 hex characters of sha1 of the NFC-normalised, whitespace-collapsed name. Cash is `PENSION:<token>:cash:<slug>`. Update the readers that parse kinds (`kindOf`, the PFIC query).
- **Gold price history:** `fetch-gold-price.mjs` MERGES fetched history into the existing file, de-duplicating by date, so history accumulates. On the first run, or when the file's oldest date is after the earliest gold purchase, it pages backwards (`page=2,3,…`, `pageSize` ≥ 10) until it covers that date or 400 days.

- [ ] **Step 1: Failing tests:**
  - `totalAssetsSeries` covering a pension step, nothing before the first point, gold grams × the price on or before the date, gold at cost when no price, total = the sum of non-null classes, and `startsOn`;
  - the adapter's last point equals the `getNetWorth()` total;
  - the Overview stock trend, through a data-level test of the page's helpers, no longer adds deposits to global;
  - stable ids survive reordering the snapshot rows;
  - the gold history merge de-duplicates.
- [ ] **Step 2: Run, verify FAIL. Step 3: Implement. Step 4: Run, verify PASS, then the full suite, typecheck and build.**
- [ ] **Step 5: Commit** (`feat(net-worth): one total-assets series, a stacked trend chart; the stock chart is stock-only again`).

---

### Task 3: Supplementary freshness in the weekly reminder

**Files:**
- `lib/adapters/portfolio-db.ts`: `getSupplementaryCoverage`.
- `scripts/write-briefing-summary.ts`: `supplementaryCoverage` block.
- `scripts/coverage-reminder.mjs`: a supplementary section.
- `scripts/ingest-stock-data.mjs`: the `gold_price_fresh` check; `source_files` registration.
- `lib/adapters/portfolio-db.ts`: `retentionFor` and `inventoryCandidate`.
- Tests: `tests/coverage-reminder.test.mjs`, `tests/supplementary-coverage.test.ts` (new).

**Interfaces:**
- **`getSupplementaryCoverage()`** returns `{ rows: { kind: 'deposit'|'cma'|'pension'|'gold'|'gold_price'; label: string; latestDate: string|null; lagDays: number|null; maxLagDays: number; status: 'current'|'due_soon'|'action_needed'|'missing'; action: string }[]; failingChecks: string[] }`. Rows:
  - **Cash accounts:** one per `cash_balances` (institution, account), with `latestDate` = its last `as_of_date`. 90 days, kind `cma` for kind cma, otherwise `deposit`. Action: `ko` `<label> 거래내역을 <latestDate>부터 받아 inbox에 넣으세요`.
  - **Pensions:** one per `pensionAccounts` token, with `latestDate` = its snapshot date (`holdings_all.as_of_date` for that wrapper/account). 180 days. Action: `ko` `<label> 보유 현황을 캡처해 pension/<token>-holdings-YYYYMMDD.csv로 넣으세요`.
  - **Gold:** `latestDate` = the latest gold transaction date (90 days, ask for a new 금현물 certificate). Also `gold_price` = the price date (7 days).
  - **Status:** the same thresholds as `coverageStatus`.
  - **`failingChecks`:** the names of failing `supplementary` checks.
- **Summary:** a `supplementaryCoverage` block with the same shape. No amounts: dates, labels and status only.
- **Reminder:** after the stock items, a "보조 자산" section, printed only when any row is not `current` or any check fails. One line per row, plus one line listing the failing checks. Silent otherwise.
- **`gold_price_fresh` check:** scope `supplementary`, warning. It fails when the gold price date is more than 7 days old and a gold holding exists.
- **`source_files`:** register the pension CSVs, `pension-evidence.json` and `gold-prices.json`, so drift is fingerprinted. Mark them supplementary so Task 1's summary filter excludes their drift items from `health.issues`.
- **`/data-map`:** add retention rules for `bank-statements/`, `pension/` and `pension/evidence/`, matching the `kr-statements` treatment, and add `.xls` to `inventoryCandidate`.

- [ ] **Step 1: Failing tests:**
  - a reminder with one stale deposit row and one failing supplementary check prints the section; an all-current doc prints none;
  - the adapter rows on a fixture DB;
  - `gold_price_fresh` fails for an 8-day-old price;
  - the summary block carries no numeric amount fields.
- [ ] **Step 2–4:** as usual, plus the full suite.
- [ ] **Step 5: Commit** (`feat(coverage): supplementary freshness in the weekly reminder`).

---

### Task 4: FBAR / Form 8938 maximum-balance table

**Files:**
- `data/treasury-reporting-rates.json` (new, TRACKED).
- `lib/fbar.ts` (new, pure).
- `lib/adapters/portfolio-db.ts`: `getForeignAccountMaxima(year)`.
- `app/net-worth/page.tsx`: a section with a year selector (a `?fbarYear=` search param).
- Copy files.
- Tests: `tests/fbar.test.ts`.

**Interfaces:**
- **`data/treasury-reporting-rates.json`:** `{ "source": "<URL of the U.S. Treasury Reporting Rates of Exchange dataset>", "retrieved": "YYYY-MM-DD", "rates": [{ "year": 2024, "date": "2024-12-31", "krwPerUsd": <number> }] }`, for 2020 through the last complete year.
  - Fetch the values from the public Treasury Fiscal Data API (`rates_of_exchange`, `country_currency_desc` Korea-Won, `record_date` 12-31). Record the exact query URL in `source`.
  - These are public figures, not personal data.
- **Foreign accounts:** everything NOT held at a US institution. The US institutions are cash `chase`, `boa`, `robinhood-bank` and `fidelity`, and brokerages Robinhood, Fidelity, Chase, Merrill and the US market. Concretely:
  - KR-market brokerage accounts (`holdings_all`/`tax_lots_all`, `market='KR'`, stock wrappers), per account;
  - pension accounts;
  - the gold account;
  - KR cash accounts (`mg`, `tossbank`, `mirae` cma, `hana` USD).
- **`lib/fbar.ts`:** `maxBalance(points: { date: string; valueKrw: number }[], year: number) → { maxKrw, date, coverage: 'daily'|'month_end'|'year_end'|'partial' }`. Coverage is:
  - `daily` when the points are daily-continuous through the year (cash with carry-forward from the start of the year);
  - `month_end` when built from month-end values;
  - `year_end` when only certificate or snapshot points;
  - `partial` when the history starts after 1 January or ends before 31 December.
- **Per kind:**
  - **Cash:** daily balances carried forward.
  - **KR brokerage:** month-end values per account, from the same reconstruction `scripts/backfill-portfolio-history.mjs` uses (lots open at month end × historical price). Reuse its function or extract one. Coverage `month_end`.
  - **Pensions:** certificate and snapshot points (`year_end`).
  - **Gold:** daily grams × price where price history exists, else at cost (coverage `partial`).
- **`getForeignAccountMaxima(year)`** returns `{ year, rate: { krwPerUsd, date } | null, rows: { account, kind, maxKrw, maxDate, maxUsd: number|null, coverage, understated: boolean }[], aggregateMaxUsd }`.
  - `understated = coverage !== 'daily'`.
  - `maxUsd` = `maxKrw / krwPerUsd`, using the Treasury year-end rate as the FBAR instructions direct.
- **UI:** a section "Foreign account maximum balances (FBAR / Form 8938)" on `/net-worth`:
  - a year selector, defaulting to the last complete year;
  - a table with an "understated" badge on non-daily rows;
  - the aggregate;
  - a note quoting no thresholds as advice: "Reference figures for preparing FBAR and Form 8938; filing thresholds depend on filing status — confirm with your preparer."
  - If the year's rate is missing, show KRW only and say so.

- [ ] **Step 1: Failing tests:**
  - `maxBalance`: the daily max and its date; month-end coverage; partial-year detection;
  - the adapter excludes US institutions;
  - the USD conversion uses the Treasury rate;
  - a missing rate gives `maxUsd` null.
- [ ] **Step 2–4:** as usual, plus the full suite, typecheck and build.
- [ ] **Step 5: Commit** (`feat(fbar): foreign account maximum balances by year`).

---

### Task 5: Docs and spec amendments

**Files:** `docs/superpowers/specs/2026-10-09-net-worth-and-pension-design.md`, `README.md`, `docs/ui-guide.md`, `docs/data-sources.md`, and the UI audit scripts (`scripts/snap-ui.mjs`, `scripts/a11y-audit.mjs`, `scripts/mobile-audit.mjs`).

- **Spec.** Add an "Amendments (2026-10-10)" section recording:
  - the supplementary-data principle (R1–R5);
  - the decisions: no `netWorth` block in the briefing summary (remove that promise); the Overview headline stays the stock total, and no pension positions appear in Holdings (remove those two promises); pensions and gold are in the total-assets trend; the FBAR table is built; supplementary warnings go to the weekly reminder only;
  - the switch lives in the sidebar.
- **README:** one "Supplementary assets" paragraph covering what the switch does, where `/net-worth` and `/pension` are, and that they are excluded from sheets and the briefing.
- **`docs/ui-guide.md`:** the All assets section and the stacked chart.
- **`docs/data-sources.md`:** the `scope` on checks, `treasury-reporting-rates.json`, and the supplementary cadences.
- **Audit scripts:** add `/pension` and `/net-worth`. Add one pass with the `stock-observatory-asset-view=all` cookie on `/`.
- [ ] **Commit** (`docs: supplementary-assets principle, decisions and audit coverage`).

---

## After the tasks (controller)

1. Run a final whole-branch review on the most capable model.
2. Open the PR, wait for CI to go green, then merge.
3. Run `make redeploy` on the ops host. Then check:
   - the badge count and the `Validation:` line no longer include supplementary checks;
   - the new chart's last total equals the Total assets card;
   - the FBAR table renders for the last complete year;
   - Stocks mode is unchanged.
