import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { RebalanceInput } from '../lib/adapters/rebalance-input'
import { readBriefingContext } from '../lib/adapters/rebalance-context'
import { buildLlmInput } from '../lib/rebalance/llm-input'
import type { AllocationPolicy } from '../lib/rebalance/allocation-policy'
import type { RebalancePosition } from '../lib/rebalance/allocation'
import type { InstrumentClasses } from '../lib/rebalance/instrument-classes'
import type { Proposal } from '../lib/rebalance/proposal-store'
import type { TaxPlanningLot } from '../lib/tax-planning'
import type { TaxPolicy } from '../lib/tax-policy'

const policy = (): AllocationPolicy => {
  const raw = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'allocation-policy.example.json'), 'utf8'))
  for (const key of Object.keys(raw)) if (key.startsWith('_')) delete raw[key]
  return raw as AllocationPolicy
}
const taxPolicy = (): TaxPolicy =>
  JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'tax-policy.example.json'), 'utf8')) as TaxPolicy

const pos = (over: Partial<RebalancePosition>): RebalancePosition => ({
  brokerage: 'Secret Broker',
  account: 'ACC-123',
  market: 'US',
  currency: 'USD',
  ticker: 'AAA',
  name: 'Alpha',
  asset_class: 'stock',
  quantity: 1,
  valueKrw: 1000,
  costKrw: 800,
  dataAsOf: null,
  ...over,
})
const lot = (over: Partial<TaxPlanningLot>): TaxPlanningLot => ({
  id: 1,
  market: 'KR',
  currency: 'KRW',
  brokerage: 'Secret Broker',
  account: 'ACC-123',
  ticker: 'KRX1',
  name: 'Kr One',
  acquired_date: '2025-01-01',
  open_quantity: 1,
  native_cost_basis: 1000,
  native_market_value: 700,
  native_unrealized_gl: -300,
  cost_basis_krw: 1000,
  holding_days: 400,
  tax_term: 'long',
  account_wrapper: 'taxable',
  ...over,
})
const classes: InstrumentClasses = { 'US:AAA': 'us_equity', 'US:BBB': 'us_equity', 'KR:KRX1': 'kr_equity' }

const input = (over: Partial<RebalanceInput> = {}): RebalanceInput => ({
  asOf: '2026-10-15',
  usdKrwRate: 1000,
  positions: [
    pos({ ticker: 'AAA', valueKrw: 600 }),
    pos({ ticker: 'BBB', brokerage: 'Other Broker', account: 'ZZ-9', valueKrw: 200 }),
    pos({ ticker: 'UNKNOWN', valueKrw: 50 }),
    pos({ market: 'KR', currency: 'KRW', ticker: 'KRX1', name: 'N'.repeat(100), valueKrw: 200 }),
  ],
  cash: [],
  lots: [lot({})],
  recentBuys: [],
  washSaleBlockedBuys: [],
  accountDataAsOf: {},
  ytd: { year: 2026, krTaxableGainKrw: 500_000, usShortUsd: 10, usLongUsd: 20, lotCount: 1 },
  healthErrors: [],
  ...over,
})

const empty = { macro: [], benchmarks: null }
const build = (over: Partial<Parameters<typeof buildLlmInput>[0]> = {}) =>
  buildLlmInput({ input: input(), policy: policy(), classes, taxPolicy: taxPolicy(), context: empty, past: [], ...over })

test('no account label, brokerage name or account number appears anywhere in the serialized input', () => {
  const text = JSON.stringify(build())
  for (const secret of ['Secret Broker', 'Other Broker', 'ACC-123', 'ZZ-9']) assert.ok(!text.includes(secret), secret)
})

test('aliases are stable and numbered by sorted accountKey per market', () => {
  const out = build()
  const byTicker = Object.fromEntries(out.positions.map((p) => [p.ticker, p.alias]))
  // 'Other Broker::ZZ-9' sorts before 'Secret Broker::ACC-123'.
  assert.equal(byTicker.BBB, 'US-taxable-1')
  assert.equal(byTicker.AAA, 'US-taxable-2')
  assert.equal(byTicker.KRX1, 'KR-taxable-1')
  const reversed = build({ input: input({ positions: [...input().positions].reverse() }) })
  assert.deepEqual(
    Object.fromEntries(reversed.positions.map((p) => [p.ticker, p.alias])),
    byTicker,
  )
  const crypto = build({
    input: input({ positions: [pos({ market: 'CRYPTO', ticker: 'BTC', asset_class: 'crypto', account: 'w2' }), pos({ market: 'CRYPTO', ticker: 'ETH', asset_class: 'crypto', account: 'w1' })] }),
  })
  assert.deepEqual(
    Object.fromEntries(crypto.positions.map((p) => [p.ticker, p.alias])),
    { BTC: 'CRYPTO-2', ETH: 'CRYPTO-1' },
  )
})

test('positions are classified-only with pct of total', () => {
  const out = build()
  assert.deepEqual(out.positions.map((p) => p.ticker).sort(), ['AAA', 'BBB', 'KRX1'])
  const aaa = out.positions.find((p) => p.ticker === 'AAA')!
  assert.equal(aaa.sleeve, 'us_equity')
  assert.ok(Math.abs(aaa.pctOfTotal - 60) < 1e-9)
  assert.equal(out.positions.find((p) => p.ticker === 'KRX1')!.name.length, 80)
  assert.equal(out.allocation.length, 6)
  assert.equal(out.tax.krDeductionRemainingKrw, 2_000_000)
  assert.equal(out.tax.ytdKrTaxableGainKrw, 500_000)
  assert.equal(out.tax.harvestableLossKrw, 300)
})

const proposal = (id: string, createdAt: string, over: Partial<Proposal> = {}): Proposal =>
  ({
    id,
    status: 'closed',
    createdAt,
    targetChange: { decision: 'hold', sleeves: {}, boundsErrors: [] },
    events: [],
    ...over,
  }) as unknown as Proposal

test('pastDecisions takes the 3 newest and carries a rejection reason', () => {
  const past = [
    proposal('p1', '2026-06-01T00:00:00Z'),
    proposal('p4', '2026-09-01T00:00:00Z', {
      status: 'rejected',
      targetChange: { decision: 'change', sleeves: { gold: { from: 5, to: 8, reason: 'x', editedBy: 'maintainer' } }, boundsErrors: [] },
      events: [{ at: 'a', type: 'rejected', detail: 'too aggressive' }],
    }),
    proposal('p2', '2026-07-01T00:00:00Z'),
    proposal('p3', '2026-08-01T00:00:00Z'),
  ]
  const out = build({ past }).pastDecisions
  assert.deepEqual(out.map((p) => p.id), ['p4', 'p3', 'p2'])
  assert.equal(out[0].rejectedReason, 'too aggressive')
  assert.equal(out[0].editedByMaintainer, true)
  assert.deepEqual(out[0].sleeves, { gold: { from: 5, to: 8 } })
  assert.equal(out[1].rejectedReason, null)
  assert.ok(!JSON.stringify(out).includes('"reason":"x"'))
})

const archive = () => mkdtempSync(path.join(tmpdir(), 'rb-archive-'))
const day = (dir: string, date: string, macro: string, schemaVersion = 2) =>
  writeFileSync(path.join(dir, `${date}.json`), JSON.stringify({ schemaVersion, date, narrative: { macro } }))

test('missing archive yields empty macro context', () => {
  assert.deepEqual(readBriefingContext('2026-10-15', 30, path.join(tmpdir(), 'rb-no-such-dir-xyz')), { macro: [], benchmarks: null })
})

test('readBriefingContext keeps only the last N days and skips unreadable days', () => {
  const dir = archive()
  day(dir, '2026-08-01', 'too old')
  day(dir, '2026-10-01', 'in window')
  day(dir, '2026-10-10', 'newer')
  day(dir, '2026-10-12', 'future schema', 99)
  writeFileSync(path.join(dir, '2026-10-13.json'), '{not json')
  writeFileSync(path.join(dir, 'notes.json'), '{}')
  mkdirSync(path.join(dir, 'sub'))
  assert.deepEqual(readBriefingContext('2026-10-15', 30, dir), {
    macro: [
      { date: '2026-10-01', macro: 'in window' },
      { date: '2026-10-10', macro: 'newer' },
    ],
    benchmarks: null,
  })
  writeFileSync(path.join(dir, 'benchmarks.json'), JSON.stringify({ spx: 1 }))
  assert.deepEqual(readBriefingContext('2026-10-15', 7, dir).benchmarks, { spx: 1 })
  writeFileSync(path.join(dir, 'benchmarks.json'), 'garbage')
  assert.equal(readBriefingContext('2026-10-15', 7, dir).benchmarks, null)
})
