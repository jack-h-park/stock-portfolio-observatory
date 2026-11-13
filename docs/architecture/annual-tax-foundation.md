# 2025 annual tax rule and contract foundation

The source-pinned rule/contract foundation is merged in [#296](https://github.com/jack-h-park/stock-portfolio-observatory/pull/296), without deployment. The US ordinary/NIIT library is merged in [#297](https://github.com/jack-h-park/stock-portfolio-observatory/pull/297), also without deployment. The eligible qualified-dividend/capital-gain v2 worksheet is merged in [#298](https://github.com/jack-h-park/stock-portfolio-observatory/pull/298), without deployment. A separate [Korean exact rate-reference API](korean-tax-reference.md) is merged in [#299](https://github.com/jack-h-park/stock-portfolio-observatory/pull/299) without deployment; Korean reported tax remains blocked. The current increment adds a [standalone read-only component preview CLI](annual-tax-preview-cli.md), with no web or operating activation. The existing investment planner, tax history, imports, web pages and operating write/access settings are unchanged.

## Public interfaces

- `getAnnualRulePack(2025, optionalPackId)` returns an isolated copy of a pinned public reference; omitting the ID preserves the v1 compatibility default. QDCG requires explicit `annual-2025-qualified-gains-v2`. Other years fail; no runtime source download or year fallback occurs.
- `getAnnualRuleStatus(2025, componentId, optionalPackId)` separates `reference-ready` from `blocked`. `calculationAvailable` is true only for implemented US ordinary/NIIT components and eligible QDCG in the explicit v2 pack and false for the blocked methods. Library availability is separate from PR merge, deployment and operating activation.
- `validateAnnualEstimateInput(unknown)` checks a reviewed-base scenario and returns an isolated copy. It does not read evidence files, verify their bytes or determine residency.
- `annualInputDigest(input)` hashes the validated input with recursively sorted object keys and preserved array order.
- `calculateKoreanTaxReference(unknown)` returns a separately scoped exact national/local rate-schedule rational or an input blocker. It always leaves reported tax unavailable; see [policy boundary](korean-tax-reference.md).
- `calculateAnnualComponents(unknown)` validates a scenario and returns independently computed or explicitly blocked components, with no I/O. It does not compose or sum an annual return.
- `validateAnnualEstimateResult(unknown, input)` binds a component result to that exact input revision/hash and the pinned rule-pack ID/hash. It validates shape, provenance metadata, scope and dependencies; it does not certify the submitted amount's arithmetic.

Implementation: `lib/domain/taxes/annual/`. Structural JSON schemas: `schemas/annual-tax-estimate-{input,result}.v1.schema.json`. Cross-field requirements below additionally require the TypeScript validator. The small internal schema evaluator supports only the keywords used by these two schemas and fails on unknown keywords; it is not a general JSON Schema library.

## Scope, money and missing facts

Each scenario represents one 2025 authority, tax type, native currency and tax unit: US federal Single/MFJ in USD, or Korean national/local individual in KRW. US MFJ requires two distinct members; it never creates joint Korean taxation. The ordinary and preferential federal regular-tax methods are mutually exclusive. California and other years/profiles are rejected.

Money is a canonical integer string in native minor units: USD cents, KRW won. No binary floating-point conversion or default amount occurs. Only designated net-gain/MAGI inputs allow negative values. An omitted input remains absent, distinct from explicit `"0"`.

Inputs distinguish `reviewed-input`, `synthetic` and `assumption`, all with reasons. Reviewed inputs/facts require valid review dates and resolved source references. The source list contains identifiers, hashes and locators, not a command to open a path. A digest or a `reviewed` label is a metadata claim, not independent verification of evidence bytes or tax treatment. The all-zero hash in the synthetic example is deliberately fictitious.

Regular-tax method eligibility is a separate reviewed fact: ordinary, preferential or Korean general method. Missing classification is never defaulted to ordinary. For the bounded ordinary profile, supplied positive preferential-dividend/net-gain/distribution amounts contradict ordinary computation; exception handling is deferred. Unknown or unsupported residency/method states are valid input states but block computed components. No private accepted return or owner tax profile is a fixture. See `examples/annual-tax-estimate.synthetic.json`.

## Component results only

The output fixes `calculationScope: component`, `annualTotal: null`, and `comparisonEligible: false`. Component IDs must exactly match the requested set. Known values are nonnegative minor-unit strings; unknown/unsupported values are null, with a reason. `blocked` means all requested components are unknown/unsupported; a partial known set is `components-only`.

Computed component assertions require reviewed profile facts, present referenced bases, a trace and relevant official rule source references. They are accepted only for reference-ready components. The result validator checks a caller-supplied assertion; the separate calculator executes supported arithmetic. Both use the same eligibility gate. Reviewed-input components and explicitly not-applicable zero components require reviewed input-source provenance; they remain distinct from computed results and cannot create an annual total. Assumption-based/synthetic components likewise gain no comparison eligibility.

There is no annual composition, settlement inference, history comparison, persistence writer, API route or UI activation. Reviewed components do not implicitly certify AMT, credits, payroll taxes, treaty treatment or other missing annual-return parts.

## Frozen references and blockers

`data/tax-rules/2025/annual-foundation.json` (v1) and `qualified-gains.json` (v2) store factual reference data and official URL/content-hash/locator/review-date receipts. The v1 bytes and default remain unchanged; v2 is a complete immutable snapshot retaining the same ordinary/NIIT/Korean reference values and adding QDCG data/sources. Its digest uses the same canonical JSON algorithm, excluding `contentSha256`; the registry additionally pins the bundled digest, so a rehashed caller replacement is rejected. Full public publications remain research artifacts outside git. A changed publication or rule requires a new reviewed pack/version, never a runtime refresh.

The federal ordinary reference retains all 2,062 official intervals below USD 100,000 and the Single/MFJ Tax Computation Worksheet above that boundary. The HTML-derived four-column intervals were independently compared with all 2,062 PDF intervals; lower/upper bounds and Single/MFJ tax cells matched. Printed pages 2, 5, 13 and 14 were also rendered for anchor/worksheet inspection. This is source-data cross-checking, not certification of a calculator. NIIT rates/thresholds and line-rounding references are separately identified in the pack.

Korean general/local rate schedules are reference data, with calculation readiness blocked pending a calculated-tax-line rounding policy. Collection/disbursement truncation does not establish that intermediate line's policy. The local schedule is independent reference data, not ten percent of final national liability. QDCG remains blocked in v1; an explicit v2 selection supports only the eligible 25-line worksheet described below. Korean and unsupported special-method blockers cannot be bypassed by requesting a computed result or introducing a caller.

The [MVP design](../superpowers/specs/2026-11-12-annual-tax-estimation-mvp-design.md) describes later composition, California and presentation work. The Korean exact-reference increment #299 is merged without deployment. The owner put Hometax verification on hold; reported KR output remains blocked because its line-specific policy is unverified. The current preview CLI reuses these gates. Further merge/deployment and operating activation require separate scope. Approved-owner-device access and disabled private web history writes remain intended operating constraints.

## Federal calculation and rounding boundary

`calculateFederalComponent(input, id)` validates a requested US federal Single/MFJ component. `calculateAnnualComponents(input)` binds its result to the exact input revision/hash and pinned pack, then validates the output contract. Each requested component can be computed, unknown or unsupported independently. The calculator never synthesizes reviewed-input/not-applicable facts or replaces a missing base with zero. Unknown method eligibility blocks ordinary tax without suppressing independently supported NIIT.

The explicit mode is whole-dollar form calculation. Supplied USD cents represent already-aggregated form lines: original cents remain in the input/hash/trace, and each line rounds half away from zero to whole dollars. The calculator does not reconstruct salary, deductions, MAGI or NII, or individually round upstream source items. See the official [2025 Form 1040 rounding instructions](https://www.irs.gov/instructions/i1040gi).

Ordinary tax selects the complete Tax Table below rounded USD 100,000 and the [2025 Tax Computation Worksheet](https://www.irs.gov/publications/p1040) at/above it. Worksheet interval equality and cent-valued subtractions are preserved with BigInt rational arithmetic; the multiplication/subtraction is rounded only at the output line. The reviewed taxable base is already after deductions; none is subtracted again.

NIIT receives reviewed equivalents of [2025 Form 8960](https://www.irs.gov/pub/irs-pdf/f8960.pdf) lines 12 and 13, not the app's gains or AGI proxies. The rounded MAGI minus filing-status threshold is floored at zero, capped by rounded NII and multiplied by the pack's rate before rounding line 17. Line-12 NII is nonnegative; signed MAGI is retained. [NIIT instructions](https://www.irs.gov/instructions/i8960) identify the profile thresholds and applicable bases. Special treatments and upstream base preparation remain reviewed external work.

Traces record original minor units and origins, rounded lines, table interval/column or worksheet interval/rate/subtraction, exact rational tax, threshold/cap operations and output minor units. Synthetic and assumption origins remain explicit. Results always retain component scope, null annual total and false comparison eligibility; a computed zero is distinct from an unknown amount. No total liability, refund/due amount or settlement result is inferred.

Synthetic tests cover independent official table anchors, worksheet boundary neighborhoods, half-dollar line/output ties, cent-valued subtractions, NIIT caps/thresholds, large exact amounts, profile/method blockers, independent partial results, determinism and input preservation. They establish the tested library behavior, not suitability of a particular private return or owner acceptance. The current CLI previews these existing components only; historical comparison, annual composition and web presentation remain later work.

## Qualified dividends and capital gains: explicit v2 only

The full [2025 Qualified Dividends and Capital Gain Tax Worksheet](https://www.irs.gov/instructions/i1040gi) (printed PDF page 38, lines 1-25) is supported for the reviewed eligible Single/MFJ profile. Selecting v2 alone does not establish eligibility: `regularTaxMethod: qdcg-reviewed`, full-year residency, no unsupported special method and a reviewed `qdcgWorksheet` branch are required. Missing facts remain unknown. This metadata does not independently verify source bytes, holding periods, elections or legal treatment.

`qdcgWorksheet` has reason/source/date provenance and one of these states:

- `schedule-d-reviewed`: review confirms eligibility for this worksheet and use of Schedule D lines 15/16, supplied as `netLongTermGain` and `netCapitalGain`. Line 3 uses their smaller positive value, or zero if either is zero/loss. A reviewed blank must be supplied as explicit reviewed zero; an omitted amount is unknown.
- `distributions-only-reviewed`: review confirms Schedule D is not required and Form 1040 line 7a contains eligible capital gain distributions, supplied as `capitalGainDistributions`. This branch also represents qualified-dividend-only cases with an explicit zero distribution.
- `unknown` / `unsupported`: the requested worksheet is unavailable; independent supported NIIT can still compute.

Both reviewed states explicitly attest that the eligible QDCG worksheet is applicable. They do not mean merely that a Schedule D was received. Schedule D Tax Worksheet special-rate cases, Form 4952 line-4g adjustments, Form 2555 stacking, PFIC/kiddie and other special methods remain unsupported. Mark affected eligibility unsupported rather than asserting a reviewed branch. The library does not determine these facts from trading records. Nonzero unused gain amounts from the other branch are rejected as contradictory. Qualified dividends may not exceed supplied ordinary dividends; dividends/gains are already included in the reviewed taxable base and are never added a second time.

The worksheet partitions the supplied base across the published preference bands, calculates ordinary tax on line 5 and again on line 1, and takes the line-23/line-24 minimum at line 25. Each ordinary subcalculation independently selects the complete Tax Table or Tax Computation Worksheet at the federal USD 100,000 boundary. Preference exceeding taxable income is capped by the worksheet operations, not an invented negative ordinary base.

Reviewed input form lines use the existing explicit whole-dollar mode. Tax terms on lines 18/21/22/23/24/25 remain exact BigInt dollar numerators over 10,000 through the sum and comparison; only the reported component is rounded. This follows the distinction between reporting and computation in [26 CFR 301.6102-1(c), 2025 edition](https://www.govinfo.gov/content/pkg/CFR-2025-title26-vol20/pdf/CFR-2025-title26-vol20-sec301-6102-1.pdf). The existing ordinary/NIIT v1 results retain their prior rounding and traces.

Every worksheet line appears in the deterministic trace, alongside branch input origins, exact ordinary lookups and the final reported amount. See `examples/annual-tax-qdcg.synthetic.json` and `tests/fixtures/annual-qdcg-2025.json`. The 21 synthetic reference cases cover 25 lines each, including both branches, losses, preference bands, the final ordinary cap and fractional tax terms. Their Python Decimal arithmetic and PDF-extracted Tax Table are independent of the TypeScript calculator. They are not an owner's accepted return. Output remains component-only with no annual total, settlement inference or history comparison.

## Korean reference is separate from reported tax

The Korean reference increment exposes exact rate arithmetic only. Its scope is `rate-schedule-reference`, with a rational numerator/denominator rather than a reported Money value. `reportedAmountMinor` and `annualTotal` are null and comparison eligibility is false, including for integer-valued references. It is deliberately not an `AnnualEstimateResult` and cannot be passed to the annual result validator as one.

The shared input-only eligibility gate is reused without clearing source-readiness gates. `calculateAnnualComponents` still returns blocked Korean components and `getAnnualRuleStatus` still reports calculation unavailable in v1/v2. No pack bytes, schema, operational writer or public interface of the existing investment planner changes. [Required evidence](korean-tax-reference.md#required-next-evidence) remains unresolved; implementation of the reference does not establish filing-grade national/local calculations.
