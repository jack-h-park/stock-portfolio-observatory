# Tax history workflow

Tax history records reported/assessed liability, actual settlements, and evidence separately. It does not expand the investment tax engine into a complete annual return calculator.

## Import and review

1. Prepare a private JSON snapshot using [the public schema](../../schemas/tax-history.v1.schema.json). The [synthetic example](../../examples/tax-history.synthetic.json) demonstrates the structure; its placeholder evidence hashes are not actual document identities.
2. Run `pnpm tax:import --input /private/path/history.json`. Preview shows additions, unchanged records, changed-record revision/digest requirements, and possible duplicate payments. It writes nothing.
3. Review tax unit, authority, year, native currency, event components/signs, allocations, evidence, effective liability basis, and settlement coverage. A return or bank debit alone does not prove authority posting. Keep unknowns unconfirmed.
4. On the designated writing host, apply with `pnpm tax:import --input /private/path/history.json --apply --expected-revision N --reason "Reviewed records"`. Supply `--decisions /private/path/decisions.json` when preview reports changed records or duplicates. That file has `changes` (the reviewed preview rows) and `matches` (reviewed incoming/existing event ID pairs, with `action: "merge"` or `action: "keep-separate"`). Candidates include duplicates within a first import. Equal payments can be explicitly kept distinct. Preview also reports `basisInvalidations`; a deliberately provisional import must list the reviewed obligation IDs in `provisionalBases`, or correct the selected basis before applying. Portable fresh imports rebase only a matched, accepted liability content version.
5. Review `/taxes`, `/taxes/history`, and the obligation record pages. Same-content re-import preserves the store revision. Conflicts require a fresh preview; the importer never retries against a changed revision automatically.

The payment-date view uses occurrence dates, not posting/document dates. Select all tax units explicitly to see cross-year payments together; each event labels its allocated units and appears once, without a combined cross-currency liability total. One payment allocated across two years appears only for the selected allocation in each tax-unit scope. Unallocated amounts are displayed separately across all units, outside scoped totals. Withholding is labeled separately from filing payments. Refunds/reversals reduce settled amounts; credit transfers move allocations without creating cash flow.

## Local corrections

The record page can select an evidenced liability basis, mark settlement evidence reviewed/unreviewed, and relink a moved document after an exact content-hash match. Review forms record a reason and expected state revision. They cannot promote a bank debit into authority-confirmed settlement; use a reviewed import supported by authority evidence for that change or for structural corrections.

Edits retain before/after snapshots, record revisions, and tombstones. A commit whose serialized state would exceed the 20 MiB reader limit is rejected without replacing the last readable revision. Original/amended filings and assessments remain separate. Missing or stale basis references produce provisional balances rather than selecting whichever amount is newest.

## Evidence access

Evidence contains a root alias (`records` or `tax`), relative path, SHA-256, and optional locator. Downloads are private-mode only, uncached attachments of the exact verified bytes. References must name real files; symbolic-link components below the configured canonical root are refused. A symlink escaping the named root is refused, including a link into the other configured root.

If a file moved, request a matching-document search on its record page. Searches are bounded to 512 files and 64 MiB per request, with a 32 MiB preview-file limit. Incomplete searches are labeled; no match does not prove the document is absent. A reviewed relink keeps document ID/hash and creates a new evidence revision. It never moves or deletes original files.

## Write authority and recovery

`FINANCE_STATE_WRITABLE=0` is the private default. Enable writes only on the application host after confirming backup coverage and restore. Source push does not carry the state root. A writer lock is not automatically stolen; inspect the recorded PID and active processes before manually recovering a stale lock. Preserve the file and backup before recovery.

Follow [backup and restore](finance-state-backup-and-restore.md) and [the cutover checklist](personal-finance-cutover.md). Sample state is disposable and regenerated only inside its owned sample root.

## Existing-record annual summary

The review-branch overview adds a year-by-year summary of existing obligations, keeping tax units, authorities, tax types and currencies separate. It does not calculate annual tax or import any new amount. A selected liability is shown only for a usable current basis with evidence references. Recorded payments, withholding, refund receipts and reversals use reviewed events and evidence references on both event and allocation; only that obligation's allocated share is counted. Categories without qualifying records remain unknown, not zero. Interest, penalties and noncash credits/adjustments are signed and separate from principal. Adjustment subtotals remain unavailable when their evidence references are incomplete. Reconciliation balances remain unavailable when the existing reconciliation cannot confirm them.

Evidence references are not a fresh verification of file bytes or authority posting. Missing event dates are labeled; allocation to an obligation year does not establish a payment-year date. Unallocated amounts remain outside obligation rows. Tax-unit scope can include owners outside the self-owned asset total. Requested refunds and return-reported prepayments remain a separate structured-record follow-up. The summary is not deployed until separately authorized.
