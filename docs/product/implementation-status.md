# Personal finance implementation and operating status

Updated November 13, 2026 (America/Los_Angeles). This is the current status of the [master plan](../superpowers/plans/2026-11-10-personal-finance-observatory.md). Code implementation, installed source/build, deployment, bounded private acceptance, and complete financial coverage are separate claims. See the [current installation observation](../operations/installation-status.md); the earlier #290 browser acceptance is historical, not the latest checkout identity.

## Delivery and acceptance

| Work | Verified state | Remaining boundary |
| --- | --- | --- |
| Framework security | [#311](https://github.com/jack-h-park/stock-portfolio-observatory/pull/311) merged/deployed; Next.js 15.5.28 build/process, bounded browser/evidence checks and preservation verified | Two moderate transitive audit findings remain; later #312 installation observation is separate from #311 browser acceptance |
| Product definition, public brand and all-assets entry | Foundation merged in [#275](https://github.com/jack-h-park/stock-portfolio-observatory/pull/275); branding and entry point are operating | GitHub slug, checkout paths and scheduled-job names retain their legacy identities |
| Compatible finance paths and sample isolation | Implemented and synthetically verified | Existing per-file overrides remain authoritative; a wholesale private path migration has not occurred |
| Tax-history domain, store and importer | Implemented; a reviewed minimal historical-year import is operating with audit and repeat-preview verification | This is bounded adoption, not complete settlement or authority-posting confirmation |
| Tax views and evidence | Private tax-year/payment-date views and hash-checked evidence downloads verified | Reported payments and requested refunds do not yet have structured return fields; requests are never booked as received cash |
| Writing authority | One operating state authority; reviewed imports use a process-only CLI write opt-in | Private web tax-history writes remain disabled; implementation of review forms does not mean they are activated |
| Private web access | Approved-owner-device restriction documented and deployed in [#278](https://github.com/jack-h-park/stock-portfolio-observatory/pull/278); effective and startup gateway rules verified | New or re-enrolled devices require review; storage mode is not an access-control mechanism |
| Backup and recovery | Earlier bounded operating-history recovery retained; wider ownership/scope audit completed; expanded custodian daily backup installed and first pinned snapshot independently restored/verified; [operating evidence boundary](../operations/finance-state-backup-and-restore.md#observed-operating-acceptance-november-13-2026) | Monthly drill rollout remains held; no full operating-host/cross-repository/app recovery or later scheduled-run proof. Independent key-store access was owner-confirmed for this scope |
| Current covered asset totals | Read-only operating review verified included-row/class arithmetic, allocation total, current chart endpoint, self-owner scope and unique inclusion keys | Source coverage remains unconfirmed; not every account or original statement has been reconciled |
| Historical asset totals | Sale-aware historical gold correction [#283](https://github.com/jack-h-park/stock-portfolio-observatory/pull/283) deployed with [#286](https://github.com/jack-h-park/stock-portfolio-observatory/pull/286); independent FIFO and post-sale web checks passed | Unknown quantities/basis remain unknown; the current endpoint alone does not validate history |
| Asset dates and coverage | [#286](https://github.com/jack-h-park/stock-portfolio-observatory/pull/286) deployed on both asset overviews; nonzero cash dates, valuation methods, source review and freshness are separate | Merged #304 connects [KR receipts](../architecture/statement-period-provenance.md); #305–#307 improve selected Fidelity/Bithumb/Merrill dates/periods. Merged #308 addresses wider query periods and is present in observed source; complete account coverage and new browser acceptance remain unconfirmed |
| Expected-account inventory | [Identity, owner, scope-review and missing-evidence design](../superpowers/specs/2026-11-13-account-inventory-design.md) proposed using the existing private map | No implementation, real metadata migration, owner attestation or completeness claim; #314 bank historical-gap signals are existing inputs, not a complete inventory |
| Annual recorded-tax summary | [#290](https://github.com/jack-h-park/stock-portfolio-observatory/pull/290) merged and deployed; operating fields and scoped links verified in English/Korean | No new tax records, structured return-reported prepayments/refund requests, annual estimate or settlement-completeness claim |
| Annual tax rules/contracts | [#296](https://github.com/jack-h-park/stock-portfolio-observatory/pull/296) merged; present in observed operating source | Pinned 2025 references and component-only contracts; no newly accepted complete annual-tax workflow |
| Annual component calculators | US ordinary/NIIT [#297](https://github.com/jack-h-park/stock-portfolio-observatory/pull/297) and eligible QDCG v2 [#298](https://github.com/jack-h-park/stock-portfolio-observatory/pull/298) merged; present in observed operating source | Explicit reviewed method/branch and version; Korean rounding and special-rate methods remain blocked; no web estimate UI |
| Korean calculated-tax reference | [Exact national/local rate arithmetic](../architecture/korean-tax-reference.md) merged in #299; present in observed operating source | Reporting quantization unverified; reported amount always null; existing annual KR components stay blocked |
| Annual component preview CLI | [Standalone explicit-file/stdout CLI](../architecture/annual-tax-preview-cli.md) merged in #300; present in observed operating source | Valid blocked results exit 0; totals/comparison stay unavailable; no evidence reads or operating writes |
| Connector shadow reader | [#301](https://github.com/jack-h-park/stock-portfolio-observatory/pull/301) merged; recovered connector records passed pointer/payload/provenance checks | Shadow-only. Recovery is not a new collection, seven-day observation, statement reconciliation or economic promotion |
| Annual total composition/comparison | [MVP design](../superpowers/specs/2026-11-12-annual-tax-estimation-mvp-design.md), not implemented | Independent components cannot be treated as a complete annual return or compared with recorded liability |
| Liabilities / complete net worth | Deferred | Require separate design and evidenced asset-minus-liability acceptance |

The operator's private acceptance records retain actual paths, figures, evidence identifiers, hashes and snapshot receipts. None belongs in this public status file. Other installations must establish their own authority, source coverage, access and recovery evidence.

## Original program checkpoint

| Phase | Current completion | What remains |
| --- | --- | --- |
| P0–P2: definition, brand, source/state/runtime boundaries | Implemented with compatible legacy paths and isolated synthetic execution | Operational aliases/consumers are retained; this is not a completed physical archive/path migration |
| P3: tax-history vertical slice | Bounded reviewed historical-year adoption, evidence views and earlier operating-history recovery verified | More years, settlement completeness and any structured return-reported prepayment/refund-request extension require available evidence and reviewed writes |
| P4: all-assets overview | Entry point, covered-total arithmetic, historical gold and date/coverage disclosure delivered within their accepted scope | Authoritative account inventory, missing-source visibility and complete reconciliation remain unconfirmed; build on merged #308 |
| P5: broader estimate/history integration | Recorded annual summary operating; 2025 component foundation and CLI merged/present in installed source | Scoped annual composition/comparison and later estimate UI are not complete; KR reported-tax and Hometax gates remain |
| P6: extraction and operational rename | Separate future work packages | Require demonstrated boundaries, consumer parity, authorization and rollback; no prerequisite rewrite or rename |

The wider backup inventory and custodian snapshot recovery advance Task6 durability. They do not close its remaining operating-host, interruption/restart, configuration-restore or live-migration gates.

## All-assets read-only review

The review used the serving application's read-only database adapters, independent read-only SQL and the live overview/total-assets pages. The queried database, original financial files, tax history, evidence, environment and gateway were checked for preservation; no ingest, refresh, import, source synchronization, setting edit or service restart was requested by this review.

Verified within the supplied data:

- Included observations sum to their asset-class subtotals and covered total; the allocation view has the same aggregate total.
- Current totals contain self-owned observations; supplied non-self holdings remain outside that total. The chart's current endpoint matches the covered-total card.
- No repeated owner/account/asset inclusion key was found. This does not prove that every possible source alias denotes a different economic account.
- Both pages label source coverage as unconfirmed and liabilities as unsupported. Missing/conflicting observations are distinct from accounts whose records were never supplied.
- Asset-class grouping and economic-exposure grouping intentionally differ: a gold ETF can remain a security in the former and gold exposure in the latter. Different group labels are not duplicate asset totals.

Follow-up resolution and remaining boundaries:

1. The former purchases-only historical gold gap is resolved in operating code. Account-scoped remaining quantities and fee-inclusive FIFO cost were independently checked, and a post-sale month-end web value was zero. Current asset totals and financial records were unchanged by deployment.
2. File freshness, statement/account coverage, valuation dates and reconciliation checks now appear as distinct signals. Configured review may include other owners; it is not a completeness score for the self-owned total.
3. Old zero cash observations are retained but no longer set the nonzero-cash date note. A zero balance does not establish account closure.
4. Overall source coverage remains unconfirmed. KR parser-recorded receipts and selected provider query/date improvements are merged in #304–#308 and present in observed source. Merged #310 adds Samsung/Chase query-period handling and #312 conditional update actions; these do not complete the expected-account inventory. A declared interval, fresh fetch or merged implementation is not a complete inventory or private-data reconciliation. This documentation update performs no extraction or refresh.

The observed installation has no included pension-gold row with which to prove that particular live duplication case. Its protection remains synthetic test evidence. The review did not reconcile every statement or authorize missing-data collection.

## Historical verification record

The foundation's integrated synthetic suite passed 1,138 tests: 1,124 passed, 14 skipped and zero failed, with dedicated domain, import, persistence, evidence, path-isolation and accounting regressions. TypeScript, lint, UI guardrails and production build passed at that release. Subsequent private operating adoption and gateway-notice rollout have separate acceptance records; these historical counts are not the current branch's test count.

The foundation's tax-route mobile/accessibility checks and bilingual read-only checks passed for their tested scope. Existing contrast issues elsewhere and the disclosure target on `/realized` remain separate UI follow-ups. An operating browser check is not physical-device or assistive-technology acceptance across all devices.

## Next work and preserved gates

See [next increment scope](next-increment.md). The #311 framework patch is merged, deployed and verified within its recorded scope; do not repeat it as pending. Prioritize account/source coverage and actionable missing-evidence visibility, building on merged #308. Then close the remaining per-module ownership and operating-state/delivery-state recovery boundaries; do not repeat the already verified custodian restore as if it were still missing. The next tax-history extension, if useful evidence is available, is structured return-reported payments/refund requests with settlement kept separate. Annual composition/comparison, California, liabilities, module extraction and repository/operational renames remain later bounded packages.

Annual libraries #296–#299 and CLI #300 are merged and present in observed operating source. Source/build identity does not establish a complete private annual workflow, comparison eligibility or new browser acceptance. Korean reported tax remains blocked by unresolved line-specific quantization; Hometax stays held and any further deployment needs separate authorization. The accepted final historical return is not reopened.

Keep private web tax-history writes disabled. Each later record change needs a reviewed candidate, current revision, one writing authority and applicable execution authorization. Preserve approved-device access, original archives and existing CLI/briefing contracts. Repository rename, archive moves, deployment, restart and legacy removal remain independent execution decisions.

## Historical operating acceptance: #290

The owner installation was verified at merge `862f968` (#290), including #283/#286, on November 12, 2026 (America/Los_Angeles). The isolated candidate build and focused synthetic history tests passed before installation. Operating obligation cards matched the read-only projection in English/Korean, including unknown balances; scoped record/year/payment-date links worked. Tax-history revision/hash, financial DB and current asset totals were unchanged. Original evidence files retained hashes/mtimes and HTTPS downloads matched expected hashes with private/no-store caching. Environment, launch-agent file, persisted/live gateway rules and disabled web writes were preserved. A non-allowed LAN source and spoofed forwarding headers received 403. Settled mobile viewport checks passed; this does not prove physical-device or assistive-technology acceptance. Private paths, amounts, account identifiers and receipts remain outside this repository.

The #290 pre-merge integrated suite had 1,229 tests: 1,215 passed, 14 skipped, zero failed; typecheck, lint, UI guardrails and synthetic build passed. These are historical verification results for that implementation, not tests of the proposed annual calculator or a claim that this documentation task reran the application suite.
