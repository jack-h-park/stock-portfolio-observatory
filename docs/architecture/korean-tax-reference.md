# Korean calculated-tax reference and unresolved reporting policy

The owner authorized #298 merge and the next Korean calculation PR. The US worksheet #298 is merged without deployment. This increment implements exact Korean rate-schedule reference arithmetic; it does not release reported Korean tax calculations. The serving application remains the previously verified #290 release.

## Verified versus unresolved

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| [NTS general rates and 2025 example](https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7667&mi=2315) | The explicitly labeled 2023-2025 national schedule and a whole-won worked example | General sub-won calculated-tax-line quantization |
| [2025 local Form 40-3](https://www.law.go.kr/LSW/flDownload.do?bylClsCd=110202&flSeq=151415013&gubun=) | An independent local-rate schedule, base and calculated-tax field | Universal filer eligibility or verified sub-won handling for this component |
| [National-funds law, Article 47](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1031453583) | Collection/disbursement end-digit rules in their specified contexts | Permission to apply a collection rule at an intermediate calculated-tax field |
| [2020 special loss-carryback form](https://www.law.go.kr/flDownload.do?flSeq=120063445&gubun=) | An explicit sub-won instruction in that special-period/form computation | General 2025 national/local reporting policy |
| Public Hometax/Wetax/ETAX material checked during research | Related forms and entry/simulation surfaces exist | A verified 2025 general calculated-tax-line rounding algorithm was not obtained |

National and local source investigations independently left the reporting-policy question unresolved. Narrower religious-income year-end instructions were not generalized to all income. Integer form fields and customary practice alone are not enough. No live filing, account login, private-return review or communication with a tax authority was performed.

## Reference API contract

`calculateKoreanTaxReference(unknown)` accepts the existing 2025 annual input contract only for Korean national/local individual general profiles. Input residency, general-method and absence-of-special-method facts require the same reviewed metadata as other annual components. The taxable base is already prepared/reviewed externally; no deduction, regime or residency is inferred.

The result binds scenario/revision/input hash, tax unit, authority, currency and selected immutable rule-pack hash. Scope is fixed to `rate-schedule-reference`; status is `reference-only`, `unknown` or `unsupported`. A valid reference retains `(taxableBase * rateBasisPoints - deductionKrw * 10000) / 10000` exactly as an integer numerator/denominator, with input origin, bracket and source references. This rational is mathematical schedule arithmetic, not reported money.

`reportedAmountMinor` and `annualTotal` remain null and `comparisonEligible` remains false in every state. Even a whole-won reference never becomes a reported component automatically. Missing/unknown/unsupported input facts leave the rational unavailable. A zero base is explicit zero, not a substitute for an absent base. Fractional values are retained without rounding, flooring or collection truncation.

National and local calculations use their respective reviewed bases and schedules; local tax is not ten percent of final national liability. Financial-income comparison, separate-tax/flat-tax/treaty methods and other special cases remain outside the reviewed general profile. No source evidence bytes are opened or verified by this library call.

The reference API is separate from `calculateAnnualComponents`: annual Korean components remain blocked in both v1/v2, rule-pack bytes/defaults and schemas are unchanged, and no annual comparison, CLI, web, persistence, import or operational activation is added. Existing finance/evidence/access settings and disabled private web writes remain intended constraints.

## Required next evidence

Before returning reported Korean tax amounts, pin a primary source that establishes the applicable **2025 general calculated-tax line**, its quantization unit/method and stage independently for national/local tax. Then add discriminating fractional/boundary reference cases, a separately versioned policy and reviewed component release. A rule applying only to tax-base calculation, collection/payment, a different year or a narrower special form cannot silently clear this gate.


Useful discriminating **synthetic reference** probes are a national taxable base of KRW 14,000,064 (exact reference KRW 840,009.6) and a local base of KRW 14,000,664 (exact reference KRW 84,009.96). A qualifying official example must show the calculated-tax field and stage, since whole-won truncation, nearest-won rounding and collection truncation can give different results. These figures are mathematical probes, not claimed reported tax amounts. Relevant artifacts to obtain include the 2025-attributable national/local electronic-filing specifications or a valid general-return instruction with a line-specific rule; no unrequested inquiry is sent to obtain them.
