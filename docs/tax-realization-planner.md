# Tax Realization Planner Design

This feature should be treated as a planning and review assistant, not tax advice or an automatic filing tool. Tax rules change, and residency, account type, covered-lot status, broker reporting, treaty positions, state taxes, local surtaxes, and foreign tax credits can all change the result. The product should make assumptions visible, editable, and exportable.

## Source Baseline

- US capital gain/loss baseline: IRS Topic 409 defines capital gain/loss as the difference between amount realized and adjusted basis, and classifies holdings as short-term or long-term using the one-year holding period rule. Source: https://www.irs.gov/taxtopics/tc409
- US investment reporting and basis baseline: IRS Publication 550 covers investment income, expenses, and reporting gains/losses on investment property. Source: https://www.irs.gov/publications/p550
- US transaction reporting baseline: IRS Form 8949 instructions require basis records and use adjustment code `W` for nondeductible wash-sale losses. Source: https://www.irs.gov/pub/irs-pdf/i8949.pdf
- Korea stock capital gains baseline: NTS states that foreign stocks sold by a resident who has had a Korean address or place of residence continuously for at least five years by the sale date can be taxable, and that taxable domestic and foreign stock gains/losses can be netted from 2020 disposals with one combined annual KRW 2.5M basic deduction. Source: https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=8800&mi=12274
- Korea calculation flow baseline: NTS stock capital gains flow is transfer price, less necessary expenses including acquisition cost and sale expenses, less annual basic deduction, times the applicable rate, with foreign tax credit shown as an adjustment stage. Source: https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7709&mi=2310

## Product Goal

Recommend candidate sales that meet a portfolio objective while minimizing expected tax cost or intentionally realizing losses. The first version should answer:

- How much gain/loss would be realized if I sell these lots?
- Which lots are best to sell to raise a target amount of cash?
- Which lots can harvest losses without increasing concentration risk?
- How much annual deduction, loss offset, or wash-sale risk remains under each filing scenario?
- What assumptions did the engine use, and what should I manually override before acting?

## Filing Scenarios

`US_ONLY`

- Calculate US capital gains by lot in USD.
- Separate short-term and long-term buckets.
- Flag wash-sale windows and Form 8949 adjustment candidates.
- Support federal, state, and NIIT assumptions as manual settings.
- Hide Korea liability math, but keep Korea source-lot context available as non-tax evidence.

`KR_ONLY`

- Calculate Korea taxable stock gains in KRW.
- Apply taxable-scope settings for foreign stocks, taxable domestic stocks, major-shareholder status, listed off-market sales, and non-listed stock treatment.
- Net taxable domestic and foreign stock gains/losses only when the rule configuration allows it.
- Apply the annual KRW 2.5M stock basic deduction as a visible, editable assumption.
- Ignore US wash-sale disallowance in the tax total, but optionally show it as an informational warning if the user may later file in the US.

`US_AND_KR`

- Run US and Korea calculations independently from the same proposed sales.
- Show side-by-side taxable gain, deductions, credits, estimated tax, and unresolved assumptions.
- Model foreign tax credit as configurable/manual. The app should not silently assume treaty treatment or full creditability.
- Rank plans by combined after-tax result after user-confirmed assumptions.

## Extensible Rule Model

Use data-driven jurisdiction modules instead of hardcoding country-specific logic in UI components.

```ts
type FilingScenario = "US_ONLY" | "KR_ONLY" | "US_AND_KR";

type JurisdictionRuleSet = {
  code: string;
  filingCurrency: "USD" | "KRW" | string;
  residencyQuestions: ResidencyQuestion[];
  taxableAssetRules: TaxableAssetRule[];
  holdingPeriodRules: HoldingPeriodRule[];
  lotSelectionMethods: LotSelectionMethod[];
  lossRules: LossRule[];
  antiAbuseRules: AntiAbuseRule[];
  deductionRules: DeductionRule[];
  rateRules: RateRule[];
  creditRules: CreditRule[];
  manualAssumptionSchema: Record<string, unknown>;
};
```

The planner should load `data/tax-policy.json` when present and fall back to `data/tax-policy.example.json` for public sample mode. Local `data/tax-policy.json` must remain ignored because it can encode private residency and tax assumptions.

## Engine Pipeline

1. Normalize holdings, tax lots, transactions, dividends, FX snapshots, and realized-lot history into one `TaxPlanningInput`.
2. Build candidate sale lots from current open tax lots and current prices.
3. Estimate proceeds, basis, fees, FX conversion, holding period, realized gain/loss, and post-sale remaining exposure for each lot.
4. Apply jurisdiction rule sets for taxable scope, lot method, loss offsets, deduction limits, wash-sale warnings, credits, and rates.
5. Generate plan alternatives:
   - minimize estimated current-year tax;
   - harvest losses up to a target;
   - realize gains up to remaining deduction/exemption room;
   - raise target cash while minimizing tax;
   - reduce concentration while preserving tax efficiency.
6. Explain every recommendation with lot-level evidence, rule assumptions, and warnings.

## UX Shape

- `/tax-planning`: Scenario switcher, target cash input, objective selector, candidate sale table, plan comparison, and warnings.
- `/tax-settings`: Filing profile, residency/taxable-scope questions, rates, deductions, wash-sale settings, FX policy, foreign tax credit mode, and manual overrides.
- Position detail: Add a tax-lot realization panel showing best/worst lots to sell for the active scenario.
- Data ops: Add missing cost basis, stale FX, ambiguous taxable scope, and missing account-type alerts.

## Manual Controls

- Residency and filing scenario.
- US federal bracket, long-term rate bracket, state rate, NIIT applicability, capital loss carryover, and wash-sale sensitivity.
- Korea foreign-stock taxable residency status, domestic taxable-stock flags, major-shareholder status, annual deduction, local-tax-inclusive rate, foreign tax credit handling, and already-used deduction.
- FX source and sale-date FX override.
- Broker basis override, fee override, covered/non-covered status, and lot ID merge/split adjustments.

## Quality Gates

- Unit-test jurisdiction engines with synthetic lots for gain, loss, holding-period, deduction, and wash-sale scenarios.
- Snapshot-test generated plan explanations so assumptions do not disappear silently.
- Add reconciliation checks for missing basis, quantity mismatches, stale prices, and stale FX before enabling recommendations.
- Keep all private tax settings ignored by git; only commit synthetic examples.
