# 2025 Korean general-tax reference implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline with test-driven-development and one fresh whole-branch review. Source research was split by authority with dispatching-parallel-agents; do not delegate implementation tasks.

**Goal:** Implement exact Korean national/local general-rate calculations and reviewed-input gates, while keeping reported tax amounts blocked until their calculated-tax-line quantization is verified.

**Architecture:** Add a separate pure `calculateKoreanTaxReference` library API returning a rational reference, never a reported component. Reuse existing input validation, split the shared input eligibility gate from the existing source-readiness gate, and retain the annual component reader's current blocked behavior. Existing immutable v1/v2 packs, schemas, US calculations, CLI/UI and operational state remain unchanged.

**Tech stack:** Existing TypeScript, JSON, BigInt and node:test/tsx; no new dependency.

**Spec:** [Annual MVP design](../specs/2026-11-12-annual-tax-estimation-mvp-design.md), [annual library boundary](../../architecture/annual-tax-foundation.md).

**Authorization and source outcome:** The owner authorized merging #298 (verified `37bcaab`) and a Korean calculator PR. Independent primary-source research did not establish the 2025 general calculated-tax-line sub-won policy for either authority. The MVP explicitly requires that evidence before KR rule release. This PR therefore delivers the exact reference core and its tests; it does not release filing-grade KR components or claim the source blocker is resolved. The owner was informed of this implementation boundary before coding. New PR merge/deployment and private financial/evidence/configuration/access/web-write changes remain unauthorized.

## Global constraints

- Tax year 2025 and Korean national/local individual general-rate profiles only. Reject US inputs, other years, wrong tax units/currencies or unsupported shape.
- Use a separately reviewed native-KRW taxable base; never infer residency, regime, deductions, local base or credits from another country's/authority's values.
- Use each authority's own published schedule. Do not calculate local tax as ten percent of final national tax.
- Input money remains canonical nonnegative integer KRW. Internal tax is an exact rational numerator over 10,000; do not floor, round or discard it, including fractions below one won or ten won.
- `reportedAmountMinor` and `annualTotal` are always null, `comparisonEligible` is always false, and scope is always `rate-schedule-reference`. Even an integer-valued reference is not promoted to a reported tax component.
- Missing input remains unknown; special/comparative/separate-tax/foreign-worker/treaty methods remain unsupported via reviewed profile facts. A prepared base does not establish eligibility.
- Preserve existing rule-pack bytes/defaults/readiness, annual result/schema contracts and US results. Do not integrate the reference into annual component output, CLI, web, persistence or comparisons.
- Preserve actual financial records, original evidence, approved-owner-device access and disabled web writes. No deployment, restart, refresh, ingest or private-return validation.

## Review focus

1. A 1-won base creates a fractional tax: retain exact rational, never turn it into known zero or a reported amount.
2. Bracket equality and large exact bases: inclusive upper boundaries and cent-free integer KRW must not pass through floating point.
3. Missing/unknown/unsupported profile facts: no arithmetic reference until eligibility and required base are known.
4. National and local reviewed bases differ: use the independent scenario base/rate/deduction, not a scaled national result.
5. A caller mistakes reference arithmetic for filing support: fixed reference-only scope/null amount and unchanged annual readiness must be tested explicitly.

## Task 1: Source decision and exact reference contract

**Files:** `docs/architecture/korean-tax-reference.md`, this plan; `tests/annual-korean-reference.test.ts`.

- [x] Record verified rate references and the unresolved line-specific policy; distinguish payment/base rounding and narrower special-form examples. Do not turn missing evidence into an assumed policy.
- [x] Define `calculateKoreanTaxReference(value: unknown): KoreanTaxReference`. Bind input/pack identities, native scope, status, source/input references and trace. Status is `reference-only`, `unknown` or `unsupported`; exact rational is null for blocked inputs and reported money is always null.
- [x] Write red tests for known/fractional references, every band boundary, large exact inputs, independent authorities, missing versus zero, special/unknown facts, wrong scope and deterministic immutable output. Observe failure before implementation.

## Task 2: Shared eligibility and pure reference core

**Files:** `lib/domain/taxes/annual/contracts.ts`, new `lib/domain/taxes/annual/kr-general-reference.ts`, reference tests/fixtures.

**Interfaces:** Extract `getAnnualComponentInputBlocker(validatedInput, id)` from the current policy; `getAnnualComponentBlocker` keeps source readiness first and calls that helper, preserving public behavior. The reference API validates a KR scenario, checks the input gate and returns exact `(base * basisPoints - deduction * 10000) / 10000` from the authority's pinned schedule. It never calls a rounding policy.

- [x] Implement the shared input gate with no existing policy/order change.
- [x] Implement the strictly scoped reference envelope and raw arithmetic/trace. Preserve unknown/unsupported input status without fabricating bases or results.
- [x] Verify official worked examples and independent Decimal boundary fixtures. Run focused/full tests, typecheck, lint, guardrails and isolated sample build; expected green.
- [x] Verify annual KR components remain blocked, both pack files are unchanged and ordinary/NIIT/QDCG regressions pass. Commit the tested core.

## Task 3: Review and PR delivery

**Files:** Status/support/next-increment/master-plan/design/library docs and this plan.

- [x] Record #298 merged without deployment; Korean exact reference implemented for review but reported KR calculation still blocked. Original source question remains an explicit next action, not completed work.
- [x] Fresh whole-branch review, material fix red/green if needed, changed Markdown links and public-fixture privacy checks.
- [x] Read-only verify protected operation/history/source/evidence/config hashes and clean committed tree.

**Delivery gate:** Push/open the source-gated reference PR, confirm exact-head CI, leave the new PR unmerged and undeployed and retain its active worktree. Record external delivery in PR/private receipts. Completing this PR is not completion of the unresolved Korean reporting-policy work.
