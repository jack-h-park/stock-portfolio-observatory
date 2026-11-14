# Read-only account inventory adapter and display plan

> **For agentic workers:** Use superpowers:executing-plans inline with TDD. The session artifact ledger records validation and delivery.

**Goal:** Connect existing account/evidence records to the inventory projection and show its bounded review results on the accounts page.

**Architecture:** A read-only transport adapter reads configured map/generated metadata and readonly SQLite; a pure application adapter binds exact account identities to recorded source facts; a bilingual server component displays review versus evidence state. Existing update tables, financial totals, owner defaults and writers remain unchanged.

**Tech Stack:** Existing TypeScript/React, better-sqlite3 readonly, Node test/tsx; no dependencies.

**Spec:** [Approved account design](../specs/2026-11-13-account-inventory-design.md), [foundation](../../architecture/account-inventory-foundation.md).

## Global constraints

- No private data/mapping edit, original reads on web requests, collection, refresh, import, write activation, access change, Hometax or deployment.
- Do not convert default DB self ownership or latest transaction/balance/quote dates into confirmed owner/statement coverage.
- No automatic IDs/reviews or source requirement creation; existing mappings retain authority.
- Failed reads or missing required metadata cannot certify an empty/complete inventory.
- Public fixtures and local browser execution use isolated synthetic roots only.

## Review focus

- Two accounts at one institution cannot share evidence (exact-binding fixtures).
- Receipt query ends and snapshot dates remain distinct from raw DB observations (date-basis fixtures).
- Map/DB fingerprint mismatch and read failures cannot show confirmed review (transport fixtures).
- Unknown/legacy/other-owner accounts remain explicit; no false green zero (projection/display fixtures).
- Bilingual rows, masked labels and read-only links require no forms, downloads or writes (render/browser checks).

## Task 1: Read-only bindings

**Files:** `lib/application/account-inventory.ts`, `lib/adapters/account-inventory.ts`, `tests/account-inventory-adapter.test.ts`.

**Interfaces:** `buildAccountInventoryReview(snapshot, clock)` returns a projection plus read/identity limitations and bound recorded-evidence descriptions. `getAccountInventoryReview()` reads only configured map/generated metadata and readonly SQLite, and calls the pure builder. Caller failure paths produce explicit unavailable state, not empty success.

- [x] Write tests for quiet statements, per-account confirmations, raw rows without periods, conflicts/read failures, snapshots and metadata preservation; verify RED.
- [x] Implement precise account/period binding using existing reader semantics; preserve unsupported bridges as unresolved. Verify GREEN and no file changes across synthetic transport calls.

## Task 2: Read-only screen and verification

**Files:** `components/AccountInventoryReview.tsx`, `lib/ui-copy/pages/accountInventory.ts`, copy registry, `app/accounts/page.tsx`, `tests/account-inventory-display.test.ts`, architecture/status docs.

**Interfaces:** Server component accepts Task1's view model and language; no browser fetch or mutable store.

- [x] Test English/Korean review/unknown/partial/excluded/empty-source display and preserved read-only links, then implement a separate accounts-page review section without replacing existing table counts/actions.
- [x] Run focused tests, typecheck, lint, existing UI guardrails and full isolated synthetic suite/build; verify local synthetic browser layout.
- [x] Independent whole-branch read-only review, fix important findings with failing regression tests, commit/push and open a PR. Do not merge the new PR or deploy.

This plan connects recorded facts, not original-byte proof or private owner attestation. Any operational source regeneration, real metadata adoption or release remains separately authorized.

## Verified source checkpoint

Final isolated CI-equivalent validation: 1,404 tests, 1,389 passed, 15 skipped, zero failures; typecheck, lint, UI guardrails and sample build passed. Read-only synthetic browser checks confirmed English/Korean review state, existing links, no forms/inputs in the new section and no document overflow at the tested 1280px viewport. No operating or physical-device acceptance is claimed. Source delivery is a review PR; merge and deployment remain separate.
