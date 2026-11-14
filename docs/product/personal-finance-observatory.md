# Personal Finance Observatory

Personal Finance Observatory connects assets, cash flow, KR/US investment tax estimates, and financial evidence. The application is personally operated and publicly reusable: code, contracts, and synthetic examples are public, while actual financial records and operating state remain private.

## Product boundary

The application preserves source records and supports local configuration, saved plans, review decisions, and reconciliation. Existing exports and file-management utilities have explicit write boundaries. It is not accurate to describe every operation as read-only.

The primary workflow is to understand financial position, investigate a figure's sources and coverage, compare planning scenarios, and review the resulting decisions. Historical returns, assessments, tax payments, and refunds use a separate versioned store and remain separate from calculated estimates. A bounded private historical-year adoption is recorded in the [implementation and operating status](implementation-status.md). Complete settlement coverage and each installation's source coverage require their own evidence.

## Organization

| Area | Question | Existing foundations |
| --- | --- | --- |
| Overview | What is the financial position and what is missing? | Portfolio overview, total-assets series, valuation coverage |
| Assets and cash flow | What is held, where, and how did money move? | Holdings, accounts, deposits, pensions, gold, income, transactions |
| Taxes | What is estimated, reported, paid, and unresolved? | Investment scenarios, annual assumptions, lots, saved plans, filing and payment history |
| Review and data | What needs attention and why trust a figure? | Rebalancing, reconciliation, freshness, source inventory |

Asset ownership, account regime, economic exposure, and tax-unit membership are separate dimensions. Preserve the existing default owner's scope; a household view must explicitly select its members. Label covered asset totals accurately and preserve missing values. Complete net worth requires supported liabilities, which are not currently implemented.

## Priorities

1. Document supported scope and operational contracts.
2. Separate financial sources, tax documents, durable state, and runtime outputs while preserving legacy paths.
3. Deliver tax-history import, review, evidence links, and independent tax-year/payment-date views.
4. Make all-assets overview the entry point without changing investment tax/rebalance scope.
5. Expand annual tax estimation and liabilities only through separately reviewed designs.

Automated trading, tax filing/payment, general budgeting, universal tax support, and multi-user SaaS are outside this expansion. The target product name does not authorize a GitHub rename, archive move, or operational restart.

Historical gold correctness, coverage explanations and the annual recorded-tax summary (#290) have prior operating acceptance. Annual component libraries #296–#299 and the read-only CLI #300 are merged and present in the [observed installation](../operations/installation-status.md); complete annual totals, comparison and a new private tax workflow are not thereby accepted. Korean reported tax stays blocked and Hometax remains held. Coverage receipts and selected provider date/period fixes #304–#307 are merged; open #308 continues account query-period work.

The expanded custodian backup has first-capture and separate-location recovery evidence, with [bounded operating acceptance](../operations/finance-state-backup-and-restore.md#observed-operating-acceptance-november-13-2026). Prioritize account/source completeness visibility and the remaining authority/recovery boundaries before wider tax estimation or naming changes; see [next increments](next-increment.md). Branding/all-assets entry are already implemented. Deployment, financial-data changes, access changes and web-write activation remain held.

## References

- [Support matrix](support-matrix.md)
- [Compatibility inventory](../architecture/compatibility-inventory.md)
- [Design](../superpowers/specs/2026-11-10-personal-finance-observatory-design.md)
- [Implementation plan](../superpowers/plans/2026-11-10-personal-finance-observatory.md)
