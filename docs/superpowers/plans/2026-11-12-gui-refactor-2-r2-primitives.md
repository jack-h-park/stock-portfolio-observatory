# GUI Refactor 2, R2: Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the pages the primitives they re-implemented by hand since the first refactor, replace every hand-written copy with the primitive, and prove with the screenshot net that each pull request changes no pixel except the ones it lists.

**Architecture:** Five pull requests, each pixel-neutral by construction: a primitive is added whose class strings equal the copies it replaces, the copies are swapped for it, and `scripts/snap-ui.mjs --compare` against a baseline captured in this worktree at the base commit reports `0 changed` (or exactly the intended changes the PR body lists). Primitives that emit `grid-cols-*` live in `components/layout.tsx` (the one file the G4 guardrail exempts); the others live next to their kin. Surfaces the net does not visit are pinned by a class-string unit test (`tests/ui-primitives.test.ts`, `renderToStaticMarkup`). The guardrail baseline drops: G7 (metric value size) to zero, G4 (hand-written grids) by the strips, rows and splits converted, G11 (bare footnotes) by the `Note` sites converted, G5 by the five sign ternaries.

**Tech Stack:** Next.js 15 app router, React 19 server components (every new primitive is hook-free and importable from `'use client'` files), Tailwind 3 with the tokenized theme, `node:test` through `tsx --test`, Playwright (installed) for the screenshot net, the R0 guardrail script.

**Spec:** The second GUI refactoring plan (Claude Docs, 2026-10-30): "재사용성 진단" (the table of re-implemented patterns, the palette, the dead code) and "R2 — 프리미티브 보강 (5 PR, 각 PR 스크린샷 0 changed)". Four read-only inventories with every site, exact class string and proposed API are in the SDD workspace (`inventory-a-metrics-strips.md`, `inventory-b-chips-tabs-palette-tone.md`, `inventory-c-panels-notes-headings.md`, `inventory-d-ui-structure-and-snapshots.md`); their line numbers go stale as tasks land, their class strings do not.

## Global Constraints

- Repo text (code, comments, commit messages, PR titles and bodies) is English only. No real figures or identifiers from the maintainer's data anywhere.
- No new npm dependencies.
- Pixel rule: a task is pixel-neutral unless its brief lists an intended change. The controller captures `tests/__screenshots__/after` after each task and runs `node scripts/snap-ui.mjs --compare tests/__screenshots__/baseline tests/__screenshots__/after`; the result goes into the review package. An unlisted `changed` file is a defect in the task. The baseline is recaptured by the controller only after a task that adds routes (Task 1) or after an intended change is accepted.
- Every new primitive emits the exact class strings the inventory records for the sites it replaces, as static lookup tables (Tailwind must see the literals). No primitive takes `className` for padding, size, colour or margin: those are props with a bounded set of values (a page's margin is a `spacing` value; a one-off margin not in the table is an intended change or stays hand-written).
- Primitives are hook-free, have no `'use client'`, and import only client-safe modules (`clsx`, `next/link`, `@/lib/tone`, `@/lib/position-url`, `@/lib/format`): `components/TaxPlanTimeline.tsx`, `components/charts.tsx`, `app/error.tsx` are client files that will import them. Never import `lib/adapters/portfolio-db.ts` from a component.
- A primitive that emits `grid-cols-*` lives in `components/layout.tsx` (exempt from G4). Anything else goes in the module its kin live in (`components/ui.tsx` until Task 9 splits it, then the split module).
- Props that carry text are `ReactNode` (values hold `<Signed>`, hints hold fragments). Lists keyed by the caller's key, never by rendered text.
- Server-action `<form action>` props, `href`/`target`/`rel`, `role`, `id`, `aria-*` and `title` are forwarded where the replaced element carried them.
- Guardrail baseline (`scripts/ui-guardrails.baseline.json`) only goes down: run `node scripts/ui-guardrails.mjs --update-baseline` after the gates and confirm with `git diff` that no count rose. A new file with a hit (for example `Signed`'s own sign ternary moving to `components/metric.tsx` in Task 9) is lowered from the old file and raised in the new one in the same commit, net zero; say so in the report.
- `tests/ui-primitives.test.ts` (created in Task 2, extended by every later task) renders each primitive variant with `renderToStaticMarkup` and asserts the exact `class` attribute string. These tests are the gate for the surfaces the net does not visit (the proposal detail page, the open WashSaleBanner, the timeline month detail, `app/error.tsx`).
- Gates after every task: `pnpm typecheck && pnpm lint && pnpm test && pnpm ui:guardrails && pnpm build`. If `pnpm lint` fails with `Plugin "@next/next" was conflicted`, run `pnpm exec eslint --no-eslintrc -c .eslintrc.json --ext .ts,.tsx app lib components` and say so.
- Commit after each task with a conventional subject (`refactor(ui): …`, `test(ui): …`) and the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

- A value a page renders through `MetricField` has the same computed font size after the `size` prop as it had through `valueClassName`, including the four overview fields that inherited 12px from their parent (Task 2).
- The totals strip above a list table still shows `0 / N` when a filter matches nothing (Task 3: it is not a `DataTable` footer).
- A link chip that is a toggle (include children) carries no `aria-current`; a chip that is a selection carries `aria-current="true"`; a tab carries `aria-current="page"`; no `<a>` carries `aria-pressed` (Task 4).
- A `Note` child that is a `Badge` still renders inside a `<p>` without a nested block element (Task 6).
- A `ProgressBar` with a value above 100 or below 0 clamps, and a `ShareBar` segment with a zero share still shows its minimum width where the caller asks for one (Task 7).
- A zero drift delta on the saved-plan page stays neutral (not green) after the sign helpers replace the inline ternaries (Task 8).
- Every importer of `@/components/ui` compiles unchanged after the split (Task 9).

## Delivery

Five pull requests, stacked on R1-4 (`worktree-gui-refactor-2-r1d`) until the stack merges; each from its own branch, each body listing its intended pixel changes (route, language, viewport, what changed):

| PR | Tasks | Branch | Pixel changes allowed |
|---|---|---|---|
| R2-1 metric fields and strips | 1, 2, 3 | `worktree-gui-refactor-2-r2` | none (Task 1 adds routes; baseline recaptured after it) |
| R2-2 link chips and tabs | 4 | `worktree-gui-refactor-2-r2b` | overview scope/view chips: inactive weight 400 → 500 |
| R2-3 panels, notes, headings, bars, cells, rows | 5, 6, 7 | `worktree-gui-refactor-2-r2c` | the success callout border alpha 25 → 30 on `/tax-planning`; four main+side rows (listed in Task 7); the net-worth Balances/History gap |
| R2-4 palette and tone | 8 | `worktree-gui-refactor-2-r2d` | `/fx` remittance losses warning → danger; saved-plan drift losses warning → danger |
| R2-5 file split and dead code | 9 | `worktree-gui-refactor-2-r2e` | none |

Controller duties between tasks: restart the sample dev server on port 3120 (every `pnpm build` rewrites `.next`), capture `after`, compare, write the result into the review package, and after an accepted intended change move `after` to `baseline`.

---

### Task 1: The screenshot net visits every route that renders on sample data

**Files:**
- Modify: `scripts/snap-ui.mjs` (`ROUTES`), `scripts/a11y-audit.mjs`, `scripts/mobile-audit.mjs` (their route lists, for parity)
- Modify: `docs/ui-guide.md` (the screenshot-net paragraph: which routes, why the proposal detail is not there)

**Interfaces:**
- Produces: `ROUTES` in `scripts/snap-ui.mjs` gains `/cash-inflow`, `/rebalance/settings`, `/positions`, `/positions/KR`, `/taxes`, `/taxes/history`, `/taxes/records/us-2025`, `/tax-planning/plans`. The a11y and mobile audits already visit the three `/taxes` routes; give all three scripts the same list.

**Steps:**

- [ ] Read the three scripts' route lists. Confirm each new route renders on the sample database with a 200 (the a11y audit already visits `/taxes/records/us-2025`, so that id exists in the sample tax history). `/rebalance/proposals/[id]` is NOT added: the sample state has no proposal, so the page cannot render; say so in the guide.
- [ ] Add the routes to all three lists, in the same order, with a one-line comment above the new block saying these are the surfaces R2's primitives touch that the net never checked.
- [ ] Update the screenshot-net paragraph in `docs/ui-guide.md`: the net is 32 routes (count after the change) in two languages and two widths; the proposal detail page is covered by `tests/ui-primitives.test.ts` instead.
- [ ] Run the gates. Commit: `test(ui): the screenshot net visits every route that renders on sample data`. The controller recaptures the baseline after this commit (132 files expected).

### Task 2: `MetricField` sizes by prop, and `HeroAside` replaces the ten hero companions

**Files:**
- Modify: `components/ui.tsx` (`MetricField`; add `HeroAside`)
- Modify: every `MetricField` call site (99, in 18 files: `app/page.tsx`, `app/accounts/page.tsx`, `app/cash-inflow/page.tsx`, `app/crypto-premium/page.tsx`, `app/daily-briefing/page.tsx`, `app/data-map/page.tsx`, `app/data-ops/page.tsx`, `app/fx/page.tsx`, `app/income/page.tsx`, `app/net-worth/page.tsx`, `app/pension/page.tsx`, `app/positions/[market]/[ticker]/page.tsx`, `app/rebalance/page.tsx`, `app/reconciliation/page.tsx`, `app/review/page.tsx`, `app/tax-planning/components.tsx`, `app/tax-planning/opportunity-analysis.tsx`, `app/tax-settings/page.tsx`) and the ten hero-companion cards (`app/page.tsx`, `app/data-ops/page.tsx`, `app/data-map/page.tsx`, `app/positions/[market]/[ticker]/page.tsx`, `app/reconciliation/page.tsx`, `app/income/page.tsx`, `app/tax-settings/page.tsx`, `app/daily-briefing/page.tsx`, `app/crypto-premium/page.tsx`, `app/rebalance/page.tsx`)
- Create: `tests/ui-primitives.test.ts`
- Modify: `scripts/ui-guardrails.baseline.json` (G7 to zero)

**Interfaces:**
- Produces:

  ```ts
  // components/ui.tsx
  export function MetricField(props: {
    label: ReactNode; value: ReactNode; hint?: ReactNode; info?: ReactNode; tone?: Tone
    size?: 'title' | 'metric' | 'caption'   // default 'title'; emits text-title | text-metric | text-caption on the value div
    truncate?: boolean                      // adds 'truncate' to the value div
    labelClassName?: string                 // unchanged (five sites pass tracking/case utilities)
  })
  // value div: clsx('mt-1 font-medium leading-tight tabular-nums', SIZE[size], truncate && 'truncate', TONE[tone])
  export function HeroAside(props: { title: ReactNode; info?: ReactNode; note: ReactNode; children: ReactNode })
  // Card(title, info) > div.flex.min-h-[16rem].flex-col.justify-between.gap-4 > div.space-y-4 {children joined by div.h-px.bg-line-subtle} + div.rounded-md.bg-surface.px-3.py-2.text-label.leading-relaxed.text-ink-3 {note}
  ```
  `valueClassName` is removed from `MetricField`.

**Steps:**

- [ ] Create `tests/ui-primitives.test.ts` with the harness the repo's render tests use (`renderToStaticMarkup`, `globalThis.React` set; copy the pattern from `tests/page-headings.test.ts`). First tests: `MetricField` default renders a value div whose class is exactly `mt-1 font-medium leading-tight tabular-nums text-title text-ink`; `size="metric"` → `… text-metric text-ink`; `size="caption"` → `… text-caption text-ink`; `truncate` adds `truncate` before the tone class; `tone="success"` ends in `text-success`. `HeroAside` with two children renders exactly one `div.h-px.bg-line-subtle` between them and the note div with the class above. Run; expected FAIL.
- [ ] Implement the `size`/`truncate` props and `HeroAside` in `components/ui.tsx`; delete `valueClassName`. Run the test; expected PASS.
- [ ] Replace every call site: `valueClassName="text-title"` and `"text-title tabular-nums"` → no prop; `"text-metric"` → `size="metric"`; `"truncate text-title"` → `truncate`; the four fields in `app/page.tsx` market breakdown with no `valueClassName` → `size="caption"` (they inherited 12px from the parent `text-caption`; explicit caption is the same computed size). `pnpm typecheck` lists any site still passing `valueClassName`.
- [ ] Replace the ten hero companions with `<HeroAside title info note>` keeping the two `MetricField` children in their current order (income lists the title-size field first) and their props; delete the hand-written divider and note divs.
- [ ] Run `node scripts/ui-guardrails.mjs`: G7 is 0 in every file. Run `--update-baseline`; only decreases.
- [ ] Run the gates. Commit: `refactor(ui): MetricField sizes by prop and HeroAside replaces the hero companions`.

### Task 3: `StatStrip`, `MiniStatGrid` and `TotalsStrip` replace the hand-written strips

**Files:**
- Modify: `components/layout.tsx` (add `StatStrip`/`Stat`, `MiniStatGrid`/`MiniStat`, `TotalsStrip`/`Total`)
- Modify: `app/rebalance/proposals/[id]/page.tsx` (two strips, delete local `Figure`), `app/tax-planning/plans/[id]/page.tsx` (two strips), `components/TaxPlanTimeline.tsx` (one strip), `app/health/page.tsx` (three tile grids), `app/page.tsx` (the term-split tiles), `app/holdings/page.tsx`, `app/lots/page.tsx`, `app/realized/page.tsx`, `app/cost-basis/page.tsx` (totals)
- Modify: `tests/ui-primitives.test.ts`, `scripts/ui-guardrails.baseline.json`

**Interfaces:**
- Produces, in `components/layout.tsx`:

  ```ts
  export function StatStrip(props: { columns: 'md-4' | 'lg-4' | 'sm-5'; children: ReactNode })
  // 'grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line-subtle bg-line-subtle' + { 'md-4': 'md:grid-cols-4', 'lg-4': 'lg:grid-cols-4', 'sm-5': 'sm:grid-cols-5' }
  export function Stat(props: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone; size?: 'title' | 'body-lg'; dense?: boolean })
  // div.bg-card.px-3 + (dense ? 'py-2.5' : 'py-3') > Label size="micro" {label} + div.mt-1.font-medium.tabular-nums + (text-title | text-body-lg) + tone class (neutral → text-ink) ; sub → div.mt-0.5.text-label.tabular-nums.text-ink-3
  export function MiniStatGrid(props: { columns: 3 | 2 | 'sm-4'; spacing?: 'mt-3'; children: ReactNode })
  // clsx(spacing, 'grid gap-3 text-caption', { 3: 'grid-cols-3', 2: 'grid-cols-2', 'sm-4': 'sm:grid-cols-4' })
  export function MiniStat(props: { label: ReactNode; value: ReactNode; tone?: Tone })
  // div > div.text-caption.text-ink-3 {label} + div.font-medium.tabular-nums.text-{tone|ink} {value}   (no size, no mt-1, no leading-tight)
  export function TotalsStrip(props: { columns: 3 | 4 | 5; children: ReactNode })
  // 'grid gap-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-caption' + { 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4', 5: 'sm:grid-cols-5' }
  export function Total(props: { label: ReactNode; value: ReactNode; tone?: Tone })
  // div > Label {label} + div.font-medium.tabular-nums.text-{tone|ink} {value}
  ```
  `Stat` tone for the two strips that computed a class from a sign (`plans/[id]` strip C, `TaxPlanTimeline` strip D) is computed by the caller exactly as today (`>0 success, <0 warning, else neutral` for C; the existing per-cell tones for D) so no colour changes in this task; Task 8 revisits the sign rule.

**Steps:**

- [ ] Add class-string tests for every variant above to `tests/ui-primitives.test.ts` (one assertion per emitted container and cell class). Run; expected FAIL.
- [ ] Implement the six components in `components/layout.tsx` (import `Label` and `Tone` from `@/components/ui`; `layout.tsx` stays hook-free). Run the test; expected PASS.
- [ ] Replace: the two proposal strips (`StatStrip columns="md-4"`, `Stat` with `sub` where `Figure` had one; delete `Figure`); the two saved-plan strips (`md-4` and `lg-4`, the second with caller-computed `tone`); the timeline strip (`sm-5`, `Stat dense size="body-lg"` with its per-cell tones); the three health tile grids (`MiniStatGrid columns={3} | {2} | "sm-4"`, `MiniStat` with the tones the tiles carry); the overview term-split tiles (`MiniStatGrid columns={3} spacing="mt-3"`); the four list totals (`TotalsStrip columns={4|3|4|5}` with `Total` cells, passing `<Signed>` as the value where the page did, and `tone` for the two cost-basis cells that compute one). Leave strips E (`tax-planning/components.tsx` divide-x) and F (`opportunity-analysis.tsx` per-cell borders) hand-written; they are not this recipe.
- [ ] `tests/holdings-columns.test.ts` reads the holdings page source for `{ key: '…', label: copy.…` shapes; write the totals as JSX children, not an items array, so the test keeps passing.
- [ ] Run `node scripts/ui-guardrails.mjs`: G4 drops by 13 (proposal page 4 → 2, saved-plan page 4 → 2, `TaxPlanTimeline` 1 → 0, health 3 → 0, overview 4 → 3, holdings/lots/realized 1 → 0 each, cost-basis 2 → 1). Run `--update-baseline`; only decreases.
- [ ] Run the gates. Commit: `refactor(ui): stat, mini-stat and totals strips as layout primitives`.

### Task 4: `LinkChips` and `Tabs` replace the chip and tab recipes

**Files:**
- Create: `components/LinkChips.tsx`, `components/Tabs.tsx`
- Modify: `components/TrendRangeLinks.tsx` (renders `LinkChips`), `app/page.tsx` (view, scope and metric chips; the include-children toggle), `app/net-worth/page.tsx` (include-children toggle, FBAR year chips), `app/rebalance/proposals/[id]/page.tsx` (tabs)
- Modify: `tests/ui-primitives.test.ts`

**Interfaces:**
- Produces:

  ```ts
  // components/LinkChips.tsx (server, no hooks; hrefs are precomputed strings)
  export function LinkChip(props: { href: string; active: boolean; variant?: 'info' | 'subtle' | 'ink'; current?: 'true' | 'page' | 'none'; title?: string; 'aria-label'?: string; scroll?: boolean; children: ReactNode })
  // info:   base 'rounded-sm border px-2 py-1 text-label font-medium'; active 'border-info bg-info/10 text-info'; inactive 'border-line text-ink-3 hover:border-info hover:text-info'
  // subtle: base 'rounded-sm border px-2 py-1 text-label'; active 'border-line bg-surface font-medium text-ink'; inactive 'border-transparent text-ink-3 hover:border-line hover:text-ink'
  // ink:    base 'inline-flex min-h-8 items-center rounded-sm border px-2.5 text-label font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-info/40'; active 'border-ink bg-ink text-card'; inactive 'border-line bg-card text-ink-2 hover:border-ink-3 hover:bg-surface hover:text-ink'
  // current: 'true' (default) → aria-current="true" when active; 'page' → aria-current="page"; 'none' → no attribute. scroll defaults to false.
  export function LinkChips<K extends string>(props: { items: { key: K; href: string; label: ReactNode; title?: string }[]; current: K; variant?: …; as?: 'fragment' | 'nav' | 'group'; label?: string })
  // 'nav' and 'group' wrap in <nav|div role="group" aria-label={label} className="flex flex-wrap items-center justify-end gap-1">
  // components/Tabs.tsx
  export function Tabs<K extends string>(props: { label: string; items: { key: K; href: string; label: ReactNode }[]; current: K; scroll?: boolean })
  // nav 'mb-5 flex flex-wrap gap-1 border-b border-line-subtle'; item base '-mb-px inline-flex min-h-8 items-center border-b-2 px-3 text-caption font-medium'; active 'border-info text-ink' + aria-current="page"; inactive 'border-transparent text-ink-3 hover:text-ink'; scroll defaults to true
  ```
  The `ink` variant is FilterBar's recipe, provided so a later phase can unify; `FilterBar.tsx` is not changed in this task.

**Steps:**

- [ ] Add class-string tests for the three chip variants (active and inactive), the three `current` modes, and the tab item (active and inactive). Run; expected FAIL.
- [ ] Implement both components. Run the test; expected PASS.
- [ ] Replace: `TrendRangeLinks` keeps its signature and renders `LinkChips` (`info`, `current="true"`); the overview view and scope chips become `LinkChip variant="info"` (intended change: their inactive state gains `font-medium`; list it); the overview metric chips become `variant="subtle"` (exact); the two include-children toggles become `LinkChip current="none"` with their `aria-label` and `title` (exact; no `aria-pressed`); the FBAR year chips become `LinkChips as="nav" label={fbarCopy.yearLabel}` with `current="page"` kept (exact); the proposal tabs become `<Tabs label={copy.title} items current>` (exact; `scroll` default true keeps today's scroll-to-top).
- [ ] Run the gates. Commit: `refactor(ui): link chips and tabs as primitives`.

### Task 5: `Panel` and `Callout` replace the inset panels and toned banners

**Files:**
- Modify: `components/ui.tsx` (add `Panel`, `Callout`)
- Modify: the 32 panel sites and 10 banner sites the inventory lists (`app/page.tsx`, `app/positions/[market]/[ticker]/page.tsx`, `app/tax-planning/opportunity-analysis.tsx`, `app/rebalance/proposals/[id]/page.tsx` (delete local `Banner`), `app/rebalance/page.tsx`, `app/tax-settings/page.tsx`, `app/tax-planning/page.tsx`, `app/health/page.tsx`, `app/tax-planning/components.tsx`, `app/tax-planning/plans/[id]/page.tsx`, `app/realized/page.tsx`, and the 16 borderless soft-note sites across `app/data-ops`, `app/page.tsx`, `app/tax-settings`, `app/cash-inflow`, `app/daily-briefing`, `app/crypto-premium`, `app/reconciliation`, `app/data-map`, `app/income`, `app/review`, `app/rebalance`, `app/positions/[market]/[ticker]`)
- Modify: `tests/ui-primitives.test.ts`, `scripts/ui-guardrails.baseline.json`

**Interfaces:**
- Produces:

  ```ts
  export function Panel(props: { as?: 'div' | 'p' | 'form' | 'a' | 'li'; pad?: 'sm' | 'md' | 'tall'; text?: 'none' | 'caption' | 'caption-2' | 'caption-3' | 'caption-note' | 'label-note'; bordered?: boolean; spacing?: 'mt-3' | 'mt-4' | 'mb-3' | 'mb-4' | 'mb-5'; layout?: 'stack-2' | 'tall' | 'span-2'; children: ReactNode } & forwarded attrs (href, target, rel, action, role, id, key))
  // clsx(spacing, 'rounded-md', bordered !== false && 'border border-line-subtle', 'bg-surface', PAD[pad ?? 'sm'], TEXT[text ?? 'none'], LAYOUT[layout])
  // PAD: sm 'px-3 py-2', md 'p-3', tall 'px-3 py-3'; TEXT: caption 'text-caption', 'caption-2' 'text-caption text-ink-2', 'caption-3' 'text-caption text-ink-3', 'caption-note' 'text-caption leading-relaxed text-ink-3', 'label-note' 'text-label leading-relaxed text-ink-3'; LAYOUT: 'stack-2' 'space-y-2', tall 'flex min-h-[15rem] flex-col', 'span-2' 'sm:col-span-2'; as='a' adds 'hover:border-info'
  export function Callout(props: { tone: 'info' | 'success' | 'warning' | 'danger'; emphasis?: 'strong' | 'soft' | 'rule'; size?: 'caption' | 'label'; relaxed?: boolean; role?: 'status' | 'alert' | 'note'; as?: 'div' | 'p'; spacing?: 'mb-3' | 'mb-4' | 'mt-3'; layout?: 'aside'; children: ReactNode })
  // strong: 'rounded-md border px-3 py-2' + size + relaxed + TONE_STYLES[tone] (the Badge triplet 'border-{t}/30 bg-{t}/10 text-{t}')
  // soft:   'rounded-md border px-3 py-2' + size + relaxed + 'border-{t}/30 bg-{t}/5 text-ink-2'
  // rule:   'border-l-2 border-{t} px-3 py-1'
  // layout 'aside' adds 'shrink-0 lg:max-w-[19rem]'
  ```

**Steps:**

- [ ] Add class-string tests: each `Panel` pad/text/bordered/layout value, `as="a"` hover class, and each `Callout` emphasis × tone combination the sites use (strong success/warning; soft warning/success; rule info/success/warning), with `size`, `relaxed`, `role`. Run; expected FAIL.
- [ ] Implement both in `components/ui.tsx`; `Callout` strong reuses the `TONE_STYLES` table. Run the test; expected PASS.
- [ ] Replace every panel site with `Panel` (the four tax-settings link tiles with `as="a" href target rel`; the two server-action forms with `as="form" action`; the opportunity-analysis grid panel keeps its hand-written inner grid as children; the four list summary strips are already `TotalsStrip` from Task 3 and are not touched). Replace the 16 borderless soft notes with `Panel bordered={false} text="label-note"` and the spacing each carries (`review` is `as="p" spacing="mb-5"`).
- [ ] Replace the banners: delete the local `Banner` in the proposal page (`Callout tone emphasis="strong" size="caption" role="status" spacing="mb-4"`); the two other proposal boxes (`strong`, `size="label"`); health (`soft warning size="label" relaxed`); components.tsx:161 (`soft warning size="caption" relaxed role="status" spacing="mt-3"`); components.tsx:125 (`soft success layout="aside"` — intended change: border alpha 25 → 30, on `/tax-planning` only; list it); the three left-rule callouts (`emphasis="rule"`). `components/WashSaleBanner.tsx` stays its own component.
- [ ] Run `node scripts/ui-guardrails.mjs`: G11 drops by one (the review soft note is no longer a bare `<p>`); G4 unchanged. Run `--update-baseline`; only decreases.
- [ ] Run the gates. Commit: `refactor(ui): Panel and Callout replace the inset panels and toned banners`.

### Task 6: `Note` and `SectionHeading` replace the footnotes and in-page headings

**Files:**
- Modify: `components/ui.tsx` (add `Note`, `SectionHeading`)
- Modify: the 55 footnote sites and the 9 heading sites the inventory lists (app pages and `components/AllocationShares.tsx`, `components/WrapperReviewCard.tsx`, `components/TaxPlanTimeline.tsx`, `components/WashSaleBanner.tsx` (its note only, not its heading), `components/DevCopyBadge.tsx`, `app/error.tsx`)
- Modify: `tests/ui-primitives.test.ts`, `tests/ui-guardrails.test.ts` only if the G11 fixtures need it (they should not), `scripts/ui-guardrails.baseline.json`

**Interfaces:**
- Produces:

  ```ts
  export function Note(props: { size?: 'label' | 'caption' | 'body' | 'micro' | 'inherit'; relaxed?: boolean; weight?: 'medium'; spacing?: 'none' | 'above-0.5' | 'above-1' | 'above-2' | 'above-3' | 'below-3' | 'below-4' | 'below-5'; tone?: 'muted' | 'warning'; row?: boolean; band?: 'top' | 'bottom'; children: ReactNode })
  // <p className={clsx(SPACING[spacing], row && 'flex flex-wrap items-center gap-2', band === 'top' && 'border-t border-line-subtle px-4 py-3', band === 'bottom' && 'border-b border-line-subtle bg-surface px-4 py-3', SIZE[size ?? 'label'], weight === 'medium' && 'font-medium', relaxed && 'leading-relaxed', tone === 'warning' ? 'text-warning' : 'text-ink-3')}>
  // SPACING: 'above-0.5' mt-0.5, 'above-1' mt-1, 'above-2' mt-2, 'above-3' mt-3, 'below-3' mb-3, 'below-4' mb-4, 'below-5' mb-5; SIZE: label text-label, caption text-caption, body text-body, micro text-micro, inherit ''
  export function SectionHeading(props: { level?: 2 | 3; size?: 'page' | 'section' | 'sub' | 'minor'; tight?: boolean; tracking?: boolean; tone?: 'default' | 'muted'; eyebrow?: ReactNode; subtitle?: ReactNode; action?: ReactNode; layout?: 'stack' | 'inline' | 'band'; spacing?: 'mb-1' | 'mb-2' | 'mt-1'; id?: string; children: ReactNode })
  // heading: clsx(SIZE[size ?? 'section'], 'font-medium', tight && 'leading-tight', tracking && 'tracking-tight', tone === 'muted' ? 'text-ink-2' : 'text-ink'); SIZE: page text-title, section text-body-lg, sub text-body, minor text-label
  // eyebrow → <Label size="micro"> above and the heading gets mt-1; subtitle → stack: <p className="mt-0.5 text-label text-ink-3">, inline: <span className="text-label text-ink-3">; action rendered after the heading in a flex row; layout 'band' wraps in <div className="mb-3 mt-7 flex flex-wrap items-baseline gap-2.5 first:mt-0">
  ```

**Steps:**

- [ ] Add class-string tests for every `Note` combination the inventory table lists (the 24 class sets, each as one assertion) and for each `SectionHeading` recipe used by the nine converted headings. Run; expected FAIL.
- [ ] Implement both. Run the test; expected PASS.
- [ ] Replace the 55 footnotes with `Note` (sizes, `relaxed`, `spacing` per the table; `tone="warning"` for the clsx site; `row` for the two flex rows; `band="top"` and `band="bottom"` for the two net-worth bands; `size="body"` and `size="micro" weight="medium"` for the two cash-inflow one-offs; `size="inherit"` for the two inherit sites). A `Note` is a `<p>`: where the children include a block element today, keep the element and say so in the report.
- [ ] Replace the headings: pension (`size="page" spacing="mb-1"`), the briefing `Band` (`size="section" tracking layout="band" subtitle`; delete the local `Band`), `tax-planning/components.tsx` headline (`size="page" tight eyebrow`), opportunity-analysis (`size="page" tight tracking action`), `TaxPlanTimeline` month heading (`level={3} size="page" action subtitle`), the hand-built tax-planning card header heading (`size="section" subtitle action`), the three proposal sub-headings (`level={3} size="minor"`), net-worth FBAR sub-heading (`level={3} size="sub" tone="muted" spacing="mb-2"`). `AllocationShares` (semibold) and `WashSaleBanner` (danger) headings stay as they are.
- [ ] Run `node scripts/ui-guardrails.mjs`: G11 reaches 0 in every file (the finder matches `<p` with `text-ink-3`; `Note` renders the `<p>` from inside `components/ui.tsx`, which G11 does not scan — confirm in the finder's roots; if `components/` is in its roots, add `components/ui.tsx` to the check's `exclude` with a one-line comment, the way `app/global-error.tsx` is excluded for G1–G3, and add a planted test). Run `--update-baseline`; only decreases.
- [ ] Run the gates. Commit: `refactor(ui): Note and SectionHeading replace the footnotes and in-page headings`.

### Task 7: `ShareBar`, `ProgressBar`, `PositionCell`, `CardRow columns="main"` and `Split`

**Files:**
- Create: `components/PositionCell.tsx`, `components/bars.tsx`
- Modify: `components/layout.tsx` (`CardRow` columns `main` | `side-main`; add `Split`)
- Modify: `app/page.tsx` (two bars, term split), `components/AllocationShares.tsx`, `app/review/page.tsx` (bar, `PositionLink`), `app/tax-planning/components.tsx` (two bars, `PositionCell`, in-card split), `app/tax-planning/plans/[id]/page.tsx` (bar, in-card split), `app/rebalance/page.tsx` (`PositionLink`), `app/income/page.tsx` (inline cell), `app/cost-basis/page.tsx`, `app/data-ops/page.tsx` (ticker cells), `app/rebalance/proposals/[id]/page.tsx` (in-card split), `app/tax-planning/page.tsx` (main row, in-card split), `app/tax-planning/opportunity-analysis.tsx` (in-card split), `app/crypto-premium/page.tsx`, `app/net-worth/page.tsx` (main rows; the Balances/History gap)
- Modify: `tests/ui-primitives.test.ts`, `scripts/ui-guardrails.baseline.json`

**Interfaces:**
- Produces:

  ```ts
  // components/bars.tsx
  export function ShareBar(props: { segments: { key: string; pct: number; className?: string; style?: CSSProperties; title?: string }[]; height?: 'sm' | 'md' | 'lg'; track?: 'surface' | 'subtle'; spacing?: 'mt-5'; ariaHidden?: boolean })
  // track clsx(spacing, 'flex overflow-hidden rounded-pill', H[height ?? 'lg'], T[track ?? 'surface']); H: sm h-1.5, md h-2, lg h-3; T: surface bg-surface, subtle bg-line-subtle; each segment div.h-full + className + style={{ width: `${pct}%`, ...style }} + title
  export function ProgressBar(props: { pct: number; tone?: 'success' | 'warning' | 'info'; height?: 'sm' | 'md'; track?: 'surface' | 'subtle'; roundedFill?: boolean; spacing?: 'mt-1' | 'mt-1.5' | 'mt-4' })
  // clamps pct to [0, 100]; track clsx(spacing, 'overflow-hidden rounded-pill', H, T); fill clsx('h-full', roundedFill && 'rounded-pill', 'bg-' + tone)
  // components/PositionCell.tsx
  export function PositionCell(props: { market: string; ticker: string; name?: string | null; showMarket?: boolean; layout?: 'stacked' | 'ticker' })
  // stacked: div.min-w-[14rem] > div.flex.items-center.gap-2 (Badge tone=marketTone(market) {market} + Link 'font-mono text-caption font-medium text-info hover:underline' {ticker}) + div.mt-1.max-w-[20rem].truncate.text-caption.font-medium.text-ink {name}
  // ticker: just the Link (showMarket ignored)
  // components/layout.tsx
  // CardRow columns adds 'main': 'xl:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]' and 'side-main': 'xl:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]'
  export function Split(props: { side: '18rem' | '20rem' | '26rem'; at: 'md' | 'lg' | 'xl'; gap: 3 | 4 | 5; sideFirst?: boolean; children: ReactNode })
  // a static table of the five templates the inventory lists: 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]', 'grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]', 'grid gap-3 md:grid-cols-[1fr_18rem]', 'grid gap-4 xl:grid-cols-[1fr_26rem]', 'grid gap-5 xl:grid-cols-[20rem_minmax(0,1fr)]' (sideFirst) — unknown combinations throw at render so the table stays the source
  ```

**Steps:**

- [ ] Add class-string tests for the bar variants, the cell layouts, the two `CardRow` columns and the five `Split` entries. Run; expected FAIL.
- [ ] Implement. `PositionCell` imports `positionHref` from `@/lib/position-url` and `Badge`/`marketTone` from `@/components/ui`. Run the test; expected PASS.
- [ ] Replace the seven bars (the overview market bar keeps its gradient `style`, separators and 1% minimum at the call site; `AllocationShares` passes `ariaHidden`; the review bar uses `roundedFill track="surface"`), the four stacked position cells (`review`, `rebalance`, `tax-planning/components`, `income`; delete the two `PositionLink`s and `PositionCell` locals), the three ticker-only cells (`layout="ticker"`). Holdings/lots/realized block links and the reconciliation "name (ticker)" cells stay (their comments say the whole-cell link is deliberate; recorded for R6).
- [ ] Convert the four main+side rows to `CardRow columns="main"` (`cost-basis`, `tax-planning`, `crypto-premium`) and `columns="side-main"` (`net-worth`, which also fixes the `md:col-span-2` on a one-column grid); delete the `className` spans. Intended changes to list per route at desktop and mobile: cost-basis gap 12 → 20px and bottom margin 16 → 20px; tax-planning side column 0.8fr → 18–24rem; crypto-premium side 1/3 → 18–24rem; net-worth side column fixed width and the span bug gone. Wrap net-worth Balances and History in `CardRow columns={1}` so a 20px gap appears between them (intended change), and give the FBAR card `spacing="above"` instead of `className="mt-5"`.
- [ ] Convert the five in-card splits to `Split` (exact).
- [ ] Run `node scripts/ui-guardrails.mjs`: G4 drops by the two page rows and five splits (7). Run `--update-baseline`; only decreases.
- [ ] Run the gates. Commit: `refactor(ui): bars, position cell, main-and-side rows and splits as primitives`.

### Task 8: One palette module, `Tone` in `lib/tone.ts`, and the sign helpers everywhere a sign decides a colour

**Files:**
- Create: `lib/palette.ts`
- Modify: `lib/tone.ts`, `components/ui.tsx`, `components/charts.tsx`, `app/net-worth/page.tsx`, `components/AllocationShares.tsx` (only if it reads the maps), `components/TaxPlanTimeline.tsx`, `app/positions/[market]/[ticker]/page.tsx`, `app/fx/page.tsx`, `app/tax-planning/plans/[id]/page.tsx`
- Modify: `tests/ui-guardrails.test.ts` only if G5 fixtures change (they should not), `scripts/ui-guardrails.baseline.json`; create `tests/palette.test.ts`

**Interfaces:**
- Produces:

  ```ts
  // lib/tone.ts
  export const TONES = ['neutral', 'info', 'success', 'warning', 'danger'] as const
  export type Tone = (typeof TONES)[number]
  export function deltaTone(value: number | null | undefined): Tone   // > 0 success, < 0 danger, else neutral
  // lib/palette.ts (no 'use client')
  export const TONE_VAR: Record<Tone, string>   // moved from charts.tsx, same values
  export function marketColor(market: string): string   // moved from charts.tsx, same body
  export const ASSET_CLASS_COLOR: Record<'stocks' | 'us_equity' | 'kr_equity' | 'bonds' | 'gold' | 'crypto' | 'pensions' | 'pension' | 'cash' | 'unclassified', string>  // the union of ASSET_COLORS and CLASS_COLORS, same values
  export const WRAPPER_COLOR: Record<'taxable' | 'isa' | 'pension', string>
  export const CHILDREN_COLOR: string
  ```
  `components/ui.tsx` imports `Tone` from `@/lib/tone` and types `TONE_STYLES` as `Record<Tone, string>`; it keeps `export type { Tone }` and `export { marketTone }` so the ten importers compile unchanged. `components/charts.tsx` keeps `export { marketColor }` as a re-export.

**Steps:**

- [ ] Write `tests/palette.test.ts`: `ASSET_CLASS_COLOR.crypto === marketColor('CRYPTO')`; `ASSET_CLASS_COLOR.pensions === ASSET_CLASS_COLOR.pension`; every `TONES` entry has a `TONE_VAR`; `deltaTone(0) === 'neutral'`, `deltaTone(-1) === 'danger'`, `deltaTone(null) === 'neutral'`. Run; expected FAIL.
- [ ] Create `lib/palette.ts`, move `TONE_VAR` and `marketColor` out of `charts.tsx` (re-export there), replace `ASSET_COLORS` in `charts.tsx` and `CLASS_COLORS`/`WRAPPER_COLORS` in `net-worth` with the palette (same values: pixel-neutral). Move `Tone` into `lib/tone.ts`; add `deltaTone`. Run the test; expected PASS.
- [ ] Sign hits: `TaxPlanTimeline` month gain → `signClass(month.gainKrw)`; the two positions page gain cells → `signClass(…)`; the two `/fx` remittance fields → `tone={signTone(…)}` (intended change: a negative value turns danger instead of warning, on `/fx` only); the saved-plan drift cells → `deltaTone(toneValue)` mapped to the text class (intended change: a negative delta turns danger instead of warning; zero stays neutral). The fourteen status ternaries stay (R3 owns the status vocabulary); `Signed`'s own ternary stays.
- [ ] Run `node scripts/ui-guardrails.mjs`: G5 drops by 5 (`TaxPlanTimeline` 1 → 0, positions 4 → 2, fx 2 → 0). Run `--update-baseline`; only decreases.
- [ ] Run the gates. Commit: `refactor(ui): one palette module, Tone owned by lib/tone, sign helpers for every sign-coloured value`.

### Task 9: `components/ui.tsx` becomes a barrel over four modules, and the dead code goes

**Files:**
- Create: `components/card.tsx`, `components/metric.tsx`, `components/table.tsx`, `components/controls.tsx`
- Modify: `components/ui.tsx` (barrel: re-exports everything, including `Panel`, `Callout`, `Note`, `SectionHeading`, `HeroAside` which go to `card.tsx` (`Panel`, `Callout`, `HeroAside`) and `metric.tsx` (`Note`, `SectionHeading`)), `components/DataTable.tsx`, `app/tax-planning/page.tsx` (InfoTooltip → HelpPopover), `components/AccountTimeline.tsx`, `components/LanguageProvider.tsx`, `components/charts.tsx`, `components/form.tsx` (drop `export` on the five internal names), `lib/glossary.ts` (delete the six unread keys and `GlossaryKey` if unused), `styles/jp-theme.css` (dead `.t-*` classes, their `--t-*`/`--lh-*`/`--tr-*` variables, the dark-mode block, `.jp-card-hover`), `docs/ui-guide.md` (where the primitives live)
- Delete: `components/GlossaryTerm.tsx`
- Modify: `scripts/ui-guardrails.baseline.json` (G5 `components/ui.tsx: 1` moves to `components/metric.tsx: 1`)

**Interfaces:**
- Produces: `components/card.tsx` (`Card`, `MetricHeroCard`, `EmptyState`, `HeroAside`, `Panel`, `Callout`), `components/metric.tsx` (`MetricField`, `Signed`, `Label`, `MetaRow`, `MetaItem`, `Note`, `SectionHeading`), `components/table.tsx` (`Table`, `Thead`, `Th`, `Tbody`, `Tr`, `Td`), `components/controls.tsx` (`Button`, `SegmentedControl`, `TextLink`, `Badge`, `TONE_STYLES`); `components/ui.tsx` re-exports all of them plus `type Tone` and `marketTone` from `@/lib/tone` and `HelpPopover` (the `InfoTooltip` alias is removed; its four readers import `HelpPopover`). `DataTable` becomes `DataTable<Row = any>` with `columns: DataTableColumn<Row>[]`, `rows: Row[]`, `getRowKey?: (row: Row, i: number) => …`, `renderExpanded?: (row: Row) => ReactNode`, and a `size?: 'body' | 'caption'` prop passed to `Table` (default `body`, so no call site changes). `Card`'s unused `hover` prop is removed with `.jp-card-hover`.

**Steps:**

- [ ] Move the components into the four files with no edits to their bodies (git should show pure moves plus import lines); `card.tsx` imports `Label` from `./metric`; `metric.tsx` imports `Badge`? (it does not; `Note`/`SectionHeading` import `Label` from the same file). Keep `components/ui.tsx` as the barrel so the 46 importers compile unchanged. Run `pnpm typecheck`.
- [ ] Rename the `InfoTooltip` readers to `HelpPopover` and drop the alias. Remove the `export` keyword from `TimelineAxis`, `useCurrencyPreferences`, `marketColor` (now in `lib/palette.ts`; the `charts.tsx` re-export stays for one release and says so), `StackedAssetPoint`, `ControlSize`. Delete `components/GlossaryTerm.tsx` and the six glossary keys nothing reads (`fx`, `taxLot`, `longTerm`, `shortTerm`, `concentration`, `degraded`) in both languages, plus `GlossaryKey` if it has no reader left.
- [ ] `DataTable` generic + `size` as the Interfaces block says; `tests/data-table-expanded.test.ts` must keep passing unchanged. Remove `Card`'s `hover` prop and `.jp-card-hover`; delete the dead `.t-*` classes, their variables and the dark-mode block from `styles/jp-theme.css` (keep `.t-h2`, `.t-eyebrow`, `.t-emph-gradient`, `.ai-page-header`, `.jp-stagger`, `--t-body`, `--lh-body`, `--t-h2`/`--lh-h2`/`--tr-h2`, `--t-eyebrow`/`--tr-eyebrow`); add a two-line comment at the top of the file saying it is a copy, not shared, and which classes are live.
- [ ] `docs/ui-guide.md`: the "Layout" table gains the strips, chips, tabs, panel, callout, note, heading, bars, cell and split rows with one line each; a new paragraph says where each primitive module lives and that `@/components/ui` stays the import path.
- [ ] Run `node scripts/ui-guardrails.mjs`: G5 `components/ui.tsx` 1 → 0 and `components/metric.tsx` 0 → 1 (edit the baseline by hand for this one move and explain it in the commit). Everything else unchanged.
- [ ] Run the gates. Commit: `refactor(ui): split components/ui.tsx into card, metric, table and controls, and remove the dead code`.
