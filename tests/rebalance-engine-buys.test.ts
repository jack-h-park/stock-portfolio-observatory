import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import type { RebalanceInput } from '../lib/adapters/rebalance-input'
import { buildTradePlan, type Instruction, type TradePlan } from '../lib/rebalance/engine'
import type { RebalanceCash, RebalancePosition } from '../lib/rebalance/allocation'
import {
  accountKey,
  SLEEVES,
  type AccountRule,
  type AllocationPolicy,
  type PreferredInstrument,
  type Sleeve,
  type SleeveTarget,
} from '../lib/rebalance/allocation-policy'
import type { InstrumentClasses } from '../lib/rebalance/instrument-classes'
import type { TaxPlanningLot } from '../lib/tax-planning'
import type { TaxPolicy } from '../lib/tax-policy'

const AS_OF = '2026-10-15'
const RATE = 1000
const ACCT1 = accountKey('BrokerA', 'acct-1')
const ACCT2 = accountKey('BrokerA', 'acct-2')

const pref = (ticker: string, account = 'acct-1', market = 'US'): PreferredInstrument => ({
  market,
  ticker,
  brokerage: 'BrokerA',
  account,
})

const allocationPolicy = (
  opts: {
    bounds?: Partial<AllocationPolicy['bounds']>
    preferred?: AllocationPolicy['preferredInstruments']
    accounts?: Record<string, AccountRule>
    cashMin?: number
  } = {}
) => {
  const raw = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'allocation-policy.example.json'), 'utf8'))
  for (const key of Object.keys(raw)) if (key.startsWith('_')) delete raw[key]
  const p = raw as AllocationPolicy
  p.bounds = { ...p.bounds, positionCapPct: 100, maxTurnoverPctPerProposal: 100, ...opts.bounds }
  if (opts.cashMin != null) p.bounds.sleeves = { ...p.bounds.sleeves, cash: { min: opts.cashMin, max: 100 } }
  p.preferredInstruments = opts.preferred ?? {}
  p.accounts = opts.accounts ?? {}
  return p
}

const taxPolicy = (): TaxPolicy =>
  JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'tax-policy.example.json'), 'utf8')) as TaxPolicy

const targets = (over: Partial<Record<Sleeve, SleeveTarget>> = {}): Record<Sleeve, SleeveTarget> =>
  Object.fromEntries(SLEEVES.map((s) => [s, over[s] ?? { target: 0, band: 100 }])) as Record<Sleeve, SleeveTarget>

const classes: InstrumentClasses = {
  'US:AAA': 'us_equity',
  'US:BBB': 'us_equity',
  'US:CCC': 'us_equity',
  'US:NEW': 'us_equity',
  'US:BDZ': 'bonds',
  'KR:KRX1': 'kr_equity',
}

type LotSpec = { id: number; ticker: string; qty: number; price: number; cost: number; account?: string }

const lot = (s: LotSpec): TaxPlanningLot => ({
  id: s.id,
  market: 'US',
  currency: 'USD',
  brokerage: 'BrokerA',
  account: s.account ?? 'acct-1',
  ticker: s.ticker,
  name: s.ticker,
  acquired_date: '2024-01-02',
  fx_rate_to_base: RATE,
  open_quantity: s.qty,
  native_cost_basis: s.cost * s.qty,
  native_market_value: s.price * s.qty,
  native_unrealized_gl: (s.price - s.cost) * s.qty,
  cost_basis_krw: s.cost * s.qty * RATE,
  acquisition_cost_krw: s.cost * s.qty * RATE,
  acquisition_cost_usd: null,
  holding_days: 600,
  tax_term: 'long',
  account_wrapper: 'taxable',
})

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
    current.valueKrw = (current.valueKrw ?? 0) + Number(l.native_market_value) * RATE
    byKey.set(key, current)
  }
  return [...byKey.values()]
}

const cash = (krw: number, currency: 'KRW' | 'USD' = 'USD', account = 'acct-1'): RebalanceCash => ({
  brokerage: 'BrokerA',
  account,
  currency,
  balance: currency === 'USD' ? krw / RATE : krw,
  krw,
  asOf: AS_OF,
})

const input = (lots: TaxPlanningLot[], cashRows: RebalanceCash[], over: Partial<RebalanceInput> = {}): RebalanceInput => ({
  asOf: AS_OF,
  usdKrwRate: RATE,
  positions: positionsFrom(lots),
  cash: cashRows,
  lots,
  recentBuys: [],
  washSaleBlockedBuys: [],
  accountDataAsOf: { [ACCT1]: AS_OF, [ACCT2]: AS_OF },
  ytd: { year: 2026, krTaxableGainKrw: 0, usShortUsd: 0, usLongUsd: 0, lotCount: 0 },
  healthErrors: [],
  ...over,
})

const plan = (
  lots: TaxPlanningLot[],
  cashRows: RebalanceCash[],
  opts: { t?: Record<Sleeve, SleeveTarget>; policy?: AllocationPolicy; over?: Partial<RebalanceInput>; skip?: string[] } = {}
): TradePlan =>
  buildTradePlan({
    input: input(lots, cashRows, opts.over),
    policy: opts.policy ?? allocationPolicy(),
    targets: opts.t ?? US_UNDER,
    classes,
    taxPolicy: taxPolicy(),
    skip: opts.skip,
  })

const of = (p: TradePlan, kind: Instruction['kind']) => p.instructions.filter((i) => i.kind === kind)
const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`)
const buyId = (ticker: string, key = ACCT1) => `buy:${key}:US:${ticker}`

/**
 * 10,000,000 KRW: AAA 3,000,000 (100,000 per share), BBB 300,000 (300,000 per share), USD cash 6,700,000.
 * US is 33% against 45 ± 5, so the plan buys 700,000 KRW of US to reach 40%: 350,000 per preferred instrument.
 */
const US_UNDER = targets({ us_equity: { target: 45, band: 5 } })
const underLots = () => [lot({ id: 1, ticker: 'AAA', qty: 30, price: 100, cost: 50 }), lot({ id: 2, ticker: 'BBB', qty: 1, price: 300, cost: 200 })]
const BOTH = { us_equity: [pref('AAA'), pref('BBB')] }

test('buy amount is split equally across preferred instruments and rounded down to shares', () => {
  const p = plan(underLots(), [cash(6_700_000)], { policy: allocationPolicy({ preferred: BOTH }) })
  const buys = of(p, 'buy')
  assert.deepEqual(buys.map((b) => [b.id, b.quantity, b.estimatedKrw]), [
    [buyId('AAA'), 3, 300_000],
    [buyId('BBB'), 1, 300_000],
  ])
  assert.equal(buys[0].sleeve, 'us_equity')
  assert.equal(buys[0].currency, 'USD')
  assert.deepEqual(buys[0].lots, [])
  assert.deepEqual(buys[0].lotIds, [])
  assert.equal(buys[0].tier, null)
  assert.equal(buys[0].gainKrw, null)
  assert.deepEqual(of(p, 'transfer'), [])
  const move = p.moves.find((m) => m.sleeve === 'us_equity')
  near(move?.amountKrw ?? NaN, 600_000)
  near(move?.intendedAmountKrw ?? NaN, 700_000)
  near(move?.toPct ?? NaN, 39)
})

test('a fractional account buys fractional shares', () => {
  const policy = allocationPolicy({
    preferred: { us_equity: [pref('AAA')] },
    accounts: { [ACCT1]: { lotMethod: 'fifo', fractional: true, managedBy: null, excludedCash: false } },
  })
  const p = plan(underLots(), [cash(6_700_000)], { policy })
  near(of(p, 'buy')[0].quantity, 7)
  const half = plan(underLots(), [cash(6_700_000)], { policy: { ...policy, preferredInstruments: { us_equity: [pref('BBB')] } } })
  near(of(half, 'buy')[0].quantity, 2.333333)
})

test('a buy is funded from the same account\'s sale proceeds', () => {
  // AAA 6,000,000 (60%) sells 1,000,000 to reach 50%; BDZ 200,000 (2%) buys 300,000 to reach 5%. No USD cash.
  const lots = [lot({ id: 1, ticker: 'AAA', qty: 60, price: 100, cost: 50 }), lot({ id: 2, ticker: 'BDZ', qty: 2, price: 100, cost: 100 })]
  const p = plan(lots, [cash(3_800_000, 'KRW')], {
    t: targets({ us_equity: { target: 45, band: 5 }, bonds: { target: 10, band: 5 } }),
    policy: allocationPolicy({ preferred: { bonds: [pref('BDZ')] } }),
  })
  assert.equal(of(p, 'sell')[0].estimatedKrw, 1_000_000)
  assert.deepEqual(of(p, 'buy').map((b) => [b.ticker, b.quantity]), [['BDZ', 3]])
  assert.deepEqual(of(p, 'transfer'), [])
  assert.ok(!p.warnings.some((w) => w.code === 'transfer_needed'))
})

test('an unfunded buy produces a transfer instruction for the shortfall', () => {
  // The buy is in acct-2, which holds 200,000 KRW of USD; the rest of the cash sits in acct-1.
  const p = plan(underLots(), [cash(6_500_000), cash(200_000, 'USD', 'acct-2')], {
    policy: allocationPolicy({ preferred: { us_equity: [pref('AAA', 'acct-2')] } }),
  })
  assert.deepEqual(of(p, 'buy').map((b) => [b.id, b.quantity, b.estimatedKrw]), [[buyId('AAA', ACCT2), 7, 700_000]])
  const transfers = of(p, 'transfer')
  assert.equal(transfers.length, 1)
  assert.equal(transfers[0].id, `transfer:${ACCT2}:USD`)
  assert.equal(transfers[0].account, 'acct-2')
  assert.equal(transfers[0].currency, 'USD')
  near(transfers[0].estimatedKrw, 500_000)
  near(transfers[0].quantity, 500)
  assert.deepEqual(transfers[0].lots, [])
  assert.ok(p.warnings.some((w) => w.code === 'transfer_needed' && w.account === 'acct-2'))
})

test('a KRW cash balance does not fund a USD buy', () => {
  const p = plan(underLots(), [cash(6_700_000, 'KRW')], { policy: allocationPolicy({ preferred: { us_equity: [pref('AAA')] } }) })
  assert.equal(of(p, 'transfer')[0]?.id, `transfer:${ACCT1}:USD`)
  near(of(p, 'transfer')[0].estimatedKrw, 700_000)
})

test('turnover cap scales sells and warns', () => {
  // AAA 6,000,000 (60%) would sell 1,000,000 (10%); the cap is 5%.
  const lots = [lot({ id: 1, ticker: 'AAA', qty: 60, price: 100, cost: 50 })]
  const p = plan(lots, [cash(4_000_000, 'KRW')], {
    t: targets({ us_equity: { target: 45, band: 5 } }),
    policy: allocationPolicy({ bounds: { maxTurnoverPctPerProposal: 5 } }),
  })
  const sold = of(p, 'sell').reduce((sum, i) => sum + i.estimatedKrw, 0)
  near(sold, 500_000)
  assert.equal(of(p, 'sell')[0].quantity, 5)
  assert.ok(p.warnings.some((w) => w.code === 'turnover_capped'))
  near(p.taxSummary.turnoverPct, 5)
})

test('instructions below minTradeKrw are dropped and listed', () => {
  // 350,000 each: AAA buys 3 shares (300,000), BBB at 50 USD buys 7 (350,000). The minimum is 320,000.
  const lots = [lot({ id: 1, ticker: 'AAA', qty: 30, price: 100, cost: 50 }), lot({ id: 2, ticker: 'BBB', qty: 6, price: 50, cost: 40 })]
  const p = plan(lots, [cash(6_700_000)], { policy: allocationPolicy({ preferred: BOTH, bounds: { minTradeKrw: 320_000 } }) })
  assert.deepEqual(of(p, 'buy').map((b) => [b.ticker, b.quantity]), [['BBB', 7]])
  const w = p.warnings.find((x) => x.code === 'below_min_trade')
  assert.ok(w, 'below_min_trade warning')
  assert.ok(w.message.includes(buyId('AAA')), w.message)
  assert.ok(!w.message.includes(buyId('BBB')), w.message)
})

test('cash floor scales buys down', () => {
  // Cash 6,700,000 with a 65% floor (6,500,000) leaves 200,000 to buy with, not 700,000.
  const p = plan(underLots(), [cash(6_700_000)], { policy: allocationPolicy({ preferred: BOTH, cashMin: 65 }) })
  const buys = of(p, 'buy')
  assert.deepEqual(buys.map((b) => [b.ticker, b.quantity]), [['AAA', 1]])
  assert.ok(buys.reduce((sum, b) => sum + b.estimatedKrw, 0) <= 200_000)
  assert.ok(p.warnings.some((w) => w.code === 'cash_floor'))
})

test('a wash-sale-blocked ticker is not bought', () => {
  const p = plan(underLots(), [cash(6_700_000)], {
    policy: allocationPolicy({ preferred: BOTH }),
    over: { washSaleBlockedBuys: [{ ticker: 'AAA', blockedThrough: '2026-10-20' }] },
  })
  assert.deepEqual(of(p, 'buy').map((b) => b.ticker), ['BBB'])
  assert.ok(p.warnings.some((w) => w.code === 'wash_sale_block' && w.ticker === 'AAA'))
  const expired = plan(underLots(), [cash(6_700_000)], {
    policy: allocationPolicy({ preferred: BOTH }),
    over: { washSaleBlockedBuys: [{ ticker: 'AAA', blockedThrough: '2026-10-14' }] },
  })
  assert.deepEqual(of(expired, 'buy').map((b) => b.ticker), ['AAA', 'BBB'])
})

test('skip removes an instruction and re-funds the rest', () => {
  // acct-1 holds 400,000 of USD: AAA (300,000) is funded, BBB (300,000) is short 200,000.
  const cashRows = [cash(400_000), cash(6_300_000, 'KRW', 'acct-2')]
  const policy = allocationPolicy({ preferred: BOTH })
  const full = plan(underLots(), cashRows, { policy })
  assert.equal(of(full, 'buy').length, 2)
  near(of(full, 'transfer')[0].estimatedKrw, 200_000)
  const skipped = plan(underLots(), cashRows, { policy, skip: [buyId('AAA')] })
  assert.deepEqual(of(skipped, 'buy').map((b) => b.ticker), ['BBB'])
  assert.deepEqual(of(skipped, 'transfer'), [])
  assert.ok(!skipped.warnings.some((w) => w.code === 'transfer_needed'))
})

test('skipping a transfer cuts the buys it would have funded', () => {
  const cashRows = [cash(400_000), cash(6_300_000, 'KRW', 'acct-2')]
  const p = plan(underLots(), cashRows, { policy: allocationPolicy({ preferred: BOTH }), skip: [`transfer:${ACCT1}:USD`] })
  assert.deepEqual(of(p, 'transfer'), [])
  assert.ok(of(p, 'buy').reduce((sum, b) => sum + b.estimatedKrw, 0) <= 400_000)
  assert.deepEqual(of(p, 'buy').map((b) => [b.ticker, b.quantity]), [['AAA', 3]])
})

test('taxSummary deduction used/remaining against ytd', () => {
  // AAA sells 10 shares at 100 USD on a 20 USD cost: 800,000 KRW of KR gain.
  const lots = [lot({ id: 1, ticker: 'AAA', qty: 60, price: 100, cost: 20 })]
  const run = (ytd: number) =>
    plan(lots, [cash(4_000_000, 'KRW')], {
      t: targets({ us_equity: { target: 45, band: 5 } }),
      over: { ytd: { year: 2026, krTaxableGainKrw: ytd, usShortUsd: 0, usLongUsd: 0, lotCount: 1 } },
    }).taxSummary
  const fresh = run(0)
  near(fresh.krGainKrw, 800_000)
  near(fresh.krDeductionUsedKrw, 800_000)
  near(fresh.krDeductionRemainingKrw, 1_700_000)
  near(fresh.turnoverPct, 10)
  near(fresh.harvestedLossKrw, 0)
  const late = run(2_000_000)
  near(late.krDeductionUsedKrw, 500_000)
  near(late.krDeductionRemainingKrw, 0)
  assert.ok(late.estimatedTaxKrw > fresh.estimatedTaxKrw)
})

test('no preferred instrument for an underweight sleeve warns and buys nothing', () => {
  const p = plan(underLots(), [cash(6_700_000)])
  assert.deepEqual(of(p, 'buy'), [])
  assert.ok(p.warnings.some((w) => w.code === 'no_buy_list' && w.message === 'no buy list for us_equity'))
})

test('a preferred instrument held nowhere has no price and is not bought', () => {
  const p = plan(underLots(), [cash(6_700_000)], { policy: allocationPolicy({ preferred: { us_equity: [pref('NEW'), pref('AAA')] } }) })
  assert.deepEqual(of(p, 'buy').map((b) => [b.ticker, b.quantity]), [['AAA', 3]])
  assert.ok(p.warnings.some((w) => w.code === 'no_buy_price' && w.ticker === 'NEW'))
})

test('cap sells in an underweight sleeve are netted into its buys of other instruments', () => {
  // AAA 2,500,000 (25%) is over a 20% cap by 500,000; US is 30% against 45 ± 5 (+1,000,000 to 40%).
  // The sleeve buys 1,000,000 + 500,000 of BBB, never AAA, and ends at 40%.
  const lots = [lot({ id: 1, ticker: 'AAA', qty: 25, price: 100, cost: 50 }), lot({ id: 2, ticker: 'BBB', qty: 5, price: 100, cost: 50 })]
  const p = plan(lots, [cash(7_000_000)], {
    policy: allocationPolicy({ preferred: BOTH, bounds: { positionCapPct: 20 } }),
  })
  assert.deepEqual(of(p, 'sell').map((s) => [s.ticker, s.quantity]), [['AAA', 5]])
  assert.deepEqual(of(p, 'buy').map((b) => [b.ticker, b.quantity, b.estimatedKrw]), [['BBB', 15, 1_500_000]])
  const us = 3_000_000 - 500_000 + 1_500_000
  near(us / 10_000_000, 0.4)
})

test('same input twice yields deep-equal plans with buys and transfers', () => {
  const run = () =>
    plan(underLots(), [cash(400_000), cash(6_300_000, 'KRW', 'acct-2')], { policy: allocationPolicy({ preferred: BOTH }) })
  assert.deepEqual(run(), run())
})

/** Every non-cash sleeve's move is the net of its emitted buys and sells (10,000,000 KRW total). */
const assertMovesMatchInstructions = (p: TradePlan) => {
  for (const sleeve of SLEEVES) {
    if (sleeve === 'cash') continue
    const net = p.instructions
      .filter((i) => i.sleeve === sleeve && i.kind !== 'transfer')
      .reduce((sum, i) => sum + (i.kind === 'buy' ? i.estimatedKrw : -i.estimatedKrw), 0)
    const move = p.moves.find((m) => m.sleeve === sleeve)
    if (!move) {
      assert.equal(net, 0, `${sleeve} trades without a move`)
      continue
    }
    near(move.amountKrw, net)
    near(move.toPct, move.fromPct + (net / 10_000_000) * 100)
  }
}
const usMove = (p: TradePlan) => p.moves.find((m) => m.sleeve === 'us_equity')

test('moves equal the net instructions under the turnover cap', () => {
  const p = plan([lot({ id: 1, ticker: 'AAA', qty: 60, price: 100, cost: 50 })], [cash(4_000_000, 'KRW')], {
    t: targets({ us_equity: { target: 45, band: 5 } }),
    policy: allocationPolicy({ bounds: { maxTurnoverPctPerProposal: 5 } }),
  })
  assertMovesMatchInstructions(p)
  near(usMove(p)?.amountKrw ?? NaN, -500_000)
  near(usMove(p)?.intendedAmountKrw ?? NaN, -1_000_000)
  const w = p.warnings.find((x) => x.code === 'turnover_capped')
  assert.ok(w?.message.includes('from 1000000 to 500000 KRW'), w?.message)
})

test('moves equal the net instructions under the cash floor', () => {
  const p = plan(underLots(), [cash(6_700_000)], { policy: allocationPolicy({ preferred: BOTH, cashMin: 65 }) })
  assertMovesMatchInstructions(p)
  near(usMove(p)?.amountKrw ?? NaN, 100_000)
  near(usMove(p)?.intendedAmountKrw ?? NaN, 700_000)
})

test('moves equal the net instructions when a cap sell is dropped below minTradeKrw', () => {
  // The 500,000 cap sale of AAA is below a 600,000 minimum; the sleeve still buys its band move.
  const lots = [lot({ id: 1, ticker: 'AAA', qty: 25, price: 100, cost: 50 }), lot({ id: 2, ticker: 'BBB', qty: 5, price: 100, cost: 50 })]
  const p = plan(lots, [cash(7_000_000)], {
    policy: allocationPolicy({ preferred: BOTH, bounds: { positionCapPct: 20, minTradeKrw: 600_000 } }),
  })
  assertMovesMatchInstructions(p)
  assert.deepEqual(of(p, 'sell'), [])
  assert.deepEqual(of(p, 'buy').map((b) => [b.ticker, b.quantity]), [['BBB', 10]])
  near(usMove(p)?.amountKrw ?? NaN, 1_000_000)
  assert.ok(p.warnings.find((w) => w.code === 'below_min_trade')?.message.includes(`sell:${ACCT1}:US:AAA`))
  // In a sleeve within its band, the dropped cap sale leaves no move at all.
  const within = plan(lots, [cash(7_000_000)], {
    t: targets(),
    policy: allocationPolicy({ preferred: BOTH, bounds: { positionCapPct: 20, minTradeKrw: 600_000 } }),
  })
  assert.deepEqual(within.instructions, [])
  assert.deepEqual(within.moves, [])
})

test('moves equal the net instructions when a buy is blocked', () => {
  const p = plan(underLots(), [cash(6_700_000)], {
    policy: allocationPolicy({ preferred: BOTH }),
    over: { washSaleBlockedBuys: [{ ticker: 'AAA', blockedThrough: '2026-10-20' }] },
  })
  assertMovesMatchInstructions(p)
  near(usMove(p)?.amountKrw ?? NaN, 300_000)
  near(usMove(p)?.intendedAmountKrw ?? NaN, 700_000)
})

test('an account short of both USD and KRW gets a transfer warning for each currency', () => {
  const krx: RebalancePosition = {
    brokerage: 'BrokerA',
    account: 'acct-1',
    market: 'KR',
    currency: 'KRW',
    ticker: 'KRX1',
    name: 'KRX1',
    asset_class: 'stock',
    quantity: 10,
    valueKrw: 500_000,
    costKrw: 400_000,
    dataAsOf: AS_OF,
  }
  const lots = underLots()
  const p = plan(lots, [cash(6_200_000)], {
    t: targets({ us_equity: { target: 45, band: 5 }, kr_equity: { target: 20, band: 5 } }),
    policy: allocationPolicy({ preferred: { us_equity: [pref('AAA', 'acct-2')], kr_equity: [pref('KRX1', 'acct-2', 'KR')] } }),
    over: { positions: [...positionsFrom(lots), krx] },
  })
  assert.deepEqual(of(p, 'transfer').map((t) => [t.id, t.estimatedKrw]), [
    [`transfer:${ACCT2}:KRW`, 1_000_000],
    [`transfer:${ACCT2}:USD`, 700_000],
  ])
  const needed = p.warnings.filter((w) => w.code === 'transfer_needed' && w.account === 'acct-2')
  assert.deepEqual(needed.map((w) => w.currency).sort(), ['KRW', 'USD'])
})

test('a preferred instrument in a managed account is refused with managed_account', () => {
  const p = plan(underLots(), [cash(6_700_000)], {
    policy: allocationPolicy({
      preferred: { us_equity: [pref('AAA', 'acct-2')] },
      accounts: { [ACCT2]: { lotMethod: 'fifo', fractional: false, managedBy: 'agent', excludedCash: false } },
    }),
  })
  assert.deepEqual(of(p, 'buy'), [])
  assert.ok(p.warnings.some((w) => w.code === 'managed_account' && w.ticker === 'AAA' && w.account === 'acct-2'))
  assert.ok(!p.warnings.some((w) => w.code === 'no_buy_list'))
})

test('stale-account warnings follow (brokerage, account), not the account label alone', () => {
  // BrokerA/acct-1 is stale and its only instruction, a 500,000 cap sale, is dropped below the minimum.
  // BrokerB/acct-1, a different account with the same label, is fresh and buys.
  const bbb = { ...lot({ id: 2, ticker: 'BBB', qty: 5, price: 100, cost: 50 }), brokerage: 'BrokerB' }
  const lots = [lot({ id: 1, ticker: 'AAA', qty: 25, price: 100, cost: 50 }), bbb]
  const run = (minTradeKrw: number) =>
    plan(lots, [{ ...cash(7_000_000), brokerage: 'BrokerB' }], {
      policy: allocationPolicy({
        preferred: { us_equity: [{ ...pref('BBB'), brokerage: 'BrokerB' }] },
        bounds: { positionCapPct: 20, minTradeKrw },
      }),
      over: { accountDataAsOf: { [ACCT1]: '2026-01-01', [accountKey('BrokerB', 'acct-1')]: AS_OF } },
    })
  const dropped = run(600_000)
  assert.deepEqual(dropped.instructions.map((i) => [i.kind, i.brokerage, i.ticker]), [['buy', 'BrokerB', 'BBB']])
  assert.deepEqual(dropped.instructions[0].notes, [])
  assert.ok(!dropped.warnings.some((w) => w.code === 'stale_account'))
  const kept = run(100_000)
  const stale = kept.warnings.filter((w) => w.code === 'stale_account')
  assert.deepEqual(stale.map((w) => [w.brokerage, w.account]), [['BrokerA', 'acct-1']])
})
