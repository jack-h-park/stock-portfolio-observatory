# Personal Finance Observatory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a staged program: complete the bounded foundation and tax-history slice before expanding annual tax calculation or refactoring unrelated modules.

**Goal:** Reposition the existing public application as Personal Finance Observatory and deliver evidence-linked KR/US tax history without losing existing investment workflows or private records.

**Architecture:** Keep one Next.js application and the current generated SQLite read model. Separate source roots, durable private state, and rebuildable runtime; implement new tax records behind domain and persistence boundaries while retaining legacy interfaces.

**Tech Stack:** Existing Next.js 15, React 19, TypeScript, Node/tsx, Python extractors, better-sqlite3, pnpm; no new service required.

**Spec:** [Product and architecture design](../specs/2026-11-10-personal-finance-observatory-design.md)

**Status:** Foundation implemented and merged; bounded private adoption is accepted. Follow-up gold correctness and coverage display are merged and deployed; the existing-record annual tax summary #290 is also merged and deployed. The [2025-first annual tax MVP design](../specs/2026-11-12-annual-tax-estimation-mvp-design.md) has a rule/contract foundation merged in #296 without deployment and a separately authorized follow-up US ordinary/NIIT calculator PR, implemented as a pure library for review. Merge/deployment of that calculator and application activation remain unauthorized. See [execution status](../../product/implementation-status.md) for verified work and remaining gates. Implementation authorization is not authorization to rename GitHub, move archives, push/merge, deploy, or restart services. Revised after review on 2026-11-10: added evidence resolution, relink by content hash, and a single write host.

## Global Constraints

- Prioritize personal operations with publicly reusable synthetic execution.
- Preserve institution-issued source records and existing financial/tax archive paths.
- Separate estimates, returns/assessments, and settlements; separate filing and payment status.
- Scope figures by owner/tax unit, year, authority, currency, calculation scope, and coverage.
- Never infer zero tax, complete coverage, submission, payment, or acceptance from missing evidence.
- Refresh may rebuild the query DB but never overwrite durable state.
- New persisted money uses signed integer minor-unit strings: KRW scale 0 and USD scale 2.
- Keep current CLI/briefing contracts, operational paths, and old routes compatible until verified replacement.
- No whole-repository rewrite or infrastructure migration.
- Never seed synthetic data into a private configured root, including through a force flag.

## Review Focus

| Failure mode | Expected behavior | Owning task |
| --- | --- | --- |
| A legacy per-file override competes with a new root | Preserve explicit override; reject conflicting equivalent variables | Task 2 |
| Two imports/edits share one state revision | Exactly one commit; return a conflict without losing the other update | Task 4 |
| Three documents refer to one payment, or one payment covers two years | One event, explicit allocations; no document-count aggregation | Tasks 3–5 |
| An amended filing or later assessment changes an obligation | Retain versions and select a justified effective basis; no double liability | Tasks 3 and 5 |
| A fund is viewed through both pension wrapper and economic exposure | Count its value once within a total; retain independent grouping views | Task 7 |
| An evidence path is a link into another configured root | Reject it as an evidence path; require a reference to the real file | Task 5 |
| An evidence file is moved, renamed or retired after it was recorded | Report it missing; offer a hash-matched relink candidate for review; never serve another file | Task 5 |
| Two hosts each resolve a default state root | One writer by explicit setting; every other host is read-only and refuses commits | Tasks 2 and 4 |

## Program sequence

| Phase | Deliverable | Dependencies | Exit condition |
| --- | --- | --- | --- |
| P0 | Accepted definition and compatibility inventory | None | Source-backed scope and consumer inventory |
| P1 | Brand and public documentation | P0 | New definition, names, runnable sample instructions |
| P2 | Source/state/runtime boundaries | P0 | Compatible configuration and safe isolated sample |
| P3 | Tax-history vertical slice | P2 | Reviewed import/edit, history UI, evidence, restore/rebuild proof |
| P4 | All-assets overview | P2; P3 for tax summary | Reconciled totals with coverage and scope |
| P5 | Broader estimate/history integration | P3 | Separate detailed annual-tax design approved before implementation |
| P6 | Incremental module extraction and operational rename | Relevant earlier phases | Consumer parity, authorized cutover, rollback evidence |

P1 and P2 may be reviewed independently. P3 is the first functional expansion; do not hold it for a full asset-model rewrite. Treat each task as a reviewable change, not a mandatory one-commit unit. Do not promise calendar dates before the baseline and source coverage are known.

## Task 1: Establish the implementation baseline and public definition

**Files:**
- Create: `docs/product/personal-finance-observatory.md`, `docs/product/support-matrix.md`, `docs/architecture/compatibility-inventory.md`.
- Modify: `README.md`, linking the new product documents.
- Read: `config.ts`, `package.json`, `.github/workflows/ci.yml`, `deploy/`, `Makefile`, `scripts/push-sources.sh`, `lib/cli/common.ts`, `scripts/summary.mjs`, and `scripts/write-briefing-summary.ts`.

**Interfaces:** Produces an inventory with interface ID, producer, consumer, schema/version, configured path, responsible operator, validation command, and migration status. Unknown external consumers are recorded as unresolved; do not assume the repo inventory is exhaustive.

- [x] Refresh the repository/PR/worktree audit without modifying another session's checkout. Integrate the current main baseline, including PR #271, through the repository's normal development process.
- [x] Classify features as implemented, partial, planned, or unsupported using owning source files. Record investment-incremental versus annual-total tax support explicitly.
- [x] Inventory config names, outputs, schedulers, source-sync/backup jobs, cookie names, PWA metadata, links, and external consumers. Review external repositories only when needed to identify a real consumer. Include the source-sync drift report and the backup target lists, because introducing a tax root changes what a backup must cover.
- [x] Write the definition, non-goals, supported dimensions, and acceptance milestones. Use generic paths and synthetic examples in public documentation.
- [x] Verify relative links and ensure every claimed current capability has a source reference. No application test is required for this documentation-only task.

**Done:** Definition and scope are reviewable; open compatibility questions have owners and block only dependent cutovers.

## Task 2: Introduce compatible data roots and isolated sample mode

**Files:**
- Create: `scripts/finance-paths.mjs`, `tests/finance-paths.test.mjs`, `tests/sample-isolation.test.mjs`, `docs/architecture/private-storage.md`.
- Modify: `config.ts`, `scripts/env.mjs`, `scripts/seed-sample.mjs`, `.env.example`, `.gitignore`, `.github/workflows/ci.yml`.
- Migrate callers in reviewed groups: `scripts/ingest-stock-data.mjs`, `scripts/refresh.mjs`, extract/fetch scripts, CLI startup, and Python entry-point environment handoff; use the inventory to find all readers.

**Interfaces:** `resolveFinancePaths(env, cwd)` in `scripts/finance-paths.mjs` returns `{ mode, recordsDir, taxDir, stateDir, runtimeDir, dbPath, stateWritable }`, with `mode: 'sample' | 'private'`, `taxDir: string | null`, and `stateWritable: boolean` (false unless set explicitly for the writing host). `resolveFinanceFile(env, { currentName, legacyName, fallback })` returns one absolute path or throws a named configuration conflict. Both app and script callers use the same pure resolver. Preserve existing public config property names behind adapters initially.

- [x] Add tests asserting new variable precedence, legacy-only parity, empty-string treatment, identical duplicate values, conflicting equivalent values, relative path resolution, explicit per-file overrides, and missing private tax root. Pin mode inference and exact sample/private defaults from design section 10; test that operational flags alone do not select private mode. Assert that `stateWritable` is false by default in private mode and that sample mode can write only inside its own isolated roots.
- [x] Run `pnpm exec tsx --test tests/finance-paths.test.mjs`; confirm the new contract is absent before implementation.
- [x] Implement the resolver according to design section 10. Existing explicit `STOCK_*` file paths must remain effective when only a new root is supplied.
- [x] Add sample tests asserting that private configured source/state/runtime/DB paths are never changed, with and without a force flag. Use temporary synthetic directories; never run the existing seed command against the working private checkout.
- [x] Route sample outputs into isolated roots and update CI environment/configuration to select those roots. Leave public synthetic examples in the repo.
- [x] Migrate direct path readers in small groups. Pass resolved values into Python wrappers instead of implementing a second set of precedence rules.
- [x] Run the new tests plus `tests/push-sources-config.test.mjs` and existing CLI/config-related tests. Run sample seed/build only in a clean isolated test checkout or an equivalently isolated sample harness.

**Done:** Old configuration remains usable; app/CLI/scripts agree on paths; sample and private files cannot collide. Actual private state moves are deferred to Task 6.

## Task 3: Define tax-history schema and reconciliation semantics

**Files:**
- Create: `lib/domain/taxes/history.ts`, `lib/domain/taxes/reconcile.ts`, `schemas/tax-history.v1.schema.json`, `examples/tax-history.synthetic.json`, `tests/tax-history-domain.test.ts`.
- Read/reuse: `lib/tax-policy.ts`, `lib/tax-plan-store.ts`, `lib/us-tax-engine.ts`; do not change calculation behavior in this task.

**Interfaces:** Export `TaxHistoryStoreV1` containing `schemaVersion: 1`, integer `revision`, `taxUnits`, `obligations`, `returns`, `assessments`, `events`, `allocations`, `adjustments`, `evidence`, and append-only `changes`. Business records have `recordRevision`; change entries contain the metadata and before/after snapshots specified in design section 7. Export `validateTaxHistory(input: unknown): TaxHistoryStoreV1` and `reconcileTaxHistory(store: TaxHistoryStoreV1): TaxHistoryProjection`. The projection contains obligation rows, payment-date cash events, unallocated items, and issues; each balance states `confirmed` or `provisional` with reasons, and has no authoritative amount without a reviewed effective basis.

- [x] Specify fields, enums, references, sign conventions, and effective-liability selection from design section 7 in both the TypeScript types and JSON schema. Amounts are native minor-unit strings; cross-currency allocations require an explicit conversion record and otherwise fail validation.
- [x] Write a synthetic fixture: a prior-year obligation paid the following year, an original and amended return, an authority assessment, withholding, partial payment, a refund, a reversal, interest/penalty components, and one payment allocated across two obligations.
- [x] Add tests asserting retained versions, no sum of return plus replacement assessment, allocation amounts bounded by event amounts, invalid references rejected, principal separate from interest/penalties, and unknown settlement balance marked provisional. Pin explicit `effectiveBasis` selection; an amended return never replaces an assessment automatically, and missing/stale basis references produce candidates without an authoritative balance.
- [x] Add tests asserting that two tax units never share totals implicitly; duplicate event IDs fail validation; multiple evidence references do not multiply amounts; credit transfers do not create cash flow; and unmatched-currency records do not silently convert.
- [x] Run `pnpm exec tsx --test tests/tax-history-domain.test.ts` to establish the failing contract, implement validation/reconciliation, and rerun to PASS.
- [x] Verify that the example validates and contains only synthetic identifiers/amounts. Do not import actual returns into fixtures.

**Done:** Deterministic tax-year and cash-date projections work without DB/UI dependencies. No new tax-law calculation is claimed.

## Task 4: Persist tax history with reviewable import and concurrency protection

**Files:**
- Create: `lib/adapters/tax-history-store.ts`, `lib/application/import-tax-history.ts`, `scripts/import-tax-history.mjs`, `tests/tax-history-store.test.ts`, `tests/tax-history-import.test.ts`.
- Modify: `config.ts`, `package.json`, `.env.example` as needed for the new private state path and command.

**Interfaces:** `readTaxHistory(filePath): TaxHistoryStoreV1`; `commitTaxHistory(filePath, { expectedRevision, next, actor, reason }): TaxHistoryStoreV1`; `previewTaxHistoryImport(current, incoming): TaxHistoryImportPreview`; `applyTaxHistoryImport(filePath, { expectedRevision, incoming, reviewedMatchDecisions, reviewedRecordChanges, reason }): TaxHistoryStoreV1`. Each reviewed record change includes collection, record ID, and expected current record revision. Import defaults to preview; only `--apply --expected-revision N` writes, with reviewed decisions supplied in a structured decision file when needed. Return conflicts without retrying against a new revision automatically. `commitTaxHistory` and `applyTaxHistoryImport` throw a named read-only error when `stateWritable` is false.

- [x] Add persistence tests for absent store, malformed/unsupported schema, atomic replacement, stale revision, lock contention, interrupted temporary write, and backup/restore parity. Corrupt input must fail without replacing valid state.
- [x] Use exclusive lock acquisition, revision verification while holding the lock, atomic temporary-file rename, and guaranteed lock release. Generate record revisions and append the local before/after change entry within the same commit; reject attempts to alter previous log entries or skip revisions. Stale locks return an actionable error; do not steal a lock merely because it is old.
- [x] Add a concurrent-edit test with two writers expecting the same revision: one succeeds, one conflicts, and final state validates. Add tests that rereading state after refresh retains the same committed content/revision.
- [x] Add tests that a non-writing host opens the store read-only and that commit and import-apply fail with the named error without touching the file, while reading stays available.
- [x] Implement import preview showing additions, unchanged IDs, changed IDs, conflicting revisions, missing references, and possible duplicate events. Repeated identical import is a no-op with no revision or log entry; a conflicting record revision is rejected until explicitly resolved. Import does not replace local history. Test that ordinary edits and tombstones preserve recoverable prior payloads.
- [x] Keep evidence-based duplicate matching as a suggestion requiring a reviewed mapping to an existing event. Do not treat a new receipt hash as a new payment automatically.
- [x] Run `pnpm exec tsx --test tests/tax-history-store.test.ts tests/tax-history-import.test.ts`. Verify preview causes no state mutation and apply honors expected revision.

**Done:** A reviewed structured import can create durable history safely; all writes use one guarded operation.

## Task 5: Deliver tax overview, history, record review, and evidence links

**Files:**
- Create: `lib/application/tax-history-query.ts`, `app/taxes/page.tsx`, `app/taxes/history/page.tsx`, `app/taxes/records/[id]/page.tsx`, `app/taxes/actions.ts`, `app/taxes/evidence/[id]/route.ts`, `lib/ui-copy/pages/taxHistory.ts`, `tests/tax-history-query.test.ts`, `tests/tax-history-actions.test.ts`, `tests/tax-history-evidence.test.ts`, `lib/application/evidence-index.ts`, `tests/tax-history-evidence-relink.test.ts`.
- Modify: `lib/ui-copy/pages/sidebar.ts`, `lib/ui-copy/pages/index.ts`, `lib/page-names.ts`; follow existing locale/copy registration patterns discovered at implementation.

**Interfaces:** `getTaxHistoryView(store, { taxUnitId, taxYear?, authority?, view: 'tax-year' | 'cash-date', cashDateFrom?, cashDateTo? })` returns scoped rows, coverage, issues, and `stateRevision`. Tax-year view requires a tax year; cash-date view accepts an inclusive validated ISO date range independently of an optional obligation-year filter. The MVP reads one complete durable-state revision directly and calls the domain projection; no tax-history SQLite schema or refresh projection is introduced. Actions call `commitTaxHistory` with an expected revision, actor, and reason. Resolve evidence through document IDs and configured root aliases, never a browser-supplied filesystem path.

- [x] Add query/action tests for tax-year versus cash-date filters, inclusive date boundaries, invalid/inverted date ranges, an optional obligation-year filter, missing evidence, unallocated payments, amended returns/assessments, stale action revisions, and no mixing of unrelated tax units. Confirm a payment-year view works without supplying a tax year.
- [x] Add comparison gating tests: only equal year/unit/authority/currency/calculation scope can show an estimate-versus-return difference. Existing investment estimates retain `investment-incremental` labeling.
- [x] Add evidence tests rejecting unknown IDs, parent traversal, absolute paths, and symlinks that leave the root named by the evidence reference (checked per root, including a link from one configured root into another). Require private mode and the existing deployment access boundary; add no public hosting or new account system. Verify document identity/hash before serving and report changed/missing evidence without substituting another file.
- [x] Build a read-only content-hash index per root. When the recorded path is missing or its hash differs, show that state and offer only a file whose hash equals the recorded one as a relink candidate; relinking is a reviewed edit that records a new evidence revision with the same document ID and hash. Test a moved file, a renamed file, a retired duplicate whose twin remains, and a candidate with a different hash (not offered).
- [x] Implement the year summary, cash-date table, record details, version/evidence history, and minimal local correction/review forms. A payment is not marked authority-confirmed from a user-entered bank debit alone.
- [x] Display state revision and invalidate the tax-history routes after successful edits. Verify tax history remains readable with an older, missing, or rebuilding portfolio DB; only portfolio-dependent comparison panels become unavailable.
- [x] Run the new tests, `pnpm typecheck`, `pnpm lint`, and UI guardrails. Verify desktop/mobile navigation and empty/partial/complete synthetic cases with the repository's existing UI tools.

**Done:** One synthetic year demonstrates the complete workflow; owner-selected private acceptance is performed separately using local evidence without putting it in Git.

## Task 6: Prove durability and prepare private storage migration

**Files:**
- Create: `scripts/migrate-finance-state.mjs`, `tests/finance-state-migration.test.mjs`, `docs/operations/finance-state-backup-and-restore.md`, `docs/operations/personal-finance-cutover.md`.
- Modify: source sync/backup wrappers only after identifying which host owns each writable file.

**Interfaces:** Migration command accepts explicit source/destination mappings, defaults to dry-run, emits a private manifest containing path/hash/ownership classifications, and refuses destination conflicts. `--apply` copies and verifies; it does not delete old files or flip live configuration automatically.

- [ ] Inventory policies, mappings, saved plans, proposals/fills/events, notification deduplication, briefing archives, historical snapshots, and generated inputs. Record the owning host and whether each item is reconstructible.
- [x] Confirm that the writing host's state root lies under a path covered by its existing records backup, or add a backup target before enabling writes, and include the state in the restore proof.
- [ ] Add synthetic migration tests for matching destinations, conflicting destinations, interruption/resume, symlink targets, legacy file overrides, and restore of a previous configuration.
- [x] Implement checksummed copy and rollback instructions. Keep one writable authority; source sync must not overwrite host-owned state with a stale workstation copy.
- [ ] In a temporary fixture environment, edit/import history, rebuild the query DB, simulate failure/restart, restore a backup, and compare state revisions/content and visible projections.
- [ ] Prepare concrete per-host configuration changes and dry-run manifests. Execute private file migration and production restart only within separately authorized scope.

**Current evidence:** Checksummed migration, matching-resume/conflict/symlink tests and synthetic ingest/restore durability tests exist and pass in the integrated suite. The owner installation has accepted populated tax-history/evidence recovery and paired backup/drill targets. The broader inventory, full original test matrix (including every interruption/override/configuration-restore combination), restart fault exercise and per-host path migration remain open; unchecked items retain that broader scope. No wholesale financial archive or state-path migration is claimed.

**Done:** Rebuild and restore are proven in isolation; live migration status is recorded separately from preparation.

## Task 7: Reframe the all-assets entry point and public brand

**Files:**
- Modify: `README.md`, `package.json`, `app/layout.tsx`, `app/manifest.ts`, `app/page.tsx`, `app/net-worth/page.tsx`, `components/sidebar.tsx`, `lib/ui-copy/pages/overview.tsx`, `lib/ui-copy/pages/netWorth.ts`, `lib/ui-copy/pages/sidebar.ts`, `lib/asset-view.ts`, `lib/asset-view-server.ts`.
- Test/extend: `tests/net-worth.test.ts`, `tests/asset-view.test.ts`, `tests/stock-views.test.ts`, `tests/page-names.test.ts`; create `tests/finance-overview-scope.test.ts`.

**Interfaces:** Keep existing stock/portfolio queries and legacy cookie fallback. Add all-assets summary scope and coverage as a separate application query before replacing the entry-point reader. Investment-specific queries retain their existing tax/rebalance scopes.

- [x] Add tests for all-assets default, legacy cookie preference, child-account exclusion unless explicitly selected, pension-underlying duplicate prevention, duplicate cash/sweeps, missing FX/price coverage, and empty supplementary data.
- [x] Establish synthetic baseline totals before changing query composition. Refactor inclusion rules only behind parity tests; retain stock views during caller migration.
- [x] Add the scoped total-assets summary and tax-history summary. Label gross assets accurately; do not expose complete net worth before supported liabilities are available.
- [x] Change visible product and package descriptions to Personal Finance Observatory. Preserve DB filenames, launchd labels, cron/venv paths, CLI JSON, and briefing schemas in this change.
- [x] Move README operating detail to linked topic docs; preserve or repair inbound anchors. Use only synthetic screenshots, generated after the UI stabilizes.
- [x] Run focused tests, `pnpm typecheck`, `pnpm lint`, and UI checks in sample mode; then run the complete existing CI checks once for the integrated change.

**Done:** Branding reflects actual supported scope; all-assets overview reconciles with baseline and existing investment tools remain usable.

## Task 8: Prepare subsequent subplans and operational rename

These are separate work packages. They require detailed designs against the then-current baseline; this master plan does not pretend their annual tax rules or complete migration algorithms are already specified.

| Work package | Required subplan decisions | Acceptance before release |
| --- | --- | --- |
| Annual tax estimation | Income categories, filing statuses, state support, deductions/credits, sourcing, rule versions, exclusions | Official-source review, synthetic reference cases, scope-matched return comparisons |
| Liabilities and net worth | Supported debt types, valuation/accrual, ownership, tax reserve treatment | No duplicate debt/reserve subtraction; evidenced asset-minus-liability totals |
| Asset/query extraction | Exact modules to extract, callers and compatibility exports | Existing totals and output contracts unchanged by mechanical moves |
| GitHub and local rename | Open PR/worktree audit, new slug, remotes/links, paths, scheduler/backup consumers | Authorized rename, consumer checks, concrete rollback; no archive moves bundled |
| Legacy removal | Actual consumer upgrades, deprecation evidence and removal boundary | No remaining authorized consumers relying on removed names/contracts |

- [ ] Write and review each subplan immediately before starting its work package.
- [ ] Prepare GitHub rename metadata and consumer/link changes after the compatibility inventory is complete; do not execute the remote rename from documentation authorization.
- [ ] If local task worktrees are needed for implementation, use the Codex managed tool and permitted worktree paths; inspect active ownership before changes. Do not move Claude/Orca worktrees as path cleanup.
- [ ] After a task branch is actually merged or closed and finished, audit dirty state, active use, PR/remote state, ancestry, and unique content; remove only that task's eligible worktree and delete its branch normally.

## Verification and delivery record

For each implemented task, record the baseline commit, exact checks and observed results, data mode, changed public contracts, unresolved issues, and acceptance status. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm ui:guardrails`, and `pnpm build` in an isolated sample environment for the integrated release; add browser/a11y/mobile checks for changed flows. Do not run sample seeding against the existing private checkout. Do not claim these checks passed merely because they are listed here.

Record these separately: locally implemented, technically verified, owner accepted, PR opened, merged, deployed, and operationally migrated. A private historical-year reconciliation is a local acceptance artifact, never a public test fixture. Publishing, notifications, repository rename, service restart, and destructive cleanup remain explicit execution steps with their own evidence.
