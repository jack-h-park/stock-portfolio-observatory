# 2025 annual tax rule-pack and contract implementation plan

> **For agentic workers:** Use superpowers:executing-plans in this session. Implement the tasks with red/green tests and one independent whole-diff review before opening the PR.

**Goal:** Freeze official 2025 reference data and add strict, side-effect-free input/component-result contracts for the first annual-tax foundation PR.

**Architecture:** A static public rule pack contains source identities, federal tax-table/worksheet data, NIIT parameters and Korean general/local rate references. Component-level readiness is explicit: unresolved rounding or worksheet coverage remains blocked. Validators accept reviewed-base scenarios and component-only results; there is no calculator, annual-total/comparison acceptance, app route, importer or operating integration.

**Tech stack:** Existing TypeScript, JSON, Node crypto and node:test/tsx; no new dependency.

**Spec:** [Annual tax MVP design](../specs/2026-11-12-annual-tax-estimation-mvp-design.md).

**Authorization:** Owner explicitly authorized the first rule-pack/input-output contract implementation PR. The previous no-implementation hold is lifted only for this increment. Merge, deployment, financial record/evidence changes, access changes and private web writes remain unauthorized. The preceding local design/status documentation commit travels in this PR.

## Global constraints

- Tax year 2025 only; unsupported years are rejected. No backward inflation from 2026 or forward projection of 2025 rules.
- Public examples and reference cases are synthetic. No accepted private return, private account identifier or actual amount enters git.
- Tax units, authorities, tax types and native currencies remain separate.
- Keep the existing investment-incremental planner, history store/importer, CLI/briefing outputs, asset totals and ownership rules unchanged.
- Preserve original source/evidence paths, the single operating record authority, approved-owner-device access and disabled private web history writes.
- No numeric tax calculator or full annual-total result is delivered by this contract PR. Validation proves shape/scope, not a tax amount's correctness.

## Review focus

1. A mutable official URL later serves another year: source identity includes the 2025 content hash; no runtime fetch/fallback.
2. Federal tax-table columns can be transposed: retain Single/MFJ explicitly and independent PDF spot checks, including first/final ranges and the USD 100,000 boundary.
3. Unresolved Korean rounding can masquerade as usable rules: rate references remain blocked for calculation until a line-specific policy is verified.
4. Unknown input can become a zero or reviewed fact: explicit provenance/applicability unions and no amount defaults.
5. A component result can be mistaken for a comparable annual liability: result contract fixes component scope, null annual total and false comparison eligibility.

## Task 1: Frozen public rules and source readiness

**Files:** Create `data/tax-rules/2025/annual-foundation.json`, `lib/domain/taxes/annual/rules.ts`, `tests/annual-tax-rules.test.ts`.

**Interfaces:** `getAnnualRulePack(year: number)` returns an isolated copy of the 2025 static pack or rejects unsupported years. `getAnnualRuleStatus(year, componentId)` returns explicit source readiness/blockers. Data/source digests are verified before a pack is returned. No config, DB, private root or network reads.

- [x] Write failing tests for unsupported year, source/data digest mismatch, mutable returned copies, exact federal boundary/column anchor cells, continuous complete table coverage, Single/MFJ worksheet constants, NIIT thresholds, KR rate references and blocked unverified rounding/qualified-dividend methods.
- [x] Run `pnpm exec tsx --test tests/annual-tax-rules.test.ts`; observe the missing module/contract failure.
- [x] Extract public official snapshots into task artifacts; record URL, observed tax year, hash, locator and review date. Store factual numeric data and source receipts in the repository, not full HTML/PDF publications. Independently inspect official PDF anchors; do not synthesize tax-table cells from generic brackets.
- [x] Implement the static read-only pack registry, digest checks and explicit readiness. Korean rounding remains blocked if primary sources do not establish its calculated-tax line boundary; collection/payment rounding does not establish that boundary. Freeze incomplete methods as blocked, never as a ready fallback.
- [x] Run focused rules tests and commit the independently verified pack/reader.

## Task 2: Reviewed-base input contract

**Files:** Create `lib/domain/taxes/annual/contracts.ts`, `schemas/annual-tax-estimate-input.v1.schema.json`, `examples/annual-tax-estimate.synthetic.json`, `tests/annual-tax-contracts.test.ts`.

**Interfaces:** `validateAnnualEstimateInput(value: unknown): AnnualEstimateInput` returns an isolated, non-mutating validated value or throws. It validates scope/provenance only, without reading evidence bytes or operational history.

- [x] Write failing tests for year 2026, authority/currency/component mismatch, KR joint filing, MFJ member count, duplicate IDs, malformed integer money/negative zero, unknown fields, incomplete reviewed/assumption provenance, missing versus explicit zero and valid unknown applicability. Reject unsupported first-PR profiles explicitly.
- [x] Run the focused contract test and observe failure before adding the validator.
- [x] Define one authority/profile per scenario: federal Single/MFJ or Korean national/local individual. Money uses native minor-unit strings. Provenance distinguishes reviewed input, synthetic input and labeled assumptions; reviewed/not-applicable facts require reasons and source references. Omitted amounts stay absent/unknown. Qualified-dividend input may be represented, but pack readiness remains blocked until its worksheet contract is frozen.
- [x] Add an input JSON schema matching the public shape and closed property sets, and a pure semantic validator for cross-field constraints. Supply synthetic examples only. No income parsing or live record import.
- [x] Run focused tests and typecheck; commit.

## Task 3: Component-result contract and delivery

**Files:** Extend `contracts.ts` and contract tests; create `schemas/annual-tax-estimate-result.v1.schema.json`; update product status/increment docs and design authorization status.

**Interfaces:** `validateAnnualEstimateResult(value: unknown, input: AnnualEstimateInput): AnnualEstimateResult` checks matching identity/scope/input digest and explicit component states. The first result contract is `calculationScope: component`, `annualTotal: null`, `comparisonEligible: false`. Known component amounts require their trace/provenance; unknown/unsupported components have null amounts and blockers. No function calculates or fabricates a result from the input.

- [x] Add red tests for forged annual totals/eligibility, cross-scenario/year/unit/currency results, missing traces/source refs, known amounts on unknown components, unsupported rule states, zero on not-applicable only when explicitly reviewed and duplicate/missing requested components.
- [x] Implement the output JSON schema and pure validator. Hash validated input deterministically; never stamp a result as a complete annual return or authority-confirmed settlement.
- [x] Run focused/full tests, typecheck, lint, UI guardrails and an isolated sample build. Verify existing investment/history/CLI tests remain unchanged; no UI/browser change is introduced.
- [x] Independently review the whole diff, fix material findings and verify protected operating source/build/config/history/evidence read-only.

**Delivery gate:** Push/open the PR only after the checks above; confirm CI at the published head. Track the external delivery state in the PR and private delivery receipt. Leave the PR unmerged and undeployed.

## Handoff after this PR

The next separately authorized work is the federal/Korean core calculator implementation against ready rule components, followed by composition/comparison and the California extension. A blocked rule component cannot be unblocked merely by adding a caller. The original accepted historical return remains outside validation scope. Private state and web writes remain unchanged.
