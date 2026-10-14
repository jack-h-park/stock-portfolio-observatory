# Cash Inflow GUI — P3: unclassified triage, legend toggle, mobile polish

**Goal:** The unclassified credits on `/cash-inflow` can be worked through in one place, the chart can isolate a category without leaving the page, and the shared filter bar reads in the page's language on a phone.

**Builds on:** P1 (#238) and P2 (#241).

## Decisions

- **Unclassified triage card.** It appears under **Show = Unclassified** and respects the source, currency and range filters.
  - It groups unclassified bank credits by institution, account and description. Each group shows count, total, first and last date, sorted by total.
  - Each group opens, through a native `<details>` element (no client JS), to its dated amounts.
  - Each group also shows a ready-to-paste `bankInflowRules` entry for the laptop's `manual-mappings.json`, with `category` left as `other` for the reader to change.
  - The page still classifies nothing itself. The app stays read-only, and the mapping file is the single place rules live.
- **Badge link.** The header's "N unclassified credit(s)" badge becomes a link to that card: `?category=unclassified#cash-inflow-unclassified`, keeping the other filters.
- **Legend toggle.** Clicking a legend item hides or shows that series in the chart only.
  - This is client state, so it does not touch the URL, the table or the KPIs.
  - The URL **Show** filter remains the way to narrow the figures, and the chart note says so.
- **FilterBar.** The phone summary label comes from `common.filters` (en "Filters", ko "필터") instead of a hard-coded English word. This fixes every page that uses the bar.

## Work

1. **Adapter.** `getCashInflowUnclassified(display, scope, now?)` returns `{ institution, account, description, count, total, first, last, rows: { date, native, currency, amount }[] }[]`. It is limited to the range window and narrowed by source and currency, and is sorted by total descending.
2. **Page.**
   - The triage card, with its id as the anchor and its `<details>` groups.
   - The rule snippet as preformatted text.
   - The badge turned into a link.
3. **Chart.** `StackedBarChart` gains a `toggleable` option, which keeps a set of hidden series. `Legend onClick` toggles a series, `Bar hide` applies it, and the legend items read as buttons.
4. **FilterBar.** It uses `common.filters` through `CommonLabel`.
5. **Copy (en and ko).**
   - The triage card title and note.
   - The group summary sentence.
   - The rule-snippet caption.
   - The legend hint.
   - `common.filters`.
6. **Tests.**
   - Adapter: grouping, totals, the range and scope narrowing, and sort order.
   - The rule snippet: it is valid JSON that the ingest's validation would accept.
   - FilterBar: renders the Korean label under ko.
7. **Verify.**
   - Run typecheck, lint, test, `ui:guardrails` and build.
   - Check in the browser on a seeded DB: the triage card and its details, the badge link, a legend toggle, and 375px in both languages.
