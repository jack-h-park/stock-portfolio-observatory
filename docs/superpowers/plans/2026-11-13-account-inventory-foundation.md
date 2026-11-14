# Account inventory foundation implementation plan

> **For agentic workers:** Use superpowers:executing-plans for this first standalone contract increment. Progress and test receipts live in the session artifact ledger.

**Goal:** Implement explicit read-result validation, identities, review digests and a pure inventory/evidence projector with synthetic tests.

**Architecture:** Separate types, map validation/normalization, semantic review handling and evidence/projection logic under `lib/domain/assets/account-inventory/`. Consumers pass already-read values; no production caller or legacy loader changes.

**Tech Stack:** Existing TypeScript, node:crypto, node:test/tsx; no dependencies.

**Spec:** [Approved design](../specs/2026-11-13-account-inventory-design.md).

## Global constraints

- No private mapping/data, original evidence, operating settings, access/write changes, provider calls, Hometax or deployment.
- Existing map remains sole editing authority. Legacy loader, arithmetic, reminder and output contracts stay unchanged.
- Missing/invalid inputs cannot yield reviewed empty inventory; clocks are injected and IDs never generated/persisted.
- Pure logic consumes recorded provenance; no filesystem, DB, network, environment or original-byte verification.
- Implementation is not private inventory adoption or UI/operating acceptance.

## Review focus

- Duplicate IDs/aliases and same-provider accounts must not borrow evidence (identity tests).
- Unknown ownership/provider cannot evade a narrower scope (scope tests).
- Historical receipts, future observations and semantic changes cannot certify current completeness (review tests).
- Legacy and new history starts must agree; endpoint freshness cannot erase gaps (source tests).
- Empty/quiet/closed versus unavailable and input mutation must remain distinct (boundary tests).

## Task 1: Independent contract and projector

**Files:** Create `lib/domain/assets/account-inventory/{types,validation,review,evidence,index}.ts`; create `tests/account-inventory.test.ts`; link the delivery boundary from product status.

**Interfaces:** `validateInventoryMap(MapRead)` returns normalized registrations or explicit unavailable reasons. `inventoryDigest(map, scope)` provides versioned canonical SHA-256 of semantic inventory. `projectAccountInventory(input)` produces `InventoryProjectionV1`; all clocks, observations and recorded evidence are explicit inputs. Scope has exact selectors and reviewed exclusions. Existing readers are not called.

- [x] Write synthetic tests for read failures, primaries/bindings, identities, ownership and lifecycle, review/digest/time, per-kind evidence/history, compatibility and immutability. Run focused tests and record the expected missing-module RED.
- [x] Implement types and strict boundary validation; deterministic semantic normalization, conservative scope matching, review selection and pure evidence/projector logic. Run focused tests until green; record any implementation decisions in the ledger.
- [x] Run typecheck/lint, related legacy synthetic regressions, full isolated CI-equivalent suite, UI guardrails and sample build. Do not seed a configured private checkout.
- [x] Independently review the full branch; fix important findings with RED→GREEN tests. Record validation and delivery scope, commit/push and open a PR. Do not merge the new PR or deploy.

This single task owns the tightly coupled contract; adapter/UI wiring and real metadata entry remain separate later tasks. The plan implements the design's first synthetic stage only, not its later display/owner-adoption stages.

## Verified implementation checkpoint

The independent review findings were reproduced and fixed with synthetic regressions. Final isolated verification: 1,389 tests, 1,374 passed, 15 skipped, zero failed; typecheck, lint, UI guardrails and sample production build passed. This is source verification only; the implementation was pushed and [PR #317](https://github.com/jack-h-park/stock-portfolio-observatory/pull/317) opened. That PR is not merged or deployed; its CI is separate from the recorded local validation.
