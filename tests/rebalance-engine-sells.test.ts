import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import type { RebalanceInput } from '../lib/adapters/rebalance-input'
import { buildTradePlan, computeSleeveMoves, type TradePlan } from '../lib/rebalance/engine'
import { computeAllocation, type RebalanceCash, type RebalancePosition } from '../lib/rebalance/allocation'
import {
  accountKey,
  SLEEVES,
  type AccountRule,
  type AllocationPolicy,
  type Sleeve,
  type SleeveTarget,
} from '../lib/rebalance/allocation-policy'
import type { InstrumentClasses } from '../lib/rebalance/instrument-classes'
import type { TaxPlanningLot } from '../lib/tax-planning'
import type { TaxPolicy } from '../lib/tax-policy'

const AS_OF = '2026-10-15'
const RATE = 1000

const allocationPolicy = (over: Partial<AllocationPolicy['bounds']> = {}, accounts: Record<string, AccountRule> = {}) => {
  const raw = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'allocation-policy.example.json'), 'utf8'))
  for (const key of Object.keys(raw)) if (key.startsWith('_')) delete raw[key]
  const p = raw as AllocationPolicy
  p.bounds = { ...p.bounds, positionCapPct: 100, ...over }
  p.accounts = accounts
  return p
}

const taxPolicy = (): TaxPolicy =>
  JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'tax-policy.example.json'), 'utf8')) as TaxPolicy

/** Every sleeve within band unless overridden. */
const targets = (over: Partial<Record<Sleeve, SleeveTarget>> = {}): Record<Sleeve, SleeveTarget> =>
  Object.fromEntries(SLEEVES.map((s) => [s, over[s] ?? { target: 0, band: 100 }])) as Record<Sleeve, SleeveTarget>

const classes: InstrumentClasses = Object.fromEntries(
  ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH', 'III', 'JJJ', 'KKK', 'LLL', 'MMM', 'NNN', 'OOO', 'PPP', 'QQQ', 'RRR'].map(
    (t) => [`US:${t}`, 'us_equity' as Sleeve]
  ).concat([['KR:KRX1', 'kr_equity']])
)

type LotSpec = {
  id: number
  ticker: string
  qty: number
  /** Per-share price and cost, in the lot's currency. */
  price: number | null
  cost: number
  acquired?: string
  long?: boolean
  account?: string
  market?: string
}

const lot = (s: LotSpec): TaxPlanningLot => {
  const market = s.market ?? 'US'
  const fx = market === 'US' ? RATE : 1
  const long = s.long ?? true
  return {
    id: s.id,
    market,
    currency: market === 'US' ? 'USD' : 'KRW',
    brokerage: 'BrokerA',
    account: s.account ?? 'acct-1',
    ticker: s.ticker,
    name: s.ticker,
    acquired_date: s.acquired ?? (long ? '2024-01-02' : '2026-08-01'),
    fx_rate_to_base: fx,
    open_quantity: s.qty,
    native_cost_basis: s.cost * s.qty,
    native_market_value: s.price == null ? null : s.price * s.qty,
    native_unrealized_gl: s.price == null ? null : (s.price - s.cost) * s.qty,
    cost_basis_krw: s.cost * s.qty * fx,
    acquisition_cost_krw: s.cost * s.qty * fx,
    acquisition_cost_usd: null,
    holding_days: long ? 600 : 75,
    tax_term: long ? 'long' : 'short',
    account_wrapper: 'taxable',
  }
}

const positionsFrom = (lots: TaxPlanningLot[]): RebalancePosition[] => {
  const byKey = new Map<string, RebalancePosition>()
  for (const l of lots) {
    const key = `${l.account}|${l.market}|${l.ticker}`
    const current = byKey.get(key) ?? {
      brokerage: l.brokerage,
      account: l.account,
      market: l.market,
      currency: l.currency,
      ticker: l.ticker,
      name: l.name,
      asset_class: 'stock',
      quantity: 0,
      valueKrw: 0 as number | null,
      costKrw: 0,
      dataAsOf: AS_OF,
    }
    current.quantity += l.open_quantity
    current.costKrw += l.cost_basis_krw
    current.valueKrw =
      current.valueKrw == null || l.native_market_value == null
        ? null
        : current.valueKrw + l.native_market_value * Number(l.fx_rate_to_base ?? 1)
    byKey.set(key, current)
  }
  return [...byKey.values()]
}

const cashRow = (krw: number): RebalanceCash => ({ brokerage: 'BrokerA', account: 'acct-1', currency: 'KRW', balance: krw, krw, asOf: AS_OF })

const input = (lots: TaxPlanningLot[], cashKrw: number, over: Partial<RebalanceInput> = {}): RebalanceInput => ({
  asOf: AS_OF,
  usdKrwRate: RATE,
  positions: positionsFrom(lots),
  cash: [cashRow(cashKrw)],
  lots,
  recentBuys: [],
  washSaleBlockedBuys: [],
  accountDataAsOf: { [accountKey('BrokerA', 'acct-1')]: AS_OF, [accountKey('BrokerA', 'acct-2')]: AS_OF },
  ytd: { year: 2026, krTaxableGainKrw: 0, usShortUsd: 0, usLongUsd: 0, lotCount: 0 },
  healthErrors: [],
  ...over,
})

/** US at 55% of 10,000,000 KRW against 45 ± 5: the plan sells 500,000 KRW to reach 50%. */
const US_OVER = targets({ us_equity: { target: 45, band: 5 } })

const plan = (
  lots: TaxPlanningLot[],
  cashKrw: number,
  opts: { t?: Record<Sleeve, SleeveTarget>; policy?: AllocationPolicy; over?: Partial<RebalanceInput>; tax?: TaxPolicy } = {}
): TradePlan =>
  buildTradePlan({
    input: input(lots, cashKrw, opts.over),
    policy: opts.policy ?? allocationPolicy(),
    targets: opts.t ?? US_OVER,
    classes,
    taxPolicy: opts.tax ?? taxPolicy(),
  })

/** YTD gains already at the KR deduction: nothing fits the kr_deduction tier. */
const DEDUCTION_USED = { ytd: { year: 2026, krTaxableGainKrw: 2_500_000, usShortUsd: 0, usLongUsd: 0, lotCount: 1 } }

const sells = (p: TradePlan) => p.instructions.filter((i) => i.kind === 'sell')
const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`)

test('no move when every sleeve is within band', () => {
  const lots = [lot({ id: 1, ticker: 'AAA', qty: 55, price: 100, cost: 50 })]
  const p = plan(lots, 4_500_000, { t: targets() })
  assert.deepEqual(p.moves, [])
  assert.deepEqual(p.instructions, [])
})

test('move goes to the band edge, not the target', () => {
  const position: RebalancePosition = {
    brokerage: 'BrokerA',
    account: 'acct-1',
    market: 'US',
    currency: 'USD',
    ticker: 'AAA',
    name: 'AAA',
    asset_class: 'stock',
    quantity: 1,
    valueKrw: 550_000,
    costKrw: 1,
    dataAsOf: AS_OF,
  }
  const allocation = computeAllocation({ positions: [position], cash: [cashRow(450_000)] }, allocationPolicy(), classes)
  const moves = computeSleeveMoves(allocation, targets({ us_equity: { target: 45, band: 5 } }))
  assert.equal(moves.length, 1)
  assert.equal(moves[0].sleeve, 'us_equity')
  near(moves[0].fromPct, 55)
  near(moves[0].toPct, 50)
  near(moves[0].amountKrw, -50_000)
})

test('losses are sold before gains', () => {
  const lots = [
    lot({ id: 1, ticker: 'AAA', qty: 10, price: 300, cost: 200 }),
    lot({ id: 2, ticker: 'BBB', qty: 10, price: 250, cost: 300 }),
  ]
  const p = plan(lots, 4_500_000)
  const s = sells(p)
  assert.equal(s.length, 1)
  assert.equal(s[0].ticker, 'BBB')
  assert.equal(s[0].tier, 'loss')
  assert.equal(s[0].quantity, 2)
  assert.equal(s[0].id, `sell:${accountKey('BrokerA', 'acct-1')}:US:BBB`)
  assert.deepEqual(s[0].lotIds, [2])
  near(s[0].estimatedKrw, 500_000)
  near(s[0].gainKrw ?? NaN, -100_000)
  near(s[0].usGainUsd ?? NaN, -100)
})

test('KR deduction tier fills the remaining deduction before US long gains', () => {
  // Remaining deduction 2.5M - 2.0M = 500k. CCC's 400k gain fits; DDD's ratio is lower but its gain does not fit.
  const lots = [
    lot({ id: 1, ticker: 'CCC', qty: 10, price: 100, cost: 60 }),
    lot({ id: 2, ticker: 'DDD', qty: 45, price: 100, cost: 77.7 }),
  ]
  const p = plan(lots, 4_500_000, { over: { ytd: { year: 2026, krTaxableGainKrw: 2_000_000, usShortUsd: 0, usLongUsd: 0, lotCount: 1 } } })
  const s = sells(p)
  assert.equal(s.length, 1)
  assert.equal(s[0].ticker, 'CCC')
  assert.equal(s[0].tier, 'kr_deduction')
  assert.equal(s[0].quantity, 5)
  // Without the deduction headroom DDD (lower gain/proceeds) goes first, as a US long gain.
  const q = plan(lots, 4_500_000, { over: { ytd: { year: 2026, krTaxableGainKrw: 2_500_000, usShortUsd: 0, usLongUsd: 0, lotCount: 1 } } })
  assert.equal(sells(q)[0].ticker, 'DDD')
  assert.equal(sells(q)[0].tier, 'us_long')
})

test('short-term gains come last and carry tier short_term', () => {
  const lots = [
    lot({ id: 1, ticker: 'EEE', qty: 52, price: 100, cost: 98, long: false }),
    lot({ id: 2, ticker: 'FFF', qty: 3, price: 100, cost: 30 }),
  ]
  const p = plan(lots, 4_500_000, { over: { ytd: { year: 2026, krTaxableGainKrw: 2_500_000, usShortUsd: 0, usLongUsd: 0, lotCount: 1 } } })
  const s = sells(p)
  assert.deepEqual(
    s.map((i) => [i.ticker, i.tier, i.quantity, i.holdingBucket]),
    [
      ['FFF', 'us_long', 3, 'long'],
      ['EEE', 'short_term', 2, 'short'],
    ]
  )
})

test('fifo account sells the oldest lot first even if a newer lot is a loss', () => {
  const lots = [
    lot({ id: 1, ticker: 'GGG', qty: 30, price: 100, cost: 50, acquired: '2023-03-01' }),
    lot({ id: 2, ticker: 'GGG', qty: 25, price: 100, cost: 150, acquired: '2025-03-01' }),
  ]
  const fifo = sells(plan(lots, 4_500_000, { over: DEDUCTION_USED }))
  assert.equal(fifo.length, 1)
  assert.deepEqual(fifo[0].lotIds, [1])
  assert.equal(fifo[0].tier, 'us_long')
  const specific = sells(
    plan(lots, 4_500_000, {
      over: DEDUCTION_USED,
      policy: allocationPolicy({}, { [accountKey('BrokerA', 'acct-1')]: { lotMethod: 'specific', fractional: false, managedBy: null, excludedCash: false } }),
    })
  )
  assert.deepEqual(specific[0].lotIds, [2])
  assert.equal(specific[0].tier, 'loss')
})

test('fifo moves to the next lot once the oldest is used up', () => {
  const lots = [
    lot({ id: 1, ticker: 'GGG', qty: 3, price: 100, cost: 50, acquired: '2023-03-01' }),
    lot({ id: 2, ticker: 'GGG', qty: 52, price: 100, cost: 150, acquired: '2025-03-01' }),
  ]
  const s = sells(plan(lots, 4_500_000, { over: DEDUCTION_USED }))
  assert.equal(s.length, 1)
  assert.deepEqual(s[0].lotIds, [1, 2])
  assert.deepEqual(
    s[0].lots.map((l) => [l.lotId, l.quantity, l.tier]),
    [
      [1, 3, 'us_long'],
      [2, 2, 'loss'],
    ]
  )
  assert.equal(s[0].quantity, 5)
  assert.equal(s[0].tier, 'us_long')
})

test('average account treats the position as one unit', () => {
  const key = accountKey('BrokerA', 'acct-1')
  const lots = [
    lot({ id: 1, ticker: 'KRX1', market: 'KR', qty: 10, price: 100_000, cost: 50_000, acquired: '2024-02-01' }),
    lot({ id: 2, ticker: 'KRX1', market: 'KR', qty: 10, price: 100_000, cost: 150_000, acquired: '2026-05-01', long: false }),
  ]
  const p = plan(lots, 3_000_000, {
    t: targets({ kr_equity: { target: 30, band: 5 } }),
    policy: allocationPolicy({}, { [key]: { lotMethod: 'average', fractional: false, managedBy: null, excludedCash: false } }),
  })
  const s = sells(p)
  assert.equal(s.length, 1)
  assert.equal(s[0].quantity, 2)
  assert.deepEqual(s[0].lotIds, [1, 2])
  assert.deepEqual(s[0].lots.map((l) => [l.lotId, l.quantity]), [
    [1, 1],
    [2, 1],
  ])
  near(s[0].gainKrw ?? NaN, 0)
  assert.equal(s[0].tier, 'short_term')
  assert.equal(s[0].currency, 'KRW')
})

test('whole-share rounding leaves the remainder unsold', () => {
  const lots = [lot({ id: 1, ticker: 'HHH', qty: 50, price: 110, cost: 100 })]
  const whole = sells(plan(lots, 4_500_000))
  assert.equal(whole[0].quantity, 4)
  near(whole[0].estimatedKrw, 440_000)
  const fractional = sells(
    plan(lots, 4_500_000, {
      policy: allocationPolicy({}, { [accountKey('BrokerA', 'acct-1')]: { lotMethod: 'fifo', fractional: true, managedBy: null, excludedCash: false } }),
    })
  )
  assert.equal(fractional[0].quantity, 4.545454)
})

test('wash-sale: a loss lot with a buy 10 days ago is blocked and warned', () => {
  const lots = [
    lot({ id: 1, ticker: 'III', qty: 25, price: 100, cost: 150 }),
    lot({ id: 2, ticker: 'JJJ', qty: 30, price: 100, cost: 50 }),
  ]
  const p = plan(lots, 4_500_000, {
    over: { recentBuys: [{ market: 'US', ticker: 'III', brokerage: 'BrokerB', account: 'other', date: '2026-10-05' }] },
  })
  assert.deepEqual(sells(p).map((i) => i.ticker), ['JJJ'])
  assert.ok(p.warnings.some((w) => w.code === 'wash_sale_block' && w.ticker === 'III'))
  // A buy 40 days ago does not block.
  const q = plan(lots, 4_500_000, {
    over: { recentBuys: [{ market: 'US', ticker: 'III', brokerage: 'BrokerB', account: 'other', date: '2026-09-05' }] },
  })
  assert.deepEqual(sells(q).map((i) => i.ticker), ['III'])
})

test('a short lot turning long in 20 days is held and warned', () => {
  // Acquired 2025-11-03: long-term from 2026-11-04, 20 days after 2026-10-15.
  const lots = [
    lot({ id: 1, ticker: 'KKK', qty: 25, price: 100, cost: 150, acquired: '2025-11-03', long: false }),
    lot({ id: 2, ticker: 'LLL', qty: 30, price: 100, cost: 50 }),
  ]
  const p = plan(lots, 4_500_000)
  assert.deepEqual(sells(p).map((i) => i.ticker), ['LLL'])
  assert.ok(p.warnings.some((w) => w.code === 'near_long_term' && w.ticker === 'KKK'))
})

test('managedBy account contributes to allocation but gets no instructions', () => {
  const lots = [
    lot({ id: 1, ticker: 'MMM', qty: 25, price: 100, cost: 150, account: 'acct-2' }),
    lot({ id: 2, ticker: 'NNN', qty: 30, price: 100, cost: 50 }),
  ]
  const p = plan(lots, 4_500_000, {
    policy: allocationPolicy({}, { [accountKey('BrokerA', 'acct-2')]: { lotMethod: 'fifo', fractional: false, managedBy: 'agent', excludedCash: false } }),
  })
  near(p.moves[0].amountKrw, -500_000)
  assert.deepEqual(sells(p).map((i) => [i.account, i.ticker]), [['acct-1', 'NNN']])
})

test('engine skips unpriced lots and warns', () => {
  const lots = [
    lot({ id: 1, ticker: 'OOO', qty: 25, price: null, cost: 100 }),
    lot({ id: 2, ticker: 'PPP', qty: 30, price: 100, cost: 50 }),
  ]
  const p = plan(lots, 4_500_000)
  assert.deepEqual(sells(p).map((i) => i.ticker), ['PPP'])
  assert.ok(p.warnings.some((w) => w.code === 'unpriced' && w.ticker === 'OOO'))
})

test('position over cap is reduced first even if its sleeve is within band', () => {
  // QQQ is 20% of 10M against a 15% cap: 500k excess. RRR is a loss lot, which would otherwise go first.
  const lots = [
    lot({ id: 1, ticker: 'QQQ', qty: 20, price: 100, cost: 50 }),
    lot({ id: 2, ticker: 'RRR', qty: 10, price: 100, cost: 150 }),
  ]
  const p = plan(lots, 7_000_000, { t: targets(), policy: allocationPolicy({ positionCapPct: 15 }) })
  assert.deepEqual(sells(p).map((i) => [i.ticker, i.quantity]), [['QQQ', 5]])
  assert.equal(p.moves.length, 1)
  assert.equal(p.moves[0].sleeve, 'us_equity')
  near(p.moves[0].amountKrw, -500_000)
})

test('a sleeve to reduce with no sellable lots warns', () => {
  const gold: RebalancePosition = {
    brokerage: 'BrokerA',
    account: 'acct-1',
    market: 'KR',
    currency: 'KRW',
    ticker: 'GOLD1',
    name: 'gold',
    asset_class: 'gold',
    quantity: 1,
    valueKrw: 5_000_000,
    costKrw: 4_000_000,
    dataAsOf: AS_OF,
  }
  const p = buildTradePlan({
    input: { ...input([], 5_000_000), positions: [gold] },
    policy: allocationPolicy(),
    targets: targets({ gold: { target: 5, band: 5 } }),
    classes,
    taxPolicy: taxPolicy(),
  })
  assert.deepEqual(p.instructions, [])
  assert.ok(p.warnings.some((w) => w.code === 'no_sellable_lots' && w.message.includes('gold')))
})

test('a stale account carries the note and the warning', () => {
  const lots = [lot({ id: 1, ticker: 'AAA', qty: 55, price: 100, cost: 50 })]
  const p = plan(lots, 4_500_000, { over: { accountDataAsOf: { [accountKey('BrokerA', 'acct-1')]: '2026-08-01' } } })
  assert.deepEqual(sells(p)[0].notes, ['stale data: check quantity in the broker app'])
  assert.ok(p.warnings.some((w) => w.code === 'stale_account' && w.account === 'acct-1'))
})

test('skip leaves an instruction out and selection moves on', () => {
  const lots = [
    lot({ id: 1, ticker: 'AAA', qty: 30, price: 100, cost: 50 }),
    lot({ id: 2, ticker: 'BBB', qty: 25, price: 100, cost: 150 }),
  ]
  const p = buildTradePlan({
    input: input(lots, 4_500_000),
    policy: allocationPolicy(),
    targets: US_OVER,
    classes,
    taxPolicy: taxPolicy(),
    skip: [`sell:${accountKey('BrokerA', 'acct-1')}:US:BBB`],
  })
  assert.deepEqual(sells(p).map((i) => i.ticker), ['AAA'])
})

test('same input twice yields deep-equal plans', () => {
  const lots = [
    lot({ id: 1, ticker: 'AAA', qty: 10, price: 100, cost: 50 }),
    lot({ id: 2, ticker: 'BBB', qty: 10, price: 100, cost: 150, account: 'acct-2' }),
    lot({ id: 3, ticker: 'CCC', qty: 10, price: 100, cost: 99, long: false }),
    lot({ id: 4, ticker: 'DDD', qty: 25, price: 100, cost: 100 }),
  ]
  assert.deepEqual(plan(lots, 4_500_000), plan(lots, 4_500_000))
})
