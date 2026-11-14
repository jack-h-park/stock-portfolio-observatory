# Account inventory compatibility plan

> **For agentic workers:** Use superpowers:executing-plans inline with TDD; validation and delivery live in the session artifact ledger.

**Goal:** Recognize existing Robinhood snapshot identities and explain legacy pension eligibility without changing private metadata or collection policy.

**Architecture:** Add a pure snapshot identity resolver; use it only in the read-only adapter. Add pension-policy presentation derived from existing legacy fields, separate from the domain's confirmed owner/lifecycle/review state. Keep existing writers, totals, ingestion and reminders unchanged.

**Tech Stack:** Existing TypeScript/React and Node test/tsx; no new dependencies.

**Spec:** [Account inventory design](../specs/2026-11-13-account-inventory-design.md), [adapter/display boundary](../../architecture/account-inventory-display.md).

## Global constraints

- No real financial data, evidence, mappings, access or web-write changes; no Hometax or deployment.
- No suffix-based identity guesses, persisted IDs, balance assumptions or owner promotion.
- Legacy retirement/token eligibility is a declared policy, not new closure, balance or review proof. Notes are not parsed as policy.
- Existing-token closed accounts stay out of fresh snapshot ingestion in this adapter; no reminder/reactivation change.
- Public fixtures are synthetic. Any private replay uses the existing write/network sandbox and before/after receipts.

## Review focus

- Full numbers with the same suffix remain distinct (identity tests).
- Duplicate numbers/nicknames or conflicting schema fields remain unresolved (identity/transport tests).
- Explicit named snapshots keep compatibility (transport tests).
- Tokenless legacy pension eligibility must not hide a new primary requirement or invalid/future retirement (policy tests).
- Display explains policy without confirming owner, review completeness, zero balance or closure (bilingual tests).

## Task 1: Read-only compatibility and presentation

**Files:** Create `lib/domain/assets/robinhood-snapshot-identity.ts` and `lib/application/inventory-pension-policy.ts`; update inventory transport/application/component/copy; extend synthetic adapter/display tests.

**Interfaces:** `readRobinhoodSnapshotIdentities(accounts)` returns labels or explicit identity issues for the existing account/accountNumber/account_number/nickname shapes. `inventoryPensionPolicies(mapRead, asOfDate)` returns a per-row declared-policy annotation. New projection metadata does not replace canonical identity or review state.

- [ ] Write failing tests for exact snapshot schemas, ambiguity/suffix isolation, closed/tokenless policies, active primary requirements and English/Korean messages.
- [ ] Implement pure resolvers and adapter/view wiring; preserve raw input, files and existing domain/legacy behavior. Verify focused GREEN.
- [ ] Independently review; fix important findings with RED→GREEN regressions. Run full isolated synthetic suite, typecheck, lint, guardrails and build.
- [ ] If needed for acceptance, rerun the private existing-data preview with the candidate source in its own directory, no deployment; compare source/metadata/config preservation. Do not create or edit inventory metadata.
- [ ] Document limits, push and open the PR. Do not merge or deploy it.
