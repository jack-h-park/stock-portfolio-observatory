# Personal Finance Observatory Product and Architecture Design

**Date:** 2026-11-10 (America/Los_Angeles)
**Status:** Foundation implemented and merged; bounded private operating adoption is recorded separately. Complete source/settlement coverage and broader migration remain separate. See [execution status](../../product/implementation-status.md).
**Companion:** [Implementation plan](../plans/2026-11-10-personal-finance-observatory.md)

## 1. Decision and purpose

Evolve Stock Portfolio Observatory into **Personal Finance Observatory**: a personally operated, publicly reusable application that connects assets, cash flow, KR/US tax estimates, filed returns, payments, refunds, and their evidence.

Prioritize the maintainer's actual operating workflow. Make the software understandable and runnable by others through synthetic data, documented contracts, and replaceable source adapters. A broadly supported consumer finance service is outside this expansion.

The public description should be:

> A personal finance observatory that connects assets, cash flow, KR/US tax estimates, filing history, and tax payments with dated source evidence. Application code and synthetic examples are public; actual financial records remain private.

The project preserves source records and supports local policy, review, and reconciliation writes. Describe those boundaries directly rather than describing the entire application as read-only.

## 2. Approaches considered

| Approach | Benefit | Cost | Decision |
| --- | --- | --- | --- |
| Rename the dashboard while retaining stock-first models | Small initial change | Supplementary assets and tax history remain awkward additions | Insufficient on its own |
| Evolve the existing application into a personal finance observatory | Reuses working ingestion, reconciliation, tax planning, and integrations | Requires staged model and storage changes | Recommended direction accepted in discussion |
| Build a general consumer finance platform | Broad audience and extensibility | Adds tenancy, onboarding, account connectivity, support, and much wider tax coverage | Outside current scope |

Keep one repository and one deployable application. Do not introduce a monorepo, service split, replacement framework, or new database server for this work.

## 3. Current baseline

The local main checkout inspected for planning is `e2ee249`. These are source-level observations, not a production runtime acceptance report. Main has since gained #271 (tax treatment questions), #272 (a test fixture) and #273 (a report of files that source sync leaves on the refresh host); Task 1 re-baselines on current main.

| Area | Existing implementation | Expansion needed |
| --- | --- | --- |
| Investments | KR/US holdings, lots, transactions, income, crypto, reconciliation | General account and asset scope rather than implicit stock scope |
| Other assets | Deposits/CMA, pensions, gold, total-assets series, foreign-account reference figures | First-class navigation and coverage; liabilities remain separate work |
| Tax planning | KR/US scenarios, annual profiles, investment sale estimates, saved plans | Filing and settlement history, scope-aware comparisons, rule provenance |
| Review | Rebalance proposals, fills, reconciliation, local settings | Preserve distinct planning and execution boundaries |
| Data | Private source root, ignored snapshots/configuration, generated SQLite | Multiple source roots, durable state boundary, isolated sample runtime |
| Interfaces | CLI JSON, briefing summary/archive, sheet exports, scheduled refresh and source sync | Compatibility inventory and versioned migration |

Key source references:

- [Project README](../../../README.md), [data sources](../../data-sources.md), [tax planner](../../tax-realization-planner.md), [rebalancing](../../rebalancing.md).
- [Configuration](../../../config.ts), [ingestion](../../../scripts/ingest-stock-data.mjs), [database adapter](../../../lib/adapters/portfolio-db.ts).
- [Asset totals](../../../lib/net-worth.ts), [account mapping](../../../scripts/account-map.mjs), [tax policy](../../../lib/tax-policy.ts), [US engine](../../../lib/us-tax-engine.ts).
- [Saved tax plans](../../../lib/tax-plan-store.ts), [rebalance proposal storage](../../../lib/rebalance/proposal-store.ts), [sample seeding](../../../scripts/seed-sample.mjs).

The repository is public. Runtime defaults still include ignored files inside the checkout. The source-root naming transition to `financial-records` has already begun; the older `stock-management` path was a temporary compatibility alias in the inspected environment and is being retired, and the code no longer references it. Do not create another copy of the archive.

Tax-treatment questions are being collected in [PR #271](https://github.com/jack-h-park/stock-portfolio-observatory/pull/271). GitHub reports that PR merged at `2026-11-11T01:18:23Z`, which is November 10 in Los Angeles. Its contents must be integrated into the implementation baseline; the inspected local checkout predates it.

## 4. Outcomes and scope

### Required outcomes

1. An overview of supported assets across accounts, owners, currencies, and valuation dates.
2. Separate views of tax estimates, reported/assessed amounts, and actual settlements.
3. Both tax-year and payment-date views of tax history.
4. Evidence, coverage, freshness, unresolved treatments, and reproducible inputs beside material figures.
5. Public execution with synthetic data and no access to actual financial documents.
6. Existing operational consumers continue to work during migration.

### Initial scope

- Promote the already supported asset classes; do not expand the parser set merely to justify the new name.
- Deliver tax-history recording through a reviewed structured import and local editing before broad PDF automation.
- Reuse the existing investment tax engine with explicit coverage labels.
- Select one complete, owner-chosen historical tax year for private acceptance across relevant KR/US authorities; do not invent missing records or infer completion from filenames.
- Support additional years through the same contract after that vertical slice works.

### Deferred scope

Full spending categorization and budgeting, general bank aggregation, automated trading, automated tax filing/payment, comprehensive PFIC computation, universal international tax support, SaaS tenancy, and real-estate-specific workflows are deferred. Liabilities are a later increment; until then, label assets as **total assets**, not complete net worth.

## 5. Product organization

| Area | Primary question | Surfaces |
| --- | --- | --- |
| Overview | What is the current financial position? | Supported assets, liquidity, changes, tax summary, coverage |
| Assets and Cash Flow | What is owned, where, and how did money move? | Accounts, positions, balances, pensions, income, transfers |
| Taxes | What is estimated, reported, paid, refunded, and unresolved? | Tax overview, history, scenarios, records, evidence, assumptions |
| Review and Data | What needs attention and why trust the figures? | Rebalance review, reconciliation, source inventory, freshness |

Use an all-assets entry point. Retain investment-focused views and existing routes during transition. A navigation change must not change the scope of an existing tax or rebalance calculation implicitly.

Display owner, currency, and as-of scope explicitly. A summary with missing inputs is a covered subtotal with omissions, not a complete total. Preserve the existing distinction between self-owned and child-owned accounts. Household aggregation requires an explicit membership definition and must not change the default owner's scope.

When liabilities are implemented, show total assets, supported liabilities, and net worth separately. An estimated tax reserve is a planning overlay; an assessed unpaid obligation is a different record. Do not subtract both without an explicit reconciliation rule.

## 6. Domain boundaries

Separate these concepts instead of overloading `market` or `asset_class`:

| Concept | Meaning |
| --- | --- |
| Owner | Legal or beneficial owner and ownership share |
| Account | Institution account with stable private ID and display alias |
| Wrapper | Account regime such as taxable, ISA, IRP, pension savings |
| Instrument | Security, fund, coin, metal, or another identifiable product |
| Exposure | Economic allocation such as US equity, KR equity, bonds, cash, gold |
| Venue | Listing or trading location, independent of exposure and tax jurisdiction |
| Position or balance | Quantity or amount held in an account at a date |
| Tax unit | Individual or joint filing unit, linked to owners for a given year |
| Tax treatment | Jurisdiction- and year-specific treatment, including unresolved state |
| Evidence | Source document/version and record/page references |
| Valuation | Price, FX, date, method, and input provenance |

Pension is an account regime/view; its underlying funds and cash must not also be counted as an additional pension asset on top of the same holdings. Allocation views can classify by exposure while account views classify by wrapper. Each counted amount needs one inclusion path per total.

Internal transfers preserve movement and lot lineage but do not create household income. Cash sweeps and account snapshots need explicit inclusion rules to avoid double counting. Preserve broker-reported basis and reconstructed basis as distinct evidence paths.

New persisted money values use a currency plus a signed integer minor-unit string: KRW scale 0 and USD scale 2. Quantities and FX use validated decimal strings with explicit precision. Define rounding at tax/valuation boundaries; do not infer tax values from display-rounded totals. Existing numeric columns can remain behind adapters until migrated. USD/KRW support does not imply arbitrary-currency support.

## 7. Tax records and calculations

### Separate three kinds of truth

1. **Estimate:** immutable calculation snapshot with input digest, policy/ruleset version, jurisdiction, tax year, tax unit, calculation scope, exclusions, and result.
2. **Return or assessment:** reported or authority-assessed result, versioned with original/amended relationships and source evidence.
3. **Settlement event:** withholding, estimated payment, filing payment, additional payment, refund, reversal, or credit transfer, supported by evidence and allocations.

Never replace a filed record with a fresh estimate. Keep the filing status independent of settlement status. A draft return is not filed; a filed return is not evidence of payment; a bank debit alone is not evidence of authority posting.

### Minimum record contract

| Record | Required content |
| --- | --- |
| Tax unit | Stable ID, year, member owner IDs, individual/joint kind, filing-profile assumptions |
| Tax obligation | Stable ID, tax unit, tax year, authority, tax type, native currency, optional reviewed effective-basis reference |
| Return version | Obligation ID, revision, superseded version ID, draft/submitted/accepted/rejected status, reported liability, evidence |
| Assessment | Obligation ID, assessed amount, effective date, authority evidence, related return if known |
| Settlement event | Stable ID, kind, occurrence date, posting date if known, currency/amount, principal/interest/penalty components, review state, evidence |
| Allocation | Settlement ID, obligation ID, applied component/amount, effective date, confirmation evidence if available |
| Adjustment | Explicit non-cash credit or authority adjustment, obligation ID, amount, effective date, evidence |
| Evidence reference | Document ID, content hash, source-root alias, relative path, optional page/record locator |

Authorities distinguish US federal and state, and KR national and local. A new authority can store historical facts without claiming support for its tax computation. Unallocated payments remain visible; do not guess their tax year.

Persist event amounts as signed values under one documented convention: positive reduces an obligation, negative increases it; refunds/reversals use the latter direction. Event kinds validate permitted signs. Store credit transfers as linked opposite allocations, not new cash payments. Reconcile return, assessment, credits, and settlements without summing a return liability and its replacement assessment.

An outstanding balance is authoritative only when the obligation basis, credits, allocations, and refund/reversal history are sufficiently evidenced. Otherwise show a provisional balance and the missing inputs. Display interest and penalties separately from tax principal.

An obligation's optional `effectiveBasis` identifies exactly one return or assessment record ID and record revision, with review date and evidence references. Do not infer that an amended return supersedes an authority assessment, or that the newest dated document necessarily governs. With no reviewed basis, or with a reference to an outdated revision, show candidate liabilities and a provisional state with no authoritative outstanding amount. Selecting or changing the basis is a recorded review action.

Use stable event IDs for re-import. Evidence hashes identify documents, not payments: the receipt, bank debit, and authority statement can all refer to one settlement. New matching suggestions require review before consolidation. Editing produces a revision; corrections and reversals preserve the previous history.

Every mutable business record has `recordRevision`, initially 1. The store also contains an append-only `changes` array. Each committed change records an ID, resulting store revision, timestamp, local-user/import actor category, reason, and the before/after snapshots of changed records. Writes retain the entire previous change history and append one new entry; deletion is a recorded tombstone rather than removal of history. Import never replaces local change history with the incoming file's log. An unchanged import creates neither a record revision nor a store revision; changed records require a reviewed decision and their expected current record revisions.

### Tax screens and comparison rules

- `/taxes`: year/tax-unit/authority overview, coverage, unresolved items.
- `/taxes/history`: tax-year summary and separate payment-date cash-history view.
- `/taxes/records/[id]`: filing/assessment versions, settlements, evidence, review history.
- Keep `/tax-planning` and `/tax-settings` working during migration.

Each estimate declares `investment-incremental` or `annual-total`. Compare estimated and reported liability only when tax unit, tax year, authority, currency, and calculation scope match. Until annual-total coverage is implemented, display investment estimates alongside history without presenting their difference as estimation error.

The payment-date view filters settlement occurrence dates inclusively; posting date is shown separately. An optional obligation-year filter does not replace the cash-date range. Missing occurrence dates are reported as unresolved and excluded from date-bounded cash totals, never substituted with document dates.

Version tax rules by authority, tax year, filing status, publication/effective dates, official source URL, and verification date. Distinguish published rules, projections, manual assumptions, and unresolved treatments. Unknown treatment is not zero tax. The current engine remains a bounded planning engine; a complete annual tax calculator needs a later detailed subplan and its own acceptance cases.

Foreign-tax-credit calculations preserve income source, tax category, paid/accrued basis, year relationships, and manual review. Do not automatically offset KR tax against US tax or combine native amounts into an authoritative global liability. FBAR/Form 8938 and similar reporting obligations are tracked separately from tax payments.

Official conceptual references: [IRS Form 1040 instructions](https://www.irs.gov/instructions/i1040gi), [IRS Publication 514](https://www.irs.gov/publications/p514), and [Korean national tax payment certificate](https://m.gov.kr/mw/AA020InfoCappView.do?CappBizCD=12100000018). These explain record separation; they do not validate every existing engine rule.

## 8. Private storage and source ownership

| Boundary | Ownership | Rebuild and backup policy |
| --- | --- | --- |
| Public repository | Code, contracts, docs, synthetic fixtures | Git; no actual financial records |
| Financial records root | Institution-issued records and original statements | Preserve originals and private backups |
| Tax records root | Return documents, receipts, submission/assessment evidence | Preserve originals and private backups |
| State root | Policies, mapping overrides, tax history, review decisions, plans, proposal/event history | Durable; independently backed up |
| Runtime root | Extracted records, market snapshots, generated query DB, disposable caches | Rebuildable only when source inputs are retained |

Target environment variables are `FINANCE_RECORDS_DIR`, `FINANCE_TAX_DIR`, `FINANCE_STATE_DIR`, and `FINANCE_RUNTIME_DIR`. The public examples use generic placeholder paths. Existing private archive locations remain in use through configuration; a source-root alias must not imply a jurisdiction.

Do not rename, relocate, merge, or deduplicate existing financial/tax archives as part of this application plan. Cross-root duplicate evidence can be indexed without deleting either copy. Separately evaluate whether the tax archive should eventually have a broader name.

### Evidence resolution

An evidence reference names the source-root alias and the relative path of the real file, never a symbolic link. A working tree may hold many links that point at originals in another root (a filing workspace linking to the records root); those links are convenient views, not evidence locations. Serving resolves the recorded path to its real path and requires the result to lie inside the root named by the reference's own alias, checked per root rather than against the union of configured roots. A link that leaves its root is rejected as an evidence path, and the reference is rewritten to the real file through a reviewed edit.

Files move: duplicates are retired, names are corrected, and originals are re-filed. When the file at a recorded path is missing or its hash differs, report that state and do not serve another file under the old reference. A read-only index of content hashes within the same root may offer the file with the recorded hash as a relink candidate. Relinking is a recorded review action: it creates a new revision of the evidence record with the same document ID and hash and the new path. It is never automatic, and a candidate whose hash differs is not offered.

### Write authority

Exactly one host holds the writable state root for tax history: the host that runs the application in private mode. Every other host opens the store read-only, and a commit there fails with a named error, even when a state root resolves by default. The resolver reports this as `stateWritable`, which is true only when the owner sets it explicitly for that host. Source sync never carries the state root in either direction, and a default state root under the records root must not turn each host into its own writer. A state root that lies under a path covered by that host's existing records backup needs no new backup job; a state root outside such a path needs its own before writes are enabled.

For the first tax-history increment, use a schema-versioned `tax-history.json` in the state root, written by an atomic compare-and-swap operation with an expected revision and an exclusive writer lock. All UI and import writes use that operation. The MVP reads that state file and computes its tax-history projection directly, independently of the generated portfolio DB. Materializing a tax-history projection in SQLite and adopting a separate transactional SQLite state store are later optimizations, not prerequisites.

Refresh may rebuild the portfolio query DB but never overwrite durable state. Keep existing DB build-and-swap semantics. A tax-history request reads one complete state revision and exposes it in the result; invalidate its route after a successful edit. A future SQLite projection must carry its source state revision and cannot be served as current when that revision differs.

Move existing ignored policy files and plans by a dry-run, checksummed copy with a backup and parity check. Flip configured reads only after verification. Keep original paths until rollback is verified; never maintain two writable authorities. Existing briefing archives, historical snapshots, and fetched market inputs must be inventoried before classifying them as disposable: an input that cannot be fetched again must be retained or privately archived.

Sample mode has its own source, state, and runtime roots. It must refuse to write into a private configured root even when a force flag is present. Seeding should not delete an existing private DB or rewrite private snapshots. Existing force behavior needs an explicit safe replacement.

## 9. Code and documentation organization

Use the current Next.js, React, TypeScript, Node scripts, Python extractors, pnpm, and SQLite stack. Keep deployment topology unchanged initially.

```text
app/                         routes and server actions
components/                  reusable presentation
lib/domain/                  accounts, assets, cash-flow, taxes
lib/application/             query, estimation, import, review use cases
lib/adapters/                source readers, persistence, exports
scripts/                     operational command entry points
schemas/                     versioned public contracts
examples/                    synthetic examples and configuration
tests/                       domain, adapter, and integration checks
docs/product/                positioning, coverage, roadmap
docs/architecture/           models, boundaries, contracts
docs/data/                   source contracts and reconciliation
docs/tax/                    supported calculations and treatment review
docs/operations/             installation, sync, backup, recovery
```

Introduce these directories only as their contents become useful. New tax-history functionality follows the boundaries first. Extract existing ingestion and query responsibilities incrementally; retain compatibility exports/views until callers have migrated. Do not combine a mechanical file move with a tax-rule change.

The README becomes an entry point: definition, support matrix, sample quick start, representative synthetic screenshots, privacy/storage boundary, and links. Move long operating procedures to topic documents with working anchors or replacement links. Keep historical specs/plans as history rather than rewriting them as current status.

## 10. Naming and operational compatibility

Target product/repository/package name: `Personal Finance Observatory` / `personal-finance-observatory`. Renaming the existing GitHub repository preserves continuity better than creating a replacement repository. The target local checkout basename is `jackhpark-personal-finance-observatory`, but moving it is a separate operational step.

Inventory package metadata, lockfile metadata if applicable, UI/PWA names, cookies, docs/links, Git remotes, CI, launchd labels, cron wrappers, venv paths, source sync, DB paths, backup jobs, external briefing/agent consumers, CLI JSON, sheet publishers, and locks before cutover. Existing open PRs and active worktrees must be accounted for before any path move.

Resolve new variables first, corresponding legacy overrides second, and mode-specific defaults last. Conflicting nonempty values must fail with the conflicting variable names and no financial payload. New roots and per-file overrides are distinct: an explicit legacy per-file path remains effective unless its new per-file counterpart is set. Runtime mode is explicit (`FINANCE_MODE=sample|private`); an upgraded existing private installation continues to work with legacy configuration, while a fresh public installation defaults to sample.

The root mapping is `FINANCE_RECORDS_DIR <- STOCK_DATA_DIR`; `FINANCE_TAX_DIR` has no implicit legacy equivalent. New state/runtime roots derive defaults for their files only when no explicit file override exists. A private installation with no tax root has tax-root document imports unavailable, not a silent fallback to sample records; a reviewed structured import can still record facts with unresolved evidence. New settings must be consumed identically by app, CLI, Node scripts, and Python entry points.

Deterministic resolver defaults:

- An explicit `FINANCE_MODE` selects the mode; an invalid value fails. Without it, any nonempty new private root, legacy source/DB path, or configured legacy per-file path selects private mode. Operational flags such as `STOCK_ALLOW_NO_ACCOUNT_MAP` do not select private mode. With none of these, use sample mode. The configuration inventory defines the exhaustive per-file key list; never infer mode from arbitrary `STOCK_*` names.
- In private mode, resolve the records root from the new/legacy root pair, otherwise the existing `cwd/private-data` fallback. The tax root is null unless explicitly configured. State/runtime defaults are `<recordsDir>/outputs/personal-finance-observatory/state` and `<recordsDir>/outputs/personal-finance-observatory/runtime`. Preserve legacy per-file defaults until Task 6 performs their verified migration; the legacy DB fallback remains `<recordsDir>/outputs/stock-portfolio-observatory/stock-portfolio-observatory.db`. `stateWritable` defaults to false in private mode and becomes true only through an explicit setting on the writing host (section 8).
- In sample mode, use `cwd/private-data/personal-finance-sample/{records,tax,state,runtime}`, with the DB at `runtime/observatory.db`. Explicit sample mode combined with configured private roots or file overrides fails. A sample root must be new/empty or carry the matching sample ownership marker; seeding refuses an existing `.env.local` and refuses conflicting roots regardless of force flags. Tests isolate samples through a temporary working directory.

Branding, GitHub slug, local paths, DB filenames, and scheduler labels are separate changes. Keep the current DB paths, scheduler names, cookie fallback, CLI envelopes, and briefing contracts in the first branding release. Do not rely on a GitHub redirect as proof that every consumer still works. A breaking serialized contract needs an explicit version and consumer rollout.

Production restart, scheduler installation/resume, external publication/notification, repository rename, push/merge, and archive moves each require applicable execution authorization. Preparing and validating their concrete changes does not imply those actions have happened.

## 11. Acceptance and rollout

Deliver the first release through a vertical slice: one synthetic KR/US tax-history case, one privately reviewed historical year, durable storage and backup/restore, and the new public definition. An owner must identify the private acceptance year and evidence scope before private reconciliation begins; synthetic implementation does not depend on that choice.

Required acceptance evidence:

1. Public clean checkout runs without private credentials or records.
2. Same legacy configuration produces equivalent existing portfolio/tax/CLI outputs.
3. A state edit survives refresh, failure, restart, backup/restore, and repeated import.
4. Two concurrent state edits produce one valid successor revision and one conflict; no update is lost.
5. One payment with multiple evidence documents counts once; unallocated and reversed payments remain explainable.
6. Tax-year and payment-year views answer different questions correctly.
7. Asset totals show owner/date/coverage, avoid duplicate wrappers/cash, and preserve unknown values.
8. Production cutover is separately recorded with validated consumers and a tested rollback.

Use the [implementation plan](../plans/2026-11-10-personal-finance-observatory.md) for sequencing, concrete files, verification, and deferred subplan boundaries. Technical validation, owner acceptance, merge, deployment, and completed migration are separate statuses.
