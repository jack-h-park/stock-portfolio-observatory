# Personal finance implementation and operating status

Updated November 12, 2026 (America/Los_Angeles). This is the current status of the [master plan](../superpowers/plans/2026-11-10-personal-finance-observatory.md). Code implementation, deployment, bounded private acceptance, and complete financial coverage are separate claims.

## Delivery and acceptance

| Work | Verified state | Remaining boundary |
| --- | --- | --- |
| Product definition, public brand and all-assets entry | Foundation merged in [#275](https://github.com/jack-h-park/stock-portfolio-observatory/pull/275); branding and entry point are operating | GitHub slug, checkout paths and scheduled-job names retain their legacy identities |
| Compatible finance paths and sample isolation | Implemented and synthetically verified | Existing per-file overrides remain authoritative; a wholesale private path migration has not occurred |
| Tax-history domain, store and importer | Implemented; a reviewed minimal historical-year import is operating with audit and repeat-preview verification | This is bounded adoption, not complete settlement or authority-posting confirmation |
| Tax views and evidence | Private tax-year/payment-date views and hash-checked evidence downloads verified | Reported payments and requested refunds do not yet have structured return fields; requests are never booked as received cash |
| Writing authority | One operating state authority; reviewed imports use a process-only CLI write opt-in | Private web tax-history writes remain disabled; implementation of review forms does not mean they are activated |
| Private web access | Approved-owner-device restriction documented and deployed in [#278](https://github.com/jack-h-park/stock-portfolio-observatory/pull/278); effective and startup gateway rules verified | New or re-enrolled devices require review; storage mode is not an access-control mechanism |
| Backup and recovery | Actual populated history, evidence and host configuration recovered from pinned encrypted snapshots in isolation; paired installed backup/drill targets match their versioned source | This is observed manual recovery proof, not proof of every later scheduled run or independent recovery of lost credentials |
| Current covered asset totals | Read-only operating review verified included-row/class arithmetic, allocation total, current chart endpoint, self-owner scope and unique inclusion keys | Source coverage remains unconfirmed; not every account or original statement has been reconciled |
| Historical asset totals | Implemented, with a confirmed gold-history correctness gap | Sale-aware historical gold correction is implemented on a review branch, not deployed; the operating reader still has the original gap |
| Annual total tax / liabilities | Deferred | Require separate designs, official-source verification where applicable, and independent acceptance cases |

The operator's private acceptance records retain actual paths, figures, evidence identifiers, hashes and snapshot receipts. None belongs in this public status file. Other installations must establish their own authority, source coverage, access and recovery evidence.

## All-assets read-only review

The review used the serving application's read-only database adapters, independent read-only SQL and the live overview/total-assets pages. The queried database, original financial files, tax history, evidence, environment and gateway were checked for preservation; no ingest, refresh, import, source synchronization, setting edit or service restart was requested by this review.

Verified within the supplied data:

- Included observations sum to their asset-class subtotals and covered total; the allocation view has the same aggregate total.
- Current totals contain self-owned observations; supplied non-self holdings remain outside that total. The chart's current endpoint matches the covered-total card.
- No repeated owner/account/asset inclusion key was found. This does not prove that every possible source alias denotes a different economic account.
- Both pages label source coverage as unconfirmed and liabilities as unsupported. Missing/conflicting observations are distinct from accounts whose records were never supplied.
- Asset-class grouping and economic-exposure grouping intentionally differ: a gold ETF can remain a security in the former and gold exposure in the latter. Different group labels are not duplicate asset totals.

Open findings:

1. The operating historical physical-gold reader reads `BUY` rows only. A sale-aware, account-scoped correction using existing FIFO basis is implemented on a review branch, not deployed; retaining a current endpoint does not validate earlier points.
2. File freshness, statement/account coverage, valuation dates and reconciliation checks are different signals. A fresh source-file inventory can coexist with older nonzero balances, overdue account coverage and unresolved checks.
3. A zero/retired balance can currently supply the oldest cash date shown beside a class. Preserve those records while making dates for nonzero supported balances understandable.
4. Overall source coverage is explicitly unconfirmed. A zero omission count does not establish complete assets, complete ownership review or complete net worth.

The observed installation has no included pension-gold row with which to prove that particular live duplication case. Its protection remains synthetic test evidence. The review did not reconcile every statement or authorize missing-data collection.

## Historical verification record

The foundation's integrated synthetic suite passed 1,138 tests: 1,124 passed, 14 skipped and zero failed, with dedicated domain, import, persistence, evidence, path-isolation and accounting regressions. TypeScript, lint, UI guardrails and production build passed at that release. Subsequent private operating adoption and gateway-notice rollout have separate acceptance records; these historical counts are not the current branch's test count.

The foundation's tax-route mobile/accessibility checks and bilingual read-only checks passed for their tested scope. Existing contrast issues elsewhere and the disclosure target on `/realized` remain separate UI follow-ups. An operating browser check is not physical-device or assistive-technology acceptance across all devices.

## Next work and preserved gates

See [next increment scope](next-increment.md). Correct historical gold first, then improve asset-coverage explanations using existing readers. Broader annual tax, liabilities, module extraction and repository/operational renames remain separately designed work packages.

Keep private web tax-history writes disabled. Each later record change needs a reviewed candidate, current revision, one writing authority and applicable execution authorization. Preserve approved-device access, original archives and existing CLI/briefing contracts. Repository rename, archive moves, deployment, restart and legacy removal remain independent execution decisions.
