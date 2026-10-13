# Cash Inflow GUI — P1: category filter and cell drill-down

**Goal:** On `/cash-inflow`, a reader can filter to one kind of inflow (salary, investment income, dividends, interest, other, unclassified) and open the transactions behind any single cell of the period table, e.g. "2025-01 · Salary", directly under that row, with a subtotal and the reason each row got its category.

**Context:** P1 of a three-phase GUI plan. P2 adds source/currency/range filters, a reworked KPI band (investment income, year-over-year) and dividend gross/withholding columns. P3 adds an unclassified triage panel, chart interaction and mobile polish.

## Decisions

- **Investment income** = dividends + interest.
- **Detail placement:** the drill-down expands in place, as an extra row directly under the clicked period row, not at the bottom of the page.
- **The filter is a URL parameter** (`category`), rendered with the existing `FilterBar`, so a filtered view can be linked and undone with Back.
  - Values: `All`, `salary`, `investment`, `dividend`, `interest`, `other`, `unclassified`.
- **The drill-down is URL state too:** `detail=<YYYY or YYYY-MM>` plus an optional `detailCategory=<category>`. Both are validated against fixed patterns.
- **Why a row has its category** comes from data already decided at ingest:
  - **Bank rows:** the rule's `note` (falling back to its `id`), or "description default" when no rule matched.
  - **Dividend-table rows:** the broker's own type word.

## Work

1. **Ingest:** `bank_inflows` gains `rule_note` (the matched rule's `note`). `scripts/seed-sample.mjs` gains the column too.
2. **Adapter** (`lib/adapters/portfolio-db.ts`):
   - `CashInflowFilter` type and `cashInflowCategories(filter)`.
   - `getCashInflow(granularity, display, now?, filter?)`: each period's `total` and the trailing / YTD / average figures sum only the filter's categories. `salaryShare12m` stays share-of-all.
   - `getCashInflowRows(period, display, categories?)`: filters by category and adds `reason` / `reasonKind` (`rule` | `default` | `broker`).
3. **`DataTable`:** optional `expandedRowKey` + `renderExpanded(row)` render one full-width row under the matching row.
4. **Page** (`app/cash-inflow/page.tsx`):
   - `FilterBar` with the category group.
   - Chart series and table columns follow the filter.
   - Every amount cell links to its drill-down.
   - The period cell links to the whole period, within the filter.
   - The expanded row shows a title with the count and subtotal, a close link, and a table of date, description, account, native amount, amount and reason.
5. **Copy** (`lib/ui-copy/pages/cashInflow.ts`, en + ko): filter label and options, detail summary, reason wording, close.
6. **Tests:**
   - Adapter: filter totals, investment = dividend + interest, rows filtered by category with reasons.
   - Ingest: `rule_note` stored.
   - `DataTable`: renders the expanded row once.
   - Page headings unchanged.
7. **Verify:** typecheck, lint, test, `ui:guardrails`, build. Then a browser check on a seeded DB: filter chips, cell drill-down, close, 375px, both languages.
