import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { proposeEngineOnly } from '../lib/rebalance/propose'
import { buildTradePlan } from '../lib/rebalance/engine'
import { getAllocationPolicy } from '../lib/rebalance/allocation-policy'
import { getTaxPolicyState } from '../lib/tax-policy'
import { getProposal, openProposal } from '../lib/rebalance/proposal-store'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-propose-'))
const dbPath = path.join(root, 'portfolio.db')
const policyPath = path.join(root, 'allocation-policy.json')
const classesPath = path.join(root, 'instrument-classes.json')
fs.copyFileSync(path.join(__dirname, '..', 'data', 'allocation-policy.example.json'), policyPath)
fs.writeFileSync(classesPath, JSON.stringify({ 'US:AAA': 'us_equity' }))

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

const TODAY = '2026-10-15'
const NOW = new Date('2026-10-15T01:00:00Z')
const args = (proposals: string, over: Partial<{ policy: string; db: string; kind: 'manual' | 'monthly' | 'trigger' }> = {}) => ({
  kind: over.kind ?? ('manual' as const),
  triggers: ['t1'],
  today: TODAY,
  now: NOW,
  paths: { policy: over.policy ?? policyPath, classes: classesPath, proposals, db: over.db ?? dbPath },
})
const tmpDir = () => fs.mkdtempSync(path.join(root, 'proposals-'))

test('propose without a policy fails with not-configured', () => {
  const r = proposeEngineOnly(args(tmpDir(), { policy: path.join(root, 'missing.json') }))
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'not_configured')
})

test('propose refuses on health errors', () => {
  const bad = path.join(root, 'bad.db')
  fs.copyFileSync(dbPath, bad)
  const c = new Database(bad)
  c.exec("insert into validation_checks (name,status,detail,severity) values ('broken','fail','d','error')")
  c.close()
  const dir = tmpDir()
  const r = proposeEngineOnly(args(dir, { db: bad }))
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.reason, 'health_errors')
    assert.match(r.detail, /broken/)
  }
  assert.equal(openProposal(dir), null)
})

test('propose with an open proposal returns its id', () => {
  const dir = tmpDir()
  const first = proposeEngineOnly(args(dir))
  assert.equal(first.ok, true)
  const second = proposeEngineOnly(args(dir, { kind: 'trigger' }))
  assert.equal(second.ok, false)
  if (!second.ok && first.ok) {
    assert.equal(second.reason, 'open_proposal_exists')
    assert.equal(second.openId, first.proposal.id)
  }
})

test('a stale draft is expired and does not block a new proposal', () => {
  const dir = tmpDir()
  const first = proposeEngineOnly(args(dir))
  assert.equal(first.ok, true)
  const later = { ...args(dir), today: '2026-10-25', now: new Date('2026-10-25T01:00:00Z') }
  const second = proposeEngineOnly(later)
  assert.equal(second.ok, true)
  if (first.ok) assert.equal(getProposal(first.proposal.id, dir)!.status, 'expired')
})

test('propose builds a hold proposal whose plan equals buildTradePlan of the snapshot', () => {
  const dir = tmpDir()
  const r = proposeEngineOnly(args(dir))
  assert.equal(r.ok, true)
  if (!r.ok) return
  const p = r.proposal
  const policy = getAllocationPolicy(policyPath).policy!
  assert.deepEqual(p.targetChange, { decision: 'hold', sleeves: {}, boundsErrors: [] })
  assert.deepEqual(p.policyAtCreation.targets, policy.targets)
  assert.deepEqual(p.planSkips, [])
  assert.deepEqual(p.triggers, ['t1'])
  assert.equal(p.status, 'draft')
  assert.equal(p.kind, 'manual')
  const expected = buildTradePlan({
    input: p.inputSnapshot,
    policy,
    targets: policy.targets,
    classes: { 'US:AAA': 'us_equity' },
    taxPolicy: getTaxPolicyState().policy,
  })
  // The store persists JSON, so compare in JSON form (-0 becomes 0).
  assert.deepEqual(p.plan, JSON.parse(JSON.stringify(expected)))
  assert.equal(p.inputSnapshot.asOf, TODAY)
})
