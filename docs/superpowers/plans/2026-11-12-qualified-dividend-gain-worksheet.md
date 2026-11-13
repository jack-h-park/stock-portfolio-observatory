# 2025 qualified dividend and capital gain worksheet implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline with test-driven-development and one fresh whole-branch review. Steps use checkbox syntax.

**Goal:** Implement all 25 lines of the eligible 2025 federal Qualified Dividends and Capital Gain Tax Worksheet for Single/MFJ as a pure component library.

**Architecture:** Add an explicitly selected, immutable v2 rule snapshot while preserving the v1 bytes/default and its ordinary/NIIT behavior. Extend the input contract additively with a reviewed worksheet branch and capital-gain-distribution base. Reuse exact ordinary table/worksheet subcalculations, retain exact worksheet tax intermediates, perform the final minimum and round only the reported component.

**Tech stack:** Existing TypeScript, JSON, BigInt and node:test/tsx; no dependencies.

**Spec:** [Annual tax MVP](../specs/2026-11-12-annual-tax-estimation-mvp-design.md), [library boundary](../../architecture/annual-tax-foundation.md).

**Authorization:** Owner authorized #297 merge (verified `4e8ae68`) and the next US dividend/gain worksheet implementation PR. This new PR stays unmerged and undeployed. No financial/evidence/configuration changes, web writes, access changes, CLI/UI activation, annual composition or historical comparison.

## Global constraints

- 2025 federal Single/MFJ only. No projected-year rules or automatic residency/method eligibility.
- Qualified Dividends and Capital Gain Tax Worksheet only; Schedule D Tax Worksheet special rates, Form 4952 line-4g effects, Form 2555 stacking, PFIC/kiddie and other special methods remain unsupported.
- Explicit reviewed branch: Schedule D lines 15/16, or no-Schedule-D capital gain distributions from Form 1040 line 7a. Missing is unknown; reviewed blanks must be supplied as explicit reviewed zero. Do not infer a branch from amounts or file names.
- Taxable income already includes dividends/gains. Preferential income is partitioned from that base, never added to it again; qualified dividends cannot exceed supplied ordinary dividends.
- Preserve source cents, round reviewed form input lines to whole dollars, retain exact rational tax intermediates (including ordinary worksheet subcalculations), compare worksheet lines 23/24 before final reported-line rounding. No independently rounded 18/21/22 tax terms.
- Preserve the pinned v1 snapshot/default and old inputs/results. A v2 scenario opts into the newly verified QDCG rule; v1 QDCG remains blocked. No silent rule promotion.
- No original private return oracle, history mutation, service restart, deployment or gateway/configuration change. Existing owner-device access and web-write prohibition remain intended constraints.

## Review focus

1. Schedule D has a loss/zero on either line: worksheet line 3 is zero, not positive portfolio LTCG.
2. No Schedule D: use explicit distributions, never infer them from Schedule D net gains or default missing distributions to zero.
3. Preference bands overlap ordinary taxable income: apply the complete 0/15/20-percent worksheet and final comparison, including preference greater than taxable income.
4. Tax Table versus worksheet for both subcalculations: select each amount independently, including the USD 100,000 equality boundary.
5. Cent-valued tax terms or comparison near a rounding tie: retain exact intermediates and round only reported output; preserve deterministic trace/provenance and v1 results.

## Task 1: Versioned reference and reviewed branch contract

**Files:** New `data/tax-rules/2025/qualified-gains.json`; extend `rules.ts`, `contracts.ts`, both annual schemas; add `examples/annual-tax-qdcg.synthetic.json` and `tests/annual-qdcg.test.ts`.

**Interfaces:** `getAnnualRulePack(year, optionalPackId)` and `getAnnualRuleStatus(year, component, optionalPackId)` preserve the v1 default; v2 is explicit. `getAnnualRequiredAmounts(input, id)` shares branch-specific dependencies with validators/calculators. Optional provenance-bearing `qdcgWorksheet` states: `schedule-d-reviewed`, `distributions-only-reviewed`, `unknown`, `unsupported`; new amount `capitalGainDistributions`.

- [x] Write red tests for version pinning/no fallback, v1 source-data preservation, v2 thresholds/readiness/integrity, optional branch provenance, branch-specific missing inputs, contradictory branch amounts, qualified/ordinary dividend consistency and old input/result compatibility.
- [x] Observe missing feature/module failure before implementation.
- [x] Cross-check complete official 2025 worksheet HTML and PDF, including thresholds, branch selector, all 25 operations and final comparison. Pin source hashes/locators and intermediate-rounding policy; keep full publications in artifacts only.
- [x] Implement additive contracts/registry and reviewed eligibility blockers. Existing ordinary/NIIT results and v1 QDCG block remain unchanged. Run focused tests/typecheck; expected green. Commit.

## Task 2: Full worksheet and orchestration

**Files:** `us-federal.ts`, new `us-ordinary.ts` shared exact subcalculation, `calculate.ts`, QDCG tests.

**Interfaces:** Extend `calculateFederalComponent` and `calculateAnnualComponents` with `us.regular.qdcg`. The shared ordinary subcalculation returns exact dollar numerator/denominator and trace; the ordinary component still rounds once exactly as before. QDCG trace includes every worksheet line and source input origin.

- [ ] Add red synthetic tests for all preference bands/filing profiles, Schedule D minimum/loss selection, distributions-only/qualified-dividend-only paths, gains exceeding taxable income, line-5 and line-1 table/worksheet boundaries, final ordinary-tax cap and fractional intermediate rounding. Include independent expected fixtures and a large exact-money case.
- [ ] Observe failure before adding QDCG arithmetic.
- [ ] Implement lines 1-25 in order, with exact tax numerators through the final minimum. Return explicit blockers and preserve independent NIIT; no ordinary fallback for unsupported QDCG.
- [ ] Independently verify synthetic worksheet reference cases using Python Decimal and the official pinned data. Run focused/full tests, typecheck, lint, guardrails and isolated sample build; expected green. Commit.

## Task 3: Review and delivery

**Files:** Status/support/master-plan/design/library-boundary docs and this plan.

- [ ] Record #297 merged but undeployed, v2 QDCG implemented for PR review, and unchanged #290 operating baseline. Keep remaining Korean, composition, special-method and UI work explicit.
- [ ] Perform one fresh whole-branch review; resolve material findings with red/green tests. Check protected runtime/source/evidence hashes read-only and changed Markdown links.
- [ ] Verify clean committed tree, then push/open the PR and verify exact-head CI. External delivery is recorded in the PR/private receipt; leave the new PR unmerged/undeployed and retain its active worktree.
