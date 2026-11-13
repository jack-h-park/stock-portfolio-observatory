# Statement-period provenance and asset coverage

> Execute inline with superpowers:executing-plans; use TDD and one fresh whole-branch review.

**Goal:** Connect explicitly parsed Korean brokerage statement periods to the existing all-assets coverage disclosure, preserving valuation/account freshness algorithms and financial totals. Update installation documentation from a fresh read-only observation; do not infer live browser acceptance from a checkout/build ID.

**Spec:** The owner authorized the period-evidence/asset-coverage improvement from the [PFO master plan](2026-11-10-personal-finance-observatory.md). Existing [coverage boundaries](../../product/next-increment.md) prohibit promoting transaction/lot/API/file dates to declared periods. Hometax research and deployment are on hold; private originals, history, access controls and web-write prohibition remain unchanged.

**Approach:** Extend generated KR `as-of.json` additively with versioned per-account statement-period receipts from the extractor's already-account-matched `declared` map: safe source basename, SHA-256, page 1, start/end, and explicit conflict state when source rows fall outside that source's period. Existing `accounts` as-of values and tax/holding calculations remain unchanged, including manual pins. Legacy metadata remains unconfirmed. Validate the new metadata at a small pure TypeScript boundary, match by exact KR account, then feed only confirmed ends to the existing range. Include read-only account/source/date details and separate conflict/unknown counts in both languages. This establishes parser-recorded provenance, not independent current-byte verification, complete reconciliation or global account completeness. Other source types remain unconfirmed; no original file is opened by the display adapter.

Alternatives: promoting legacy as-of dates loses origin; re-reading originals on web requests broadens evidence access and runtime work; a universal parser/schema migration exceeds the bounded request. Additive recorded receipts fit existing extraction and are safe for old readers. These are implementation choices within the authorized scope.

## Tasks

- [x] Write failing synthetic extraction/receipt tests for explicit periods, manual as-of independence, missing/invalid dates and source-row contradictions. Implement additive receipt output without changing legacy data.
- [x] Write failing adapter/UI tests for exact account matching, legacy fallback, multiple valid sources, conflicts, invalid metadata, future transaction/API dates and unchanged totals. Implement the pure reader, narrow adapter wiring and bilingual disclosure.
- [x] Update operating/implementation/next-step docs using read-only installation observations. Distinguish #300 merge from installed code/build and separately verified service behavior.
- [x] Verify focused/full tests, typecheck, lint, guardrails and sample build; inspect the synthetic rendered UI. Obtain fresh review, fix material findings, preserve operating boundaries and prepare the PR. Delivery status is tracked on GitHub; do not merge or deploy.

Review focus: no fabricated dates from legacy pins; a conflicting receipt must not quietly fall back to an older green source; no file/path/evidence read from display; exact-account binding; deterministic aggregation; explicit subset/unknown scope; public docs/tests contain only synthetic data and generic operating identities. Another active worktree's account/bank coverage changes are outside this branch and must not be overwritten or cleaned up.
