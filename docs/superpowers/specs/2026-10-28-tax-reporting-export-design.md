# US tax-reporting export from the web console

Date: 2026-10-28. Status: draft for review. Repo text is English only.

## Intent

The owner wants to download US tax-reporting data from the Observatory console, not only read it with `pnpm tax:realized`: realized gains as Form 8949-style rows, with the fields Schedule D needs, across US securities, Korea-account lots measured in dollars, crypto and physical gold.

Who will use the file is not decided. The design therefore treats the CSV as a **reference worksheet** (hand to a preparer, reconcile against a 1099-B, or copy rows by hand), not as a file for import into tax software and not as a filing document. Every choice below that depends on that is marked "(call)".

## Starting point: what already exists

Local branch `worktree-realized-lots-page` (commit `f153cb3`, not pushed, no PR as of 2026-10-28; based on `505fcca`) already adds:

- `/realized`: one table of closed lots from the `realized_lots` view (Korean and US stocks, crypto), a sale-year selector (defaults to this year, else the latest year with sales), filters for market, broker and term, and a search box.
- `lib/realized-lots.ts`: dollar cost from the stored `acquisition_cost_usd`; dollar proceeds from `native_proceeds` for a USD lot, or `proceeds_krw` divided by the sale-date USD/KRW rate for a won lot (nearest earlier rate, flagged `rate_approximate`); a lot missing a dollar figure keeps its row and is counted out of the dollar totals.
- `/realized/export`: a CSV with seven columns (description, date acquired, date sold, proceeds, cost basis, gain/loss, term), read through the same `queryRealized` function as the page, so the file holds exactly what the table shows. `no-store`.
- Replay rows that a 1099-B filing replaced are skipped (`superseded_by` empty).

This spec is the difference between that branch and what was asked. **Implementation starts by landing, or rebasing onto, that branch**; this spec does not redesign what it does.

## Goals

1. The download is correct and complete enough to hand over for a tax year, and says plainly what it does not cover.
2. Gold sales appear once the gold FIFO work (PR #253, open) is merged, with a `collectible` flag.
3. No real account number, and nothing derived from one, is in the file.
4. A reader can tell, per row, where the figure came from (this repo's replay or the broker's filed 1099-B) and whether it is a normal row or an audit-only row.

## Non-goals

- Producing a filing, computing tax, applying the 28% collectibles rate, netting by term, or filling Schedule D lines. The CSV carries the inputs; per-term gain/loss totals in the notes are the most it states (no per-box summary).
- Tax-software import formats (TXF, TurboTax CSV). Revisit if the owner names a target.
- Wash-sale adjustment as a filed number. Replay rows carry the repo's own estimate only; the broker's 1099-B is the filed figure.
- Dividends, interest, foreign income, FBAR/FinCEN 114, Korean (KR-side) gains and Korean tax. Those live elsewhere in the app.
- Any write path, any upload, any request to a third party. The app stays read-only; the export is a generated GET download.

## Anti-goals (a failure even if it technically works)

- A file that silently contains a different set of rows than the owner believes: filters, another person's lots, or audit rows.
- A real account number, or a number that identifies one, anywhere in the file name, header or cells.
- A blank where the truth is "unknown": an unknown dollar figure or box is shown as such, never as zero.
- Presenting estimated figures as filed ones.

## Decisions

### Scope of rows: tax-year export is not the filtered table (call)

The existing route reuses the page's filters. For a tax download that is a trap: a leftover broker or term filter produces a plausible file that is missing sales. Change:

- The download takes **only a year** (`year=YYYY` or `all-years`) and an `audit=1` switch. It ignores `market`, `brokerage`, `term` and `q`.
- The page's "Download" control is a separate block, labelled with the year it will use, and states that table filters do not apply to it.
- Year means **sale date in that calendar year, US (Los Angeles) date**, matching `todayLosAngeles` in the CLI. The year list and default come from the existing `defaultSoldYear`.
- `Date sold` is whatever the table holds; no timezone conversion is applied to stored dates, which are already dates.

### Only the owner's own lots

`getRealizedLots` currently has no owner filter, so a lot belonging to another person whose account the console tracks would appear in the table and the file. The export (and, for consistency, the page) must apply the same self-only predicate as the CLI and `selfOnlyAnd` (`coalesce(owner, 'self') = 'self'`, skipped when the column is absent). Add a test with an `owner <> 'self'` fixture row.

### Which table, and gold

Read `realized_lots_all` where it exists, with `account_wrapper in ('taxable', 'isa')` for stocks and crypto as the view does today, plus `asset_class = 'gold'` once #253 is merged; fall back to the `realized_lots` view for an older database. Gold rows are included by default in the export (the CLI keeps `--include-gold` opt-in because it is an operator tool; the console download is for the whole year). Until #253 merges the gold part is simply absent and the coverage note says so. If #253's column names differ from the description in its PR (`proceeds_usd`, `realized_gl_usd`, `collectible`), follow the merged code.

Pension-wrapper rows are never exported.

### Columns (call)

Form 8949 order first, then context. One header row, UTF-8, CRLF, no BOM, no preamble or comment lines (the file stays machine-readable).

| # | Column | Source / rule |
|---|--------|---------------|
| 1 | `description` | `<quantity> <ticker>` as on the branch today (8949 column a) |
| 2 | `date_acquired` | `acquired_date`; blank if unknown |
| 3 | `date_sold` | `sold_date` (column c) |
| 4 | `proceeds_usd` | derived as on the branch (column d); blank if unknown |
| 5 | `cost_basis_usd` | `acquisition_cost_usd` (column e); blank if unknown |
| 6 | `adjustment_usd` | Form 8949 column g: on `1099b` rows the broker's gain minus (proceeds minus cost), from cents-rounded values, `0.00` allowed; blank for replay rows and whenever an input is unknown. See "Adjustments" |
| 7 | `gain_loss_usd` | column h. On `1099b` rows the broker's filed gain (`native_realized_gl`); otherwise proceeds minus cost. Blank if proceeds or cost is unknown. Every dollar cell is rounded to cents first, so the printed cells add up |
| 8 | `term` | `short`, `long`, or blank when unknown |
| 9 | `form_8949_box` | the stored `form_8949_box` when set (1099-B rows); blank for replay rows. Never derived. |
| 10 | `covered` | stored `covered_status` normalised to `covered`, `noncovered`, or blank |
| 11 | `basis_source` | `replay` or `1099b` (stored `basis`) |
| 12 | `row_status` | `reported` (default) or `superseded` (audit rows only) |
| 13 | `asset_class` | `security`, `crypto`, `gold` |
| 14 | `market` | `US`, `KR`, `CRYPTO`, `GOLD` as stored |
| 15 | `collectible` | `true` for gold, otherwise `false` |
| 16 | `proceeds_rate_note` | `approximate_fx` when the sale-date rate was not the sale day's own, else blank |
| 17 | `broker` | brokerage name |
| 18 | `account_alias` | see Privacy |
| 19 | `ticker` | ticker or symbol |

### Adjustments (call)

The database stores no wash-sale or other adjustment code or amount, but a `1099b` row stores the form's own gain in `native_realized_gl`, which differs from proceeds minus cost by the wash-sale and basis adjustments (see `scripts/ingest-stock-data.mjs`). On `1099b` rows `gain_loss_usd` is therefore the broker's filed gain, and `adjustment_usd` (column g) is the difference from proceeds minus cost. The adjustment code (column f) is **omitted**, not left blank, because neither the code nor the wash amount is stored. Replay rows carry no adjustment (the cell is blank) and no wash-sale estimate in the file; the wash-sale estimate stays on the wash-sale page. The page's dollar gain for a `1099b` row uses the same filed gain, so page and file agree.

Why a derived box is refused: the branch's own comment is right. The box depends on whether the venue issued a 1099-B or 1099-DA, a fact the app holds only for filed rows. Where the box is blank the coverage note says why. (call) Columns 1–8 follow Form 8949 (a, b, c, d, e, g, h, plus term); a hand-copier can ignore the rest. Column f is absent, see above.

### Superseded replay rows and 1099-B rows

- Default file: 1099-B rows (`basis_source=1099b`) for any year a filing covers, replay rows for everything else. Superseded replay rows are **not** present. This is what the table shows and what the CLI lists.
- `audit=1`: adds the superseded replay rows with `row_status=superseded`. They are excluded from every total the page or notes state. Purpose: reconcile this repo's estimate against the broker's form.
- A replay row is never relabelled as filed. `basis_source` is the only statement of origin.

### Privacy

- Never in the file: the stored account string or any part of it, file paths, the database path, or provenance hashes.
- `account_alias`: `<broker> A`, `<broker> B`, … assigned in order of first appearance **within one file**. It is stable inside the file and deliberately not stable across files or years, so an alias cannot be used to join exports. Accounts are never compared by last four (see the standing rule that identity is the full number); aliasing keys on the full stored account string.
- Description and ticker come from the lot, never from the account.
- File name is `tax-realized-<year>.csv` (or `-audit.csv`): no account, no broker, no date of generation.
- Response headers: `cache-control: no-store`, `content-type: text/csv; charset=utf-8`, `content-disposition: attachment`, `x-content-type-options: nosniff`. No analytics event, no logging of row contents, no third-party request.
- Privacy is tested against the fixture's own account strings, not a digit pattern: no stored `account` value, and no digit run taken from one, appears anywhere in the body. A pattern like `\d{6,}` is wrong here, because Korean tickers are six digits and dollar amounts and quantities can reach six. The ticker and description of a Korean lot are exported as stored.
- What the DB holds as `account` is a text label (the repo already folds account numbers to tokens such as "Robinhood Mid-term · 1234"); the full number may not be in the database at all. Aliasing keys on that stored string. Two accounts that carry an identical stored string cannot be told apart by the export, and that is stated in the notes rather than guessed around.

### What the export does not cover

Stated in two places, from one source string so they cannot drift: on the page beside the button, and in a companion file `tax-realized-<year>-notes.txt` (a second download link; the CSV stays pure data). Contents:

- Generated from the Observatory database as of the `ingested_at` meta value (the database build date, the same one `provenance.dbBuiltAt` reports; date only); freshness is not a guarantee a statement has been downloaded. A sale a broker shows that is missing here is usually an un-ingested statement.
- This is a worksheet, not a filing. Figures marked `replay` are this repo's FIFO estimate; `1099b` rows are the broker's filed figures.
- Missing items are blank, not zero. State the count of rows with a blank dollar figure and the sum is stated over the rest only.
- Wash-sale adjustments are not computed for replay rows.
- Box codes appear only on 1099-B rows. Crypto rows have no box here; 1099-DA is not parsed by this app.
- Gold is flagged `collectible`; the 28% rate is not computed. (Gold line appears in the notes once gold is exported.) Gold dollar figures use the historical USD/KRW table; a purchase older than the table has a blank cost.
- Korea-account lots are measured in dollars: cost at the acquisition-date rate, proceeds at the sale-date rate. This is the repo's reading of the IRS method, to be confirmed with the preparer.
- Not included: other owners' accounts, pension wrappers, dividends and interest, FBAR, Korean-side gains and tax.
- Per-term totals of gain/loss over rows that have all three figures, with the count of rows left out.

Notes file is English only. It is plain text, no personal data beyond what the CSV has.

## Page behaviour

- A "Tax export" block on `/realized`: year (defaults to the table's year), an "Include superseded rows (audit)" checkbox, two links (CSV, notes), the not-covered summary, and the counts: rows, rows with a blank dollar figure.
- No new top-level page and no change to sidebar copy beyond the block's strings. Strings go in `lib/ui-copy/pages/realized.ts` in both languages as the repo does today; the CSV and the notes file stay English.

## CLI

`pnpm tax:realized` keeps its shape and its `--include-gold` flag (PR #253). A later cleanup may point the CLI at the shared row builder; out of scope here. The CSV builder is a pure function in `lib/realized-lots.ts` (or a sibling file) so a CLI `--csv` is possible later without a rewrite.

## Testing

- Pure-function tests: column order and escaping; blank for unknown; gain blank when either side unknown; box blank for replay rows; `covered` normalisation; alias assignment order and stability inside one file; totals exclude superseded rows.
- Route test with a small fixture database: default file excludes superseded and other-owner rows; `audit=1` adds superseded with `row_status`; filters in the query string are ignored; no `\d{6,}` in the body; headers.
- Gold rows tested in the follow-up PR, against #253's merged column names; in step 2, a test that the export works on a database with no gold rows and no gold columns.

## Delivery order

1. Land `worktree-realized-lots-page` as its own PR (it is local and unpushed on this machine; its seven-column CSV is unmerged and nothing depends on it, so changing it needs no compatibility layer). Include the owner filter fix as a separate commit.
2. This work, stacked on it: export changes, notes file, privacy tests.
3. Gold, as a follow-up PR after #253 merges, written against its merged columns. Not built speculatively; step 2 only guarantees the export tolerates a database without gold columns.

## Constraints

- Read-only database (`readonly: true`), no writes, no network.
- Old databases (no `owner`, `superseded_by`, `form_8949_box`, `realized_lots_all`) must not throw; the adapter already guards columns, keep that pattern.
- Dependency order: land `worktree-realized-lots-page` first; the gold part follows #253.

## Left to the builder

Exact copy strings; where the shared CSV builder lives; the internal shape of the notes generator; whether the totals block is a table or a list; how `defaultSoldYear` is reused for the export block.

## Calls I made (for the owner to check)

1. Treating the CSV as a reference worksheet, not an import file.
2. Download ignores table filters; year and an audit switch only.
3. Gold included by default in the console export.
4. Box code never derived; blank for replay and crypto rows.
5. Account alias per file, not stable across files.
6. Notes as a separate `.txt`, CSV has no preamble.
7. Self-owner filter added to the page too (behaviour change on `/realized`).
