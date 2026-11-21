import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildTaxPlan,
  instructionReasonCode,
  masterStrategyDescription,
  masterStrategyLabel,
  scenarioDescription,
  scenarioLabel,
  type MasterPlanInstruction,
  type MasterPlanReasonCode,
  type MasterPlanStrategyKey,
  type MultiYearStrategyKey,
  type TaxPlanningLot,
  type TaxPlanWarning,
  WARNING_MESSAGES,
} from '@/lib/tax-planning'
import type { TaxPolicy } from '@/lib/tax-policy'
import { taxPlanning } from '@/lib/ui-copy/pages/taxPlanning'
import {
  instructionReasonText,
  masterPlanDescription,
  masterPlanName,
  multiYearScenarioDescription,
  multiYearScenarioName,
  taxPlanWarningText,
} from '@/app/tax-planning/view-utils'

const STRATEGIES: MasterPlanStrategyKey[] = ['EARLIEST_LT', 'STAGED', 'WAIT_US_ONLY', 'ACCELERATE_LOSSES']
const SCENARIOS: MultiYearStrategyKey[] = ['KR_FIRST', 'US_FIRST', 'BALANCED', 'LOSS_FIRST']
const LATIN = /[A-Za-z]/

test('the English strategy name and description are the engine wording for every key and window', () => {
  for (const strategy of STRATEGIES) {
    for (const executionMonths of [1, 6, 12]) {
      const plan = { strategy, executionMonths, label: 'stored', description: 'stored' }
      assert.equal(masterPlanName(plan, taxPlanning.en), masterStrategyLabel(strategy, executionMonths))
      assert.equal(masterPlanDescription(plan, taxPlanning.en), masterStrategyDescription(strategy, executionMonths))
    }
  }
})

test('the Korean strategy name and description exist for every key and carry no English', () => {
  for (const strategy of STRATEGIES) {
    const plan = { strategy, executionMonths: 6, label: 'stored', description: 'stored' }
    const name = masterPlanName(plan, taxPlanning.ko)
    const description = masterPlanDescription(plan, taxPlanning.ko)
    assert.ok(name && !LATIN.test(name), name)
    assert.ok(description && !LATIN.test(description), description)
  }
  assert.equal(masterPlanName({ strategy: 'STAGED', executionMonths: 6, label: '' }, taxPlanning.ko), '6개월에 걸쳐 단계적 매도')
})

test('an unknown strategy falls back to the stored English name and description', () => {
  const plan = { strategy: 'RETIRED' as MasterPlanStrategyKey, executionMonths: 6, label: 'Old label', description: 'Old description' }
  assert.equal(masterPlanName(plan, taxPlanning.ko), 'Old label')
  assert.equal(masterPlanDescription(plan, taxPlanning.ko), 'Old description')
})

test('the English scenario name and description are the engine wording for every key', () => {
  for (const key of SCENARIOS) {
    const scenario = { key, label: 'stored', description: 'stored' }
    assert.equal(multiYearScenarioName(scenario, taxPlanning.en), scenarioLabel(key))
    assert.equal(multiYearScenarioDescription(scenario, taxPlanning.en), scenarioDescription(key))
    const ko = [multiYearScenarioName(scenario, taxPlanning.ko), multiYearScenarioDescription(scenario, taxPlanning.ko)]
    for (const text of ko) assert.ok(text && !LATIN.test(text.replace(/US|KR/g, '')), text)
  }
})

// Synthetic policy: only the wash-sale window matters here, set off the defaults.
function washSalePolicy(): TaxPolicy {
  return {
    version: 3,
    activeScenario: 'US_AND_KR',
    baseCurrency: 'KRW',
    jurisdictions: [
      { code: 'US', enabled: true, filingCurrency: 'USD', manualAssumptions: { washSaleWindowDaysBefore: 21, washSaleWindowDaysAfter: 40 } },
      { code: 'KR', enabled: true, filingCurrency: 'KRW', manualAssumptions: {} },
    ],
    manualAdjustments: [],
  }
}

function usLossLot(): TaxPlanningLot {
  return {
    id: 1,
    market: 'US',
    currency: 'USD',
    brokerage: 'Broker',
    account: 'Taxable',
    ticker: 'LOSS',
    name: 'Test Holdings',
    acquired_date: '2025-07-01',
    fx_rate_to_base: 1000,
    open_quantity: 10,
    native_cost_basis: 10_000,
    native_market_value: 6_000,
    native_unrealized_gl: -4_000,
    cost_basis_krw: 10_000_000,
    holding_days: 365,
    tax_term: 'short',
  }
}

test('every plain warning code renders the engine sentence in English and a Korean sentence otherwise', () => {
  const codes = Object.keys(WARNING_MESSAGES) as Array<keyof typeof WARNING_MESSAGES>
  assert.equal(codes.length, 7)
  for (const code of codes) {
    const warning: TaxPlanWarning = { code, message: WARNING_MESSAGES[code] }
    assert.equal(taxPlanning.en.planWarnings.codes[code], WARNING_MESSAGES[code])
    assert.equal(taxPlanWarningText(warning, taxPlanning.en), WARNING_MESSAGES[code])
    const ko = taxPlanWarningText(warning, taxPlanning.ko)
    assert.notEqual(ko, warning.message)
    assert.ok(!LATIN.test(ko.replace(/US|KR|FX/g, '')), ko)
  }
})

test('the wash-sale warning built by the engine renders its own message in English', () => {
  const plan = buildTaxPlan({ lots: [usLossLot()], policy: washSalePolicy(), scenario: 'US_AND_KR', objective: 'raise-cash' })
  const warning = plan.candidates[0].warnings.find((w) => w.code === 'WASH_SALE_REVIEW')
  assert.ok(warning, 'the US loss lot carries a wash-sale warning')
  assert.equal(taxPlanWarningText(warning, taxPlanning.en), warning.message)
  const ko = taxPlanWarningText(warning, taxPlanning.ko)
  assert.notEqual(ko, warning.message)
  assert.ok(!LATIN.test(ko.replace(/US|KR|FX/g, '')), ko)
  assert.match(ko, /21일.*40일/)
})

test('an unknown warning code still shows its message', () => {
  const warning = { code: 'SOMETHING_NEW', message: 'A new engine warning.' } as unknown as TaxPlanWarning
  assert.equal(taxPlanWarningText(warning, taxPlanning.ko), 'A new engine warning.')
})

const LEGACY_REASONS: Array<[string, MasterPlanReasonCode]> = [
  ['Held for long-term treatment and same-year netting in the first US-only filing year', 'WAIT_US_ONLY_YEAR'],
  ['Early loss candidate for same-year gain offset; wash-sale review required', 'EARLY_LOSS_OFFSET'],
  ['Loss inventory scheduled with the annual realization plan', 'LOSS_INVENTORY'],
  ['A gain on one return and a loss on the other this year; scheduled as a sale, not as loss inventory', 'MIXED_RETURNS'],
  ['First permitted window after long-term eligibility', 'FIRST_LONG_TERM_WINDOW'],
  ['Short-term sale under the selected scenario', 'SHORT_TERM_SALE'],
]

test('instructionReasonCode reads the stored code first', () => {
  const instruction = { reasonCode: 'LOSS_INVENTORY', reason: 'Short-term sale under the selected scenario' } as Pick<MasterPlanInstruction, 'reason' | 'reasonCode'>
  assert.equal(instructionReasonCode(instruction), 'LOSS_INVENTORY')
})

test('instructionReasonCode recovers the code from the English reason of a plan saved before codes', () => {
  for (const [reason, code] of LEGACY_REASONS) {
    assert.equal(instructionReasonCode({ reason }), code)
    assert.equal(instructionReasonText({ reason }, taxPlanning.en), reason)
    const ko = instructionReasonText({ reason }, taxPlanning.ko)
    assert.notEqual(ko, reason)
  }
  assert.equal(instructionReasonCode({ reason: 'Some other sentence' }), null)
  assert.equal(instructionReasonText({ reason: 'Some other sentence' }, taxPlanning.ko), 'Some other sentence')
})

test('the six Korean reasons carry no English word', () => {
  for (const [, code] of LEGACY_REASONS) {
    const text = taxPlanning.ko.timeline.reasons[code]
    assert.ok(text && !LATIN.test(text.replace(/US|KR/g, '')), text)
  }
  assert.equal(taxPlanning.ko.timeline.reasons.FIRST_LONG_TERM_WINDOW, '장기 보유 요건 충족 후 첫 매도 가능 구간')
})

test('the US method note keeps the English sentence and names the method in Korean', () => {
  for (const method of ['progressive-mfj', 'screening-rate-fallback']) {
    const en = taxPlanning.en.page.methodNote(taxPlanning.en.page.methodLabels[method] ?? method)
    assert.equal(en, `Method: ${method}. FTC is applied only in the selected credit mode; source and treaty percentages remain manual inputs.`)
    const label = taxPlanning.ko.page.methodLabels[method]
    assert.ok(label && !LATIN.test(label.replace(/MFJ/g, '')), label)
  }
})

test('the saved-plan line keeps its English wording', () => {
  assert.equal(taxPlanning.en.savedPlans.snapshotLine('Sell at long-term eligibility', '2030-01-02', 3), 'Sell at long-term eligibility · snapshot 2030-01-02 · revision 3')
  assert.equal(taxPlanning.ko.savedPlans.snapshotLine('라벨', '2030-01-02', 3), '라벨 · 스냅샷 2030-01-02 · 리비전 3')
})
