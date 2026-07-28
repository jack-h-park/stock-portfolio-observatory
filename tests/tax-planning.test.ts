import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildMonthlySalePlanSet,
  buildTaxPlan,
  summarizeTaxCandidates,
  type TaxPlanningLot,
} from '@/lib/tax-planning'
import type { TaxPolicy } from '@/lib/tax-policy'
import { estimateUsCapitalGainTax, netUsCapitalGains } from '@/lib/us-tax-engine'
import {
  createSavedTaxPlan,
  getSavedTaxPlan,
  savedTaxPlanProgress,
  updateSavedInstructionExecution,
  updateSavedTaxPlanStatus,
} from '@/lib/tax-plan-store'

function policy(overrides?: { creditMode?: string; domesticTaxable?: boolean }): TaxPolicy {
  return {
    version: 3,
    activeScenario: 'US_AND_KR',
    baseCurrency: 'KRW',
    planningHorizonYears: 5,
    annualFilingProfiles: [2026, 2027, 2028, 2029, 2030].map((year) => {
      const filingScenario = year >= 2028 ? 'US_ONLY' as const : 'US_AND_KR' as const
      return {
        year,
        filingScenario,
        status: 'confirmed' as const,
        jurisdictions: [
          { code: 'US', filingRequired: true, taxCalculationEnabled: true },
          {
            code: 'KR',
            filingRequired: year < 2028,
            taxCalculationEnabled: year < 2028,
          },
        ],
      }
    }),
    jurisdictions: [
      {
        code: 'US',
        enabled: true,
        filingCurrency: 'USD',
        manualAssumptions: {
          filingStatus: 'MFJ',
          stateCode: 'NONE',
          wageBaseYear: 2026,
          wageBaseUsd: 336_000,
          annualIncomeGrowthPct: 0,
          federalBracketInflationPct: 2.5,
          planningUsdKrwRate: 1000,
          taxInputYear: 2026,
          federalShortTermRatePct: 37,
          federalLongTermRatePct: 20,
          stateRatePct: 0,
          netInvestmentIncomeTaxRatePct: 0,
          lossDeductionLimitUsd: 3000,
        },
      },
      {
        code: 'KR',
        enabled: true,
        filingCurrency: 'KRW',
        manualAssumptions: {
          stockBasicDeductionKrw: 2_500_000,
          foreignStockFlatRatePct: 22,
          domesticMajorShareholder: overrides?.domesticTaxable ?? false,
          domesticListedOffMarketSale: false,
          foreignTaxCreditMode: overrides?.creditMode ?? 'manual',
        },
      },
    ],
    manualAdjustments: [],
  }
}

function lot(overrides: Partial<TaxPlanningLot> = {}): TaxPlanningLot {
  return {
    id: 1,
    market: 'US',
    currency: 'USD',
    brokerage: 'Broker',
    account: 'Taxable',
    ticker: 'TEST',
    name: 'Test Holdings',
    acquired_date: '2025-07-01',
    fx_rate_to_base: 1000,
    open_quantity: 10,
    native_cost_basis: 10_000,
    native_market_value: 20_000,
    native_unrealized_gl: 10_000,
    cost_basis_krw: 10_000_000,
    holding_days: 365,
    tax_term: 'short',
    ...overrides,
  }
}

test('earliest plan waits until the day after the one-year anniversary', () => {
  const result = buildMonthlySalePlanSet({
    lots: [lot()],
    policy: policy(),
    selectedStrategy: 'EARLIEST_LT',
    executionMonths: 12,
    horizonYears: 5,
    asOfDate: '2026-06-15',
  })
  assert.equal(result.selectedPlan.instructions.length, 1)
  assert.equal(result.selectedPlan.instructions[0].plannedDate, '2026-07-02')
  assert.equal(result.selectedPlan.instructions[0].holdingBucket, 'long')
})

test('US short and long gains net losses before applying their rates', () => {
  const plan = buildTaxPlan({
    lots: [
      lot({ id: 1, tax_term: 'long', holding_days: 800, native_market_value: 20_000, cost_basis_krw: 10_000_000 }),
      lot({
        id: 2,
        ticker: 'LOSS',
        tax_term: 'short',
        holding_days: 100,
        native_cost_basis: 10_000,
        native_market_value: 6_000,
        native_unrealized_gl: -4_000,
        cost_basis_krw: 10_000_000,
      }),
    ],
    policy: policy(),
    scenario: 'US_ONLY',
    objective: 'raise-cash',
  })
  const aggregate = summarizeTaxCandidates({ candidates: plan.candidates, policy: policy(), scenario: 'US_ONLY' })
  assert.equal(aggregate.netShortGainKrw, -4_000_000)
  assert.equal(aggregate.netLongGainKrw, 10_000_000)
  assert.equal(aggregate.usTaxKrw, 900_000)
})

test('cross-border credit reduces only the overlapping Korea estimate', () => {
  const currentPolicy = policy({ creditMode: 'estimated-us-source' })
  const plan = buildTaxPlan({
    lots: [lot({ tax_term: 'long', holding_days: 800 })],
    policy: currentPolicy,
    scenario: 'US_AND_KR',
    objective: 'raise-cash',
  })
  const aggregate = summarizeTaxCandidates({
    candidates: plan.candidates,
    policy: currentPolicy,
    scenario: 'US_AND_KR',
  })
  assert.equal(aggregate.krTaxKrw, 1_650_000)
  assert.equal(aggregate.usTaxKrw, 1_500_000)
  assert.equal(aggregate.estimatedCrossBorderTaxCreditKrw, 1_500_000)
  assert.equal(aggregate.incrementalKrTaxAfterCreditKrw, 150_000)
  assert.equal(aggregate.combinedTaxAfterCreditsKrw, 1_650_000)
})

test('2026 MFJ engine stacks short and long gains on projected ordinary income', () => {
  const estimate = estimateUsCapitalGainTax({
    year: 2026,
    filingStatus: 'MFJ',
    stateCode: 'NONE',
    ordinaryIncomeUsd: 336_000,
    shortGainUsd: 10_000,
    longGainUsd: 10_000,
    fallbackStateRatePct: 0,
    niitRatePct: 0,
  })
  assert.equal(estimate.federalTaxableIncomeBeforeGainsUsd, 303_800)
  assert.equal(estimate.federalShortTermTaxUsd, 2_400)
  assert.equal(estimate.federalLongTermTaxUsd, 1_500)
  assert.equal(estimate.federalRegularTaxUsd, 3_900)
})

test('NIIT and California are incremental calculations rather than flat rates on proceeds', () => {
  const estimate = estimateUsCapitalGainTax({
    year: 2026,
    filingStatus: 'MFJ',
    stateCode: 'CA',
    ordinaryIncomeUsd: 336_000,
    shortGainUsd: 0,
    longGainUsd: 10_000,
    niitRatePct: 3.8,
    californiaBracketInflationPct: 0,
  })
  assert.equal(estimate.niitTaxUsd, 380)
  assert.equal(Math.round(estimate.stateTaxUsd), 930)
})

test('loss carryovers retain character before cross-netting and the ordinary loss limit', () => {
  const netting = netUsCapitalGains({
    shortGainUsd: 5_000,
    longGainUsd: 2_000,
    shortLossCarryoverUsd: 12_000,
    ordinaryLossDeductionLimitUsd: 3_000,
  })
  assert.equal(netting.taxableShortGainUsd, 0)
  assert.equal(netting.taxableLongGainUsd, 0)
  assert.equal(netting.netCapitalLossUsd, 5_000)
  assert.equal(netting.ordinaryLossDeductionUsd, 3_000)
  assert.equal(netting.projectedLossCarryforwardUsd, 2_000)
})

test('US foreign tax credit is capped by the federal tax attributable to foreign-source income', () => {
  const estimate = estimateUsCapitalGainTax({
    year: 2026,
    filingStatus: 'MFJ',
    stateCode: 'NONE',
    ordinaryIncomeUsd: 100_000,
    shortGainUsd: 0,
    longGainUsd: 100_000,
    foreignSourceIncomeUsd: 100_000,
    foreignTaxPaidUsd: 22_000,
    fallbackStateRatePct: 0,
    niitRatePct: 0,
  })
  assert.ok(estimate.foreignTaxCreditLimitUsd > 0)
  assert.equal(estimate.foreignTaxCreditAllowedUsd, estimate.foreignTaxCreditLimitUsd)
  assert.ok(estimate.foreignTaxCreditAllowedUsd < estimate.foreignTaxCreditAvailableUsd)
})

test('loss instructions flag same-ticker open-lot acquisitions inside the wash-sale window', () => {
  const planSet = buildMonthlySalePlanSet({
    lots: [
      lot({ id: 1, acquired_date: '2026-07-01', native_market_value: 8_000, cost_basis_krw: 10_000_000 }),
      lot({ id: 2, acquired_date: '2026-07-10', native_market_value: 7_000, cost_basis_krw: 10_000_000 }),
    ],
    policy: policy(),
    selectedStrategy: 'ACCELERATE_LOSSES',
    asOfDate: '2026-07-20',
  })
  assert.equal(planSet.selectedPlan.instructions.length, 2)
  assert.ok(planSet.selectedPlan.instructions.every((instruction) => instruction.washSaleRisk))
  assert.ok(planSet.selectedPlan.instructions.every((instruction) => instruction.washSaleMatches === 1))
})

test('Korea-listed holdings stay outside Korea tax unless taxable-scope flags are enabled', () => {
  const krLot = lot({
    market: 'KR',
    currency: 'KRW',
    ticker: '000000',
    fx_rate_to_base: 1,
    native_cost_basis: 10_000_000,
    native_market_value: 20_000_000,
    native_unrealized_gl: 10_000_000,
    cost_basis_krw: 10_000_000,
    tax_term: 'long',
    holding_days: 800,
  })
  const excludedPolicy = policy()
  const includedPolicy = policy({ domesticTaxable: true })
  const excluded = buildTaxPlan({ lots: [krLot], policy: excludedPolicy, scenario: 'KR_ONLY', objective: 'raise-cash' })
  const included = buildTaxPlan({ lots: [krLot], policy: includedPolicy, scenario: 'KR_ONLY', objective: 'raise-cash' })
  assert.equal(summarizeTaxCandidates({ candidates: excluded.candidates, policy: excludedPolicy, scenario: 'KR_ONLY' }).krTaxKrw, 0)
  assert.equal(summarizeTaxCandidates({ candidates: included.candidates, policy: includedPolicy, scenario: 'KR_ONLY' }).krTaxKrw, 1_650_000)
})

test('saved plans preserve the snapshot while execution state advances separately', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'stock-tax-plans-'))
  const filePath = path.join(directory, 'plans.json')
  const planSet = buildMonthlySalePlanSet({
    lots: [lot({ tax_term: 'long', holding_days: 800 })],
    policy: policy(),
    selectedStrategy: 'EARLIEST_LT',
    executionMonths: 12,
    horizonYears: 5,
    asOfDate: '2026-07-15',
  })
  const saved = createSavedTaxPlan({
    name: '2026 baseline',
    plan: planSet.selectedPlan,
    asOfDate: planSet.asOfDate,
    horizonYears: 5,
    policyVersion: 2,
    policyUpdatedAt: null,
    filePath,
    now: new Date('2026-07-15T12:00:00Z'),
  })
  const instructionId = saved.plan.instructions[0].id
  updateSavedTaxPlanStatus({ id: saved.id, status: 'active', filePath, now: new Date('2026-07-16T12:00:00Z') })
  updateSavedInstructionExecution({
    planId: saved.id,
    instructionId,
    status: 'executed',
    actualProceedsKrw: 19_500_000,
    actualGainKrw: 9_500_000,
    filePath,
    now: new Date('2026-07-17T12:00:00Z'),
  })
  const reloaded = getSavedTaxPlan(saved.id, filePath)
  assert.ok(reloaded)
  assert.equal(reloaded.status, 'active')
  assert.equal(reloaded.plan.instructions[0].proceedsKrw, 20_000_000)
  assert.equal(reloaded.execution[instructionId].actualProceedsKrw, 19_500_000)
  assert.equal(savedTaxPlanProgress(reloaded).executed, 1)
  assert.equal(savedTaxPlanProgress(reloaded).completionPct, 100)
  assert.equal((JSON.parse(readFileSync(filePath, 'utf8')) as { version: number }).version, 1)
})
