# Overview as the observatory's summary — improvement plan

**Status:** implemented, 2026-11-20, as stacked PRs, one per phase (Phase 0 on `claude/overview-asset-graph-layout-466742`, then Phases 1–5). Decisions below are settled; where a phase departed from this plan it says why.

## Why

The Overview (`app/page.tsx`) is the first page of the Personal Finance Observatory, but it reads as a stock-portfolio page with finance cards attached:

- **The headline number is stocks only.** The hero is the stock market value; total assets, the figure the product exists for, is a plain text list in the third card.
- **The one picture of total assets is gone.** R4-2 (#348, 2026-11-17) removed the stacked total-assets chart from Overview under "one home per data block" (`docs/ui-guide.md`, `tests/page-blocks.test.ts`), so it now lives only on `/net-worth`. The rule was right about the duplicate *workbench* (range links, children toggle, event list), but it also removed the summary.
- **Whole areas of the product are absent.** Nothing on the page says what came in or went out this month (`/cash-inflow`), what income or realized gains this year look like (`/income`, `/realized`), whether the portfolio drifts from its targets (`/rebalance`), or what needs attention (`/data-ops`). Taxes appear only as the yearly tax-record card.
- **Text outweighs pictures.** Market breakdown, concentration, term mix and account allocation are lists of numbers with equal weight; on a phone the hero alone fills the first screen.
- **The snapshot trend is a workbench, not a summary.** Three chip groups, a price-basis line and two explanation paragraphs.

## Principles

1. **Every product area gets one line on Overview, and a link to its home.** Overview summarises; the area page explains. This amends "one home per data block": a *summary* (one figure, or one chart without controls) may repeat on Overview, the same way header pills already summarise another page's count. A workbench (controls, tables, event lists) still lives only at home.
2. **Pictures first, lists last.** The top of the page carries the charts; detail lists go below or to their home page.
3. **Answer, in order:** How much do I have, and where is it going? What changed this month and this year? How is it spread? What needs me?
4. **Stocks view stays stock-only.** The `assetView === 'stocks'` switch keeps hiding supplementary assets, as today.

## Target layout (all-assets view)

| Band | Content | Source (existing) | Home |
|---|---|---|---|
| Header | status pill (exists) | `getOperationalHealth` | `/health` |
| 1. Hero | **total assets** with change over 1M and YTD; compact stacked area by class, no controls, links to `/net-worth` | `getNetWorth`, `getTotalAssetsSeries` | `/net-worth` |
| 2. Portfolio trend | the snapshot trend (moved here in Phase 0), slimmed: range + scope chips visible, metric chips and the two explanation paragraphs behind the card's info popover | `getPortfolioSnapshots` | Overview (its only home) |
| 3. This month / this year | four tiles: net cash flow this month, income YTD (dividends + interest), realized G/L YTD, estimated tax for the year | `getCashInflow`, `getIncomeReview`, realized lots, `getAnnualTaxSummary` | `/cash-inflow`, `/income`, `/realized`, `/taxes` |
| 4. Allocation | one row: asset class shares (stocks / crypto / cash / pension / gold), market and currency exposure (KR / US / crypto; KRW / USD), top-5 concentration | `getNetWorth`, `getMarketBreakdown`, `getTopHoldings` | `/net-worth`, `/holdings` |
| 5. Needs attention | one strip: review-queue count, stale sources, rebalance drift beyond band, upcoming filing dates (FBAR, KR comprehensive income tax) | `getDataOpsReview`, `getRebalanceReview`, tax settings | `/data-ops`, `/rebalance`, `/taxes` |
| 6. Detail | term mix; account allocation moves to `/accounts` | existing | `/holdings`, `/accounts` |

## Phases

**Phase 0 — done in this branch.** Snapshot trend moved directly under the hero. Filter chips no longer jump to the top (Next.js patch, see "Scroll fix" below).

**Phase 1 — total assets leads (implemented on `claude/overview-total-assets-hero`).** Amend the one-home rule in `docs/ui-guide.md` and `tests/page-blocks.test.ts` (allow a control-less `StackedAssetChart` summary on Overview; keep `AssetEventList`, range links and the children toggle banned). Hero becomes total assets in the all view, stock value in the stocks view. The text list of classes folds into band 4.

**Phase 2 — this month / this year tiles (implemented on `claude/overview-month-year-tiles`).** Three tiles reading existing adapters, each linking to its page; no new data. Empty and unavailable states follow the "unavailable is not zero" rule (#364). Two of the four proposed tiles changed on contact with the data:

- *Net cash flow this month* became **cash inflow this month**: the cash-inflow model records credits only (salary, dividends, interest, other), so a net figure would need an outflow source the app does not have.
- *Estimated tax for the year* is **not shown**. The tax records are recorded obligations ("never a new annual tax calculation"), and the planner's estimates are for hypothetical future sales under a chosen plan, so neither is this year's estimated tax. Building one means a new calculation; decided 2026-11-20 to leave the slot empty rather than build it, so Phase 2 ships three tiles.

**Phase 3 — one allocation row (implemented on `claude/overview-allocation-row`).** One "Allocation" card replaces the total-assets class list, the market-breakdown card and the concentration card: asset-class shares (all view), market shares with each market's value and return, and the top 5 by cost basis, each a bar plus lines (`components/ShareSummary.tsx`) linking to `/net-worth` or `/holdings`. Per-market cost basis and G/L move off Overview (they are on `/holdings`), and so does the top-10 list. Currency exposure is not shown yet: a total-assets currency split needs each class's currency, which only stocks and cash carry today.

**Phase 4 — needs-attention strip (implemented on `claude/overview-attention-strip`).** Counts only, each linking to its queue; the strip hides when everything is clear (`lib/overview-attention.ts`). Three counts: the `/data-ops` work-queue total (which already includes stale sources, so they are not counted twice; shown as a lower bound when the position-break row is capped), positions over the rebalance cap, and markets whose target gap calls for Add or Reduce. Filing dates are not shown: no source in the app holds them, and hard-coding deadlines would be new tax rules.

**Phase 5 — trim (implemented on `claude/overview-trim`).** The snapshot-trend card keeps its range, view and scope chips; the metric chips show only in the single-metric view (the combined chart already draws every metric), and the price basis, range summary and method paragraph move into the card's info popover, with only a stale-snapshot warning left in the body. Account allocation moves to `/accounts` as "Holdings by account". At 390×844 the hero figure and its 12-month chart fit the first screen with no horizontal scroll; the portfolio trend starts on the second screen, below the supporting metrics.

Each phase is one PR with the screenshot net (`docs/ui-guide.md`), `pnpm ui:guardrails`, and the English render diffed line by line.

## Decisions (settled 2026-11-20)

1. **Amend "one home per data block": yes.** A control-less summary (one figure, or one chart without controls) may repeat on Overview; workbenches stay at home (Phase 1).
2. **Hero figure in the all view: total assets.** The stocks view keeps stock value.
3. **Phase 2 tiles: the four proposed** (net cash flow this month, income YTD, realized G/L YTD, estimated tax for the year). Implemented as three: the cash tile reads inflow, and the tax tile is dropped (see Phase 2).

## Scroll fix (Phase 0)

Clicking a filter chip on the snapshot trend sometimes scrolled the page to the top. The chips are `<Link scroll={false}>`. Next.js 15.5's navigate reducer takes an "aliased prefetch" path when its prefetch cache holds the same pathname under other search params, which is the normal state on a page whose chips all point at `/?…`. That path (`handleAliasedPrefetchEntry`) never copies `shouldScroll` onto the mutable state, so `handleMutable` defaults it to `true`, and the layout router focuses the page's first element (`<header>`) and sets `scrollTop = 0`. The aliasing branch is disabled in `next dev`, so the bug only appears in production builds, and only when the prefetch cache happens to hold a sibling URL, which is why it looked intermittent.

`patches/next@15.5.28.patch` sets `mutable.shouldScroll = shouldScroll` before that call, in both the CommonJS and ESM builds. `tests/next-scroll-patch.test.ts` fails if a Next upgrade drops the patch; pnpm also refuses to install with a patch that no longer matches a version. On a local production build, eight chip clicks scrolled to the top eight times without the patch and zero times with it. Upstream 15.5.28 still lacks the fix; drop the patch when Next is upgraded past the aliased-prefetch reducer (Next 16 replaced it with the segment cache).
