import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { RebalanceInput } from '../lib/adapters/rebalance-input'
import { readBriefingContext, sanitizeBenchmarks } from '../lib/adapters/rebalance-context'
import { buildLlmInput, scrubText } from '../lib/rebalance/llm-input'
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
  writeFileSync(path.join(dir, 'benchmarks.json'), JSON.stringify({ SPX: [{ date: '2026-10-01', close: 5000 }] }))
  assert.deepEqual(readBriefingContext('2026-10-15', 7, dir).benchmarks, { SPX: [{ date: '2026-10-01', close: 5000 }] })
  writeFileSync(path.join(dir, 'benchmarks.json'), 'garbage')
  assert.equal(readBriefingContext('2026-10-15', 7, dir).benchmarks, null)
})

const dirty = 'Secret Broker acct ACC-123 id 1234567890 on 2026-10-01 level 2,450.5 usd 1350 phone 010-1234-5678'
const mustGo = ['Secret Broker', 'ACC-123', '1234567890', '010-1234-5678']
const mustStay = ['2026-10-01', '2,450.5', '1350']

test('free text is scrubbed of secrets and account-like numbers and capped', () => {
  const past = [
    proposal('r', '2026-09-01T00:00:00Z', { status: 'rejected', events: [{ at: 'a', type: 'rejected', detail: dirty }] as never }),
    proposal('long', '2026-08-01T00:00:00Z', { status: 'rejected', events: [{ at: 'a', type: 'rejected', detail: 'x'.repeat(900) }] as never }),
  ]
  const out = build({
    past,
    context: { macro: [{ date: '2026-10-01', macro: dirty }, { date: '2026-10-02', macro: 'y'.repeat(5000) }], benchmarks: null },
  })
  const text = JSON.stringify(out)
  for (const s of mustGo) assert.ok(!text.includes(s), s)
  for (const s of mustStay) assert.ok(out.pastDecisions[0].rejectedReason!.includes(s) && out.context.macro[0].macro.includes(s), s)
  assert.equal(out.pastDecisions[1].rejectedReason!.length, 500)
  assert.equal(out.context.macro[1].macro.length, 2000)
})

test('security names are scrubbed before truncation', () => {
  const out = build({ input: input({ positions: [pos({ ticker: 'AAA', name: 'Fund Secret Broker 1234567890' })] }) })
  assert.ok(!out.positions[0].name.includes('Secret Broker'))
  assert.ok(!out.positions[0].name.includes('1234567890'))
})

test('benchmarks are shape-checked and bounded', () => {
  const series = (n: number) => Array.from({ length: n }, (_, i) => ({ date: '2026-01-01', close: i }))
  const raw: Record<string, unknown> = { SPX: series(200), 'bad key!': series(3), ODD: 'x', NOCLOSE: [{ date: '2026-01-01', close: 'n' }] }
  for (let i = 0; i < 30; i++) raw[`S${i}`] = series(2)
  const out = sanitizeBenchmarks(raw)!
  assert.equal(Object.keys(out).length, 20)
  assert.equal(out.SPX.length, 120)
  assert.ok(!('bad key!' in out) && !('ODD' in out) && !('NOCLOSE' in out))
  assert.equal(sanitizeBenchmarks([1]), null)
  assert.equal(sanitizeBenchmarks('x'), null)
  assert.equal(sanitizeBenchmarks({ a: 1 }), null)
  assert.equal(build({ context: { macro: [], benchmarks: { note: 'Secret Broker' } } }).context.benchmarks, null)
})

test('briefing window includes today and excludes today minus N', () => {
  const dir = archive()
  day(dir, '2026-09-15', 'edge out')
  day(dir, '2026-09-16', 'edge in')
  day(dir, '2026-10-15', 'today')
  day(dir, '2026-10-16', 'future')
  assert.deepEqual(readBriefingContext('2026-10-15', 30, dir).macro.map((m) => m.date), ['2026-09-16', '2026-10-15'])
})

test('the newest of two rejected events wins; unpriced lots add no harvestable loss', () => {
  const past = [
    proposal('p', '2026-09-01T00:00:00Z', {
      status: 'rejected',
      events: [
        { at: 'a', type: 'rejected', detail: 'first' },
        { at: 'b', type: 'rejected', detail: 'second' },
      ] as never,
    }),
  ]
  assert.equal(build({ past }).pastDecisions[0].rejectedReason, 'second')
  const unpriced = lot({ id: 2, ticker: 'KRX1', native_market_value: null, native_unrealized_gl: null })
  assert.equal(build({ input: input({ lots: [lot({}), unpriced] }) }).tax.harvestableLossKrw, 300)
})

test('digit groups split by spaces or dashes are redacted, dates and figures survive', () => {
  for (const leak of ['1234 5678 9012', '1234-5678-9012', '123 456 789012']) {
    const out = scrubText(`acct ${leak} end`, [])
    assert.ok(!/\d{3}/.test(out.replace('end', '')), `${leak} -> ${out}`)
  }
  const kept = scrubText('on 2026-10-01 and 2026-10-02 the index hit 2,450.5 at 1350 in 2026, up 12345678.5', [])
  assert.equal(kept, 'on 2026-10-01 and 2026-10-02 the index hit 2,450.5 at 1350 in 2026, up 12345678.5')
})

test('short or embedded ASCII secrets do not over-redact', () => {
  assert.equal(scrubText('The market was a bit flat', ['a', '12']), 'The market was a bit flat')
  assert.equal(scrubText('closed 2026-10-12', ['12']), 'closed 2026-10-12')
  assert.equal(scrubText('the Broker1234 rally', ['Broker']), 'the Broker1234 rally')
  assert.equal(scrubText('via Broker today', ['Broker']), 'via [redacted] today')
  assert.equal(scrubText('계좌 한국증권사 확인', ['한국증권사']), '계좌 [redacted] 확인')
})
