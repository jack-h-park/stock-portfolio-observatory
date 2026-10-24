import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import type { RebalanceInput } from '../lib/adapters/rebalance-input'
import type { AllocationPolicy } from '../lib/rebalance/allocation-policy'
import type { RebalancePosition } from '../lib/rebalance/allocation'
import type { InstrumentClasses } from '../lib/rebalance/instrument-classes'
import type { TaxPlanningLot } from '../lib/tax-planning'
import type { TaxPolicy } from '../lib/tax-policy'

// Everything that reads @/config is imported dynamically, after these are set.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-triggers-'))
const dbPath = path.join(root, 'portfolio.db')
const policyPath = path.join(root, 'allocation-policy.json')
const classesPath = path.join(root, 'instrument-classes.json')
const proposalsDir = path.join(root, 'proposals')
const statePath = path.join(root, 'trigger-state.json')
const lockPath = path.join(root, '.refresh.lock')
process.env.STOCK_REBALANCE_PROPOSALS_DIR = proposalsDir
process.env.STOCK_ALLOCATION_POLICY_PATH = policyPath
process.env.STOCK_INSTRUMENT_CLASSES_PATH = classesPath
process.env.STOCK_DB_PATH = dbPath
process.env.STOCK_REBALANCE_TRIGGER_STATE_PATH = statePath
process.env.STOCK_REFRESH_LOCK_PATH = lockPath

const M = 1_000_000
const examplePolicy = (): AllocationPolicy => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'allocation-policy.example.json'), 'utf8'))
  for (const key of Object.keys(raw)) if (key.startsWith('_')) delete raw[key]
  return raw as AllocationPolicy
}
const taxPolicy = (): TaxPolicy =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'tax-policy.example.json'), 'utf8')) as TaxPolicy

const pos = (market: string, ticker: string, valueKrw: number, account = 'acct-1'): RebalancePosition => ({
  brokerage: 'BrokerA',
  account,
  market,
  currency: market === 'US' ? 'USD' : 'KRW',
  ticker,
  name: ticker,
  asset_class: 'stock',
  quantity: 1,
  valueKrw,
  costKrw: valueKrw,
  dataAsOf: null,
})
const lot = (over: Partial<TaxPlanningLot>): TaxPlanningLot => ({
  id: 1,
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
const classes: InstrumentClasses = {
  'KR:K1': 'kr_equity',
  'KR:K2': 'kr_equity',
  'US:U1': 'us_equity',
  'US:U2': 'us_equity',
  'US:U3': 'us_equity',
  'KR:B': 'bonds',
  'KR:G': 'gold',
  'CRYPTO:C': 'crypto',
}
/** Every sleeve on target, every instrument exactly at the 15% cap: no trigger. */
const basePositions = () => [
  pos('KR', 'K1', 150 * M),
  pos('KR', 'K2', 150 * M),
  pos('US', 'U1', 150 * M),
  pos('US', 'U2', 150 * M),
  pos('US', 'U3', 150 * M),
  pos('KR', 'B', 50 * M),
  pos('KR', 'G', 50 * M),
  pos('CRYPTO', 'C', 50 * M),
]
const input = (over: Partial<RebalanceInput> = {}): RebalanceInput => ({
  asOf: '2026-10-16',
  usdKrwRate: 1350,
  positions: basePositions(),
  cash: [{ brokerage: 'BrokerA', account: 'acct-1', currency: 'KRW', balance: 100 * M, krw: 100 * M, asOf: '2026-10-16' }],
  lots: [],
  recentBuys: [],
  washSaleBlockedBuys: [],
  accountDataAsOf: {},
  ytd: { year: 2026, krTaxableGainKrw: 0, usShortUsd: 0, usLongUsd: 0, lotCount: 0 },
  healthErrors: [],
  ...over,
})
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)

const detect = async (over: Partial<RebalanceInput> = {}, today = '2026-10-16', policy = examplePolicy()) => {
  const { detectTriggers } = await import('../lib/rebalance/triggers')
  return detectTriggers({ input: input(over), policy, classes, taxPolicy: taxPolicy(), today })
}

test('within band gives no band hit', async () => {
  assert.deepEqual(await detect(), [])
})

test('band hit magnitude is distance outside band', async () => {
  const policy = examplePolicy()
  policy.bounds.positionCapPct = 0
  // us_equity 560 of 1000 (upper 50), cash 0 (lower 5), crypto 40 (within 0-10).
  const positions = basePositions().map((p) => (p.ticker === 'U1' ? pos('US', 'U1', 260 * M) : p.ticker === 'C' ? pos('CRYPTO', 'C', 40 * M) : p))
  const hits = await detect({ positions, cash: [] }, '2026-10-16', policy)
  assert.deepEqual(
    hits.map((h) => h.key),
    ['band:us_equity', 'band:cash']
  )
  near(hits[0].magnitude, 6)
  near(hits[1].magnitude, 5)
  assert.equal(hits[0].label, 'us_equity 6.0pp outside band')
  assert.equal(hits[1].label, 'cash 5.0pp outside band')
})

test('cap hit per instrument over cap', async () => {
  // U1 200 of 1000 (cap 150): 5pp. K1 is 80 + 90 across two accounts: the cap limits exposure, 2pp.
  const positions = basePositions().flatMap((p) => {
    if (p.ticker === 'U1') return [pos('US', 'U1', 200 * M)]
    if (p.ticker === 'U2') return [pos('US', 'U2', 100 * M)]
    if (p.ticker === 'K1') return [pos('KR', 'K1', 80 * M), pos('KR', 'K1', 90 * M, 'acct-2')]
    if (p.ticker === 'K2') return [pos('KR', 'K2', 130 * M)]
    return [p]
  })
  const hits = await detect({ positions })
  assert.deepEqual(
    hits.map((h) => h.key),
    ['cap:KR:K1', 'cap:US:U1']
  )
  near(hits[0].magnitude, 2)
  near(hits[1].magnitude, 5)
  assert.equal(hits[1].label, 'US:U1 5.0pp over the position cap')
})

test('harvest fires at threshold and not below; zero threshold disables', async () => {
  const at = await detect({ lots: [lot({})] })
  assert.deepEqual(
    at.map((h) => h.key),
    ['harvest']
  )
  near(at[0].magnitude, 1 * M)
  assert.ok(!/\d/.test(at[0].label), 'the harvest label carries no amount')
  const below = await detect({ lots: [lot({ native_market_value: 2 * M + 1, native_unrealized_gl: -(M - 1) })] })
  assert.deepEqual(below, [])
  const off = examplePolicy()
  off.bounds.harvestThresholdKrw = 0
  assert.deepEqual(await detect({ lots: [lot({})] }, '2026-10-16', off), [])
})

test('harvest ignores lots with a wash-sale conflict', async () => {
  const buy = (market: string, ticker: string, date: string) => ({ market, ticker, brokerage: 'BrokerA', account: 'acct-1', date })
  const lots = [lot({})]
  assert.deepEqual(await detect({ lots, recentBuys: [buy('KR', 'K1', '2026-10-01')] }), [])
  // Older than 30 days, or another market's ticker: no conflict.
  assert.equal((await detect({ lots, recentBuys: [buy('KR', 'K1', '2026-09-15')] })).length, 1)
  assert.equal((await detect({ lots, recentBuys: [buy('US', 'K1', '2026-10-01')] })).length, 1)
  // The LLM input's figure is the same computation.
  const { buildLlmInput } = await import('../lib/rebalance/llm-input')
  const llm = (recentBuys: RebalanceInput['recentBuys']) =>
    buildLlmInput({
      input: input({ lots, recentBuys }),
      policy: examplePolicy(),
      classes,
      taxPolicy: taxPolicy(),
      context: { macro: [], benchmarks: null },
      past: [],
      accountMapPath: null,
    }).tax.harvestableLossKrw
  assert.equal(llm([buy('KR', 'K1', '2026-10-01')]), 0)
  near(llm([]), 1 * M)
})

test('yearend keys fire on/after Nov 15 and Dec 1 once per year', async () => {
  const { dueTriggers, markFired } = await import('../lib/rebalance/trigger-state')
  assert.deepEqual(await detect({}, '2026-11-14'), [])
  assert.deepEqual(
    (await detect({}, '2026-11-15')).map((h) => [h.key, h.magnitude]),
    [['yearend:2026-11-15', 1]]
  )
  const dec = await detect({}, '2026-12-01')
  assert.deepEqual(
    dec.map((h) => h.key),
    ['yearend:2026-11-15', 'yearend:2026-12-01']
  )
  // Fired once: never again that year, even past the 14-day debounce.
  const state = markFired({ version: 1, fired: {} }, dec, '2026-12-01')
  assert.deepEqual(dueTriggers(await detect({}, '2026-12-31'), state, '2026-12-31'), [])
  // The next year's keys are new.
  assert.deepEqual(
    dueTriggers(await detect({}, '2027-11-15'), state, '2027-11-15').map((h) => h.key),
    ['yearend:2027-11-15']
  )
})

test('debounce: refire after 14 days, or earlier on 25% growth', async () => {
  const { dueTriggers, markFired } = await import('../lib/rebalance/trigger-state')
  const hit = (magnitude: number) => ({ key: 'band:cash', magnitude, label: 'x' })
  const state = markFired({ version: 1, fired: {} }, [hit(4)], '2026-10-01')
  assert.deepEqual(state.fired['band:cash'], { at: '2026-10-01', magnitude: 4 })
  assert.equal(dueTriggers([hit(4)], { version: 1, fired: {} }, '2026-10-01').length, 1)
  assert.equal(dueTriggers([hit(4.9)], state, '2026-10-14').length, 0)
  assert.equal(dueTriggers([hit(5)], state, '2026-10-14').length, 1)
  assert.equal(dueTriggers([hit(4)], state, '2026-10-15').length, 1)
  // markFired keeps keys it was not given.
  const next = markFired(state, [{ key: 'harvest', magnitude: 9, label: 'y' }], '2026-10-20')
  assert.deepEqual(Object.keys(next.fired).sort(), ['band:cash', 'harvest'])
})

test('trigger state: missing reads empty, written atomically', async () => {
  const { readTriggerState, writeTriggerState } = await import('../lib/rebalance/trigger-state')
  const file = path.join(root, 'state-rt', 'state.json')
  assert.deepEqual(readTriggerState(file), { version: 1, fired: {} })
  writeTriggerState({ version: 1, fired: { harvest: { at: '2026-10-16', magnitude: 5 } } }, file)
  assert.deepEqual(readTriggerState(file), { version: 1, fired: { harvest: { at: '2026-10-16', magnitude: 5 } } })
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['state.json'])
})

// ---------------------------------------------------------------------------
// The CLI

fs.copyFileSync(path.join(__dirname, '..', 'data', 'allocation-policy.example.json'), policyPath)
fs.writeFileSync(classesPath, JSON.stringify({ 'US:AAA': 'us_equity' }))
{
  const db = new Database(dbPath)
  const common = `market text, currency text, base_currency text, brokerage text, account text, ticker text, name text,
    asset_class text default 'security', account_wrapper text default 'taxable', owner text default 'self'`
  db.exec(`
  create table fx_rates (id integer primary key, from_currency text, to_currency text, rate real, as_of_date text, source text);
  create table cash_balances (id integer primary key, institution text, account text, owner text default 'self', kind text,
    currency text, as_of_date text, balance real, source text);
  create table brokerage_cash (id integer primary key, institution text, account text, pool text, currency text,
    as_of_date text, balance real, source text, account_wrapper text, asset_class text);
  create table holdings_all (id integer primary key, ${common}, quantity real, base_cost real, base_market_value real,
    total_cost_krw real, as_of_date text, native_price real, current_price real, native_market_value real);
  create table tax_lots_all (id integer primary key, ${common}, fx_rate_to_base real, open_quantity real, native_cost_basis real,
    native_market_value real, native_unrealized_gl real, cost_basis_krw real, acquired_date text, holding_days integer, tax_term text);
  create table realized_lots_all (id integer primary key, ${common}, sold_date text, tax_term text, realized_gl_krw real,
    native_realized_gl real, quantity_sold real, acquired_date text, superseded_by text);
  create table transactions_all (id integer primary key, ${common}, date text, type text, quantity real, placed_agent text);
  create view realized_lots as select * from realized_lots_all where account_wrapper in ('taxable', 'isa') and asset_class = 'security';
  create view transactions as select * from transactions_all where account_wrapper in ('taxable', 'isa') and asset_class = 'security';
  create table validation_checks (id integer primary key, name text, status text, detail text, severity text, scope text default 'stock');
  insert into holdings_all (market,currency,base_currency,brokerage,account,ticker,name,quantity,base_cost,base_market_value,total_cost_krw,as_of_date)
    values ('US','USD','KRW','BrokerA','acct-1','AAA','AAA',10,500000,1000000,500000,'2026-10-14');
  insert into validation_checks (name,status,detail,severity) values ('ok check','pass','d','error');
  `)
  db.close()
}

const TODAY = '2026-10-15'
const NOW = new Date('2026-10-15T01:00:00Z')
// All of it in us_equity: kr_equity 25pp below, us_equity 50pp above, cash 5pp below, AAA 85pp over the cap.
const DUE = ['band:kr_equity', 'band:us_equity', 'band:cash', 'cap:US:AAA']

const reset = () => {
  fs.rmSync(proposalsDir, { recursive: true, force: true })
  fs.rmSync(statePath, { force: true })
  fs.rmSync(lockPath, { recursive: true, force: true })
}
const setHealthError = (on: boolean) => {
  const db = new Database(dbPath)
  db.exec("delete from validation_checks where name = 'broken'")
  if (on) db.exec("insert into validation_checks (name,status,detail,severity) values ('broken','fail','d','error')")
  db.close()
}
const cli = async (argv: string[] = ['triggers', '--today', TODAY]) => {
  const { runRebalanceCli } = await import('../lib/rebalance/cli')
  let out = ''
  let err = ''
  const code = await runRebalanceCli(argv, { out: (t) => (out += t), err: (t) => (err += t) }, NOW)
  return { code, body: out ? JSON.parse(out) : null, err }
}
const proposalFiles = () => (fs.existsSync(proposalsDir) ? fs.readdirSync(proposalsDir).filter((n) => n.endsWith('.json')) : [])

test('CLI creates a trigger proposal with suffix', async () => {
  reset()
  const r = await cli()
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(r.body, { schemaVersion: 1, ok: true, command: 'triggers', created: 'rb-2026-10-15-band', due: DUE })
  const { getProposal } = await import('../lib/rebalance/proposal-store')
  const p = getProposal('rb-2026-10-15-band')!
  assert.equal(p.kind, 'trigger')
  assert.deepEqual(p.triggers, DUE)
  assert.equal(p.llm, null)
  const { readTriggerState } = await import('../lib/rebalance/trigger-state')
  const state = readTriggerState()
  assert.deepEqual(Object.keys(state.fired), DUE)
  assert.equal(state.fired['band:us_equity'].at, TODAY)
  near(state.fired['band:us_equity'].magnitude, 50)
  // The next run the same day: everything is debounced.
  const again = await cli()
  assert.deepEqual(again.body, { schemaVersion: 1, ok: true, command: 'triggers', due: [] })
})

test('CLI appends to an open proposal instead of creating', async () => {
  reset()
  const { proposeEngineOnly } = await import('../lib/rebalance/propose')
  const open = proposeEngineOnly({ kind: 'manual', triggers: ['manual'], today: TODAY, now: NOW })
  assert.equal(open.ok, true)
  if (!open.ok) return
  const r = await cli()
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(r.body, { schemaVersion: 1, ok: true, command: 'triggers', appendedTo: open.proposal.id, due: DUE })
  assert.deepEqual(proposalFiles(), [`${open.proposal.id}.json`])
  const { getProposal } = await import('../lib/rebalance/proposal-store')
  const p = getProposal(open.proposal.id)!
  assert.equal(p.triggers[0], 'manual')
  assert.equal(p.triggers[2], 'band:us_equity: us_equity 50.0pp outside band')
  assert.equal(p.triggers.length, 1 + DUE.length)
  assert.equal(p.events.filter((e) => e.type === 'trigger_appended').length, DUE.length)
})

test('refresh lock → skipped, exit 0', async () => {
  reset()
  fs.mkdirSync(lockPath)
  fs.writeFileSync(path.join(lockPath, 'pid'), String(process.pid))
  const r = await cli()
  assert.equal(r.code, 0)
  assert.deepEqual(r.body, { schemaVersion: 1, ok: true, command: 'triggers', skipped: 'refresh_in_progress' })
  assert.deepEqual(proposalFiles(), [])
  assert.equal(fs.existsSync(statePath), false)
})

test('health errors → blocked, no state change', async () => {
  reset()
  setHealthError(true)
  try {
    const r = await cli()
    assert.equal(r.code, 0)
    assert.deepEqual(r.body, { schemaVersion: 1, ok: true, command: 'triggers', blocked: 'health_errors' })
    assert.deepEqual(proposalFiles(), [])
    assert.equal(fs.existsSync(statePath), false)
  } finally {
    setHealthError(false)
  }
})

test('CLI without a policy exits 1 like propose', async () => {
  reset()
  const saved = fs.readFileSync(policyPath)
  fs.rmSync(policyPath)
  try {
    const r = await cli()
    assert.equal(r.code, 1)
    assert.equal(r.body.ok, false)
    assert.equal(r.body.reason, 'not_configured')
  } finally {
    fs.writeFileSync(policyPath, saved)
  }
})

test('state is marked only after success', async () => {
  reset()
  const { proposeEngineOnly } = await import('../lib/rebalance/propose')
  const open = proposeEngineOnly({ kind: 'manual', triggers: ['manual'], today: TODAY, now: NOW })
  assert.equal(open.ok, true)
  // The open proposal can be read but not rewritten: the append fails.
  fs.chmodSync(proposalsDir, 0o555)
  try {
    const r = await cli()
    assert.equal(r.code, 1)
    assert.equal(r.body.ok, false)
    assert.equal(fs.existsSync(statePath), false)
  } finally {
    fs.chmodSync(proposalsDir, 0o755)
  }
  // Once it can be written, the same triggers are still due.
  const ok = await cli()
  assert.equal(ok.code, 0)
  assert.deepEqual(ok.body.due, DUE)
})
