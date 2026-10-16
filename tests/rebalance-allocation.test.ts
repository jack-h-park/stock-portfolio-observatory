import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { accountKey, type AllocationPolicy } from '../lib/rebalance/allocation-policy'
import {
  computeAllocation,
  type RebalanceCash,
  type RebalancePosition,
} from '../lib/rebalance/allocation'
import {
  classify,
  getInstrumentClasses,
  instrumentKey,
  saveInstrumentClasses,
  type InstrumentClasses,
} from '../lib/rebalance/instrument-classes'

const policy = (): AllocationPolicy => {
  const raw = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'allocation-policy.example.json'), 'utf8'))
  for (const key of Object.keys(raw)) if (key.startsWith('_')) delete raw[key]
  return raw as AllocationPolicy
}

const pos = (over: Partial<RebalancePosition>): RebalancePosition => ({
  brokerage: 'BrokerA',
  account: 'acct-1',
  market: 'US',
  currency: 'USD',
  ticker: 'AAA',
  name: 'Alpha',
  asset_class: 'stock',
  quantity: 1,
  valueKrw: 100,
  costKrw: 80,
  dataAsOf: null,
  ...over,
})

const cashRow = (over: Partial<RebalanceCash> = {}): RebalanceCash => ({
  brokerage: 'BrokerA',
  account: 'acct-1',
  currency: 'KRW',
  balance: 100,
  krw: 100,
  asOf: '2026-01-01',
  ...over,
})

const classes: InstrumentClasses = { 'US:AAA': 'us_equity', 'KR:KRX1': 'kr_equity', 'KR:KRBOND1': 'bonds' }

test('instrument classes round-trip and a missing file is empty', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'instrument-classes-')), 'c.json')
  assert.deepEqual(getInstrumentClasses(file), {})
  saveInstrumentClasses(classes, file)
  assert.deepEqual(getInstrumentClasses(file), classes)
  assert.equal(instrumentKey('US', 'AAA'), 'US:AAA')
})

test('gold and crypto classify without a mapping', () => {
  assert.equal(classify({ market: 'KR', ticker: 'G1', asset_class: 'gold' }, {}), 'gold')
  assert.equal(classify({ market: 'CRYPTO', ticker: 'BTC', asset_class: 'crypto' }, {}), 'crypto')
  assert.equal(classify({ market: 'US', ticker: 'AAA', asset_class: 'stock' }, classes), 'us_equity')
  assert.equal(classify({ market: 'US', ticker: 'ZZZ', asset_class: 'stock' }, classes), null)
})

test('an unmapped security is unclassified and excluded from totals', () => {
  const unknown = pos({ ticker: 'ZZZ', valueKrw: 500 })
  const a = computeAllocation({ positions: [pos({}), unknown], cash: [] }, policy(), classes)
  assert.equal(a.totalKrw, 100)
  assert.deepEqual(a.unclassified, [unknown])
  for (const list of Object.values(a.positionsBySleeve)) assert.ok(!list.includes(unknown))
})

test('value uses market value, cost when unpriced, and lists unpriced', () => {
  const priced = pos({ valueKrw: 100 })
  const unpriced = pos({ ticker: 'KRX1', market: 'KR', valueKrw: null, costKrw: 40 })
  const a = computeAllocation({ positions: [priced, unpriced], cash: [] }, policy(), classes)
  assert.equal(a.totalKrw, 140)
  assert.deepEqual(a.unpriced, [unpriced])
  assert.equal(a.sleeves.find((s) => s.sleeve === 'kr_equity')?.valueKrw, 40)
  assert.deepEqual(a.positionsBySleeve.kr_equity, [unpriced])
})

test('cash in excludedCash accounts is left out', () => {
  const p = policy()
  p.accounts[accountKey('BrokerA', 'acct-2')] = { lotMethod: 'fifo', fractional: false, managedBy: null, excludedCash: true }
  const a = computeAllocation(
    { positions: [], cash: [cashRow(), cashRow({ account: 'acct-2', krw: 900 })] },
    p,
    classes,
  )
  assert.equal(a.totalKrw, 100)
  assert.equal(a.sleeves.find((s) => s.sleeve === 'cash')?.valueKrw, 100)
})

test('cash with unknown krw is left out', () => {
  const a = computeAllocation({ positions: [], cash: [cashRow(), cashRow({ krw: null })] }, policy(), classes)
  assert.equal(a.totalKrw, 100)
})

test('status uses target±band', () => {
  const p = policy()
  const run = (pct: number) => {
    const a = computeAllocation(
      {
        positions: [pos({ valueKrw: pct }), pos({ ticker: 'KRX1', market: 'KR', valueKrw: 100 - pct })],
        cash: [],
      },
      p,
      classes,
    )
    return a.sleeves.find((s) => s.sleeve === 'us_equity')!
  }
  p.targets.us_equity = { target: 45, band: 5 }
  const above = run(51)
  assert.equal(above.status, 'above')
  assert.equal(above.lower, 40)
  assert.equal(above.upper, 50)
  assert.equal(run(40).status, 'within')
  assert.equal(run(39).status, 'below')
  assert.equal(run(50).status, 'within')
})

test('percentages sum to 100 over classified value', () => {
  const a = computeAllocation(
    {
      positions: [pos({ valueKrw: 300 }), pos({ ticker: 'KRX1', market: 'KR', valueKrw: 200 }), pos({ ticker: 'ZZZ', valueKrw: 999 })],
      cash: [cashRow()],
    },
    policy(),
    classes,
  )
  assert.equal(a.totalKrw, 600)
  const sum = a.sleeves.reduce((s, r) => s + r.pct, 0)
  assert.ok(Math.abs(sum - 100) < 1e-9)
})
