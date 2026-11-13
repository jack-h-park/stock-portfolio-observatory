# Annual tax summary implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this approved read-only increment. No merge, deployment, financial import or configuration change is authorized.

**Goal:** Replace the overview's tax-record counts with useful year-by-year amounts from existing records and update stale operating status.

**Architecture:** A pure application projection groups existing obligation rows by tax year while keeping tax unit, authority, tax type and currency separate. Reuse reconciliation for outstanding amounts; display a selected liability only when its basis is current, usable and evidence-linked. Sum only the allocated share of evidence-linked, reviewed settlement events; keep payments, withholding, refunds, reversals, interest, penalties and signed noncash adjustments distinguishable. A presentation-only component renders bilingual read-only detail links inside the existing overview card. No schema or persistence changes.

**Scope:** Existing recorded tax units, explicitly separated; no implication that they match the asset overview's self-owner scope. No cross-currency total, new estimate or complete settlement claim. Missing categories are unknown rather than zero. Unreviewed or missing-evidence allocations are excluded with visible counts; unknown dates and unallocated events remain explicit. Requested refunds and return-reported prepayments require a later structured-record increment.

**Delivery status:** Subsequently merged and deployed in #290 at `862f968` under separate owner authorization on November 12, 2026 (America/Los_Angeles). The execution holds above/below record the original PR-preparation scope; they do not describe current deployment status. Further annual-calculator work remains design-only.

## Files and tasks

- [x] Add `tests/annual-tax-summary.test.ts`: split cross-year allocation, payment/refund/reversal separation, withheld principal, interest/penalties, missing categories, stale/unusable basis, incomplete evidence/review, deleted rows, large exact amounts, date uncertainty, unrelated tax units and empty/error rendering, events-only unallocated history and noncash adjustments. Watch the projection test fail before implementation.
- [x] Add `lib/application/annual-tax-summary.ts` with `getAnnualTaxSummary(store)`; never mutate the supplied store or read the portfolio DB. Add `components/AnnualTaxSummary.tsx` as a pure presenter and `lib/ui-copy/pages/annualTaxSummary.ts` in the bilingual registry. Wire the existing `FinanceTaxSummary` card to this projection and presenter, including an explicit unavailable state on read failure.
- [x] Update operating/product/support/master-plan status to reflect the verified #283/#286 deployment. Reconcile Task 6 with existing code/tests and bounded private recovery evidence; leave broader consumer/path migration gates open. Document this new summary as review-branch implementation, not deployed.
- [x] Run focused/full tests, typecheck, lint, guardrails and synthetic sample build/browser checks. Obtain independent whole-diff review. Verify original sources, tax state, access settings and operational build remain unchanged. Existing scheduled generated-data refreshes are recorded separately; this task does not invoke them. Delivery is a PR with CI recorded in its description/private receipt; merge and deployment remain outside authorization.

## Acceptance boundaries

1. No total combines tax units, authorities, tax types or currencies.
2. No amended/assessment candidate or unreviewed payment is promoted without an eligible selected basis or reviewed allocation evidence.
3. A cash payment allocated to two years contributes only each year's allocated share; no amount is multiplied by evidence count.
4. No missing refund/withholding/payment is presented as confirmed zero; a valid recorded zero principal with interest remains visible.
5. Real records and evidence are never fixtures. No portfolio dependency, edits, imports, source acquisition or operational changes.
