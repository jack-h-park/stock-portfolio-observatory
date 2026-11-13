# KR/US annual tax estimation MVP design

**Date:** November 12, 2026 (America/Los_Angeles)
**Status:** The owner selected finalized **2025** rules and authorized the first rule-pack/input/component-result contract PR. That bounded foundation is implemented for review; see [implementation boundary](../../architecture/annual-tax-foundation.md) and [execution plan](../plans/2026-11-12-annual-tax-rule-contracts.md). Calculators, composition/comparison, California and UI integration below remain proposed later increments. Merge, deployment, configuration and financial-data changes are not authorized.
**Parent:** [Observatory design](2026-11-10-personal-finance-observatory-design.md) and [P5 program](../plans/2026-11-10-personal-finance-observatory.md).
**Operating baseline:** [#290](https://github.com/jack-h-park/stock-portfolio-observatory/pull/290), merge `862f968`, includes the deployed annual recorded-tax summary. The owner-accepted final historical return package is **not** a test oracle, extraction target or investigation task for this design.

## 1. Outcome and approaches

Make a reproducible calculation from an explicitly reviewed annual tax base, explain its rules and missing components, and keep it separate from reported liability and actual settlements. Establish a 2025 foundation before adding projected years or a complete income-document pipeline.

| Approach | Benefit | Tradeoff / decision |
| --- | --- | --- |
| Relabel the current investment engine as annual | Small apparent change | Rejected: incremental/state/credit assumptions do not constitute a complete annual return |
| Build a complete KR/US filing engine from raw documents | Broad automation | Deferred: residency, deductions, elections, sourcing and special schedules exceed a bounded MVP |
| Reviewed annual tax base plus explicit components | Small independently verifiable calculation and useful partial results | Recommended: upstream base/credit preparation remains a reviewed input; coverage must be visible |

MVP means a **reviewed-base calculation foundation**, not automatic preparation of a complete return from salary, trades and bank records. It may produce an annual-total result only through the completeness gate in section 6. A computed regular-tax component alone is never labeled complete annual tax.

## 2. Scope and operating constraints

- Tax year 2025 only; unsupported years are rejected. No backward inflation from 2026 or forward projection of 2025 rules.
- Public examples and reference cases are synthetic. No accepted private return, private account identifier or actual amount enters git.
- Tax units, authorities, tax types and native currencies remain separate. KRW and USD are not combined into a tax bill; two countries are not added into a net worldwide liability.
- No residency determination, treaty election, automatic sourcing or cross-border credit optimization. Reviewed jurisdiction-specific inputs are required; disputed/unknown treatment blocks the affected result.
- No new document parser, transaction ingest, income-to-taxable-base pipeline, withholding estimator, filing/payment execution or penalty/safe-harbor calculator in this MVP.
- Keep the existing investment-incremental planner, history store/importer, CLI/briefing outputs, asset totals and ownership rules unchanged.
- Preserve original source/evidence paths, the single operating record authority, approved-owner-device access and disabled private web history writes. No state-path/repository rename or infrastructure change is bundled.
- 2026 and later years are separate rule-pack increments, not defaults selected from the system clock.

## 3. Calculation profiles

A residency or filing status is an explicit reviewed fact, not inferred from nationality, address, asset owner, tax-unit ID or a file name. Joint US ownership never creates joint Korean taxation.

| Profile | First computed output | Required base / eligibility | Deferred automatic work |
| --- | --- | --- | --- |
| `US:federal`, Single or MFJ | Form 1040 regular tax, line 16; optional NIIT component | Full-year resident/citizen return treatment reviewed; taxable income already determined; ordinary or eligible qualified-dividend/capital-gain worksheet path explicitly selected | Other filing statuses, 1040-NR/dual-status, Form 2555 stacking, Schedule D special-rate paths, PFIC/kiddie/lump-sum methods, automatic AMT/credits/payroll taxes |
| `KR:national`, individual | General global-income calculated tax before reductions/credits | Reviewed 2025 global-income taxable base and confirmation that the general calculation is applicable | Salary deductions/expense deductions, financial-income comparative taxation, separate-tax elections, flat-tax foreign-worker elections, treaty/residency decisions, automatic reductions/credits |
| `KR:local`, individual | Local global-income calculated tax before local reductions/credits | Explicit reviewed local base; applicable local rule/profile confirmed | Automatic local credit translation and residence-specific exceptions |
| `US:CA`, Single or MFJ, optional | Form 540 regular tax, line 31; Behavioral Health Services Tax, line 62 | Full-year California resident profile and reviewed California taxable income; no inference from federal income | 540NR/part-year allocation, RDP/community-property differences, automatic Schedule CA, exemption/credit phase-outs and Schedule P |

The federal and Korean general-tax profiles are the first implementation tranche. California is a separately reviewable, same-2025 extension of the MVP; its absence cannot block a separately requested federal result or be treated as zero state tax. Each profile is independently requested and gated.

Special treatments do not disappear because a reviewed base was supplied. A treatment affecting the selected regular-tax method, such as Form 2555 stacking or the Korean financial-income comparison, makes that automatic component unsupported. A valid ordinary component may still be shown when a different downstream component is unknown. No claim is made that the owner's cross-border circumstances already meet these eligibility conditions.

## 4. Inputs: reviewed values, never silent defaults

### 4.1 Common scenario envelope

The future input contract is an estimate-specific document, separate from `tax-history.v1`. It contains:

- `schemaVersion`, scenario ID and immutable revision, `taxYear: 2025`, tax-unit reference and reviewed members, authority, currency, tax type, profile ID and rule-pack ID/version.
- Reviewed residency/filing profile, selected regular-tax method, and applicability states for the required components. Applicability uses `applies`, `not-applicable`, `unknown` or `unsupported`; an omitted answer is unknown.
- Each monetary input as a native minor-unit string: KRW scale 0, USD scale 2. No binary floating-point money. Negative amounts are accepted only where the form component explicitly permits them.
- Per input: `origin` (`reviewed-input` or `synthetic`), source/evidence reference and locator or an explicitly labeled assumption, review reason/date, scope and source revision/hash. Source documents remain in their existing private roots.
- Optional history comparison selection: exact obligation and current return/assessment basis revisions plus a reviewed form-component mapping. No automatic selection by matching a year or a nearby amount.

An assumption may produce an assumption-based component, but cannot pass the reviewed annual-total/comparison gate. `not-applicable` requires a recorded reason/review; it is not a shortcut for an unknown amount. An actual reviewed zero is represented explicitly as `"0"`.

### 4.2 Federal reviewed-base inputs

Required: filing status, reviewed Form 1040 line-15-equivalent taxable income, and selected method. For the qualified-dividend path, include reviewed ordinary/qualified dividends and the relevant Schedule D net-gain worksheet inputs/eligibility facts. Follow the official worksheet's net-gain selection; do not add qualified dividends or gains to line 15 a second time. Missing preferential-income classification is not ordinary income by default.

For NIIT, supply reviewed Form-8960-specific MAGI and net investment income (or declare the component unknown). These are not automatically interchangeable with AGI, taxable income or positive portfolio gains. Do not reconstruct them from the existing planner's proxies.

The MVP does not subtract a standard deduction from a base already supplied after deductions. Future gross-income input construction must use the correct 2025 rules; the current engine's 2026-based deduction/inflation behavior is not reusable as an official 2025 rule pack.

### 4.3 Korean and California inputs

Korean national and local taxable bases are explicitly reviewed, including which income/filing regime applies. Local tax is not derived as ten percent of the final national liability. Any allowed reductions/credits enter the separate jurisdiction's reviewed component slot; no foreign tax credit is copied between countries or between national/local tax automatically.

California uses its own reviewed line-19-equivalent base and filing profile. A federal deduction, federal capital-loss carryforward or federal taxable income is not a California input without a reviewed state adjustment. The first core does not calculate the state taxable base or individual exemption-credit phase-outs.

## 5. Rule sources and arithmetic

Rule packs are versioned by authority, tax type, tax year, filing profile, form/worksheet revision and validity dates. A pack records official URLs, document hashes, page/section locators, retrieval/review dates and reviewer. The year inside a publication governs: the NTS guide published in 2026 explicitly concerns tax returns for 2025 [S7]. Publication year alone must not select a rule pack.

Public source snapshots are research artifacts. Implementation must pin the applicable 2025 bytes and complete numeric tables before coding the corresponding calculation. Runtime calculation never fetches a mutable website. A draft/current-year replacement or conflicting source version blocks that pack; there is no screening-rate fallback.

| Rule | Design requirement | Official source |
| --- | --- | --- |
| US ordinary regular tax | Apply the official Tax Table below USD 100,000; use the Tax Computation Worksheet at/above that boundary. Generic continuous brackets alone are not a form-equivalent substitute | [S1], [S2] |
| Qualified dividends / gains | Implement the complete eligible worksheet with ordinary-income stacking and its final comparison; ordinary subcalculations still use the table/worksheet rules. Unsupported special methods block the component | [S1] |
| Federal annual boundary | Line 24 is a liability boundary distinct from withholding, estimated payments and refund/due fields | [S3] |
| NIIT | Use the specified MAGI and NII bases and the profile's threshold, not only gains generated by this app | [S4] |
| KR general calculated tax | Use the published 2023–2025 taxable-base/rate/deduction table, not a flat gain-screening rate | [S5] |
| KR local calculated tax | Use the local base/rate schedule and local reductions/credits; the cited form's Article-92 schedule is a rate reference, not universal eligibility for every filer | [S6] |
| CA regular tax | Tax Table through USD 100,000; rate schedules only above USD 100,000. Preserve the different federal/state equality boundary | [S8], [S9] |
| CA additional component | Compute 2025 line 62 separately; do not label it regular tax or infer its absence from a lower capital-gain amount | [S9], [S10] |
| Foreign-tax/earned-income interactions | Separate reviewed FTC components from automatic calculation; the first core does not implement Form 1116 allocation or Form 2555 stacking | [S11], [S12] |

Use exact integer/rational arithmetic and a trace per worksheet line. USD input cents remain available until the prescribed line aggregation/rounding boundary; sums are not rounded item by item. Adopt a consistent whole-dollar form mode for US form-equivalence and preserve original input cents [S1]. KR calculated-tax traces retain exact rational values internally; the precise 2025 won truncation/rounding rule and its line boundary must be pinned before a KR pack can be released. This is an explicit rule-pack completion gate, not permission to approximate. No general cross-jurisdiction rounding helper may guess the policy.

## 6. Components and honest annual-total eligibility

Each required component has `mode: computed | reviewed-input | not-applicable | unknown | unsupported`, native amount when known, rule/source references, and dependencies. Reviewed input is visibly different from an application-computed result.

- **Computed component:** a supported calculation with reviewed inputs and a verified pack.
- **Composed annual estimate:** all required components for a declared reporting boundary are supplied, computed or explicitly reviewed as inapplicable. It may contain externally calculated amounts and must say so.
- **Partial / blocked:** unresolved inputs or methods leave the affected component and annual result unavailable. Preserve any independent computed components, but do not call their sum a lower bound: missing credits may reduce liability.

Proposed reporting boundaries and composition:

| Boundary key | Composition contract | Excluded from that liability |
| --- | --- | --- |
| `US:federal:1040-line24` | Compute line 16, add a reviewed line-17 component, apply a reviewed line-21 credit total with the form's floor, then add NIIT and a reviewed other-line-23 component **excluding that NIIT** | Withholding/prepayments, refundable payment-side credits, requested/received refunds and payment penalties |
| `US:CA:540-line64` | Reviewed/computed line-48 tax after exemption/special credits, plus reviewed AMT (61), computed BHST (62) and reviewed other taxes (63). A reviewed line-48 input replaces its upstream computation; it is never added to line 31 | Payments, use-tax/health-coverage adjustments outside line 64, contributions and payment penalties |
| `KR:national:global-income-determined-tax` | General calculated tax, then independently reviewed applicable reductions/credits in the correct order and with eligibility/floor rules pinned to the selected form | Separate capital-gain/retirement/separate-tax obligations, prepayments, penalties and actual refunds |
| `KR:local:global-income-determined-tax` | Local calculated tax, then the reviewed local reductions/credits for the selected form | National tax, separate local capital-gain tax, prepayments, penalties and actual refunds |

The US bridge inputs are reviewed form totals at fixed stages, not arbitrary balancing amounts. A line-23 total that already contains computed NIIT is rejected unless explicitly decomposed and reconciled. AMT and credit limitation/order must already be reflected in the reviewed bridge values. Review metadata states which schedules were externally resolved. Form 2555/PFIC/special-rate effects on the selected line-16 method cannot be bypassed by adding a downstream adjustment.

For Korea, a reduced general-tax result cannot be promoted to the full return boundary while comparative taxation, minimum-tax rules or other applicable determination methods remain unresolved. Applicable but unimplemented special rules block annual composition. Liability for separate stock-disposal tax remains a distinct obligation; existing investment estimates are not silently imported into these global-income boundaries.

An annual result is eligible only if every required dependency is reviewed and known, all applicable methods are supported or explicitly covered by permitted reviewed bridge inputs, the rule pack is verified, and the income/component inventory is explicitly confirmed for that boundary. Completeness is about a declared boundary, not every possible tax or every account.

## 7. Comparison with recorded history

Retain `calculationScope` distinctions: `component` versus `annual-total`. Also record boundary key/component set, calculation coverage (`computed` or `composed`), profile, pack/input hashes and assumption status. A composed annual result stays visibly composed.

A numerical estimate-versus-record difference requires equal tax unit, year, authority, currency, tax type and reporting boundary, reviewed filing/residency compatibility, complete reviewed estimate inputs, a current evidenced history basis, and a reviewed return-component mapping. The current [canCompareTaxEstimate](../../../lib/application/tax-history-query.ts) checks only the older dimensions; a future application guard must add the new gates before calling it. Do not label a component `annual-total` merely to satisfy that helper.

If history has only an untyped liability, show it alongside the estimate without a numerical error/difference until a mapping is reviewed. Do not infer the mapped form line from the total or overwrite history. Changed input/rule/history revisions invalidate prior comparison acceptance. Neither a comparison nor a projected overpayment proves actual payment/refund. The deployed annual recorded-tax summary remains a history view with its current semantics.

## 8. Application and data boundaries

Keep pure jurisdiction calculations separate from orchestration and existing investment engines. Proposed interfaces for a later implementation plan:

- `validateAnnualEstimateInput(unknown)` validates scope, applicability, Money and provenance without reading operational state.
- `calculateAnnualComponents(input, verifiedRulePack)` returns component amounts/traces and blockers; no side effects or writes.
- `composeAnnualEstimate(components, reviewedCoverage)` applies only the selected form-boundary contract and returns a known annual result or explicit blockers.
- `compareAnnualEstimateToHistory(estimate, historySelection)` is read-only and applies section 7's additional gates.

Suggested future units: `lib/domain/taxes/annual/{input,rules,us-federal,kr-global,kr-local,california}.ts` and `lib/application/annual-tax-estimate.ts`, plus synthetic fixtures. These are proposals only; no modules, schemas or routes are created by this documentation task.

Reuse native `Money`, tax-unit/evidence identifiers and history read projections. Do not reuse the current `estimateUsCapitalGainTax` entry point as the annual calculator: its incremental/state/FTC assumptions and projected rule bases have a different contract. Any reuse of a low-level helper requires separate reference-case proof without modifying existing planner results.

The first executable surface, if approved later, is a preview-only CLI reading an explicit estimate-input file and producing a result to stdout or an explicit private artifact path. It reads original evidence only for identity checks and never imports history or changes mappings. Estimate snapshots, if later approved for persistence, belong to estimate-specific durable state with revisions; they never overwrite tax history or rebuildable DB files. No new sync, schedule, environment setting or canonical private file is activated by this design.

A subsequent read-only web surface may show a reviewed snapshot and its input/rule versions. Web input/edit/import controls remain disabled. Preserve existing routes and output contracts; add a separate estimate surface rather than changing `/taxes/history` into an estimator.

## 9. User flow and presentation

1. Select 2025, one tax unit and requested jurisdiction/profile. Show that residency and base preparation require review.
2. Read a reviewed scenario. Display taxable base and its source, calculated components, externally supplied bridge components and blockers separately.
3. Show independent jurisdiction cards in native currency. Label partial/composed status in both English and Korean; an empty component is unknown, not zero.
4. Enable comparison only when section 7 passes; link to the precise recorded basis/evidence and disclose external calculations. Keep payments and refund requests/receipts separate.

No worldwide net-tax total, automatic residency recommendation, filing-readiness badge or automatic promotion to the record ledger. UI wording should describe the financial distinction, not implementation paths.

## 10. Synthetic acceptance matrix

Every release needs independent official table/worksheet references, including arithmetic and provenance. Expected values are not generated by the implementation being tested. The following anchors are synthetic and do not refer to the owner's returns.

| Case | Required result |
| --- | --- |
| US ordinary, MFJ, 2025 taxable income USD 120,000, no preferential income | Line-16 worksheet result USD 16,228 [S2]; no deduction applied again. Annual result remains unavailable unless all remaining components are explicitly resolved |
| US Tax Table boundary | Exact table cells below USD 100,000, worksheet at USD 100,000; eligible dividend worksheet also applies the correct ordinary subcalculation |
| Qualified dividends / LTCG | Approved 2025 worksheet cases crossing preference bands and its final comparison; positive preferential income is not counted again in the taxable base |
| NIIT, MFJ MAGI USD 300,000 and NII USD 20,000 | NIIT component USD 760 [S4]; unknown MAGI/NII produces an unavailable component, not zero |
| KR general base KRW 30,000,000 | Calculated national tax KRW 3,240,000, matching the NTS worked example [S5]; not final determined liability by itself |
| KR local base KRW 30,000,000 | Calculated local tax KRW 324,000 from the local schedule [S6]; a national credit cannot change this amount without a separately reviewed local credit |
| CA equality boundary | USD 100,000 still uses the Tax Table; above it uses the applicable 2025 schedule [S8] |
| CA base USD 1,100,000 | Line-62 BHST component USD 1,000 [S9]; regular tax/credits/AMT remain separate |
| Credits and bridge inputs | Form-order/floor behavior, NIIT included exactly once, replacement line-48 input never added to its upstream regular tax |
| Special methods / residence | 2555/PFIC/dual-status or unknown residency does not fall back to an ordinary annual result; unsupported CA does not suppress a valid separately scoped federal component |
| KR financial/separate-tax scope | Comparative-tax or separate-tax facts cannot be silently treated as ordinary global income; unknown applicability blocks affected final composition |
| Missing versus zero | Missing income classifications, schedules, credits and flags remain unknown; only an explicit reviewed/computed zero displays zero |
| Revisions / scope | Wrong year, currency, owner, authority, tax type, stale basis or boundary mapping blocks comparison. `investment-incremental` is never compared as annual error |
| Money / rounding | Large exact inputs, cent aggregation before rounding, nonnegative/floor constraints, every bracket boundary and pack-specific KR truncation tests; missing rounding provenance blocks pack release |
| Persistence / isolation | Portfolio DB absent/rebuilt, stale/moved evidence and failed reads do not mutate history; byte/hash preservation of sources, state, policies and access settings |

The first rule/contract increment adds synthetic contract and source-integrity tests; its implementation boundary documents the delivered checks. This broader calculator/composition acceptance matrix remains a requirement for later increments, not a claim that those calculations exist or passed.

## 11. Proposed sequence and release gates

1. **Rule-pack and contract PR:** pin public 2025 sources, extract complete required tables and rounding policies, define input/result contracts and synthetic reference cases. No private import or application activation.
2. **Federal + KR core PRs:** independently implement the reviewed-base components and blockers. Retain the investment planner's regression contract. No composed annual-total output until its bridge/completeness tests pass.
3. **Composition/comparison PR:** add the permitted reviewed bridges and strict history-boundary mapping; keep actual settlements distinct. Schema changes to historical return-reported prepayments/refund requests remain a separate work package.
4. **CA extension and read-only presentation PRs:** add only after state-specific rule/credit boundary tests; preserve unrelated services and existing access controls.
5. **Separate operational acceptance:** only after authorization, preview a reviewed scenario, verify writer/backup/isolation and existing-history parity, then separately authorize deployment. No request to revisit the accepted final historical return package is implied; any future private validation needs its own scope.

No dates are promised. Release blockers are unresolved rounding/table provenance, unsupported applicable tax methods, unreviewed comparison mappings, incomplete input coverage, financial regression or access/write-boundary regression. Finalized 2025 rules first is the owner decision; only the first rule-pack/input/component-result contract increment is authorized; later calculator and composition scope remains proposed for review. Later years, automatic deductions/credits, broader filing profiles and cross-border engines require new scope decisions.

## 12. Official source register

Reviewed November 12, 2026 (America/Los_Angeles). Links identify sources, not a complete frozen implementation pack. Pin the 2025 revision and content hash before implementation; mutable HTML must not silently become a later-year rule.

- **S1:** [IRS 2025 Form 1040 instructions](https://www.irs.gov/instructions/i1040gi), regular-tax method, qualified-dividend worksheet and rounding sections.
- **S2:** [IRS Publication 1040 (2025)](https://www.irs.gov/publications/p1040), Tax Table and Tax Computation Worksheet, including Section B for MFJ.
- **S3:** [IRS 2025 Form 1040](https://www.irs.gov/pub/irs-pdf/f1040.pdf), tax versus payment/refund boundaries.
- **S4:** [IRS 2025 Form 8960 instructions](https://www.irs.gov/instructions/i8960), NIIT inputs, thresholds and computation.
- **S5:** [NTS general tax rates and 2025 worked example](https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7667&mi=2315), the explicitly labeled 2023–2025 general-income table.
- **S6:** [Official 2025 local-income-tax return, form 40-3](https://www.law.go.kr/LSW/flDownload.do?bylClsCd=110202&flSeq=151415013&gubun=), Article-92 schedule and separate local calculated/determined-tax lines. The form has limited filing eligibility; its rate schedule does not establish a taxpayer's regime.
- **S7:** [NTS Individual Income Tax and Benefit Guide for Foreigners, tax return for 2025](https://www.nts.go.kr/english/na/ntt/selectNttInfo.do?nttSn=1350804), published April 30, 2026. Public PDF reviewed separately; the guide distinguishes income types and financial-income treatment.
- **S8:** [FTB 2025 rate schedules](https://www.ftb.ca.gov/forms/2025/2025-540-tax-rate-schedules.pdf), including the Tax Table eligibility boundary.
- **S9:** [FTB 2025 Form 540 instructions](https://www.ftb.ca.gov/forms/2025/2025-540-booklet.html), line 62 and state-specific deductions/credits.
- **S10:** [FTB 2025 Form 540](https://www.ftb.ca.gov/forms/2025/2025-540.pdf), line 64 composition versus payment/other charges.
- **S11:** [IRS 2025 Form 1116 instructions](https://www.irs.gov/instructions/i1116), foreign-tax-credit complexity outside automatic MVP calculation.
- **S12:** [IRS 2025 Form 2555 instructions](https://www.irs.gov/pub/irs-prior/i2555--2025.pdf), pinned prior-year source; the generic current-year instruction page was observed to be 2026 and is not used as a 2025 rule.
