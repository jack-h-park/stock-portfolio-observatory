# Annual tax review contract and journey

Status: merged in #369 and deployed with #371, with [bounded operating acceptance](../operations/installation-status.md#annual-review-and-hypothetical-planning-release-acceptance-november-20-2026). No new real return facts were adopted by that rollout; owner routine acceptance remains separate. Implements packet 1 of the [completion plan](../superpowers/plans/2026-11-20-personal-finance-completion.md).

## Pinned additive contract

`TaxReturn.reportedAmounts` is optional and contains optional `prepayments: Money` and `refundRequested: Money`, plus required nonempty `evidenceIds`. At least one money field must be present. Amounts are nonnegative integer minor-unit strings in the obligation currency; unsupported fields, references and currencies fail validation. Values belong to that exact return ID/revision/status, including submitted amendments. No latest-return selection or inference from an assessment/free text occurs.

The reader returns each live return separately. Missing fields remain unavailable, explicit zero remains zero, and unlinked/deleted evidence makes the reported values unavailable. Return and fact evidence references must both be live. These are recorded statement facts, not settlement events, authority-posting confirmation or proof of document bytes. Opening evidence uses the existing hash-checked resolver. No reported amount affects reconciliation, allocations, cash totals, balances or estimate comparisons.

Schema version 1 remains additive and legacy stores require no migration. Existing old readers may reject new optional fields; consumers must be upgraded before a separately authorized adoption. Import uses existing content digests, reviewed record revisions and append-only history; repeat import is a no-op. Reading never adopts or writes a new fact.

## Integrated acceptance

Overview → selected year/unit/authority review → exact return version and evidence → allocated payment-date history. Reuse current routes and components. Annual estimates/comparisons remain unavailable in this review; no calculator/comparison is called. Actual 2025 comparison stays blocked. Read-only UI and server write policy are unchanged.

Synthetic cases cover requested refund without receipt, explicit zero, legacy absence, draft/amended/superseded versions, stale effective basis, separate native currencies, cross-year cash events, reversal/unallocated/undated records, unavailable/hash-mismatched evidence and repeat import/review conflicts. A separate opt-in synthetic seed demonstrates the complete journey without changing the default fixture or touching private inputs.

All real data, originals, mappings, unresolved decisions and access/settings remain untouched. Automatic briefing stays paused; generation, briefing publication, Hometax and further deployment remain held. Source tests, browser validation, merge, operating rollout and owner financial acceptance are distinct milestones.

## Reproduce with invented records

In an isolated checkout without `.env.local`, run `FINANCE_MODE=sample pnpm seed:sample --annual-tax-review`, then start the app in sample mode. The default seed/fixture remains unchanged. The opt-in example adds a separate USD return with a 200.00 refund request and no refund settlement, a KRW return with explicit zero prepayments, and undated/unallocated cash cases. All labels, amounts and documents are invented; no calculator is used to derive the fixture's return figures.

Start at `/`, follow the existing year link into `/taxes?unit=self-2025&year=2025&authority=US%3ACA`, inspect `refund-return` and its evidence on `/taxes/records/refund-request-2025`, then follow the allocated cash-history link. The requested 200.00 must not appear as received cash. Separately inspect federal cash dates in 2026 for the 2025 obligation, the reversal and date exclusions. The public sample does not enable private evidence downloads; byte/hash/error paths are verified against a disposable private-mode fixture containing only these synthetic roots, never operating records.

Future real adoption requires an explicitly reviewed evidence-linked import at the current store/record revisions. Optional new fields are backward-compatible for upgraded readers, not for older strict schema readers. Any rollback after real adoption must pair a compatible reader with its reviewed state/backup; this source PR does not migrate or modify private state or promise that an old binary can read the new fields.

## Source acceptance, November 20, 2026

The isolated opt-in synthetic fixture passed 2,076 tests with 14 skipped and zero failures (2,090 total), TypeScript, lint, UI guardrails and a production build. Dedicated tests exercise the additive schema, null versus zero, exact return revisions, archived/amended versions, unchanged settlement arithmetic, stale basis, import conflict/repeat behavior and evidence references. An independent source review found no blocking issue.

The built local app used only disposable invented records, with private-mode evidence roots and web writes disabled. The overview-to-filtered-year link retained the unit/year/authority scope. English desktop (1280 px) and Korean narrow (375 px) screenshots were visually inspected after layout settled; the narrow page had no horizontal overflow. Keyboard Enter reached exact version and evidence anchors. A synthetic evidence download returned 200; changed bytes and a missing file each returned 409 with no-store caching, after which the original dummy bytes were restored and the state hash remained unchanged. The payment-date view kept the requested refund out of received cash and separately displayed the existing cross-year occurrence/posting dates, reversal, undated warning and globally labelled unallocated records.

These checks establish local source behavior only. They are not operating-host validation, physical-device/assistive-technology acceptance, real financial reconciliation, actual estimate/comparison execution, migration or deployment. Existing combined classifications/reminders and operating controls are unchanged. At this source-checkpoint, hypothetical KR/US planning was a separate packet; its subsequent #371 merge and combined operating acceptance are now recorded in installation status.
