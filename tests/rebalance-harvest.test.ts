// The loss-harvest scenario (lib/rebalance/harvest.ts), the one display name per instrument it and the LLM input
// use (display-names.ts), the concentration figures the LLM input carries, and the optional `harvest` field a
// proposal stores. Fake instruments, accounts and amounts throughout.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { RebalanceInput } from '../lib/adapters/rebalance-input'
import type { AllocationPolicy } from '../lib/rebalance/allocation-policy'
import type { RebalancePosition } from '../lib/rebalance/allocation'
import type { InstrumentClasses } from '../lib/rebalance/instrument-classes'
import type { TaxPlanningLot } from '../lib/tax-planning'
import type { TaxPolicy } from '../lib/tax-policy'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-harvest-'))
process.env.STOCK_REBALANCE_PROPOSALS_DIR = path.join(root, 'proposals')
process.env.STOCK_ALLOCATION_POLICY_PATH = path.join(root, 'none.json')

const M = 1_000_000
const examplePolicy = (): AllocationPolicy => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'allocation-policy.example.json'), 'utf8'))
  for (const key of Object.keys(raw)) if (key.startsWith('_')) delete raw[key]
  return raw as AllocationPolicy
}
const taxPolicy = (): TaxPolicy =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'tax-policy.example.json'), 'utf8')) as TaxPolicy

const pos = (market: string, ticker: string, valueKrw: number, over: Partial<RebalancePosition> = {}): RebalancePosition => ({
  brokerage: 'BrokerA',
  account: 'acct-1',
  market,
  currency: market === 'US' ? 'USD' : 'KRW',
  ticker,
  name: ticker,
  asset_class: 'stock',
  quantity: 1,
  valueKrw,
  costKrw: valueKrw,
  dataAsOf: null,
  ...over,
})
let nextLot = 1
const lot = (over: Partial<TaxPlanningLot>): TaxPlanningLot => ({
  id: nextLot++,
  market: 'KR',
  currency: 'KRW',
  brokerage: 'BrokerA',
  account: 'acct-1',
  ticker: 'K1',
  name: 'K1',
  acquired_date: '2025-01-01',
  open_quantity: 1,
  native_cost_basis: 3 * M,
  native_market_value: 2 * M,
  native_unrealized_gl: -1 * M,
  cost_basis_krw: 3 * M,
  holding_days: 400,
  tax_term: 'long',
  account_wrapper: 'taxable',
  ...over,
})
/** A KR lot with a won loss of `loss` KRW. */
const lossLot = (ticker: string, loss: number, over: Partial<TaxPlanningLot> = {}) =>
  lot({ ticker, name: ticker, native_cost_basis: 10 * M, cost_basis_krw: 10 * M, native_market_value: 10 * M - loss, native_unrealized_gl: -loss, ...over })

const classes: InstrumentClasses = { 'KR:K1': 'kr_equity', 'KR:K2': 'kr_equity', 'KR:K3': 'kr_equity', 'US:U1': 'us_equity', 'US:U2': 'us_equity' }
const input = (over: Partial<RebalanceInput> = {}): RebalanceInput => ({
  asOf: '2026-10-16',
  usdKrwRate: 1350,
  positions: [pos('KR', 'K1', 100 * M), pos('KR', 'K2', 100 * M), pos('US', 'U1', 300 * M), pos('US', 'U2', 400 * M)],
  cash: [{ brokerage: 'BrokerA', account: 'acct-1', currency: 'KRW', balance: 100 * M, krw: 100 * M, asOf: '2026-10-16' }],
  lots: [],
  recentBuys: [],
  washSaleBlockedBuys: [],
  accountDataAsOf: {},
  ytd: { year: 2026, krTaxableGainKrw: 0, usShortUsd: 0, usLongUsd: 0, usSourceShortUsd: 0, usSourceLongUsd: 0, lotCount: 0 },
  healthErrors: [],
  ...over,
})
const buy = (market: string, ticker: string, date: string) => ({ market, ticker, brokerage: 'BrokerA', account: 'acct-1', date })
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)

const scenarioOf = async (over: Partial<RebalanceInput> = {}, policy = examplePolicy()) => {
  const { buildHarvestScenario } = await import('../lib/rebalance/harvest')
  return buildHarvestScenario({ input: input(over), policy, classes, taxPolicy: taxPolicy(), today: '2026-10-16' })
}

// --- display names ------------------------------------------------------------------------------------------

test('displayNames: one name per market and ticker, from the largest-value row; ties alphabetical; blanks ignored', async () => {
  const { displayName, displayNames, snapshotDisplayNames } = await import('../lib/rebalance/display-names')
  const names = displayNames([
    { market: 'KR', ticker: '000001', name: 'Romanized Name', valueKrw: 10 },
    { market: 'KR', ticker: '000001', name: '한글 이름', valueKrw: 30 },
    { market: 'KR', ticker: '000002', name: 'Beta', valueKrw: 5 },
    { market: 'KR', ticker: '000002', name: 'Alpha', valueKrw: 5 },
    { market: 'KR', ticker: '000003', name: '  ', valueKrw: 99 },
    { market: 'US', ticker: '000001', name: 'Other market', valueKrw: 1 },
  ])
  assert.equal(displayName(names, 'KR', '000001'), '한글 이름')
  assert.equal(displayName(names, 'KR', '000002'), 'Alpha')
  assert.equal(displayName(names, 'KR', '000003'), '000003', 'a blank name falls back to the ticker')
  assert.equal(displayName(names, 'US', '000001'), 'Other market', 'market is part of the key')
  // Positions win over lots; a lot names only what no position names.
  const snap = snapshotDisplayNames({
    positions: [pos('KR', 'K1', 5, { name: 'From position' })],
    lots: [lot({ ticker: 'K1', name: 'From lot', cost_basis_krw: 999 }), lot({ ticker: 'K9', name: 'Lot only' })],
  })
  assert.equal(displayName(snap, 'KR', 'K1'), 'From position')
  assert.equal(displayName(snap, 'KR', 'K9'), 'Lot only')
})

// --- scenario -------------------------------------------------------------------------------------------------

test('harvest scenario: aggregates loss lots by market and ticker across accounts, largest loss first', async () => {
  const lots = [
    lossLot('K1', 1 * M),
    lossLot('K1', 2 * M, { account: 'acct-2', tax_term: 'short', holding_days: 100, acquired_date: '2026-06-01' }),
    lossLot('K2', 4 * M),
    // A gain is never harvestable; an unpriced loss lot is not either.
    lot({ ticker: 'K3', native_cost_basis: 1 * M, cost_basis_krw: 1 * M, native_market_value: 2 * M, native_unrealized_gl: M }),
    lossLot('K3', 5 * M, { native_market_value: null, native_unrealized_gl: null }),
  ]
  const positions = [pos('KR', 'K1', 50 * M, { name: 'Small name' }), pos('KR', 'K1', 80 * M, { account: 'acct-2', name: 'Big name' }), pos('KR', 'K2', 10 * M)]
  const s = await scenarioOf({ lots, positions })
  near(s.totalLossKrw, 7 * M)
  assert.equal(s.lotCount, 3)
  assert.deepEqual(
    s.rows.map((r) => [r.market, r.ticker, r.name, r.sleeve, r.lotCount, r.accountCount]),
    [
      ['KR', 'K2', 'K2', 'kr_equity', 1, 1],
      ['KR', 'K1', 'Big name', 'kr_equity', 2, 2],
    ]
  )
  near(s.rows[0].lossKrw, 4 * M)
  near(s.rows[1].lossKrw, 3 * M)
  near(s.rows[1].shortLossKrw, 2 * M)
  near(s.rows[1].longLossKrw, 1 * M)
  assert.deepEqual(s.excludedForWashSale, [])
  assert.equal(s.asOf, '2026-10-16')
  assert.equal(s.usTaxPerson, false)
})

test('harvest scenario: the tax effect is the year with every loss lot sold minus the year without, as the engine computes it', async () => {
  const { prepareSellContext, harvestCandidates, yearTaxKrw } = await import('../lib/rebalance/sell-selection')
  const { summarizeTaxCandidates } = await import('../lib/tax-planning')
  // A realized US gain this year, so a US loss has something to offset.
  const over: Partial<RebalanceInput> = {
    lots: [lot({ market: 'US', currency: 'USD', ticker: 'U1', name: 'U1', native_cost_basis: 3000, cost_basis_krw: 3000 * 1350, native_market_value: 1000, native_unrealized_gl: -2000, fx_rate_to_base: 1350, acquisition_cost_usd: 3000, acquisition_cost_krw: 3000 * 1350 })],
    ytd: { year: 2026, krTaxableGainKrw: 0, usShortUsd: 5000, usLongUsd: 0, usSourceShortUsd: 5000, usSourceLongUsd: 0, lotCount: 1 },
  }
  const s = await scenarioOf(over)
  const ctx = prepareSellContext({ input: input(over), policy: examplePolicy(), classes, taxPolicy: taxPolicy() })
  const { candidates } = harvestCandidates(ctx, '2026-10-16')
  const year = (rows: typeof candidates) =>
    summarizeTaxCandidates({ candidates: rows, policy: ctx.taxPolicy, scenario: ctx.taxPolicy.activeScenario, year: 2026 }).combinedTaxAfterCreditsKrw
  near(s.yearTotalWithKrw, year(candidates))
  near(s.yearTotalWithoutKrw, year([]))
  near(s.taxEffectKrw, s.yearTotalWithKrw - s.yearTotalWithoutKrw)
  near(s.taxEffectKrw, yearTaxKrw(ctx, candidates) - yearTaxKrw(ctx, []))
  assert.ok(s.taxEffectKrw < 0, `selling a loss against a realized gain reduces the year’s tax (${s.taxEffectKrw})`)
})

test('harvest scenario agrees with the harvest trigger and the LLM input, wash-sale exclusion included', async () => {
  const { detectTriggers } = await import('../lib/rebalance/triggers')
  const { harvestableLossKrw, prepareSellContext } = await import('../lib/rebalance/sell-selection')
  const { buildLlmInput } = await import('../lib/rebalance/llm-input')
  const lots = [lossLot('K1', 2 * M), lossLot('K2', 3 * M), lossLot('K2', 1 * M, { account: 'acct-2' })]
  for (const recentBuys of [[], [buy('KR', 'K2', '2026-10-01')], [buy('KR', 'K2', '2026-09-01')], [buy('KR', 'K1', '2026-10-10'), buy('KR', 'K2', '2026-10-12')]]) {
    const over = { lots, recentBuys }
    const s = await scenarioOf(over)
    const ctx = prepareSellContext({ input: input(over), policy: examplePolicy(), classes, taxPolicy: taxPolicy() })
    assert.equal(s.totalLossKrw, harvestableLossKrw(ctx, '2026-10-16'))
    const hit = detectTriggers({ input: input(over), policy: examplePolicy(), classes, taxPolicy: taxPolicy(), today: '2026-10-16' }).find((h) => h.key === 'harvest')
    if (s.totalLossKrw >= examplePolicy().bounds.harvestThresholdKrw && s.totalLossKrw > 0) assert.equal(hit?.magnitude, s.totalLossKrw)
    else assert.equal(hit, undefined)
    const llm = buildLlmInput({ input: input(over), policy: examplePolicy(), classes, taxPolicy: taxPolicy(), context: { macro: [], benchmarks: null }, past: [], accountMapPath: null })
    assert.equal(llm.tax.harvestableLossKrw, s.totalLossKrw)
  }
  // A buy within 30 days leaves that instrument out and lists it, with its loss and latest buy date.
  const s = await scenarioOf({ lots, recentBuys: [buy('KR', 'K2', '2026-10-01'), buy('KR', 'K2', '2026-10-05')] })
  near(s.totalLossKrw, 2 * M)
  assert.deepEqual(s.rows.map((r) => r.ticker), ['K1'])
  assert.equal(s.excludedForWashSale.length, 1)
  assert.equal(s.excludedForWashSale[0].ticker, 'K2')
  assert.equal(s.excludedForWashSale[0].lastBuy, '2026-10-05')
  near(s.excludedForWashSale[0].lossKrw, 4 * M)
})

test('harvest scenario: nothing to harvest is a zero scenario; usTaxPerson follows the policy', async () => {
  const policy = examplePolicy()
  policy.investor = { usTaxPerson: true }
  const s = await scenarioOf({}, policy)
  assert.equal(s.totalLossKrw, 0)
  assert.deepEqual(s.rows, [])
  assert.equal(s.taxEffectKrw, 0)
  assert.equal(s.usTaxPerson, true)
})

test('isHarvestScenario accepts a built scenario (after JSON) and refuses malformed ones', async () => {
  const { isHarvestScenario } = await import('../lib/rebalance/harvest')
  const s = JSON.parse(JSON.stringify(await scenarioOf({ lots: [lossLot('K1', M)] })))
  assert.equal(isHarvestScenario(s), true)
  for (const bad of [null, [], 'x', { ...s, totalLossKrw: 'many' }, { ...s, rows: [{ ticker: 1 }] }, { ...s, usTaxPerson: undefined }, { ...s, excludedForWashSale: null }]) {
    assert.equal(isHarvestScenario(bad), false, JSON.stringify(bad)?.slice(0, 80))
  }
})

// --- stored on the proposal -------------------------------------------------------------------------------------

test('a proposal keeps a valid harvest field, drops a malformed one, and reads without one', async () => {
  const { createProposal, getProposal } = await import('../lib/rebalance/proposal-store')
  const dir = fs.mkdtempSync(path.join(root, 'store-'))
  const harvest = await scenarioOf({ lots: [lossLot('K1', M)] })
  const base = {
    kind: 'manual' as const,
    triggers: [],
    policyAtCreation: examplePolicy(),
    inputSnapshot: input(),
    outlook: null,
    llm: null,
    targetChange: { decision: 'hold' as const, sleeves: {}, boundsErrors: [] },
    plan: { moves: [], instructions: [], warnings: [], taxSummary: {} } as never,
    planSkips: [],
  }
  const withIt = createProposal({ ...base, id: 'rb-h1', harvest }, new Date('2026-10-16T00:00:00Z'), dir)
  assert.deepEqual(getProposal(withIt.id, dir)?.harvest, JSON.parse(JSON.stringify(harvest)))
  const file = path.join(dir, `${withIt.id}.json`)
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  raw.harvest = { totalLossKrw: 'lots' }
  fs.writeFileSync(file, JSON.stringify(raw))
  assert.equal('harvest' in (getProposal(withIt.id, dir) ?? {}), false)
  delete raw.harvest
  fs.writeFileSync(file, JSON.stringify(raw))
  assert.equal(getProposal(withIt.id, dir)?.harvest, undefined)
})

// --- LLM input ------------------------------------------------------------------------------------------------

const llmInput = async (over: Partial<RebalanceInput> = {}, policy = examplePolicy()) => {
  const { buildLlmInput } = await import('../lib/rebalance/llm-input')
  return buildLlmInput({ input: input(over), policy, classes, taxPolicy: taxPolicy(), context: { macro: [], benchmarks: null }, past: [], accountMapPath: null })
}

test('LLM input: concentration sums an instrument across accounts, with shares of the total and of its sleeve', async () => {
  // Total 1000: kr_equity K1 (200 + 110 across two accounts, two spellings) and K2 210, us 380, cash 100.
  const positions = [
    pos('KR', 'K1', 200 * M, { name: '한글 이름' }),
    pos('KR', 'K1', 110 * M, { brokerage: 'BrokerB', account: 'acct-9', name: 'Romanized Name' }),
    pos('KR', 'K2', 210 * M),
    pos('US', 'U1', 380 * M),
  ]
  const out = await llmInput({ positions })
  assert.equal(out.concentration.positionCapPct, examplePolicy().bounds.positionCapPct)
  assert.deepEqual(out.concentration.top, [
    { market: 'US', ticker: 'U1', name: 'U1', sleeve: 'us_equity', pctOfTotal: 38, pctOfSleeve: 100 },
    { market: 'KR', ticker: 'K1', name: '한글 이름', sleeve: 'kr_equity', pctOfTotal: 31, pctOfSleeve: 59.6 },
    { market: 'KR', ticker: 'K2', name: 'K2', sleeve: 'kr_equity', pctOfTotal: 21, pctOfSleeve: 40.4 },
  ])
  // Every per-account row carries the instrument's one display name.
  assert.deepEqual([...new Set(out.positions.filter((p) => p.ticker === 'K1').map((p) => p.name))], ['한글 이름'])
})

test('LLM input: concentration keeps the ten largest instruments; harvest is null without a loss and summarized with one', async () => {
  const positions = Array.from({ length: 12 }, (_, i) => pos('US', i < 2 ? `U${i + 1}` : `X${i}`, (i + 1) * M))
  const extra: InstrumentClasses = {}
  for (const p of positions) extra[`US:${p.ticker}`] = 'us_equity'
  const { buildLlmInput } = await import('../lib/rebalance/llm-input')
  const out = buildLlmInput({ input: input({ positions }), policy: examplePolicy(), classes: { ...classes, ...extra }, taxPolicy: taxPolicy(), context: { macro: [], benchmarks: null }, past: [], accountMapPath: null })
  assert.equal(out.concentration.top.length, 10)
  assert.equal(out.concentration.top[0].ticker, 'X11')
  assert.equal(out.harvest, null)

  const withLoss = await llmInput({ lots: [lossLot('K1', 2 * M), lossLot('K2', 3 * M)] })
  assert.ok(withLoss.harvest)
  assert.equal(withLoss.harvest.totalLossKrw, 5 * M)
  assert.deepEqual(withLoss.harvest.top.map((r) => [r.ticker, r.lossKrw, r.lotCount]), [['K2', 3 * M, 1], ['K1', 2 * M, 1]])
  assert.equal(typeof withLoss.harvest.taxEffectKrw, 'number')
})
