# 2025 federal ordinary-tax and NIIT calculator implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline with test-driven-development; perform one fresh whole-branch review before PR delivery. Steps use checkbox syntax.

**Goal:** Calculate independent 2025 US federal ordinary line-16 and NIIT line-17 components from reviewed bases, without annual composition or operating activation.

**Architecture:** Extend the merged rule/contract library with exact BigInt form-line arithmetic, pure federal calculators and component orchestration. Return the existing component-only result contract, bound to input and rule hashes, with explicit traces and per-component blockers. Do not call investment engines or operational readers/writers.

**Tech stack:** Existing TypeScript/JSON, node:test/tsx and BigInt; no dependencies.

**Spec:** [Annual tax MVP design](../specs/2026-11-12-annual-tax-estimation-mvp-design.md), [foundation contract boundary](../../architecture/annual-tax-foundation.md).

**Authorization:** The owner explicitly authorized merging #296 and opening the next US ordinary/NIIT calculator PR. #296 is merged at `fdd8155`. Merge/deployment of this new PR, financial/evidence/configuration changes, access changes and web writes remain unauthorized. The operating application remains at #290.

## Global constraints

- 2025 only; US federal Single/MFJ only for computed components. No backward inflation, future projection or system-clock rule selection.
- Use the complete pinned Tax Table below USD 100,000 after whole-dollar line rounding, and the Tax Computation Worksheet at/above it. Preserve worksheet inclusive/exclusive boundaries.
- Whole-dollar form mode: preserve input cents; round each supplied already-aggregated form line half away from zero, then follow form operations and round each output line. Never round source items individually or subtract deductions again.
- NIIT uses reviewed Form-8960-specific MAGI/NII, not portfolio gains or AGI proxies; floor threshold excess at zero and apply the cap before tax rounding.
- Missing or unreviewed facts block affected components; independent requested components may still compute. Explicit reviewed zero remains known zero.
- Korean calculated-tax rounding and preferential worksheet methods remain blocked; no California, annual composition/comparison, CLI, UI, import, snapshot or persistence feature.
- Keep exact native minor-unit strings and provenance. No binary floating-point money or private-return fixtures.
- Preserve existing financial/evidence bytes, deployment, approved-owner-device restriction and disabled web writes.

## Review focus

1. Rounded taxable income crosses USD 100,000 or a tax-table boundary: choose from the rounded form line and retain original cents in trace.
2. Worksheet subtraction includes cents and equality boundaries: use rational/integer arithmetic; do not round intermediate products separately.
3. Preferential income or unknown profile silently selects ordinary tax: reuse the shared contract eligibility gate, never assume missing classification is ordinary.
4. One requested component is blocked: preserve a separately supported component without producing an annual total or comparison eligibility.
5. Very large/signed MAGI and cents near rounding ties: retain exact BigInt arithmetic and explicit provenance; no overflow or implicit zero.

## Task 1: Shared eligibility and federal arithmetic

**Files:** `lib/domain/taxes/annual/contracts.ts`, `lib/domain/taxes/annual/us-federal.ts`, `tests/annual-federal-calculator.test.ts`.

**Interfaces:** Share `ANNUAL_REQUIRED_AMOUNTS` and `getAnnualComponentBlocker(validatedInput, componentId)` with the result validator. `calculateFederalComponent(validatedInput, ordinaryOrNiitId)` returns a component assertion with rule refs, input refs and deterministic trace; its caller must honor the shared eligibility gate.

- [x] Add failing tests for reviewed method/profile gates, MFJ USD 120,000 -> USD 16,228, Single/MFJ table anchors, USD 100,000 equality/cents crossing, all worksheet boundary neighborhoods and exact large inputs.
- [x] Run focused tests; expected missing calculator module or unimplemented calculation failure.
- [x] Extract a shared blocker gate without changing accepted foundation contract behavior. Implement BigInt whole-dollar input/output rounding, table lookup and exact worksheet calculation.
- [x] Add NIIT tests: MFJ MAGI USD 300,000/NII USD 20,000 -> USD 760; Single threshold; cap/excess/zero/negative MAGI; rounding below/at half-dollar output ties. Implement NIIT from already aggregated reviewed line inputs.
- [x] Run focused tests and existing contract tests; expected all pass. Commit this tested calculation unit.

## Task 2: Pure component orchestration and provenance

**Files:** `lib/domain/taxes/annual/calculate.ts`, calculator tests, `lib/domain/taxes/annual/rules.ts`.

**Interfaces:** `calculateAnnualComponents(value: unknown): AnnualEstimateResult` validates input, computes supported requested federal components, emits explicit unknown/unsupported results for blocked methods/profiles/authorities, validates the resulting contract and returns an isolated result. No I/O or runtime state reads. Registry calculation availability becomes true only for implemented ordinary/NIIT components; source readiness is unchanged.

- [ ] Write failing tests for independent partial output, unknown/missing versus known zero, unsupported methods/Korean scope, invalid scope/year rejection, immutable input/result copies and deterministic hash/trace/provenance.
- [ ] Run focused tests; expected missing orchestrator/failing feature assertion.
- [ ] Implement orchestration with component-only scope, null annual total, false comparison eligibility, exact source/input identities and traces identifying synthetic/assumed bases. No reviewed/manual component fabrication.
- [ ] Update availability tests to distinguish implemented library from merged/deployed/operating availability. Preserve blocked rule readiness and pinned reference digest.
- [ ] Run focused/full tests, typecheck, lint, guardrails and isolated sample build; expected green. Commit.

## Task 3: Review, status and PR

**Files:** `docs/architecture/annual-tax-foundation.md`, product status/support/next-increment docs, MVP design and this plan.

- [ ] Record #296 as merged but not deployed; calculator implementation is a review-branch library only. No annual-total, operating web or settlement claim.
- [ ] Cross-check public source identities and synthetic expected outputs independently; check no private source identifiers enter git. Record any rulings/limitations in the private ledger and public boundary documentation.
- [ ] Perform a fresh whole-branch review, resolve material issues with red/green tests, and verify protected operation/source hashes read-only.
- [ ] Verify changed Markdown links and clean committed tree. Push/open the calculator PR and confirm exact-head CI; leave it unmerged and undeployed. Preserve worktree while its PR remains active.

## Later separately scoped work

Unblock preferential worksheet/Korean rounding only with verified rules. Annual composition, recorded-history comparison, California, preview CLI and read-only presentation remain separate increments. The owner's finalized historical return is not an oracle or investigation target.
