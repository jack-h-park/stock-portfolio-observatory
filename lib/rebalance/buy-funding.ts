import type { RebalanceInput } from '@/lib/adapters/rebalance-input'
import {
  accountKey,
  defaultAccountRule,
  SLEEVES,
  type AllocationPolicy,
  type PreferredInstrument,
  type Sleeve,
} from './allocation-policy'
import type { EngineWarning, Instruction, SleeveMove } from './engine'
import { instrumentKey } from './instrument-classes'
import { fmtKrwAmount, KRW_EPS, STALE_NOTE, staleAccount, type CapExcess } from './sell-selection'

export function buyInstructionId(brokerage: string | null, account: string, market: string, ticker: string) {
  return `buy:${accountKey(brokerage, account)}:${market}:${ticker}`
}

export function transferInstructionId(brokerage: string | null, account: string, currency: string) {
  return `transfer:${accountKey(brokerage, account)}:${currency}`
}

const roundQty = (value: number) => Math.round(value * 1e8) / 1e8
const roundDown = (q: number, decimals: number) => {
  const scale = 10 ** decimals
  return Math.floor(q * scale + 1e-6) / scale
}
/** Whether any account holds the instrument, priced or not. */
const heldAnywhere = (input: RebalanceInput, pref: PreferredInstrument) =>
  input.positions.some((p) => p.market === pref.market && p.ticker === pref.ticker && p.quantity > 0) ||
  input.lots.some((l) => l.market === pref.market && l.ticker === pref.ticker && l.open_quantity > 0)
const fundingKey = (brokerage: string | null, account: string, currency: string) =>
  `${accountKey(brokerage, account)}|${currency}`

/**
 * The latest per-share price of an instrument, in KRW, with its currency. Taken from a current
 * position (the buy account's own first), else from an open lot. An instrument held nowhere has no
 * price, and the engine does not buy it.
 */
export function buyPrice(input: RebalanceInput, pref: PreferredInstrument): { priceKrw: number; currency: string } | null {
  const buyKey = accountKey(pref.brokerage, pref.account)
  const own = (p: { brokerage: string | null; account: string }) => (accountKey(p.brokerage, p.account) === buyKey ? 0 : 1)
  const positions = input.positions
    .filter((p) => p.market === pref.market && p.ticker === pref.ticker && p.valueKrw != null && p.valueKrw > 0 && p.quantity > 0)
    .sort((a, b) => own(a) - own(b))
  if (positions.length) return { priceKrw: Number(positions[0].valueKrw) / positions[0].quantity, currency: positions[0].currency }
  const fx = (currency: string) => (currency === 'KRW' ? 1 : currency === 'USD' ? input.usdKrwRate : null)
  const lots = input.lots
    .filter(
      (l) =>
        l.market === pref.market &&
        l.ticker === pref.ticker &&
        l.native_market_value != null &&
        l.native_market_value > 0 &&
        l.open_quantity > 0 &&
        fx(l.currency) != null
    )
    .sort((a, b) => own(a) - own(b) || a.id - b.id)
  if (!lots.length) return null
  const l = lots[0]
  return { priceKrw: (Number(l.native_market_value) / l.open_quantity) * Number(fx(l.currency)), currency: l.currency }
}

type BuyTarget = {
  id: string
  sleeve: Sleeve
  pref: PreferredInstrument
  amountKrw: number
  priceKrw: number
  currency: string
  decimals: number
}

export type BuyPlan = {
  buys: Instruction[]
  transfers: Instruction[]
  warnings: EngineWarning[]
  /** Buys left out for being below minTradeKrw or less than one tradable unit. */
  droppedIds: string[]
}

/**
 * Buys for every sleeve the band moves raise, funded per (account, currency). Steps: split each
 * sleeve's amount equally over its preferred instruments; keep the cash floor by scaling every buy
 * down; round to what the account can trade; drop buys below the minimum trade; fund buys in plan
 * order from that account's cash and sale proceeds in the same currency, the unfunded part becoming
 * one transfer per (account, currency).
 *
 * Cap sales in a sleeve that is also being raised are netted: that sleeve buys the band move plus
 * what the cap sold, from preferred instruments other than the capped ones, so it ends where the
 * band move wanted it.
 */
export function planBuys(args: {
  input: RebalanceInput
  policy: AllocationPolicy
  /** Band moves; a positive amount raises the sleeve. */
  moves: SleeveMove[]
  /** The plan's final sells. */
  sells: Instruction[]
  capExcess: CapExcess[]
  skip: Set<string>
  cashSleeveKrw: number
  totalKrw: number
}): BuyPlan {
  const { input, policy, sells, skip } = args
  const warnings: EngineWarning[] = []
  const minTradeKrw = policy.bounds.minTradeKrw

  // 1. Targets: each raised sleeve's amount, split equally over its buy list.
  const targets = new Map<string, BuyTarget>()
  for (const sleeve of SLEEVES) {
    if (sleeve === 'cash') continue
    const move = args.moves.find((m) => m.sleeve === sleeve && m.amountKrw > 0)
    if (!move) continue
    const capSold = sells.filter((s) => s.sleeve === sleeve).reduce((sum, s) => sum + s.estimatedKrw, 0)
    const capped = new Set(args.capExcess.filter((c) => c.sleeve === sleeve).map((c) => instrumentKey(c.market, c.ticker)))
    const list = (policy.preferredInstruments[sleeve] ?? []).filter((p) => !capped.has(instrumentKey(p.market, p.ticker)))
    if (!list.length) {
      warnings.push({ code: 'no_buy_list', message: `no buy list for ${sleeve}` })
      continue
    }
    const each = (move.amountKrw + capSold) / list.length
    for (const pref of list) {
      const id = buyInstructionId(pref.brokerage, pref.account, pref.market, pref.ticker)
      if (skip.has(id)) continue
      const rule = policy.accounts[accountKey(pref.brokerage, pref.account)] ?? defaultAccountRule(pref.market)
      if (rule.managedBy) {
        warnings.push({
          code: 'managed_account',
          ticker: pref.ticker,
          brokerage: pref.brokerage,
          account: pref.account,
          message: `${pref.ticker} on the ${sleeve} buy list is in an account managed by ${rule.managedBy}, so it is not bought`,
        })
        continue
      }
      const block = input.washSaleBlockedBuys.find((b) => b.ticker === pref.ticker && b.blockedThrough >= input.asOf)
      if (block) {
        warnings.push({
          code: 'wash_sale_block',
          ticker: pref.ticker,
          brokerage: pref.brokerage,
          account: pref.account,
          message: `${pref.ticker} cannot be bought through ${block.blockedThrough}: a loss on it was realized within the wash-sale window`,
        })
        continue
      }
      const price = buyPrice(input, pref)
      if (!price) {
        warnings.push({
          code: 'no_buy_price',
          ticker: pref.ticker,
          brokerage: pref.brokerage,
          account: pref.account,
          message: heldAnywhere(input, pref)
            ? `${pref.ticker} has no current price, so it has no price to buy at`
            : `${pref.ticker} is not held anywhere, so it has no price to buy at`,
        })
        continue
      }
      const existing = targets.get(id)
      if (existing) {
        existing.amountKrw += each
        continue
      }
      targets.set(id, {
        id,
        sleeve,
        pref,
        amountKrw: each,
        priceKrw: price.priceKrw,
        currency: price.currency,
        decimals: rule.fractional ? (pref.market === 'CRYPTO' ? 8 : 6) : 0,
      })
    }
  }

  // 2. Cash floor: cash after the plan stays at or above the cash sleeve's minimum.
  const sellsKrw = sells.reduce((sum, s) => sum + s.estimatedKrw, 0)
  const buysKrw = [...targets.values()].reduce((sum, t) => sum + t.amountKrw, 0)
  const floorKrw = ((policy.bounds.sleeves.cash?.min ?? 0) / 100) * args.totalKrw
  const budget = args.cashSleeveKrw + sellsKrw - floorKrw
  if (buysKrw > 0 && buysKrw > budget + KRW_EPS) {
    const f = Math.max(budget, 0) / buysKrw
    for (const t of targets.values()) t.amountKrw *= f
    warnings.push({
      code: 'cash_floor',
      message: `buys scaled from ${fmtKrwAmount(buysKrw)} to ${fmtKrwAmount(Math.max(budget, 0))} KRW to keep cash at the ${policy.bounds.sleeves.cash?.min ?? 0}% floor`,
    })
  }

  // 3. Round to tradable units, dropping what falls below the minimum trade.
  const droppedIds: string[] = []
  type Buy = BuyTarget & { quantity: number; costKrw: number }
  const sized = (t: BuyTarget, quantity: number): Buy => ({ ...t, quantity, costKrw: quantity * t.priceKrw })
  const tooSmall = (b: Buy) => !(b.quantity > 0) || b.costKrw < minTradeKrw
  const buys: Buy[] = []
  for (const t of targets.values()) {
    const b = sized(t, roundDown(t.amountKrw / t.priceKrw, t.decimals))
    if (tooSmall(b)) droppedIds.push(b.id)
    else buys.push(b)
  }

  // 4. Funding per (account, currency): cash (unless excluded) plus this plan's sale proceeds there.
  const available = new Map<string, number>()
  const add = (key: string, krw: number) => available.set(key, (available.get(key) ?? 0) + krw)
  for (const row of input.cash) {
    if (row.krw == null) continue
    const rule = policy.accounts[accountKey(row.brokerage, row.account)] ?? defaultAccountRule('')
    if (rule.excludedCash) continue
    add(fundingKey(row.brokerage, row.account, row.currency), row.krw)
  }
  for (const s of sells) add(fundingKey(s.brokerage, s.account, s.currency), s.estimatedKrw)

  const shortfalls = new Map<string, { brokerage: string | null; account: string; currency: string; krw: number }>()
  const funded: Buy[] = []
  for (const buy of buys) {
    const { brokerage, account } = buy.pref
    const key = fundingKey(brokerage, account, buy.currency)
    const onHand = Math.max(available.get(key) ?? 0, 0)
    if (buy.costKrw <= onHand + KRW_EPS) {
      available.set(key, onHand - buy.costKrw)
      funded.push(buy)
      continue
    }
    const transferId = transferInstructionId(brokerage, account, buy.currency)
    if (skip.has(transferId)) {
      // No transfer: the buy is cut to the cash on hand.
      const cut = sized(buy, roundDown(onHand / buy.priceKrw, buy.decimals))
      warnings.push({
        code: 'transfer_needed',
        brokerage,
        account,
        currency: buy.currency,
        message: `${account}: the ${buy.currency} transfer is skipped, so its buys are cut to the cash on hand`,
      })
      if (tooSmall(cut)) {
        droppedIds.push(cut.id)
        continue
      }
      available.set(key, onHand - cut.costKrw)
      funded.push(cut)
      continue
    }
    available.set(key, 0)
    const entry = shortfalls.get(transferId) ?? { brokerage, account, currency: buy.currency, krw: 0 }
    entry.krw += buy.costKrw - onHand
    shortfalls.set(transferId, entry)
    funded.push(buy)
  }

  // Stale buys carry the note; the engine raises the stale_account warning per account.
  const buyInstructions = funded.map((b): Instruction => {
    const stale = staleAccount({ input, policy }, accountKey(b.pref.brokerage, b.pref.account))
    return {
      id: b.id,
      kind: 'buy',
      sleeve: b.sleeve,
      brokerage: b.pref.brokerage,
      account: b.pref.account,
      market: b.pref.market,
      ticker: b.pref.ticker,
      currency: b.currency,
      lotIds: [],
      lots: [],
      quantity: roundQty(b.quantity),
      estimatedKrw: b.costKrw,
      gainKrw: null,
      usGainUsd: null,
      holdingBucket: null,
      tier: null,
      notes: stale ? [STALE_NOTE] : [],
    }
  })

  const transfers: Instruction[] = []
  for (const [id, t] of shortfalls) {
    const native = t.currency === 'USD' && input.usdKrwRate > 0 ? t.krw / input.usdKrwRate : t.krw
    transfers.push({
      id,
      kind: 'transfer',
      sleeve: 'cash',
      brokerage: t.brokerage,
      account: t.account,
      market: '',
      ticker: '',
      currency: t.currency,
      lotIds: [],
      lots: [],
      quantity: Math.round(native * 100) / 100,
      estimatedKrw: t.krw,
      gainKrw: null,
      usGainUsd: null,
      holdingBucket: null,
      tier: null,
      notes: [],
    })
    warnings.push({
      code: 'transfer_needed',
      brokerage: t.brokerage,
      account: t.account,
      currency: t.currency,
      message: `${t.account} needs ${fmtKrwAmount(t.krw)} KRW more of ${t.currency} cash for its buys`,
    })
  }

  return { buys: buyInstructions, transfers, warnings, droppedIds }
}
