# Personal finance implementation status

This records the bounded local implementation of the [master plan](../superpowers/plans/2026-11-10-personal-finance-observatory.md). It does not establish private financial acceptance, merge, deployment, or operational migration.

| Work | Local implementation | Verification and remaining boundary |
| --- | --- | --- |
| Product definition and support inventory | Implemented | Source-linked coverage and interface inventory; external consumers/backups still require host confirmation |
| Compatible finance paths | Implemented | New/legacy aliases, conflict handling, isolated sample roots, Python wrapper handoff; installed shell jobs retain legacy interfaces |
| Tax-history domain | Implemented | Versioned returns/assessments/settlements, exact minor units, evidence references, reviewed effective liability basis, explicit allocations |
| Durable history and import | Implemented | Writer lock, expected revisions, audit snapshots, idempotency, reviewed changes/duplicate matches, read-only host gate |
| Tax pages and evidence | Implemented | Tax-year/payment-date/all-unit record views, review forms, exact-hash downloads, bounded same-root relink; authority confirmation uses reviewed import |
| Restore and migration tools | Implemented for isolated use | Actual synthetic ingest preserves state; backup/restore checked; copy tool previews hashes and refuses conflicts/symlinks; no private migration executed |
| All-assets entry and branding | Implemented | Explicit legacy Stocks preference retained; current totals scope owners and deduplicate cash/wrappers; liabilities unsupported |
| Repository and operational rename | Prepared only | No GitHub rename, local primary move, job rename, production restart, push, merge, or deployment performed |
| Annual total tax / liabilities | Deferred | Require the next detailed subplans and their own official-source/acceptance cases |

## Accounting changes

Current asset totals now include supported bank, brokerage, and FX cash sources. Same account/asset observations are counted once; conflicting observations at the same date are omitted and reported. Child holdings are excluded from self-owned totals, and gold inside a pension wrapper is counted once. Quantity-zero pension snapshot fund/cash rows can still carry a valid balance.

These corrections can intentionally change current asset totals. Investment-specific tax/rebalance scopes and serialized CLI/briefing contracts are preserved. Historical series retain their existing source coverage and may differ from current cash coverage. A covered asset subtotal is not complete net worth or proof that every account was supplied.

## Verification record

Domain, persistence, import, evidence, path-isolation, accounting and migration tests have been run using synthetic fixtures. TypeScript, lint, UI guardrails and the production build have passed during implementation. Browser checks verified a stored review revision/audit entry, date-scoped cross-year payment display, read-only private mode with synthetic roots, exact evidence bytes, missing-portfolio-DB independence, and empty history.

The new tax screens had no findings in the completed accessibility/mobile audit. The full application audit still reports contrast issues on other surfaces and an undersized disclosure target on `/realized`. Invalid link ARIA found on the two changed asset pages is addressed in source and requires the final rebuilt-browser check. Independent code review and final integrated verification are in progress; do not treat this document as final release acceptance.

## Private and operational gates

Before private writes, confirm the actual application host, resolved state root, backup targets, restore proof, and single-writer ownership. `FINANCE_STATE_WRITABLE` remains off by default privately. Select one complete historical tax year and review its actual evidence locally before declaring tax-history acceptance.

Before any repository/path/job rename, inventory actual consumers, active worktrees, backups, locks and remote PR state. Prepare concrete updates and rollback, obtain the applicable execution authorization, then record the observed result. Source archives are not moved or deduplicated by this implementation.
