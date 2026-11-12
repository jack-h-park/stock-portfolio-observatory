# Next Personal Finance Observatory increments

**Status:** First increment merged in [#283](https://github.com/jack-h-park/stock-portfolio-observatory/pull/283), not deployed. Second increment authorized and implemented on a review branch, not deployed. Updated November 12, 2026 (America/Los_Angeles). Deployment and financial-data mutation require separate authorization.

The [operating status](implementation-status.md) records the completed foundation and bounded adoption. The read-only review established the immediate priority: resolve the historical gold calculation gap before expanding the overview or annual tax engine. Private examples, account inventory, dates, balances and evidence remain in the operator's private review.

## First PR: sale-aware historical gold

**Suggested title:** `fix(assets): reconcile historical gold quantities after sales`.

Original defect: [getTotalAssetsSeries](../../lib/adapters/portfolio-db.ts) supplied only gold purchases to [totalAssetsSeries](../../lib/net-worth.ts), which accumulated purchased grams on every later historical date. The merged correction reads purchases and sales per account and uses the existing FIFO matcher for remaining grams and fee-inclusive cost. The current endpoint is independently replaced with current covered assets, so agreement at that endpoint cannot detect historical gold retained after a sale.

Scope:

- Read the relevant dated gold purchase and sale quantities, preserving account and self-owner scope. Define sign normalization explicitly; do not treat cash transfers, fees or interest as gram changes.
- Compute remaining grams on each requested date. Before supported history begins, retain unknown/null semantics; a supported fully closed position has zero grams rather than an invented continuing position.
- Use only price evidence available on or before the requested date. A missing price must not restore the original gross purchase cost after a sale. Define remaining-cost fallback against the existing basis contract; where it cannot be supported, preserve unknown valuation rather than inventing basis. Unexpected negative holdings or ambiguous quantity events require an explicit limitation.
- Keep today's covered-total card, current asset inclusion, economic-exposure mapping and investment tax/rebalance scope unchanged. Historical values may intentionally change where the defect is corrected.
- Use synthetic fixtures for full sale, partial sale, multiple accounts, non-self ownership, no future-price leakage, missing price/basis, pre-first-observation null and post-close zero. Verify both overview callers and current-endpoint parity.

Likely files: `lib/adapters/portfolio-db.ts`, `lib/net-worth.ts`, their existing historical-assets tests, and the affected explanatory copy if its algorithm description changes. Reuse the current code structure; no broad adapter/module extraction is necessary for this correction.

Out of scope: rewriting source statements, refreshing prices, reimporting tax history, changing asset classifications, applying transactions, renaming repositories or enabling web writes. Deployment requires its own applicable authorization and a read-only operating recheck.

Correction boundary: unknown quantities and oversold account histories remain null; missing purchase basis blocks cost fallback only for unknown lots still open. A known closed account remains zero even without price/basis. An unresolved account makes that date's gold class unknown rather than reporting an unlabeled partial gold total. The shared matcher and investment/tax calculations are unchanged. The service is still running the pre-correction code until separately authorized deployment.

## Second PR: explain the coverage behind current assets

**Suggested title:** `feat(assets): distinguish valuation freshness from source coverage`.

Build on [finance-overview](../../lib/application/finance-overview.ts), existing account/supplementary coverage and validation readers, [AssetCoverageNote](../../components/AssetCoverageNote.tsx), and the two existing overview pages.

- Present valuation dates, statement coverage, unresolved reconciliation and omitted observations separately. Do not turn an unconfirmed account inventory into a completeness percentage.
- Give read-only links from actionable coverage issues to existing data-review screens. Keep manual review and source acquisition separate from this summary.
- Distinguish current nonzero cash-balance dates from old zero/retired observations while retaining the original rows. Show available statement period ends separately from last transaction/balance dates; do not relabel one as the other.
- Make wrapper/asset-class grouping and economic exposure understandable without forcing their category subtotals to be identical.
- Preserve the covered-total amount, owner default, currencies, exclusions and missing-value behavior. Keep a fresh file/status badge from asserting that all balances or tax treatments are current and reconciled.

Acceptance uses synthetic stale-but-readable data, a zero retired balance, missing account evidence, conflicting observations and non-self accounts. Real account names, amounts or screenshots must not be committed as fixtures.

### Second-increment implementation boundary

Both asset overviews share a disclosure that separates self-owned nonzero cash dates, market/snapshot/cost observation dates and the conversion-rate date from configured-account source review. Zero balance observations remain stored and listed; their old dates no longer set the nonzero-cash class note. Zero does not establish account closure.

Configured brokerage/crypto and supplementary coverage, validation failures and file freshness are independent signals and may include other owners; they are not a self-only inventory or completeness percentage. An unavailable or empty coverage/check reader remains unconfirmed. Declared statement period ends remain unconfirmed in this increment: existing KR as-of metadata can be overridden or inferred from transactions, and does not retain declared-period provenance. Neither it nor legacy lot/transaction dates is promoted to a declared period end. A later provenance-preserving extraction change can supply those dates. Read-only links lead to existing review screens. No source acquisition, ingest, classification change or web write is added.

The second increment is not deployed. Observation dates describe evidence used by the existing valuation; they do not certify current market quotes, full statement reconciliation or complete account coverage.

## Later increments

After those two increments, consider structured return-reported payments/refund requests and more useful tax summary links. Keep requested refunds distinct from actual receipts and annual return liability distinct from investment-incremental estimates. A complete annual tax calculator, liabilities/net worth, broader parser coverage and repository/path renames retain their own design and acceptance gates from the [master plan](../superpowers/plans/2026-11-10-personal-finance-observatory.md).

This review does not reopen the owner's accepted final return package or require further tax investigation before the asset work can proceed.
