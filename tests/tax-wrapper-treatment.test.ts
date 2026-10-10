import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { config } from '@/config'
import { buildMonthlySalePlanSet, buildTaxPlan, type TaxPlanningLot } from '@/lib/tax-planning'
import { normalizeTaxPolicy, pensionCreditLimit, wrapperTreatment, type TaxPolicy } from '@/lib/tax-policy'
import { runIngest } from './ingest-harness'
import { IRP, SAMSUNG_PENSION, writeScenario } from './pension-fixtures'

// Invented figures throughout; the repository is public.

function basePolicy(extra: Partial<TaxPolicy> = {}): TaxPolicy {
  return {
    version: 3,
    activeScenario: 'US_ONLY',
    baseCurrency: 'KRW',
    planningHorizonYears: 1,
    annualFilingProfiles: [],
    jurisdictions: [
      {
        code: 'US',
        enabled: true,
        filingCurrency: 'USD',
        manualAssumptions: {
          filingStatus: 'MFJ',
          stateCode: 'NONE',
          wageBaseYear: 2026,
          wageBaseUsd: 200_000,
          planningUsdKrwRate: 1000,
          taxInputYear: 2026,
          federalShortTermRatePct: 24,
          federalLongTermRatePct: 15,
          stateRatePct: 0,
          netInvestmentIncomeTaxRatePct: 3.8,
        },
      },
      { code: 'KR', enabled: true, filingCurrency: 'KRW', manualAssumptions: {} },
    ],
    manualAdjustments: [],
    ...extra,
  }
}

const EXAMPLE_POLICY = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '..', 'data', 'tax-policy.example.json'), 'utf8')
) as TaxPolicy

test('wrapperTreatment: spec defaults when the key is absent, with US isa kept taxable', () => {
  const policy = basePolicy()
  assert.equal(wrapperTreatment(policy, 'US', 'isa'), 'taxable')
  assert.equal(wrapperTreatment(policy, 'US', 'irp'), 'undecided')
  assert.equal(wrapperTreatment(policy, 'US', 'pension_savings'), 'undecided')
  assert.equal(wrapperTreatment(policy, 'US', 'taxable'), 'taxable')
  assert.equal(wrapperTreatment(policy, 'US', 'something_new'), 'undecided')
  assert.equal(wrapperTreatment(policy, 'KR', 'isa'), 'exempt_within_limit')
  assert.equal(wrapperTreatment(policy, 'KR', 'irp'), 'deferred')
  assert.equal(wrapperTreatment(policy, 'KR', 'pension_savings'), 'deferred')
  assert.equal(wrapperTreatment(policy, 'KR', 'taxable'), 'taxable')
})

test('wrapperTreatment: the policy overrides a default, and an unknown value falls back to it', () => {
  const policy = basePolicy({
    wrapperTreatment: { US: { irp: 'taxable', isa: 'undecided', pension_savings: 'nonsense' } },
  } as Partial<TaxPolicy>)
  assert.equal(wrapperTreatment(policy, 'US', 'irp'), 'taxable')
  assert.equal(wrapperTreatment(policy, 'US', 'isa'), 'undecided')
  assert.equal(wrapperTreatment(policy, 'US', 'pension_savings'), 'undecided')
  // The plain brokerage wrapper is taxable whatever the policy says.
  const forced = basePolicy({ wrapperTreatment: { US: { taxable: 'undecided' } } } as Partial<TaxPolicy>)
  assert.equal(wrapperTreatment(forced, 'US', 'taxable'), 'taxable')
})

test('the example policy records the plan ruling: US isa taxable, the pension wrappers undecided', () => {
  for (const wrapper of ['isa', 'irp', 'pension_savings']) {
    assert.equal(wrapperTreatment(EXAMPLE_POLICY, 'US', wrapper), wrapperTreatment(basePolicy(), 'US', wrapper), wrapper)
    assert.equal(wrapperTreatment(EXAMPLE_POLICY, 'KR', wrapper), wrapperTreatment(basePolicy(), 'KR', wrapper), wrapper)
  }
  // normalizeTaxPolicy must not drop the new keys.
  const normalized = normalizeTaxPolicy(EXAMPLE_POLICY)
  assert.deepEqual(normalized.wrapperTreatment, EXAMPLE_POLICY.wrapperTreatment)
  assert.deepEqual(normalized.pensionTaxCredit, EXAMPLE_POLICY.pensionTaxCredit)
})

test('pensionCreditLimit picks the newest band that starts on or before the year', () => {
  assert.deepEqual(pensionCreditLimit(EXAMPLE_POLICY, 2024), { pensionSavingsLimitKrw: 6_000_000, combinedLimitKrw: 9_000_000 })
  assert.deepEqual(pensionCreditLimit(EXAMPLE_POLICY, 2023), { pensionSavingsLimitKrw: 6_000_000, combinedLimitKrw: 9_000_000 })
  assert.deepEqual(pensionCreditLimit(EXAMPLE_POLICY, 2021), { pensionSavingsLimitKrw: 4_000_000, combinedLimitKrw: 7_000_000 })
  assert.equal(pensionCreditLimit(EXAMPLE_POLICY, 2014), null)
  // The limit comes from the policy file, never from the code.
  assert.equal(pensionCreditLimit(basePolicy(), 2024), null)
})

function lot(overrides: Partial<TaxPlanningLot>): TaxPlanningLot {
  return {
    id: 1,
    market: 'US',
    currency: 'USD',
    brokerage: 'Example Broker',
    account: 'Example Broker 0000',
    ticker: 'EXMPL',
    name: 'EXAMPLE INC',
    acquired_date: '2024-01-02',
    fx_rate_to_base: 1000,
    open_quantity: 10,
    native_cost_basis: 1000,
    native_market_value: 3000,
    native_unrealized_gl: 2000,
    cost_basis_krw: 1_000_000,
    holding_days: 700,
    tax_term: 'Long-term',
    account_wrapper: 'taxable',
    ...overrides,
  }
}

const stockLot = lot({})
const irpLot = lot({
  id: 2,
  market: 'KR',
  currency: 'KRW',
  brokerage: 'Example Securities',
  account: 'Example Securities(IRP)',
  ticker: '000000',
  name: 'EXAMPLE 200 ETF',
  fx_rate_to_base: 1,
  native_cost_basis: 4_000_000,
  native_market_value: 9_000_000,
  native_unrealized_gl: 5_000_000,
  cost_basis_krw: 4_000_000,
  account_wrapper: 'irp',
})

test('an undecided irp lot leaves the US estimate unchanged; a taxable one moves into it', () => {
  const undecided = basePolicy()
  const taxable = basePolicy({ wrapperTreatment: { US: { irp: 'taxable' } } } as Partial<TaxPolicy>)

  const stockOnly = buildTaxPlan({ lots: [stockLot], policy: undecided, scenario: 'US_ONLY', objective: 'raise-cash' })
  const withUndecided = buildTaxPlan({ lots: [stockLot, irpLot], policy: undecided, scenario: 'US_ONLY', objective: 'raise-cash' })
  const withTaxable = buildTaxPlan({ lots: [stockLot, irpLot], policy: taxable, scenario: 'US_ONLY', objective: 'raise-cash' })

  assert.ok(stockOnly.summary.usTaxKrw > 0)
  assert.equal(withUndecided.summary.usTaxKrw, stockOnly.summary.usTaxKrw)
  assert.deepEqual(withUndecided.candidates.map((c) => c.id), [1])

  assert.ok(withTaxable.summary.usTaxKrw > stockOnly.summary.usTaxKrw)
  assert.deepEqual(withTaxable.candidates.map((c) => c.id).sort(), [1, 2])

  // A lot with no wrapper is a plain brokerage lot, as every lot was before wrappers.
  const untagged = { ...stockLot, account_wrapper: undefined }
  assert.equal(
    buildTaxPlan({ lots: [untagged], policy: undecided, scenario: 'US_ONLY', objective: 'raise-cash' }).summary.usTaxKrw,
    stockOnly.summary.usTaxKrw
  )

  // The monthly master plan sees the same lot set.
  const planLotIds = (policy: TaxPolicy) =>
    new Set(
      buildMonthlySalePlanSet({ lots: [stockLot, irpLot], policy, asOfDate: '2026-10-10' }).scenarios.flatMap((plan) =>
        plan.instructions.map((instruction) => instruction.lotId)
      )
    )
  assert.ok(!planLotIds(undecided).has(2))
  assert.ok(planLotIds(taxable).has(2))
})

// ---------------------------------------------------------------------------
// Database side: the ingest check and the adapter read the same policy helper.

function ingest(taxPolicy: Record<string, unknown>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'wrapper-treatment-'))
  const env = writeScenario(dir, { withPensions: true })
  const policyPath = path.join(dir, 'tax-policy.json')
  const existing = JSON.parse(readFileSync(policyPath, 'utf8'))
  writeFileSync(policyPath, JSON.stringify({ ...existing, ...taxPolicy }), 'utf8')
  const dbPath = runIngest(dir, { env, allowFailure: true })
  const db = new Database(dbPath, { readonly: true })
  const check = db.prepare("select status, detail from validation_checks where name = 'us_wrapper_treatment_decided'").get() as {
    status: string
    detail: string
  }
  db.close()
  return { dbPath, check }
}

test('us_wrapper_treatment_decided follows wrapperTreatment from the policy', () => {
  const undecided = ingest({})
  assert.equal(undecided.check.status, 'fail')
  assert.match(undecided.check.detail, /irp/)
  assert.match(undecided.check.detail, /pension_savings/)

  const decided = ingest({ wrapperTreatment: { US: { irp: 'taxable', pension_savings: 'deferred' } } })
  assert.equal(decided.check.status, 'pass', decided.check.detail)

  const partly = ingest({ wrapperTreatment: { US: { irp: 'taxable' } } })
  assert.equal(partly.check.status, 'fail')
  assert.doesNotMatch(partly.check.detail, /\birp\b/)
  assert.match(partly.check.detail, /pension_savings/)
})

test('getWrapperReview and getTaxPlanningLots read the pension accounts out of *_all', async () => {
  const { dbPath } = ingest({})
  // One synthetic IRP lot: the snapshot carries none today.
  const rw = new Database(dbPath)
  rw.prepare(
    `insert into tax_lots_all (market, currency, base_currency, fx_rate_to_base, brokerage, account, ticker, name,
       acquired_date, open_quantity, native_cost_basis, native_market_value, native_unrealized_gl, cost_basis_krw,
       holding_days, tax_term, asset_class, account_wrapper, owner)
     values ('KR', 'KRW', 'KRW', 1, 'Example Securities', ?, '069500', 'Example 200 ETF', '2025-01-02', 10, 300000,
       360000, 60000, 300000, 600, 'Long-term', 'security', 'irp', 'self')`
  ).run(IRP)
  rw.close()

  // config is read once at import, and the policy helpers above already loaded it.
  config.stockDbPath = dbPath
  const { getWrapperReview, getTaxPlanningLots } = await import('../lib/adapters/portfolio-db')

  const review = getWrapperReview(basePolicy())
  const byAccount = new Map(review.map((row) => [row.account, row]))
  assert.deepEqual([...byAccount.keys()].sort(), [IRP, SAMSUNG_PENSION].sort())

  const irp = byAccount.get(IRP)!
  assert.equal(irp.wrapper, 'irp')
  assert.equal(irp.usTreatment, 'undecided')
  // The ETF and the fund; the cash sweep is not a PFIC.
  assert.equal(irp.likelyPficCount, 2)

  const samsung = byAccount.get(SAMSUNG_PENSION)!
  assert.equal(samsung.wrapper, 'pension_savings')
  assert.equal(samsung.realizedGainKrw, 98_000)
  assert.ok(samsung.dividendsKrw > 0)
  // Two certificate funds; the certificate's cash is not one.
  assert.equal(samsung.likelyPficCount, 2)

  const decided = getWrapperReview(basePolicy({ wrapperTreatment: { US: { irp: 'taxable' } } } as Partial<TaxPolicy>))
  assert.equal(decided.find((row) => row.account === IRP)!.usTreatment, 'taxable')

  const stockLots = getTaxPlanningLots(5000, basePolicy())
  assert.ok(stockLots.length > 0)
  // With the pension wrappers undecided the planner reads exactly the stock view.
  const ro = new Database(dbPath, { readonly: true })
  const viewIds = (ro.prepare('select id from tax_lots where open_quantity > 0 order by id').all() as { id: number }[]).map((r) => r.id)
  ro.close()
  assert.deepEqual(stockLots.map((row) => row.id).sort((a, b) => a - b), viewIds)
  assert.ok(stockLots.every((row) => row.account !== IRP))
  // The gold lot is wrapper taxable but not a security: never a planning lot.
  assert.ok(stockLots.every((row) => !/금현물/.test(row.account)))

  const withIrp = getTaxPlanningLots(5000, basePolicy({ wrapperTreatment: { US: { irp: 'taxable' } } } as Partial<TaxPolicy>))
  const irpLots = withIrp.filter((row) => row.account === IRP)
  assert.equal(irpLots.length, 1)
  assert.equal(irpLots[0].account_wrapper, 'irp')
  assert.equal(withIrp.length, stockLots.length + 1)
})
