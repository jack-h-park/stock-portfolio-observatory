# Next Personal Finance Observatory increments

Updated November 14, 2026 (America/Los_Angeles). The original program is still the [master plan](../superpowers/plans/2026-11-10-personal-finance-observatory.md): public reusable code, private sources/state, evidence-linked financial visibility and bounded tax planning. Foundation/branding, all-assets entry and historical-tax adoption are implemented. Historical gold, date/coverage disclosure and the recorded-tax summary have prior operating acceptance. The first expanded custodian backup now also has separate-location recovery evidence. These completed increments should not remain the next implementation tasks.

The [implementation status](implementation-status.md) and [installation observation](../operations/installation-status.md) separate source, installation, historical acceptance and current gaps. Hometax remains held; further deployments require separate authorization. This document authorizes no implementation, merge, private-data mutation or operating change.

## Completed security prerequisite and bounded maintenance

[#311](https://github.com/jack-h-park/stock-portfolio-observatory/pull/311) is merged and its Next.js 15.5.28 patch was deployed with bounded browser/build/evidence and preservation verification. This is completed work, not the next feature PR. The [installation observation](../operations/installation-status.md) separates that release from the subsequent #312 checkout/build observation.

The release audit retained two moderate transitive findings through Tailwind and ESLint tooling. Classify compatible fixes in a small maintenance PR when scoped; do not fold a framework migration into account coverage. Retained rollback/recovery payload cleanup is a separate retention decision. Hometax remains held; no further release is authorized by this plan.

## Priority 1: finish account/source coverage visibility

Build on merged [#308](https://github.com/jack-h-park/stock-portfolio-observatory/pull/308), which addresses query-period evidence across accounts. Merged #310 adds Samsung/Chase period handling; #312 shows file requests only when an update is needed and is present in the latest observed checkout. These are inputs to the next increment, not evidence that expected-account coverage is complete. Do not duplicate their period handling or conditional request prompts. Merged #304–#307 already address KR receipts and selected Fidelity/Bithumb/Merrill period/date cases.

The next independent increment should connect a reviewed account inventory to the existing coverage/read-only review surfaces. Its question is: which expected assets/accounts are represented, which have missing or stale evidence, and which still need reconciliation? A fresh file or recent API fetch must not imply complete history.

The proposed [expected-account design](../superpowers/specs/2026-11-13-account-inventory-design.md) defines additive metadata on the existing private map, canonical identities, explicit ownership, scoped review receipts and separate missing-evidence judgments. It is a design proposal, not implementation or a completed private account review. Merged [#314](https://github.com/jack-h-park/stock-portfolio-observatory/pull/314) already adds explicit bank historical-gap signals; reuse them rather than duplicating that work. No deployment of #314 is established by this document.

The design is merged in #316. The [first standalone foundation](../architecture/account-inventory-foundation.md) adds types, explicit read-result validation, semantic digest and a pure synthetic projection for review. Existing loader, app, CLI and reminders remain unchanged. The foundation merged in #317; the [read-only adapter/display increment](../architecture/account-inventory-display.md) now connects existing recorded facts and a separate accounts-page review section for PR review. This does not establish an operating rollout or a complete owner inventory. Next validate this source increment before a separately authorized private identity/requirement preview; private metadata adoption, owner review and deployment remain later gates.

Adapter/display acceptance scope; remaining unsupported bridges must stay explicit:

- Identify the existing authoritative inventory inputs and account/owner keys. Document gaps rather than inventing a second mutable inventory or silently merging aliases.
- Reuse existing account, supplementary-asset and statement-period adapters. Separate valuation dates, query/statement intervals, fetch age, evidence review and reconciliation.
- Distinguish an expected account with no supplied source from a supported closed/zero account, a provider's absent row, an omitted observation and conflicting evidence. Keep source review that includes other owners distinct from the self-owned covered total.
- Add read-only links to existing account/source review details. Preserve totals, ownership scope, tax/rebalance boundaries and missing-value behavior; no completeness percentage without a defensible inventory.
- Verify with synthetic stale/missing/partial/conflicting/zero/other-owner/alias cases and unchanged covered totals. Private account names, balances and screenshots must never become fixtures.

Exit: a reviewer can trace a supported total and an actionable gap to existing evidence without a refresh, importer, provider call or write surface. Where existing contracts cannot establish an authoritative inventory, produce the small contract/design decision first rather than creating guessed records. Private acceptance later uses an explicitly authorized read-only review; deployment remains held.

## Priority 2: complete operating ownership and recovery boundaries

The wider durable-state inventory and first expanded MacBook snapshot recovery are done for their documented scope. Do not repeat that same restore merely to generate another success receipt.

Remaining work:

- Clarify the editing authority for curated FX/evidence inputs and reconcile the briefing producer's effective archive paths. Existing backed-up files must not be replayed or rewritten to resolve ownership.
- Document targeted backup installation versus the shared runtime checkout's auto-update behavior, preserving the held monthly drill. Broader runtime updates must not unintentionally activate its new marker namespace.
- If authorized later, select compatible pinned stock-management/ops-runtime snapshots and validate policies, proposals/events and delivery deduplication/thread state alongside the recovered sources. Never infer an atomic recovery set from nearby timestamps.
- Observe an ordinary scheduled daily backup independently. The manual first capture and loaded registration are not evidence of that future scheduled run.
- Decide retention/cleanup for the private decrypted recovery specimen; keep receipts if its payload is removed. No automatic deletion or production promotion is proposed.

Exit: explicit authority/consumer boundaries and bounded cross-repository recovery evidence, with no notification replay, live-path overwrite or web-write activation. Any execution beyond documentation/read-only inspection needs its own scope and authorization.

## Priority 3: expand recorded-tax usefulness only with available evidence

The annual summary already operates in #290. A later bounded change may model return-reported prepayments and requested refunds separately from actual payment/refund settlement events. Requested refunds must never appear as received cash; missing settlement proof remains unknown.

Design the fields and synthetic projection tests before importing anything. Add a historical fact only from available reviewed evidence and applicable write authorization. The accepted final historical return is not reopened, and no tax-document investigation is a prerequisite for Priority1. Further years or settlement completeness are not established by the existing minimal-year adoption.

## Priority 4: advance the annual estimate MVP within explicit scope

The [2025-first design](../superpowers/specs/2026-11-12-annual-tax-estimation-mvp-design.md), #296 contracts, #297 ordinary/NIIT, #298 eligible QDCG, #299 Korean exact reference and #300 component preview CLI are merged and present in observed installed source. They are not a complete annual return calculator or a newly accepted operating tax workflow.

A separately approved next design can define reviewed annual inputs and permitted US component composition, retaining unsupported-method/credit/coverage blocks. It must not sum independent component outputs into an unlabeled annual total or compare them with recorded liability at a different scope. Korean reported amounts remain blocked; Hometax is held. California, special-rate methods and a read-only estimate UI retain separate designs/gates. Keep real input entry, state mutation and deployment out of a synthetic calculator PR.

## Later: liabilities, extraction and naming

Complete net worth requires a designed/evidenced liabilities model and no duplicate reserve/debt subtraction. It remains unsupported. Module extraction follows demonstrated maintenance boundaries and preserves public interfaces; no whole-repository rewrite is needed. GitHub slug/local path/job renames are optional compatibility cutovers after consumer inventory and rollback planning, not a prerequisite for the current product name.

Connector exports remain shadow-only. Seven distinct successful daily observations, statement comparison and separate position/cash/activity/lot acceptance are required before a promotion decision; a backed-up or recovered export does not satisfy those gates. Keep collector authentication, API acquisition and economic promotion separate from read-only coverage improvements.

## Preserved gates

Keep actual financial records, original evidence, approved-device access and private web-write prohibition unchanged. Hometax remains held; further deployments require separate authorization. Source PRs, merge, installation, scheduled observation, private operating acceptance and recovery/promotion are separate outcomes. No recommendation above authorizes those later actions.
