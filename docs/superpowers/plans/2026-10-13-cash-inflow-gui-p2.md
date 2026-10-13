# Cash Inflow GUI — P2: source, currency and range filters, a reworked KPI band, dividend detail, chart click-through

**Goal:** `/cash-inflow` answers four questions:
- How much came in over a chosen period, from the bank or the brokers, in won or in dollars.
- How that compares with the year before.
- What a dividend paid before and after withholding.
- Which credits sit behind one chart bar. Clicking a segment filters to it and opens them.

**Builds on:** P1 (#238): the category filter, the in-place drill-down and the reason column.

## Decisions

- **New URL filters**, each a `FilterBar` group next to **Show**:
  - **Source**: All · Bank · Brokers. Bank is the `bank_inflows` rows; Brokers is the dividends-table rows.
  - **Currency**: All · KRW · USD. This is the credit's own currency, not the display currency.
  - **Range**: Last 12 months (default) · Last 24 months · This year · Last year · All time.
- **The range drives everything on the page.** It sets the hero, the KPI band, the chart and the table rows.
  - In the yearly view, the table keeps every year the range touches.
  - "All time" spans from the first credit to this month.
- **KPI band.**
  - **Hero:** the range total, for the selected categories.
  - **Under Show = All:** monthly average, salary, investment income (dividends + interest), investment share of counted inflow, and change versus the year before.
  - **Under any other Show:** monthly average and change versus the year before.
  - **Monthly average:** divides by the range's calendar months, not by the months that happen to have a credit.
  - **Change versus the year before** compares with the same-length window shifted back by its own length:
    - 12 months back for Last 12 months, This year and Last year.
    - 24 months back for Last 24 months.
    - Under All time it reads n/a, as it does when the earlier window holds nothing.
- **Yearly table:** gains a "vs previous year" column, the change against the year before. It reads n/a for the first year.
- **Dividend detail rows** gain ticker, gross and withheld. Withheld is `native_amount − NET_DIVIDEND_SQL`, so it is 0 for rows already net (Toss foreign dividends, refunds). Bank rows leave these cells blank.
- **Chart click-through.**
  - **Click:** clicking a bar segment sets **Show** to that segment's category and opens the drill-down for that period and category. The page scrolls to the opened rows (`#cash-inflow-detail`).
  - **Implementation:** each data point carries its own hrefs, built on the server. The client chart only navigates; it builds no URL.
  - **Keyboard:** bars are not focusable, so the table's cell links remain the way to reach every drill-down. A note under the chart says bars are clickable.
- **Validation:** every new parameter is checked against a fixed list, and unknown values fall back to the default.

## Work

1. **Adapter** (`lib/adapters/portfolio-db.ts`).
   - Types `CashInflowSource`, `CashInflowCurrency`, `CashInflowRange` and `CashInflowScope`.
   - The union gains `ticker`, `gross` and `withheld` columns. Its `where` clause binds source and currency as parameters.
   - `getCashInflow(granularity, display, now?, filter?, scope?)`.
     - Periods come limited to the range.
     - Totals: `rangeTotal`, `rangeMonths`, `monthlyAverage`, `salary`, `investment`, `counted`, `investmentShare`, `previousTotal` and `change`.
     - Yearly periods carry `previousTotal`.
     - The existing `trailing12m`/`ytd`/`monthlyAverage12m`/`salaryShare12m` stay, so callers and tests keep working.
   - `getCashInflowRows(period, display, categories?, scope?)` returns ticker, gross and withheld.
2. **Chart** (`components/charts.tsx`). `StackedBarChart` gains an optional `linkKey`. When it is set, `data[i][linkKey][seriesKey]` is the href a click on that segment pushes, and the cursor becomes a pointer.
3. **Page** (`app/cash-inflow/page.tsx`).
   - Four filter groups.
   - The range-driven hero and KPI band.
   - Chart hrefs with the anchor.
   - The yearly change column.
   - The dividend columns in the drill-down, shown only when the opened rows include a broker row.
4. **Copy** (`lib/ui-copy/pages/cashInflow.ts`, en and ko): group labels and options, KPI labels, the change column, the dividend columns, and the chart hint.
5. **Tests** (`tests/cash-inflow-scope.test.ts`).
   - Source and currency narrow the sums.
   - Range windows, including a year boundary and All time.
   - The monthly average divides by calendar months.
   - Change versus the previous window, and n/a when it is empty.
   - Yearly `previousTotal`.
   - Dividend gross and withheld, including an already-net Toss foreign dividend.
6. **Verify.** Run typecheck, lint, tests, `ui:guardrails` and build. Then check on a seeded DB in the browser:
   - each filter
   - a segment click opens and scrolls to the rows
   - the yearly change column
   - dividend columns
   - 375px
