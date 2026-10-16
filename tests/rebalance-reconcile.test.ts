import assert from 'node:assert/strict'
import test from 'node:test'
import { reconcile, type TxRow } from '../lib/rebalance/reconcile'
import type { Fill, Proposal } from '../lib/rebalance/proposal-store'
import type { Instruction } from '../lib/rebalance/engine'

const ins = (id: string, kind: 'buy' | 'sell' | 'transfer', ticker: string, quantity: number, account = 'acct-1'): Instruction =>
  ({ id, kind, sleeve: 'us_equity', brokerage: 'BrokerA', account, market: 'US', ticker, currency: 'USD', lotIds: [], lots: [], quantity, estimatedKrw: 1000 }) as unknown as Instruction

const fill = (instructionId: string, quantity: number, date: string): Fill => ({ instructionId, status: 'executed', quantity, price: 10, date, note: '' })

function proposal(instructions: Instruction[], fills: Record<string, Fill>): Proposal {
  return {
    id: 'rb-test',
    status: 'executing',
    createdAt: '2026-10-10T09:00:00.000Z',
    plan: { moves: [], instructions, warnings: [], taxSummary: {} },
    fills,
  } as unknown as Proposal
}

const tx = (ticker: string, type: string, date: string, quantity: number, account = 'acct-1'): TxRow => ({
  brokerage: 'BrokerA',
  account,
  market: 'US',
  ticker,
  type,
  date,
  quantity,
})

const TODAY = '2026-10-20'

test('matched within 3 days and 1%', () => {
  const p = proposal([ins('sell:a:US:AAA', 'sell', 'AAA', 100)], { 'sell:a:US:AAA': fill('sell:a:US:AAA', 100, '2026-10-12') })
  const r = reconcile(p, [tx('AAA', 'sell', '2026-10-15', 100.9)], TODAY)
  assert.deepEqual(r.matched, [{ instructionId: 'sell:a:US:AAA', txDate: '2026-10-15' }])
  assert.deepEqual(r.missing, [])
  assert.equal(r.complete, true)
  const late = reconcile(p, [tx('AAA', 'SELL', '2026-10-16', 100)], TODAY)
  assert.equal(late.complete, false)
  assert.equal(late.unplanned.length, 1)
  const qty = reconcile(p, [tx('AAA', 'SELL', '2026-10-12', 102)], TODAY)
  assert.equal(qty.complete, false)
  // within one share even when above 1%
  const small = proposal([ins('buy:a:US:BBB', 'buy', 'BBB', 10)], { 'buy:a:US:BBB': fill('buy:a:US:BBB', 10, '2026-10-12') })
  assert.equal(reconcile(small, [tx('BBB', 'BUY', '2026-10-12', 10.9)], TODAY).complete, true)
})

test('missing after a fill with no tx', () => {
  const p = proposal([ins('sell:a:US:AAA', 'sell', 'AAA', 100)], { 'sell:a:US:AAA': fill('sell:a:US:AAA', 100, '2026-10-12') })
  const r = reconcile(p, [], TODAY)
  assert.deepEqual(r.missing, [{ instructionId: 'sell:a:US:AAA', daysSinceFill: 8 }])
  assert.equal(r.complete, false)
  assert.equal(r.at.length > 0, true)
})

test('transfers and skipped fills are not matched or counted', () => {
  const p = proposal(
    [ins('transfer:a:USD', 'transfer', 'USD', 0), ins('sell:a:US:AAA', 'sell', 'AAA', 5)],
    {
      'transfer:a:USD': fill('transfer:a:USD', 0, '2026-10-12'),
      'sell:a:US:AAA': { instructionId: 'sell:a:US:AAA', status: 'skipped', quantity: null, price: null, date: null, note: 'n' },
    }
  )
  const r = reconcile(p, [], TODAY)
  assert.deepEqual(r.matched, [])
  assert.deepEqual(r.missing, [])
  assert.equal(r.complete, true)
})

test('unplanned lists other trades in plan accounts', () => {
  const p = proposal([ins('sell:a:US:AAA', 'sell', 'AAA', 100)], { 'sell:a:US:AAA': fill('sell:a:US:AAA', 100, '2026-10-12') })
  const r = reconcile(
    p,
    [
      tx('AAA', 'SELL', '2026-10-12', 100),
      tx('ZZZ', 'BUY', '2026-10-13', 3), // plan account, not planned
      tx('YYY', 'BUY', '2026-10-13', 3, 'other-acct'), // account not in the plan
      tx('OLD', 'BUY', '2026-10-09', 3), // before createdAt
      tx('DIV', 'DIVIDEND', '2026-10-13', 1), // not a trade
    ],
    TODAY
  )
  assert.deepEqual(r.unplanned.map((t) => t.ticker), ['ZZZ'])
  assert.equal(r.complete, true)
})

test('one tx cannot match two instructions', () => {
  const p = proposal(
    [ins('sell:a:US:AAA', 'sell', 'AAA', 100), ins('sell:b:US:AAA', 'sell', 'AAA', 100)],
    { 'sell:a:US:AAA': fill('sell:a:US:AAA', 100, '2026-10-12'), 'sell:b:US:AAA': fill('sell:b:US:AAA', 100, '2026-10-12') }
  )
  const r = reconcile(p, [tx('AAA', 'SELL', '2026-10-12', 100)], TODAY)
  assert.equal(r.matched.length, 1)
  assert.equal(r.missing.length, 1)
  assert.equal(r.complete, false)
})

test('a plan with an unfilled buy or sell is not complete', () => {
  const p = proposal(
    [ins('sell:a:US:AAA', 'sell', 'AAA', 100), ins('buy:a:US:BBB', 'buy', 'BBB', 10)],
    { 'sell:a:US:AAA': fill('sell:a:US:AAA', 100, '2026-10-12') }
  )
  const r = reconcile(p, [tx('AAA', 'SELL', '2026-10-12', 100)], TODAY, new Date('2026-10-20T00:00:00Z'))
  assert.equal(r.matched.length, 1)
  assert.deepEqual(r.missing, [])
  assert.deepEqual(r.unfilled, ['buy:a:US:BBB'])
  assert.equal(r.complete, false)
  assert.equal(r.at, '2026-10-20T00:00:00.000Z')
})
