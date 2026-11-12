# GUI Refactor 2, R0: Guardrails and Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before any UI code is cleaned up, make the rules the first refactor wrote down (and the ones it never wrote down) mechanically checkable, with a baseline so that existing violations are counted and new ones fail CI.

**Architecture:** `scripts/ui-guardrails.mjs` grows from two zero-tolerance checks into a family of counted checks, each a pure exported function over one file's source, plus a baseline file `scripts/ui-guardrails.baseline.json` holding per-check, per-file counts. The existing two checks keep zero tolerance. `tests/ui-guardrails.test.ts` gets a planted-positive and a legitimate-negative case per new check. `tests/page-headings.test.ts` stops skipping routes. A new `tests/copy-registry.test.ts` flags copy keys nothing reads.

**Tech Stack:** Node 22 ESM script (no new dependencies), `node:test` through `tsx --test`, TypeScript, Next.js app router.

**Spec:** The second GUI refactoring plan (Claude Docs, 2026-10-30), guardrail-extension section. Its table of checks G1–G11 is restated below with exact definitions; this file is the authority for the implementer.

## Global Constraints

- Repo text (code comments, docs, commit messages, the PR) is English only. Korean appears only as data the code matches or as a test fixture.
- No real account names, numbers, amounts or dates from the maintainer's data in any file, comment, test fixture or PR text. Fixtures use invented values.
- No new npm dependencies. The guardrail script stays importable without side effects: it scans the tree only when run directly (keep the existing `import.meta.url` guard).
- The two existing checks (`findConflicts`, `findDeadOpacity`) keep zero tolerance and their current output; nothing about them changes except that they share the new runner.
- Scan scope for every new check is `app/**/*.{ts,tsx}` and `components/**/*.{ts,tsx}` unless a check says otherwise. `app/global-error.tsx` is excluded from G1, G2 and G3 (it is deliberately bilingual inline because no provider is available there). Test files are never scanned.
- Scanning is line-based over the file's source after a rough comment strip: remove `/* ... */` blocks and `//` to end of line outside string literals. A simple strip is acceptable; the baseline absorbs residual noise.
- Every check reports `file:line` and a short snippet for each hit, so a failing run is actionable without re-running anything.
- A check's result is a count per file. The baseline file maps check id to `{ file: count }`. A run fails when any file's current count exceeds its baseline count (a file absent from the baseline has baseline 0). When a count is below its baseline, the run prints a one-line hint that the baseline can be lowered and still passes.
- `node scripts/ui-guardrails.mjs --update-baseline` rewrites the baseline from the current tree (keys sorted, 2-space JSON, trailing newline). The PR that introduces the baseline runs this once; its numbers are the record of the audit.
- `pnpm ui:guardrails` keeps its exit code contract: 0 when clean against the baseline, 1 otherwise. CI already runs it; no workflow change is needed unless a task says so.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm ui:guardrails && pnpm build` must pass at the end of every task. In this worktree, lint may hit the nested-ESLint-config conflict described in `docs/ui-guide.md`; if `pnpm lint` fails with `Plugin "@next/next" was conflicted`, run `pnpm exec eslint --no-eslintrc -c .eslintrc.json --ext .ts,.tsx app lib components` instead and say so in the report.
- Commit after each task with a conventional subject (`chore(ui): …`, `test(ui): …`) and the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

- A planted violation of each new check in a scratch string is reported, and the matching legitimate construction is not (Task 1, Task 2, Task 4).
- A file with a higher count than its baseline fails the run; a file missing from the baseline with one hit fails; a lower count passes with a hint (Task 1).
- `--update-baseline` output is deterministic: running it twice produces a byte-identical file (Task 1).
- `tests/page-headings.test.ts` fails, not skips, when a sidebar route's copy module has no title (Task 3).
- The two dynamic routes whose emphasis was never a trailing substring now render a gradient in both languages, and the test covers them (Task 3).
- `tests/copy-registry.test.ts` reports the overview keys the audit found unused, and after they are deleted it passes (Task 4).

## Delivery

One PR for all four tasks, on this worktree's branch. The PR body describes the checks and the baseline mechanism; it must not quote real figures.

---

### Task 1: Counted checks with a baseline, and the copy checks G1–G3

**Files:**
- Modify: `scripts/ui-guardrails.mjs`
- Create: `scripts/ui-guardrails.baseline.json`
- Modify: `tests/ui-guardrails.test.ts`

**Steps:**

- [ ] Read `scripts/ui-guardrails.mjs` and `tests/ui-guardrails.test.ts` in full. Keep `findConflicts` and `findDeadOpacity` exactly as they are.
- [ ] Add a comment-strip helper `stripComments(source)` that removes `/* … */` blocks and `//` comments that are not inside a string literal (single, double or backtick). A pragmatic implementation that tokenizes line by line is fine; document its limits in a comment.
- [ ] Add a registry of counted checks. Each check is `{ id, title, roots, exclude, find(source, file) }` where `find` returns `[{ file, line, snippet }]`. `roots` defaults to `['app', 'components']`; `exclude` is a list of exact relative paths. Export the registry as `CHECKS` and each `find` function by name so tests can call them directly.
- [ ] Implement **G1 `inline-language-branch`**: a hit for every match of `/\blanguage\s*===?\s*['"](?:ko|en)['"]/` (also `!==`/`!=`). Exclude `app/global-error.tsx`.
- [ ] Implement **G2 `hangul-literal`**: a hit for every single-, double- or backtick-quoted string literal (after comment strip) that contains a Hangul syllable (`[가-힣]`), and for every JSX text run between `>` and `<` that contains one. Exclude `app/global-error.tsx`.
- [ ] Implement **G3 `english-prose-literal`**: a hit for (a) every JSX text run between `>` and `<` on one line that contains no `{` and at least two Latin words of two or more letters, and (b) every single- or double-quoted string literal that contains a space and at least two Latin words of two or more letters, when it is the value of one of these props or keys: `title`, `subtitle`, `placeholder`, `aria-label`, `hint`, `label`, `info`, `description`, `emptyMessage`, `caption`, `detail`, `kind`, `name` (`prop="…"`, `prop={'…'}`, `prop: '…'`). Never match `className`, `href`, `src`, `key`, `id`, `type`, `role`. Exclude `app/global-error.tsx`.
- [ ] Implement the baseline: read `scripts/ui-guardrails.baseline.json` if present; compare per check and per file as the Global Constraints describe; print hits for files over baseline; print one hint line per file under baseline; exit 1 on any file over baseline. Implement `--update-baseline`. Files with zero hits are omitted from the baseline.
- [ ] Keep the final summary lines the current script prints for the two zero-tolerance checks, and add one summary line per counted check in the form `G1 inline-language-branch: <current> hit(s) in <files> file(s), baseline <sum>`.
- [ ] Run `node scripts/ui-guardrails.mjs` with no baseline and read the hits for G1, G2, G3 across the tree. Sanity check against the audit's expectations (G1 about 40, G2 about 60, G3 about 150; the tree has moved since, so treat these as orders of magnitude). Spot-read ten hits of G3 to confirm they are reader-visible prose and not class names, paths or identifiers; if more than one of the ten is noise, tighten the regex before baselining.
- [ ] Run `node scripts/ui-guardrails.mjs --update-baseline` to create the baseline, then run it again and confirm `git diff --stat` shows the baseline unchanged.
- [ ] Add tests: for each of G1, G2, G3 a planted-positive source string and a legitimate-negative string (for G3: a class list with spaces, a path, a template literal, text with `{`). Add a test that the baseline comparison logic (export it as a function taking `current` and `baseline` maps) fails on over, passes on equal, passes with hint on under, and fails on a file absent from the baseline.
- [ ] Run `pnpm test`, `pnpm ui:guardrails`, `pnpm typecheck`. Commit.

### Task 2: Layout, tone, format and footnote checks G4–G11

**Files:**
- Modify: `scripts/ui-guardrails.mjs`
- Modify: `scripts/ui-guardrails.baseline.json` (regenerated)
- Modify: `tests/ui-guardrails.test.ts`

**Steps:**

- [ ] Implement **G4 `hand-written-grid`**: a hit for every string literal containing a class that starts with `grid-cols-` (including `grid-cols-[`), in any file except `components/layout.tsx`. A line, or the line directly above it, containing the comment marker `guardrail:allow grid` is exempt.
- [ ] Implement **G5 `inline-sign-tone`**: a hit for every match of `/['"]text-(?:success|danger)['"]\s*:\s*['"]text-(?:danger|success)['"]/` and of `/['"](?:success|danger)['"]\s*:\s*['"](?:danger|warning|success)['"]/` (a sign chosen by an inline ternary instead of `signTone`/`Signed` from `lib/tone.ts` and `components/ui.tsx`).
- [ ] Implement **G6 `null-literal`**: a hit for every string literal that is exactly `n/a`, `N/A` or `—` (U+2014).
- [ ] Implement **G7 `metric-value-size`**: a hit for every match of `/valueClassName=(?:["']|\{\s*["'`])\s*text-/`.
- [ ] Implement **G8 `accent-per-page`**: scope `app/**/page.tsx` only; a hit for every occurrence of the identifier `accent` that is a JSX prop (`/(?<=\s)accent(?=[\s=>}])/`), not a class token such as `accent-danger`. The documented target is at most one per page; the baseline records the current counts.
- [ ] Implement **G9 `date-format-without-language`**: a hit for every call `fmtDateTime(` or `fmtDateShort(` whose argument list, read with a small parenthesis matcher, has no top-level comma (one argument only).
- [ ] Implement **G10 `browser-locale-number`**: a hit for every `toLocaleString(` and `toLocaleDateString(`.
- [ ] Implement **G11 `bare-footnote`**: scope `app/**` only; a hit for every `<p ` whose `className` literal contains `text-ink-3`.
- [ ] Regenerate the baseline with `--update-baseline`; read the G4 hits and confirm `components/layout.tsx` has none; read five G9 hits and confirm each is a one-argument call.
- [ ] Add tests: planted-positive and legitimate-negative per check. For G9 include a two-argument call and a nested call `fmtDateTime(row.at(0), language)` as negatives, and `fmtDateTime(toIso(x))` as a positive. For G8 include `accent-danger` as a negative. For G4 include a `guardrail:allow grid` line as a negative.
- [ ] Run `pnpm test`, `pnpm ui:guardrails`, `pnpm typecheck`. Commit.

### Task 3: Heading tests that cannot skip, and a PageHeader that refuses a dead emphasis

**Files:**
- Modify: `tests/page-headings.test.ts`
- Modify: `components/PageHeader.tsx`
- Modify: `app/rebalance/proposals/[id]/page.tsx`
- Modify: `app/positions/[market]/[ticker]/page.tsx`
- Possibly modify: `lib/ui-copy/pages/rebalanceProposal.ts`, `lib/ui-copy/pages/positionDetail.ts`

**Steps:**

- [ ] Read `tests/page-headings.test.ts`, `lib/page-names.ts`, `components/PageHeader.tsx`, and the two page files. Note which sidebar routes in `ROUTE_HREFS` are missing from `COPY_FOR` (at least `/taxes` and `/taxes/history`, added after the test was written) and which copy modules nest the title under `page.title` (`taxPlanning`, `taxSettings`).
- [ ] Change `heading()` to read `copy.title` or, failing that, `copy.page.title` (same for `emphasis`). Change both tests so that a sidebar route whose module yields no string title is an assertion failure naming the route, not a `continue`. Add the missing `COPY_FOR` entries; if a sidebar route has no copy module with a title at all, give it one from the page's existing inline strings (the `holdings` page builds its title inline today — move `title`, `emphasis` and `subtitle` for both languages into `lib/ui-copy/pages/holdings.ts` and make the page read them). Do not change any visible string.
- [ ] Add a third test for the routes outside the sidebar. For each, export a pure helper from the page's copy module or a small `lib/` helper that returns `{ title, emphasis }` for given inputs, and assert `title.endsWith(emphasis)` in both languages with an invented id/name/ticker:
  - `/rebalance/settings`: `rebalanceSettings` `title`/`emphasis` as they are.
  - `/rebalance/proposals/[id]`: today the page renders `title = \`${copy.title} ${id}\`` with `emphasis = copy.emphasis`, so the gradient never renders. Ruling: keep the title and set `emphasis = \`${copy.emphasis} ${id}\``, which is a trailing substring. Add `proposalHeading(copy, id)` next to the copy module and use it in the page.
  - `/positions/[market]/[ticker]`: today `title = detail.name`, `emphasis = detail.ticker`, never trailing. Ruling: render the heading as the instrument name with no emphasis (drop the `emphasis` prop); the header redesign in a later phase decides the final shape. Add `positionHeading(name)` returning `{ title: name, emphasis: undefined }` so the test documents the choice.
  - `/tax-planning/plans/[id]`: title is the saved plan's name with no emphasis; assert the helper returns no emphasis.
  - `/taxes/records/[id]`: read the page and cover it the same way.
- [ ] In `components/PageHeader.tsx`, when `emphasis` is given and `title` does not end with it, throw an `Error` naming the title and emphasis unless `process.env.NODE_ENV === 'production'`. In production keep the current silent fallback. Add a comment that the test above is the primary net and this is the backstop for data-driven titles.
- [ ] Run `pnpm test`. Start the sample server only if you need to confirm a page renders (`pnpm seed:sample` first; it refuses while `.env.local` exists); otherwise the tests and `pnpm build` are enough. Run `pnpm typecheck`, `pnpm ui:guardrails` (the baseline from Task 2 must still pass; if moving the holdings strings lowered a count, regenerate the baseline and say so), `pnpm build`. Commit.

### Task 4: Unused-copy test, Korean-copy check G12, and the guide

**Files:**
- Create: `tests/copy-registry.test.ts`
- Modify: `lib/ui-copy/pages/overview.tsx` (delete unused keys)
- Delete: `app/tax-settings/copy.ts` if it has no importers
- Modify: `scripts/ui-guardrails.mjs`, `scripts/ui-guardrails.baseline.json`, `tests/ui-guardrails.test.ts`
- Modify: `docs/ui-guide.md`

**Steps:**

- [ ] Write `tests/copy-registry.test.ts`: for every module in `PAGE_COPY` (from `lib/ui-copy/pages`), take the top-level keys of its `en` object and assert each key name appears, as a whole word, in at least one file under `app/`, `components/` or `lib/` excluding `lib/ui-copy/`. Read files once with `node:fs`, join them into one string per directory, and test with a word-boundary regex. Keep a small, documented `DYNAMIC_KEYS` allow-list in the test for keys that are only reached through computed access (find them by reading the failures: a key read as `copy[kind]` is not a whole-word hit). Common-word keys such as `title` will always pass; say so in a comment — the test is a net, not a proof.
- [ ] Run the test. For each failing key, grep to confirm it is unused; delete it from the copy module in both languages (the audit found eleven in `overview.tsx`: `allAssets`, `primaryMetrics`, `koreaGain`, `usGain`, `cryptoGain`, `nativeCurrency`, `totalShare`, `activitySummary` and three more). If a key turns out to be used through computed access, add it to `DYNAMIC_KEYS` with a one-line reason instead. Delete `app/tax-settings/copy.ts` if nothing imports it.
- [ ] Implement **G12 `english-in-korean-copy`** in the guardrail script: scope `lib/ui-copy/**/*.{ts,tsx}`; for each file, the Korean section is the text from the first line matching `/^\s*ko:\s*\{/` to the end of the file; a hit is every string literal in that section containing a Latin word of two or more letters that is not in the allow-list `FX, API, ISA, IRP, ETF, CSV, PDF, DB, URL, USD, KRW, US, KR, ID, PFIC, FBAR, IRS, CMA, RP, LLM, JSON, Form, W, EUR, JPY, CLI, OK` (case-sensitive, whole word) and is not a `{placeholder}` or `${…}` interpolation. Report the offending word in the snippet. Regenerate the baseline; the known hits are mostly `lot`, `snapshot`, `ticker`, `inbox` and `pnpm refresh` in `taxPlanning.ts`.
- [ ] Add planted-positive and legitimate-negative tests for G12 (an allow-listed `ETF` and an interpolation are negatives).
- [ ] In `docs/ui-guide.md`, add a section "The guardrail baseline" after "The mistake this codebase keeps making": what a counted check is, the G1–G12 list with one line each, the baseline file, that a PR may only lower counts, `--update-baseline`, and the `guardrail:allow grid` marker. Update the "Checking a change" command block if anything changed. Keep the existing tone; no Korean.
- [ ] Run `pnpm test`, `pnpm ui:guardrails`, `pnpm typecheck`, `pnpm build`. Commit.
