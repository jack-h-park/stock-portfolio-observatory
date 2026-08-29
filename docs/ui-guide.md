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
| a row of cards under the header | `<CardRow>` — `columns` 1 / 2 / 3 / `hero`, `spacing` below / above / none |
| the metric strip inside a hero card | `<KpiBand>` |
| a link beside a heading | `<TextLink>` |
| a submit button | `<SubmitButton>` — shows a pending state |
| a table | `Table` with `size`, or `DataTable` |

Do not write the grid class by hand. Fifty-one copies of five arrangements
existed before `CardRow`, which is how a fifty-second comes to differ by one
utility.

## Type and colour

Sizes are named by role in `tailwind.config.ts` — `micro` 10, `label` 11,
`caption` 12, `body` 13, `body-lg` 14, `title` 18, `metric` 28, `hero` 42,
`display` 52. There were 514 arbitrary `text-[Npx]` literals across sixteen
sizes before that.

Colours are tokens (`text-ink-3`, `bg-surface`, `border-line`) bound to CSS
variables in `styles/jp-theme.css`.

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

Nineteen routes × two languages × two widths = 80 images, diffed by content
hash. A refactor that should change nothing must report **0 changed**; that is
the whole claim of most of the phases in this refactor.

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
```

Both need a running sample server, so neither is in CI. Run them when you touch
layout.

Do not audit accessibility by reading the source. The hand survey that started
P4 was wrong in both directions — it flagged seven selects that were wrapped in
`<label>` elements and missed both real failures, which axe found in a minute.

`ui:mobile` deliberately ignores links inside table rows and sort headers. Those
are inline targets, which WCAG 2.2 SC 2.5.8 exempts, and giving each a 24px box
would change the row height of every dense table in the app.

## Never point any of this at real data

`snap-ui`, `a11y-audit` and `mobile-audit` all visit every page. Run
`pnpm seed:sample` first — it refuses while `.env.local` exists — and serve
that. The scripts default to a port that is deliberately not the usual dev port
for the same reason.
