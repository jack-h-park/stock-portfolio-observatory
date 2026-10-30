# US Tax-Reporting Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the unmerged `/realized` page's seven-column CSV into a private, year-scoped tax worksheet download (18 columns plus a notes file) that states what it does not cover.

**Architecture:** A pure module `lib/tax-export.ts` turns `RealizedLotView` rows into the CSV text, a summary and the notes text. Two read-only route handlers under `app/realized/export/` call it; the page gets a small export block. The adapter learns to return the extra stored columns and, on request, superseded rows.

**Tech Stack:** Next.js app router, better-sqlite3 (read-only), `node:test` run through `tsx --test`, TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-28-tax-reporting-export-design.md`

## Global Constraints

- Repo text, the CSV and the notes file are English only; page strings go in `lib/ui-copy/pages/realized.ts` in both languages as that file already does.
- The app is read-only: database opened `readonly: true`, no writes, no network, no analytics.
- CSV: UTF-8, CRLF, no BOM, one header row, no comment or preamble lines.
- Response headers: `content-type: text/csv; charset=utf-8` (notes: `text/plain; charset=utf-8`), `content-disposition: attachment; filename="tax-realized-<year>.csv"` (`-audit.csv` with audit; notes `tax-realized-<year>-notes.txt`), `cache-control: no-store`, `x-content-type-options: nosniff`. `<year>` is the resolved year or `all-years`.
- File never contains: the stored `account` string or any part of it, file paths, the database path, hashes.
- Unknown dollar figure, box or term is blank, never zero.
- Old databases (no `owner`, `superseded_by`, `form_8949_box`, `covered_status`, `asset_class`, `realized_lots_all`) must not throw.
- Fixtures use invented tickers, brokers and accounts only (see `tests/cli-fixture.ts`).
- Year means sale date in a calendar year; the "current year" is `todayLosAngeles().slice(0, 4)` from `lib/cli/common`.

## Review Focus

- A year with no sales: header-only CSV, notes say 0 rows, no crash (Task 3, Task 4).
- A text cell that starts with `=`, `+`, `-` or `@` (ticker or name): must not run as a spreadsheet formula (Task 2).
- More than 26 accounts: aliases continue `AA`, `AB`, … rather than repeating (Task 2).
- `year=abc` or a year with no sales in the query: falls back to the default year, and the file name shows the year actually used (Task 4).
- A lot with null `brokerage`: exported as `Unknown`, aliased like any other (Task 2).
- A database without the extra columns: export works with blank box/covered (Task 1, Task 4).
- A lot with a null `sold_date` under `all-years`: row kept with a blank sold date, excluded from any single year (Task 2).

## Delivery

Task 1 is its own PR (the unmerged page branch plus the owner fix). Tasks 2-5 are a second PR stacked on it. Gold is a third PR after #253 merges and is **not** in this plan; Task 2's row model already carries `asset_class` and `collectible` so that PR only extends the query and the notes line.

---

### Task 1: Land the page branch and make the adapter owner-safe

**Files:**
- Modify: `lib/adapters/portfolio-db.ts` (`getRealizedLots`)
- Modify: `lib/realized-lots.ts` (`RealizedLotRow`)
- Test: `tests/realized-lots-adapter.test.ts` (create)

**Interfaces:**
- Consumes: branch `worktree-realized-lots-page` (commit `f153cb3`) as the base; `selfOnlyAnd(conn, table)` and `STOCK_ROW_SQL` already exported by `lib/adapters/portfolio-db.ts`.
- Produces:
  - `RealizedLotRow` gains `asset_class: string | null`, `form_8949_box: string | null`, `covered_status: string | null`, `superseded_by: string | null` (null where the database has no such column).
  - `getRealizedLots(options?: { includeSuperseded?: boolean }): RealizedLotView[]` — default behaviour unchanged except it now returns only `owner = 'self'` rows.
  - `getIngestedAt(): string | null` — the `ingested_at` meta value (reuse an existing meta reader if the adapter has one).

- [ ] **Step 1: Rebase the working branch.** Create `claude/tax-export` from `worktree-realized-lots-page`, rebase onto `origin/main`, run `pnpm test` and `pnpm typecheck`; both must pass before any change (note any failure that predates this work and stop if it is not trivially unrelated).
- [ ] **Step 2: Write the failing tests** in `tests/realized-lots-adapter.test.ts`, building a scratch database the way `tests/default-view-regression.test.ts` does and pointing the adapter at it:
  - `getRealizedLots leaves out lots owned by someone else` — fixture has one `owner = 'self'` and one `owner = 'spouse'` row; result has one row, the self one.
  - `getRealizedLots skips superseded rows unless asked` — default returns the non-superseded row only; `{ includeSuperseded: true }` returns both and each row's `superseded_by` is set accordingly.
  - `getRealizedLots works on a table without the extra columns` — a minimal `realized_lots` with only the old columns: returns rows, new fields are `null`.
- [ ] **Step 3: Run** `pnpm exec tsx --test tests/realized-lots-adapter.test.ts`; expect the three tests FAIL.
- [ ] **Step 4: Implement** the adapter change: add the owner predicate via `selfOnlyAnd(conn, 'realized_lots')`, select the four new columns through the existing `col()` guard, and apply the superseded filter only when `includeSuperseded` is falsy. Add `getIngestedAt()` beside the other meta readers.
- [ ] **Step 5: Run** the new test file plus `pnpm test` and `pnpm typecheck`; expect PASS.
- [ ] **Step 6: Commit** the owner/columns change as `fix(realized): leave other owners' lots out of the closed-lot table` (separate from the branch's own commit). Open the PR for this branch; body explains the page and the owner fix, one line per paragraph.

---

### Task 2: The export builder (pure)

**Files:**
- Create: `lib/tax-export.ts`
- Test: `tests/tax-export.test.ts` (create)

**Interfaces:**
- Consumes: `RealizedLotView`, `ALL_YEARS`, `defaultSoldYear` from `lib/realized-lots`.
- Produces:
  - `TAX_EXPORT_HEADER: readonly string[]` — exactly: `description, date_acquired, date_sold, proceeds_usd, cost_basis_usd, gain_loss_usd, term, form_8949_box, covered, basis_source, row_status, asset_class, market, collectible, proceeds_rate_note, broker, account_alias, ticker`.
  - `selectTaxExportRows(rows: RealizedLotView[], opts: { year: string; audit: boolean }): RealizedLotView[]` — keeps rows whose `sold_year === year` (all rows for `ALL_YEARS`); drops rows with `superseded_by` set unless `audit`.
  - `taxExportCsv(rows: RealizedLotView[]): string` — header plus one line per row, CRLF-terminated.
  - `summarizeTaxExport(rows: RealizedLotView[]): TaxExportSummary` where `TaxExportSummary = { rows: number; blankDollar: number; superseded: number; byTerm: Record<'short' | 'long' | 'unknown', { count: number; gain_usd: number }> }`; superseded rows count only in `superseded`; rows missing a dollar figure count in `blankDollar` and not in `byTerm` gain.
  - `NOT_COVERED_LINES: readonly string[]` — the "what this export does not cover" sentences, one source for the notes and the page.
  - `taxExportNotes(summary: TaxExportSummary, ctx: { year: string; builtAt: string | null; audit: boolean }): string`.
  - `readExportParams(params: URLSearchParams, years: string[], currentYear: string): { year: string; audit: boolean }` — `audit` is true only for `audit=1`; an unknown or missing year resolves through `defaultSoldYear`.

- [ ] **Step 1: Write the failing tests** (`tests/tax-export.test.ts`, invented rows from a local `lot()` helper that builds a `RealizedLotView` via `toRealizedView`):
  - `header is the 18 columns in spec order` — deep-equals `TAX_EXPORT_HEADER` against the literal list above.
  - `a 1099b row exports its box, covered flag and basis source` — box `'A'`, `covered_status` stored as `'Covered'` → cells `A`, `covered`, `1099b`, `reported`.
  - `a replay row has a blank box and blank covered` .
  - `unknown dollar figures are blank, not zero` — `cost_usd: null` gives blank cost and blank gain.
  - `gain is proceeds minus cost` — 665000/1330 − 500 formatted to 2 places.
  - `description is quantity then ticker` — `0.5 AAA`.
  - `superseded rows appear only in audit and are marked` — `selectTaxExportRows(..., audit: false)` excludes; with `audit: true` the CSV row says `superseded`.
  - `aliases follow first appearance and are per file` — two accounts at one broker become `Broker A`, `Broker B`; the same account twice reuses its alias; a second call to `taxExportCsv` with the rows in reverse order assigns differently.
  - `aliases continue past 26 accounts` — 27th account is `Broker AA`.
  - `null broker is Unknown` .
  - `a ticker or description starting with = + - @ is neutralised` — cell is prefixed with `'`; numeric columns are not touched (a negative gain stays `-12.50`).
  - `cells with commas, quotes or newlines are quoted` .
  - `the body never contains a stored account string` — fixture accounts like `Invented 1234567890`; assert neither the full string nor `1234567890` appears in `taxExportCsv` or `taxExportNotes` output.
  - `summary totals leave out superseded rows and count blanks` — three rows (one superseded, one with a null cost) → `rows`, `blankDollar`, `superseded`, `byTerm` as computed by hand.
  - `readExportParams falls back for an unknown year and reads audit` — `year=abc` with `years = ['2026','2025']`, current `2026` → `2026`; `audit=1` true, `audit=yes` false; `year=all-years` kept.
  - `notes state the build date, the row counts and every NOT_COVERED_LINES entry`; with `builtAt: null` the notes say the build date is unknown.
- [ ] **Step 2: Run** `pnpm exec tsx --test tests/tax-export.test.ts`; expect FAIL (module missing).
- [ ] **Step 3: Implement `lib/tax-export.ts`** with the signatures above. Reuse the CSV cell escaping from `lib/realized-lots.ts` (export it from there rather than duplicating). `covered` maps stored text containing `noncovered`/`non-covered` (case-insensitive) to `noncovered`, containing `covered` to `covered`, anything else to blank. `collectible` is `true` iff the row's `collectible` field is true; `asset_class` is `crypto` when `market === 'CRYPTO'`, else the stored value, else `security`. `NOT_COVERED_LINES` carries the spec's "What the export does not cover" bullets verbatim, without the gold line (a later PR adds it).
- [ ] **Step 4: Run** the tests; expect PASS. Run `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(realized): build the tax worksheet rows, summary and notes`.

Task 2 also owns `collectible`: add `collectible: boolean | null` to `RealizedLotRow` (null where absent) with the Task 1 columns' null-guard pattern; no query change until the gold PR.

---

### Task 3: Export routes

**Files:**
- Modify: `app/realized/export/route.ts`
- Create: `app/realized/export/notes/route.ts`
- Test: `tests/tax-export-route.test.ts` (create)

**Interfaces:**
- Consumes: `getRealizedLots`, `getIngestedAt` (Task 1); `selectTaxExportRows`, `taxExportCsv`, `summarizeTaxExport`, `taxExportNotes`, `readExportParams` (Task 2); `todayLosAngeles` from `lib/cli/common`.
- Produces: `GET(request: Request): Promise<Response>` in both route files, both with `export const dynamic = 'force-dynamic'`.

- [ ] **Step 1: Write the failing tests** calling `GET(new Request('http://x/realized/export?...'))` against a scratch database (pattern from Task 1):
  - `the CSV ignores table filters` — fixture with two brokers; `?year=2026&brokerage=OnlyOne&term=Long-term&q=zzz` still returns every 2026 self row.
  - `the CSV leaves out other owners and superseded rows; audit adds superseded` .
  - `an unknown year uses the default year and names it in the file name` — `?year=abc` → `content-disposition` contains `tax-realized-2026.csv`.
  - `a year with no sales returns the header only` — body equals the header line plus CRLF; status 200.
  - `all-years names the file tax-realized-all-years.csv; audit adds -audit` .
  - `headers` — `content-type`, `cache-control: no-store`, `x-content-type-options: nosniff`, attachment disposition on both routes.
  - `the response bodies contain no stored account string` — fixture accounts with long digit runs; check CSV and notes bodies.
  - `the notes route reports the same row count as the CSV` .
  - `works on a database without the extra columns` — minimal `realized_lots`; 200, blank box.
- [ ] **Step 2: Run** the test file; expect FAIL.
- [ ] **Step 3: Implement both handlers.** Both read only `year` and `audit` from the URL (everything else ignored), load `getRealizedLots({ includeSuperseded: audit })`, compute `years` from the rows, resolve through `readExportParams(..., todayLosAngeles().slice(0, 4))`, and build the body from Task 2. The notes route passes `getIngestedAt()?.slice(0, 10) ?? null` as `builtAt`.
- [ ] **Step 4: Run** the tests, `pnpm test`, `pnpm typecheck`, `pnpm lint`; expect PASS.
- [ ] **Step 5: Commit** `feat(realized): year-scoped tax worksheet download and notes file`.

---

### Task 4: Page export block and copy

**Files:**
- Modify: `app/realized/page.tsx` (replace the export link and `exportHref` logic, switch the default year source to the LA helper)
- Modify: `lib/ui-copy/pages/realized.ts`
- Modify: `lib/realized-lots-query.ts` (default current year argument only if it is computed there; otherwise none)
- Test: `tests/realized-page-copy.test.ts` (create) or the existing `tests/page-headings.test.ts` if it already covers copy parity

**Interfaces:**
- Consumes: `NOT_COVERED_LINES` (Task 2), `todayLosAngeles` (`lib/cli/common`), the Task 3 route URLs.
- Produces: an export block on `/realized` with a year select (its own control, default = the table's year, values the year list plus `all-years`), an "Include superseded rows (audit)" checkbox, two links — CSV `/realized/export?year=<y>[&audit=1]` and notes `/realized/export/notes?year=<y>[&audit=1]` — the `NOT_COVERED_LINES` text, a row count and a blank-dollar count for the chosen year.

- [ ] **Step 1: Write the failing test** that the `realized` copy has the same keys in `en` and `ko` (follow how `tests/page-headings.test.ts` or the copy tests already assert parity) and that the new keys exist: `taxExport.title`, `taxExport.year`, `taxExport.audit`, `taxExport.csv`, `taxExport.notes`, `taxExport.filtersIgnored`, `taxExport.counts(rows, blank)`.
- [ ] **Step 2: Run** it; expect FAIL.
- [ ] **Step 3: Implement the copy** (English strings written by you; Korean translations in the `ko` block) and the page block. The block must say that the table's filters do not apply to the download. The block uses plain links built from the chosen year, so it needs no client script: the year select and audit checkbox submit as a GET form to the same page with `exportYear` and `exportAudit` params, and the links are rebuilt from them. Remove the old `exportHref` and the old `export`/`exportNote` strings once nothing uses them.
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`; expect PASS. Start the dev server with the project's preview configuration against the development-copy database, open `/realized`, and confirm: the block shows; the CSV link downloads a file whose first line is the 18-column header; the notes link downloads text that ends with the not-covered lines; a leftover table filter does not change the file. Say in the PR if the browser check could not be done.
- [ ] **Step 5: Commit** `feat(realized): tax export block with year, audit switch and coverage note`.

---

### Task 5: Docs

**Files:**
- Modify: `docs/data-sources.md` (the `realized_lots` section: add the export and its columns)
- Modify: `README.md` (one line where `/realized` is mentioned, if it is)

- [ ] **Step 1: Update the docs** to describe the download: scope (own lots only, year of sale in the US/Los Angeles calendar), the 18 columns by name, the superseded/audit behaviour, the privacy rules, and the notes file. No new claims beyond the spec.
- [ ] **Step 2: Run** `pnpm test` (doc-linting tests, if any), then open the second PR; the body says: stacked on the page PR, gold excluded until #253 merges, and what was and was not verified in the browser. One line per paragraph.
- [ ] **Step 3: Commit** `docs: describe the tax worksheet download`. Add a `Portfolio-Impact: none (<reason>)` trailer only if `portfolio-watched.py` shows a watched doc changed and the live page section was read.

---

## Self-review

- **Spec coverage:** scope/year/filters-ignored (Tasks 2, 3, 4); owner filter (Task 1); columns and header (Task 2); box never derived, covered, adjustments omitted (Task 2); superseded/audit (Tasks 1-3); privacy, aliases, file names, headers (Tasks 2-3); notes file and shared not-covered text (Tasks 2-4); page block (Task 4); old databases (Tasks 1, 3); delivery order and gold deferral (Delivery). The spec's "page strings both languages" is Task 4. Gold rows themselves, the notes' gold line and the `--csv` CLI option are deliberately out of this plan.
- **Calls added beyond the spec:** formula-injection prefixing for text cells (Task 2); the page uses the English `NOT_COVERED_LINES` text directly rather than a translation so the page and notes cannot drift.
- **Types:** `RealizedLotRow` additions (Task 1) and `collectible` (Task 2) are consumed by `taxExportCsv` and the routes under the same names.
