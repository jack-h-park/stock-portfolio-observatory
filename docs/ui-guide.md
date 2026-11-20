# UI guide

What the interface is made of, and how to change it without breaking something
quietly. Written at the end of the GUI refactor (P0–P5), from what actually went
wrong during it.

## The short version

- Copy lives in `lib/ui-copy/`, never in a page.
- Layout comes from `CardRow` and `KpiBand`, never from a hand-written grid class.
- Type sizes come from the named scale, never from `text-[13px]`.
- A route's name comes from the sidebar, and nowhere else says it.
- Before you open a pull request: `pnpm typecheck && pnpm lint && pnpm test && pnpm ui:guardrails && pnpm build`.

## Copy

Every string a reader sees comes from `lib/ui-copy/`:

- `common.ts` — the vocabulary shared by every screen: All, Search, freshness,
  priority, form and error wording.
- `pages/<page>.ts` — one module per route, read with `getPageCopy('review', language)`.

Each module is wrapped in `defineCopy({ en, ko })`, which infers the shape from
`en` and pins `ko` to it. A missing translation is a compile error, not a
sentence that silently stays English — seven pages had drifted to English-only
before that existed, and `/health` still had no module at all as late as P4.

Two rules that are not obvious:

- **Do not translate `tax_term` or `cost_note`.** The ingest writes them; they
  are data, not interface.
- **Build a sentence in the copy module, not in the JSX.** English needs plural
  agreement where Korean needs none, so a sentence assembled from fragments in a
  component forces Korean to carry English grammar. Pass the raw values in and
  let each language do what it needs — see `health.degradedBody`, which takes the
  step list rather than a joined string precisely so both languages use it.

### Korean vocabulary

New Korean copy uses these words for these terms, so one concept reads one way
on every page (G12 reports the English left behind):

| English term | Korean |
|---|---|
| snapshot | 스냅샷 |
| ingest | 수집 |
| refresh (the run) | 갱신 |
| provenance | 출처 |
| override | 수동 지정 |
| triage | 분류 |
| freshness | 최신성 |
| version | 버전 |
| revision | 리비전 |
| netting (verb) | 상계 |
| proxy | 대용값 |
| ticker (in prose) | 종목 |
| wash sale | 워시세일 |
| Opportunity map | 기회 지도 |
| Tax Settings (page) | 세금 설정 |
| staged baseline | 단계적 기준안 |
| Reporting Rate of Exchange | 재무부 보고 환율 |

## Naming

`lib/page-names.ts` holds the set of route hrefs and the product name. The
**names themselves** are not there — they are read back from the sidebar copy,
because that is the name the reader clicked to arrive.

So one route has one name, used in three places: the sidebar entry, the browser
tab (`routeMetadata`), and the page heading. `tests/page-headings.test.ts`
asserts the heading matches the sidebar in both languages. Seven routes
disagreed before it existed.

`PageHeader`'s `emphasis` must be a **trailing** substring of `title` — that is
how the brand gradient is applied. It is not enforced by types, so the same test
checks it: six headings were rendering with no gradient because the emphasis was
a leading substring instead.

## Layout

| you want | use |
|---|---|
| a row of cards under the header | `<CardRow>` — `columns` 1 / 2 / 3 / `hero` / `main` / `side-main`, `spacing` below / above / none |
| the metric strip inside a hero card | `<KpiBand>` |
| a link beside a heading | `<TextLink>` |
| a submit button | `<SubmitButton>` — shows a pending state |
| a table | `Table` with `size`, or `DataTable` |
| a boxed strip of figures | `<StatStrip>` of `<Stat>`; `<MiniStatGrid>` of `<MiniStat>` for small tiles; `<TotalsStrip>` of `<Total>` above a list table |
| a row of link chips (filters, scopes) | `<LinkChips>` or one `<LinkChip>` — a selection carries `aria-current`, a toggle does not |
| tabs that change the page | `<Tabs>` — the current tab carries `aria-current="page"` |
| an inset box inside a card | `<Panel>` — `pad`, `text`, `bordered`, `as="a"` for a link tile |
| a toned message box | `<Callout>` — `tone`, `emphasis` strong / soft / rule |
| the result of a form post | `status={{ severity: 'ok', label }}` on the header; `<FormSaved>` for a saved notice inside a card; `<FormError>` above the first card |
| a button that changes policy | `<ConfirmSubmitButton>` instead of `<SubmitButton>` |
| a muted footnote | `<Note>` — `size`, `spacing`, `row`, `band`; phrasing content only |
| a heading inside a page or card body | `<SectionHeading>` — `size`, `eyebrow`, `subtitle`, `layout` |
| a share or progress bar | `<ShareBar>` for segments, `<ProgressBar>` for one percentage (clamped to 0–100) |
| a broker and account in a table cell | `<AccountCell>` (`components/PositionCell.tsx`) — broker over `maskAccountLabel(account)`, each line truncated |
| a help note beside a label or figure | `<HelpPopover>`; `<Stat info>` renders one for you (`Stat renders an info popover when given info`) |
| a route's loading state | `app/loading.tsx` renders `<PageSkeleton>` |
| a position in a table cell | `<PositionCell>` — market badge and ticker link, with the name under them or alone |
| a main column and a fixed side column inside a card | `<Split>` — `side`, `at`, `gap`, `sideFirst` |

Do not write the grid class by hand. Fifty-one copies of five arrangements
existed before `CardRow`, which is how a fifty-second comes to differ by one
utility.

Import the primitives from `@/components/ui`; it stays the import path and
re-exports four modules: `components/card.tsx` (`Card`, `MetricHeroCard`,
`EmptyState`, `HeroAside`, `Panel`, `Callout`), `components/metric.tsx`
(`MetricField`, `Signed`, `Label`, `MetaRow`, `MetaItem`, `Note`,
`SectionHeading`), `components/table.tsx` (`Table`, `Thead`, `Th`, `Tbody`,
`Tr`, `Td`) and `components/controls.tsx` (`Button`, `SegmentedControl`,
`TextLink`, `Badge`). The rest are imported from their own files:
`components/layout.tsx` (`CardRow`, `Split`, `KpiBand` and the strips, the one
file allowed to write `grid-cols-*`), `components/bars.tsx`,
`components/PositionCell.tsx`, `components/LinkChips.tsx`,
`components/Tabs.tsx`, `components/FormNotice.tsx` and
`components/ConfirmSubmitButton.tsx`.

### Phone width

`KpiBand` is two across below `sm`, so four figures take two rows instead of
four. The language, currency and asset-view controls sit in the sidebar's
footer rather than the header. `KpiBand is two across on a phone` in
`tests/ui-primitives.test.ts` pins the band.

Touch targets are 24 px, with two recipes. A `<summary>` gets `min-h-6
leading-6` (never `flex`, which drops the disclosure marker in Chromium). An
inline text link gets `inline-flex min-h-6 items-center`. `pnpm ui:mobile` checks
the routes, and the unit tests pin the primitives (`OperatorDetails summary has a
24px target`, `AnnualTaxSummary links…`, `AssetCoverageNote summaries and
links…`).

### Loading

`app/loading.tsx` renders `PageSkeleton`: a `role="status" aria-busy="true"`
region whose only text is `common.loading` in `sr-only`, with the blocks
`aria-hidden`. It pulses with `motion-safe:animate-pulse` and not otherwise. `PageSkeleton
announces loading without motion by default` in `tests/ui-primitives.test.ts`
pins it.

### Tables

An account cell shows the broker over the masked account label, each line
truncated, so a long name stays on one line at 375 px. Its `title` is "broker ·
masked" and never the raw account number. The account column sorts by
`accountSortValue` (`lib/account-label.ts`), not by the displayed string.
`AccountCell shows broker over the masked account…` in
`tests/ui-primitives.test.ts` pins the cell; `tests/table-sort.test.ts` covers
`accountSortValue`.

A page defines its columns once. `sortableKeys(columns)` and `knownSort` in
`lib/table-sort.ts` derive the sort keys the page accepts from that list, so a
key that no longer exists (an old `sort=brokerage:…` bookmark) falls back to the
default sort (its header marked), with no error. Sorting honours each
column's `sortValue`. `tests/table-sort.test.ts` covers `knownSort`, including an
unknown key.

Priority below `md`: in a table with six or more columns, at most four stay
`primary`. Those are the identity column, the amount the card exists for, and any
status or action column. Source, page and identifier columns go `tertiary`
first. `tests/table-priority.test.ts` checks the four pages.

### Charts

Every chart in `components/charts.tsx` takes raw values plus `unit`,
`language` and `emptyMessage`; a page never pre-scales a series, and axis titles
come from copy. `lib/chart-format.ts` owns the rest: `ChartUnit` is `money` (with
a currency), `percent` or `number`; `axisTick` formats a tick; `tooltipValue`
formats the hover value (money uses `fmtMoney`, the full amount, so the axis can
abbreviate and the tooltip cannot); `hasPlottablePoint` guards the empty state.
A series that is all `null`, or an empty `data` array, shows `emptyMessage`
instead of an axis drawn from `-Infinity`. Every series carries a `name` from
copy (`valueName` on the single-series charts), so a tooltip never shows a data
key. `tests/chart-format.test.ts` checks the ticks, the tooltip, the plottable
guard and the series names.

Tick rules:

- Korean KRW is 억 with up to two decimals (1.25억); 만 with up to one decimal
  (1.5만, 12.5만, 3,500만); otherwise the plain number.
- English KRW is ₩M and ₩K, USD is $M and $K in both languages, each with up to
  two decimals ($1.25K). Trailing zeros are dropped.
- A value rounds half away from zero and promotes to the next unit.
- Percent axes use `allowDecimals={false}` and whole-percent labels.
- Negative zero prints `0`.

### Page header

`PageHeader` has three slots in a fixed order: one `status` pill, then
`actions` (back links, buttons), then the refresh clock. A page therefore never
shows two verdicts, and the thing that is clickable is always in the same place.

- **`status` is `{ severity, label, href? }`.** The pill's colour comes from the
  severity scale below. When it reports a problem and a card on the page lists
  it, `href` is `#<card id>` of that card, so the pill is the way to the rows
  and not only a sign that they exist; a pill with no such card (an example
  assumption, a missing rate) has no link. The pill and the card's `issues`
  badge then show one count in one colour: `lib/header-status.ts` builds both
  from one source per page (`*LinkedIssues`), and where a verdict has two causes
  the linkable issue wins and one label names both, so the header never shows
  an all-clear beside a warning.
- **Form pages pass `autoRefresh={false}`.** The clock calls `router.refresh()`
  every 30 seconds, which re-renders a form mid-entry and discards what was
  typed. G14 checks this per route folder.
- **A form's outcome is a saved notice or `FormError`**, not a hand-built
  callout. A saved notice in the header is `status={{ severity: 'ok', label }}`;
  `FormSaved` is the saved notice inside a card (an in-card editor). The error
  sits above the first card.

### Confirming an action

An action that rewrites policy (approving targets or a plan, closing or
rejecting a proposal) uses `ConfirmSubmitButton`, which asks for a second press
inline, in the button, with no dialog. The first press arms it and swaps the
label for the confirm wording; a second press submits. It disarms after six
seconds or on blur, and a press within 400 ms of arming, or the second click of
a double-click, is ignored, so one gesture cannot arm and confirm before the
reader has read the new label. Enter in a text field never confirms: idle, the
button is `type="button"`, and a submission without a submitter is cancelled.
`confirmStep` is pure and tested; the click, timer and blur wiring has no DOM
test, so check it by hand.

## Page order

Every page restructured in R5 reads in the same order, top to bottom:

| # | Block | Rule |
|---|-------|------|
| 1 | Alert that blocks a trade | `WashSaleBanner` only. It renders nothing when no window is open, and its component documents why it goes first. |
| 2 | Lead figure | The page's one `accent` card, with an `id` (`MetricHeroCard` takes it). |
| 3 | Issues card | Directly under the lead. Rendered only when it has rows. |
| 4 | Input controls | A toolbar, not a card. |
| 5 | Detail | Everything else. |

The order exists so the reader sees the figure first, then what is wrong with it,
then what they can change, then the evidence.

### Rules that go with the order

- Input controls are a toolbar, not a card. A card around a row of filters spends
  budget on a block that carries no figure.
- A page fed by two engines labels each group with `SectionHeading`.
  `/tax-planning` shows "Monthly sale plan" and "Lot-level estimate" this way, so
  two figures that differ by design are not read as a disagreement.
- A policy figure shown on a page comes from its named constant or from the
  policy, never a literal. `/rebalance` reads `MARKET_GAP_HOLD_PCT` and
  `SHORT_TERM_WATCH_PCT` from `lib/rebalance-policy.ts` and the position cap from
  the policy, so changing the number changes the page.

### Card budget

A page has at most ten `section.shadow-card` inside `<main>` at 1440×1000, not
counting cards inside a `<details>`. The lead's top edge sits at or above 840 px,
so its title and figure are on the first screen.

`pnpm ui:shape --base <url>` measures both limits. Its routes and their lead ids
are `SHAPE_ROUTES` in `scripts/page-shape.mjs`: `/tax-planning`
(`#tax-plan-overview`), `/rebalance` (`#rebalance-lead`), `/positions/KR/005930`
(`#position-lead`), `/cash-inflow` (`#cash-inflow-lead`) and `/review`
(`#review-summary`). A new page joins the budget by adding a row there.

Two exceptions are already in the code and are not precedent:

- `/rebalance` always renders its hold/watch card, because the header status pill
  links to it (the R3 pairing).
- `/review` has no accent card by design. Its lead is the summary strip.

## Information architecture

The sidebar has five sections. `lib/nav.ts` holds the model (`navItems`, and
`activeHref` with its aliases `/positions` to `/holdings` and `/taxes/records`
to `/taxes/history`); the eyebrow above a heading is the top-level section.

| section | what belongs in it |
|---|---|
| Overview | `/` and `/daily-briefing`: the summary a reader opens first; its own blocks, plus control-less summaries that link to the page owning them |
| Assets & Cash Flow | `/holdings`, `/net-worth`, `/pension`, `/income`, `/cash-inflow`, and the collapsible Detailed Records group (`/transactions`, `/fx`, `/crypto-premium`). `/net-worth` and `/pension` are hidden when the database has no supplementary data |
| Taxes | `/taxes`, `/taxes/history`, `/tax-planning`, `/lots`, `/realized`, `/fbar` |
| Review & Data | `/review`, `/rebalance`, `/data-ops`, `/reconciliation`, `/accounts`, `/health`, `/data-map` |
| Settings | `/tax-settings`, `/rebalance/settings` |

`/cost-basis` redirects to `/holdings` with every parameter kept, and
`/dividends` redirects to `/income`, so old links still land.

### Breadcrumbs

A page under another page passes `PageHeader parent={...} language={...}`
instead of `eyebrow`; the two are exclusive. The header then reads
`Section › Parent` above the heading, and the way back is that breadcrumb, never
a back link in `actions`.

### One home per data block

A block of data renders on one page, and other pages link to it. The overview
and the review page keep only their own blocks; the total-assets workbench
(range links, the children toggle, event markers and the event list) lives only
on `/net-worth`; `/data-ops` is the one work
queue, and each of its rows links to the card that lists its items, never back
to the queue (validation and source freshness lead to `/health`, position breaks
to `/reconciliation`); the FBAR worksheet lives on `/fbar`. The allowed repeats
are:

- a header pill that summarises another page's count (it links there);
- an Overview summary of another page's block: one figure, or one chart with no
  controls, linking to the page that owns it (the all-view hero's 12-month
  total-assets chart links to `/net-worth`). Anything with controls, tables or
  event lists stays at home;
- the archive figures on `/daily-briefing`, which is the archive's own page;
- the position page's per-ticker slices of data whose full list lives elsewhere.

`tests/page-blocks.test.ts` asserts the absences, so a block cannot drift back
quietly.

### Operator detail

Paths, hashes, stderr tails and commands are for whoever runs the pipeline, not
for the reader of a figure. Put them in `<OperatorDetails language={language}>`
(`components/OperatorDetails.tsx`): a closed `<details>` whose summary is
`common.operatorDetails`. It goes at the bottom of the page, except that a
stderr tail stays inside its own step on `/health`. On `/data-map` it holds the
data directory, on `/health` the stderr tail and the refresh-runs path, and on
the position page the evidence-summary and lineage cards. Keep these out of
subtitles and out of the main flow.

### Ticker links

A position links to `/lots`, `/realized` and `/transactions` with an exact
`ticker` parameter, plus `market` where the ticker alone is ambiguous. The
target page shows the filter as a removable `TickerFilterChip`, so the reader
can see why the list is short and clear it in one press.

## All assets

Deposits, CMA balances, pensions and gold are supplementary data (see
`docs/superpowers/specs/2026-10-09-net-worth-and-pension-design.md`, Amendments).
Three rules decide where they may appear:

- **Stock surfaces never include them.** Holdings, the stock trend chart, the
  badge and the validation line are stock-only in both views.
- **The switch is in the sidebar.** All assets is the default view. In it the
  Overview adds a Total assets card, which links to `/net-worth`; the Stocks
  view drops that card. The sidebar gates supplementary items one by one, not by
  section: Total Assets (`/net-worth`) and Pension (`/pension`) sit in Assets &
  Cash Flow with `supplementary: true` and are hidden when the database has no
  supplementary data, while the rest of the section stays.
- **Every amount carries its as-of date.** The Total assets card shows the date
  per class, with cash using the oldest latest balance across accounts.

**The stacked chart.** `StackedAssetChart` draws one stacked area per class
(stocks, crypto, cash, pensions, gold) from `totalAssetsSeries`, the single
definition of total assets by date. Only `/net-worth` draws it, above the
balances and a month-end table (Month, Stocks, Crypto, Cash, Pensions, Gold,
Total). The last point is today's `getNetWorth()` figures, so it equals the
Overview's Total assets card. A class contributes nothing before its data
starts; it is never drawn as zero mid-series and never interpolated, and a note
under the chart lists where each class starts. Pensions move only on
certificate and snapshot dates, so the note says so.

## Type and colour

Sizes are named by role in `tailwind.config.ts` — `micro` 10, `label` 11,
`caption` 12, `body` 13, `body-lg` 14, `title` 18, `metric` 28, `hero-sm` 36,
`hero` 42. There were 514 arbitrary `text-[Npx]` literals across sixteen sizes
before that.

The lead figure is the only thing set at hero size: `MetricHeroCard` is
`text-hero-sm sm:text-hero` (36 below `sm`, 42 from it). The companion figures
beside it on Overview are `text-metric`. A second hero-sized number on a screen
means none of them leads. `tests/ui-primitives.test.ts` pins it (`MetricHeroCard
renders the hero at 36px on a phone and 42px from sm`).

Korean labels are set solid. Letter-spacing opens up uppercase Latin and pulls
Hangul apart, so `Label` and the table header carry `[&:lang(ko)]:tracking-normal`, pinned by
`Label sets Korean solid` in `tests/ui-primitives.test.ts`.

Colours are tokens (`text-ink-3`, `bg-surface`, `border-line`) bound to CSS
variables in `styles/jp-theme.css`.

### Gradients and first-load motion

A screen carries at most three gradients: the sidebar marker (`--gradient-mini`
in `SidebarNav`), one title mark, and the lead card's accent bar. The title mark
is `t-emph-gradient` when the header renders `emphasis`; otherwise `PageHeader`
adds `ai-page-header` (the tick), so a header never carries both.
`tests/gradient-budget.test.ts` pins the files that may name a gradient; a new
file that does fails it until the budget is argued again. It also fails on any
inline `linear-gradient(` in `app/`, `components/` or `styles/` other than the
`--gradient-*` token definitions in `styles/globals.css`; swatches and share
bars use solid colours from `lib/palette.ts`.

Motion happens once. `components/EntranceMotion.tsx` sets `data-entered` on
`<html>` 800 ms after mount (the last staggered child ends at 750 ms), and the stagger rule is
`:not([data-entered]) .jp-stagger > *` inside `prefers-reduced-motion:
no-preference`. A client-side navigation after the first load therefore does not
replay the fade, and nothing animates under reduced motion. The first-load fade
and `EntranceMotion` tests sit in `tests/gradient-budget.test.ts`.

### Warning contrast

`--accent-warning` is `#8F570A`: 4.79:1 in its 10% pill on the surface, 5.15:1
in the pill on white and 5.50:1 as plain text. The `EmptyState` hint is
`text-ink-3`. `the warning token clears AA inside its own pill` and `EmptyState
hint is full-strength tertiary` in `tests/ui-primitives.test.ts` hold the ratios,
and `pnpm ui:a11y` (axe) checks the pages; do not lighten the token to make a
pill look softer.

### Already decided

These were rulings in the second plan and are still true: P/L colour is Western
(green for 0 and above, red below; decision 7), there are no dark tokens
(decision 8), and `/review` stays slim (decision 10).

### Status colour

`lib/tone.ts` owns the meaning-to-colour step. A status that says how much
something needs the reader maps to one of five severities, and the severity
alone picks the tone: `quiet` neutral, `info` info, `ok` success, `attention`
warning, `problem` danger. Two statuses that mean the same can then no longer
be drawn in different colours, and `quiet` (nothing to do) stays distinct from
`info` (worth knowing).

- **Read a status through a table.** `statusTone(TABLE, value)` for a string
  status, `countTone(TABLE, count)` for a count (`TO_REVIEW_SEVERITY`,
  `FAULT_SEVERITY`, `CAVEAT_SEVERITY`, `TAX_DUE_SEVERITY` differ in whether zero
  is `ok` or only `quiet`). Add a status as a table row, not a ternary: a
  ternary decides zero and null its own way, and its branches can be swapped
  without anything objecting (G5).
- **Category colours are not severities.** A sell is not worse than a dividend.
  Categories read a named `Record<string, Tone>` through
  `categoryTone(map, value, fallback)`, so the colour is chosen in `lib/tone.ts`
  and not in a page-local function.
- **A plain figure or bar takes `toneTextClass` or `toneBgClass`**, static
  tables, so Tailwind still sees every class.

### The accent bar

`accent` on a `Card` is the page's lead figure, the one to read first. Use it
once per page and never bind it to a condition: a conditional bar turns into a
status light, and a second one means none of them stands out (G8). A card that
lists problems says so with `issues={{ count, severity? }}`, which puts a count
badge beside the title (`attention` unless you pass `problem`) and needs a
`title`. Give that card an `id` so a header status can link to it.

### Words in badges

Market codes (`KR`, `US`, `CRYPTO`) stay raw: the code is the name. Every other
enum value in a badge reads a copy map, `labels[value] ?? value`, so the reader
sees a word in their language and an unknown value still shows instead of a
blank (G13). Properties named `market`, `ticker` or `label` are exempt.

**`styles/jp-theme.css` is shared with `nextjs-react-notion-x`.** Changing a
token there splits the two projects unless both move together. Two known items
are waiting on that decision: the `--text-tertiary` contrast fix (`#74736D` →
`#72716B`, which takes it from 4.40:1 to 4.53:1 on the surface background) and
the gradient-clipped `h1`, whose cyan stop is 1.7:1 on white.

## The mistake this codebase keeps making

**Two Tailwind utilities that set the same property, on one element.** Tailwind
does not resolve that by the order you wrote them — both land in the stylesheet
and the one emitted later wins.

It is completely silent. Types pass, lint passes, the build passes. It has
already made two font sizes dead letters (`DataTable` asked for `text-[12px]`
and rendered 13px on all thirty-five tables) and produced three more regressions
mid-refactor.

`pnpm ui:guardrails` catches it in literal class strings. It cannot see a
className assembled by `clsx` from variables, or one component's `className`
prop landing on another's — that is what the screenshot net is for.

## The guardrail baseline

The conflict check above, and the dead-opacity check beside it (an opacity
modifier on a `var()` colour, which generates no CSS), allow no findings at all. The rest of `pnpm ui:guardrails` is **counted checks**: each
one looks for a mistake the tree already contains, too many to fix in one pull
request, so it records how many each file has and stops the count from growing.

| check | catches |
|---|---|
| G1 `inline-language-branch` | copy picked with `language === 'ko'` in a component instead of a copy module |
| G2 `hangul-literal` | Korean written into a component, which the language toggle cannot switch |
| G3 `english-prose-literal` | English sentences written into a component, which never reach the Korean page |
| G4 `hand-written-grid` | a `grid-cols-*` class outside `components/layout.tsx` |
| G5 `inline-sign-tone` | a colour picked by a ternary between two tones instead of `signTone`, `Signed`, a severity table or a named map |
| G6 `null-literal` | a missing value written as `'n/a'` or `'—'` instead of by a formatter |
| G8 `accent-per-page` | an `accent` bound to a condition, or a second bare `accent` on a page |
| G9 `date-format-without-language` | `fmtDateTime` or `fmtDateShort` called without the language, so it prints English |
| G10 `browser-locale-number` | `toLocaleString()` or `toLocaleDateString()`, which formats in the server's locale and then the browser's |
| G11 `bare-footnote` | a footnote written as a bare `<p className="… text-ink-3">` |
| G12 `english-in-korean-copy` | an English word left in the `ko` half of a copy module (`lot`, `snapshot`, `pnpm refresh`) |
| G13 `raw-enum-badge` | `<Badge>{row.status}</Badge>`: an enum code shown where a copy label belongs |
| G14 `form-page-polls` | a route folder with `SubmitButton` or `ConfirmSubmitButton` and no `autoRefresh={false}` |

Each of these mistakes passes everything else: types, lint and build.

The counts live in `scripts/ui-guardrails.baseline.json`, as check id → file →
count. A run fails when any file has more hits than its recorded count, and a
file missing from the baseline counts as zero. So **a pull request may only
lower a count**. When you fix some, the run passes and prints a hint; lower the
record in the same pull request so the fix cannot quietly come back:

```bash
node scripts/ui-guardrails.mjs --update-baseline
```

Never run that to make a failing check pass. A higher number in the baseline
diff is the thing a reviewer should stop at. The one legitimate exception is a
moved or renamed file: its hits fail as a new path while the old path prints a
hint, so update the baseline, and the reviewer checks that the diff only moves
counts from one path to the other.

A grid that really belongs to one page (a layout the primitives have no reason
to know about) can be marked with a `guardrail:allow grid` comment on its line or
the line above, and G4 skips it. Say why in the same comment.

G12 does not read what is not a word: a `className=` value, an operand of `===`
or `!==`, a backticked span inside a literal (`` `make pull-prod-db` ``), an
identifier token (one holding `@`, `::`, an inner `.` or `_`, or a camelCase
hump, such as `tax-policy.json에서` or `bankInflowRules에`), a path token, and
the codes, acronyms and names on its allow-list (`KO_LATIN_ALLOW` in
`scripts/ui-guardrails.mjs`). A command in a Korean sentence is reworded, not
allowed: `pnpm refresh를 실행하세요` becomes `갱신을 실행하세요`. Backticks are
for a command or identifier the `en` half shows the same way, not a way around
rewording a word that can be translated.

## Checking a change

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm ui:guardrails && pnpm build
```

CI runs all of these. `next build` is not optional: a page exporting both
`metadata` and `generateMetadata` passes `tsc` **and** `lint`, and only `build`
rejects it.

### The screenshot net

```bash
pnpm seed:sample
pnpm exec next dev -p 3143          # not `pnpm dev` — it is pinned to 3101, the production port
pnpm ui:snap --base http://127.0.0.1:3143 --out /tmp/before
# …make the change…
pnpm ui:snap --base http://127.0.0.1:3143 --out /tmp/after
pnpm ui:compare /tmp/before /tmp/after
```

29 routes × two languages × two widths, plus one extra Overview pass per
language and width in the all-assets view (`--all` files): 120 files, diffed by
content hash. A refactor that should change nothing must report **0 changed**;
that is the whole claim of most of the phases in this refactor.

The 29 are every page that renders its own content on the sample database
(`/tax-planning/plans/none` is in on purpose: its not-found page is the empty
state). Routes that only redirect (`/positions`, `/positions/KR`,
`/tax-planning/plans`) are not visited, since they would capture `/holdings`
and `/tax-planning` twice. Nor is the rebalance proposal detail
(`/rebalance/proposals/[id]`): the sample state holds no proposal, so there is
nothing for it to render. Its markup is pinned instead by the class-string
assertions in `tests/ui-primitives.test.ts`, added in R2. The saved-plan detail
page with a real plan (`/tax-planning/plans/[id]`) is, like the proposal page,
not in the net: only its not-found state is. `a11y-audit` and
`mobile-audit` keep the same list in the same order; add a new page to all
three.

Three things will waste your afternoon otherwise:

- **A baseline from another worktree is not a comparison.** `seed-sample.mjs`
  stamps `ingested_at` and the absolute data directory into the database, so a
  fresh seed under a different path moves ten pages for reasons that have
  nothing to do with your diff. Capture both sides in one worktree against one
  database, varying only the code — `git stash push -u`, capture, `git stash
  pop`, capture.
- **Restart the dev server after any `next build` in the same worktree**, and
  `rm -rf .next` first. Both write there, and the capture that follows otherwise
  reports every page as changed.
- **The net masks the AutoRefresh control** — it holds a wall clock. `0 changed`
  therefore proves the pages *around* it did not move, not that it did not.
  Measure that one directly.

### Accessibility and phone width

```bash
pnpm ui:a11y --base http://127.0.0.1:3143      # axe-core, WCAG 2.0/2.1 A + AA
pnpm ui:mobile --base http://127.0.0.1:3143    # sideways scroll, touch targets at 375px
pnpm ui:shape --base http://127.0.0.1:3143     # card budget and lead position, see Page order
```

All three need a running sample server, so none is in CI. Run them when you touch
layout.

The a11y and mobile audits cover `/net-worth` and `/pension`, and run one extra pass over `/` with
the `stock-observatory-asset-view=all` cookie so the stacked chart is checked.

Do not audit accessibility by reading the source. The hand survey that started
P4 was wrong in both directions — it flagged seven selects that were wrapped in
`<label>` elements and missed both real failures, which axe found in a minute.

`ui:mobile` deliberately ignores links inside table rows and sort headers. Those
are inline targets, which WCAG 2.2 SC 2.5.8 exempts, and giving each a 24px box
would change the row height of every dense table in the app.

A disclosure `<summary>` keeps its 24px target with `min-h-6 … leading-6`, not
`flex`: `flex` drops the disclosure marker in Chromium. An inline text link uses
`inline-flex min-h-6 items-center`.

Expect zero a11y violations and zero mobile routes over. `ui:shape` is run in
both languages.

## Never point any of this at real data

`snap-ui`, `a11y-audit` and `mobile-audit` all visit every page. Run
`pnpm seed:sample` first — it refuses while `.env.local` exists — and serve
that. The scripts default to a port that is deliberately not the usual dev port
for the same reason.
