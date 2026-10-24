import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import type { LlmRunner } from '../lib/rebalance/llm-runner'

// The CLI reads its paths from config, which is evaluated on first import; set the environment before any
// project module loads (every project import below is dynamic for that reason).
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-propose-llm-'))
const dbPath = path.join(root, 'portfolio.db')
const policyPath = path.join(root, 'allocation-policy.json')
const classesPath = path.join(root, 'instrument-classes.json')
const archiveDir = path.join(root, 'briefing-archive')
const cliProposals = path.join(root, 'cli-proposals')
process.env.STOCK_DB_PATH = dbPath
process.env.STOCK_ALLOCATION_POLICY_PATH = policyPath
process.env.STOCK_INSTRUMENT_CLASSES_PATH = classesPath
process.env.STOCK_REBALANCE_PROPOSALS_DIR = cliProposals
process.env.STOCK_BRIEFING_ARCHIVE_DIR = archiveDir
process.env.STOCK_ACCOUNT_MAP_PATH = path.join(root, 'no-account-map.json')

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
const tmpDir = () => fs.mkdtempSync(path.join(root, 'proposals-'))
const paths = (proposals: string) => ({ policy: policyPath, classes: classesPath, proposals, db: dbPath })

const load = async () => ({
  ...(await import('../lib/rebalance/propose')),
  ...(await import('../lib/rebalance/proposal-store')),
  ...(await import('../lib/rebalance/engine')),
  ...(await import('../lib/rebalance/allocation-policy')),
  ...(await import('../lib/rebalance/llm-runner')),
  ...(await import('../lib/tax-policy')),
})

type Reply = string | Error
function fakeRunner(replies: Reply[], available = true) {
  const prompts: string[] = []
  const runner: LlmRunner = {
    name: 'claude',
    available: () => available,
    async run(prompt) {
      prompts.push(prompt)
      const reply = replies.shift()
      if (reply === undefined) throw new Error('fake runner: no reply left')
      if (reply instanceof Error) throw reply
      return { raw: reply, model: 'fake-model-1' }
    },
  }
  return { runner, prompts }
}

const outlook = {
  summary: 'Synthetic outlook for a test.',
  drivers: ['driver a'],
  risks: ['risk a'],
  whatWouldChangeMyView: ['view a'],
  sources: [{ url: 'https://example.com/a', title: 'Example source', date: '2026-10-10' }],
  confidence: 'medium',
}
const answer = (targetChange: unknown) =>
  JSON.stringify({ outlook, targetChange, ideas: [{ ticker: 'AAA', sleeve: 'us_equity', why: 'test idea' }], questionsForMaintainer: ['test question?'] })
const CHANGE = answer({
  decision: 'change',
  sleeves: { us_equity: { to: 48, reason: 'more us' }, cash: { to: 7, reason: 'less cash' } },
})
const HOLD = answer({ decision: 'hold', sleeves: {} })
// Off by the sum rule: 45 -> 49 with nothing taken elsewhere.
const INVALID = answer({ decision: 'change', sleeves: { us_equity: { to: 49, reason: 'more us' } } })

/** The CLI tests share the configured proposals directory; reject any draft an earlier one left open. */
const clearCliDrafts = async () => {
  const { listProposals, transition } = await import('../lib/rebalance/proposal-store')
  for (const p of listProposals(cliProposals)) if (p.status === 'draft') transition(p.id, 'rejected', 'test cleanup', NOW, cliProposals)
}

const monthly = async (dir: string, runner: LlmRunner) => {
  const m = await load()
  return m.proposeMonthly({ today: TODAY, now: NOW, runner, model: null, timeoutMs: 1000, paths: paths(dir), contextDir: archiveDir })
}

test('valid change -> change proposal with plan on proposed targets', async () => {
  const m = await load()
  const dir = tmpDir()
  const { runner, prompts } = fakeRunner([CHANGE])
  const r = await monthly(dir, runner)
  assert.equal(r.ok, true)
  if (!r.ok) return
  const p = r.proposal
  const policy = m.getAllocationPolicy(policyPath).policy!
  assert.equal(p.kind, 'monthly')
  assert.equal(p.id, 'rb-2026-10')
  assert.equal(prompts.length, 1)
  assert.deepEqual(p.targetChange, {
    decision: 'change',
    sleeves: { us_equity: { from: 45, to: 48, reason: 'more us' }, cash: { from: 10, to: 7, reason: 'less cash' } },
    boundsErrors: [],
  })
  const targets = structuredClone(policy.targets)
  targets.us_equity.target = 48
  targets.cash.target = 7
  const expected = m.buildTradePlan({
    input: p.inputSnapshot,
    policy,
    targets,
    classes: { 'US:AAA': 'us_equity' },
    taxPolicy: m.getTaxPolicyState().policy,
  })
  assert.deepEqual(p.plan, JSON.parse(JSON.stringify(expected)))
  assert.equal(p.outlook?.summary, outlook.summary)
  assert.deepEqual(p.ideas, [{ ticker: 'AAA', sleeve: 'us_equity', why: 'test idea' }])
  assert.deepEqual(p.questionsForMaintainer, ['test question?'])
  assert.equal(p.llm?.status, 'ok')
  assert.equal(p.llm?.reason, null)
  assert.equal(p.llm?.runner, 'claude')
  assert.equal(p.llm?.model, 'fake-model-1')
  assert.equal(p.llm?.attempts.length, 1)
  assert.equal(p.llm?.attempts[0].prompt, prompts[0])
  assert.equal(p.llm?.attempts[0].raw, CHANGE)
  assert.deepEqual(p.llm?.attempts[0].errors, [])
  // The stored file reads back the same.
  assert.deepEqual(m.getProposal(p.id, dir), p)
})

test('invalid then valid -> ok with 2 attempts', async () => {
  const dir = tmpDir()
  const { runner, prompts } = fakeRunner([INVALID, CHANGE])
  const r = await monthly(dir, runner)
  assert.equal(r.ok, true)
  if (!r.ok) return
  const llm = r.proposal.llm!
  assert.equal(llm.status, 'ok')
  assert.equal(llm.attempts.length, 2)
  assert.ok(llm.attempts[0].errors.length > 0)
  assert.deepEqual(llm.attempts[1].errors, [])
  // Attempt 2 is told what attempt 1 got wrong.
  assert.equal(prompts.length, 2)
  assert.match(prompts[1], /previous answer was rejected/)
  assert.ok(prompts[1].includes(llm.attempts[0].errors[0]))
  assert.equal(r.proposal.targetChange.decision, 'change')
})

test('invalid twice -> hold with invalid_output and both attempts stored', async () => {
  const m = await load()
  const dir = tmpDir()
  const { runner } = fakeRunner([INVALID, 'no json at all'])
  const r = await monthly(dir, runner)
  assert.equal(r.ok, true)
  if (!r.ok) return
  const p = r.proposal
  assert.deepEqual(p.targetChange, { decision: 'hold', sleeves: {}, boundsErrors: [] })
  assert.equal(p.llm?.status, 'failed')
  assert.equal(p.llm?.reason, 'invalid_output')
  assert.equal(p.llm?.attempts.length, 2)
  assert.equal(p.llm?.attempts[1].raw, 'no json at all')
  assert.ok(p.llm!.attempts.every((a) => a.errors.length > 0))
  assert.equal(p.outlook, null)
  assert.deepEqual(p.ideas, [])
  assert.deepEqual(p.questionsForMaintainer, [])
  const policy = m.getAllocationPolicy(policyPath).policy!
  const expected = m.buildTradePlan({
    input: p.inputSnapshot,
    policy,
    targets: policy.targets,
    classes: { 'US:AAA': 'us_equity' },
    taxPolicy: m.getTaxPolicyState().policy,
  })
  assert.deepEqual(p.plan, JSON.parse(JSON.stringify(expected)))
})

test('runner throws -> hold runner_failed', async () => {
  const { runner, prompts } = fakeRunner([new Error('claude failed with exit code 1')])
  const r = await monthly(tmpDir(), runner)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(prompts.length, 1)
  assert.equal(r.proposal.targetChange.decision, 'hold')
  assert.equal(r.proposal.llm?.status, 'failed')
  assert.equal(r.proposal.llm?.reason, 'runner_failed')
  assert.equal(r.proposal.llm?.attempts.length, 1)
})

test('timeout -> hold timeout', async () => {
  const { LlmTimeoutError } = await load()
  const { runner, prompts } = fakeRunner([new LlmTimeoutError()])
  const r = await monthly(tmpDir(), runner)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(prompts.length, 1)
  assert.equal(r.proposal.targetChange.decision, 'hold')
  assert.equal(r.proposal.llm?.status, 'failed')
  assert.equal(r.proposal.llm?.reason, 'timeout')
})

test('runner unavailable -> hold runner_unavailable', async () => {
  const { runner, prompts } = fakeRunner([CHANGE], false)
  const r = await monthly(tmpDir(), runner)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(prompts.length, 0)
  assert.equal(r.proposal.targetChange.decision, 'hold')
  assert.equal(r.proposal.llm?.status, 'failed')
  assert.equal(r.proposal.llm?.reason, 'runner_unavailable')
  assert.deepEqual(r.proposal.llm?.attempts, [])
})

test('runner unavailable -> exit 0 via CLI, with llm in the JSON', async () => {
  const { runRebalanceCli } = await import('../lib/rebalance/cli')
  const { runner } = fakeRunner([], false)
  let out = ''
  const code = await runRebalanceCli(['propose', '--kind', 'monthly', '--today', TODAY], { out: (t) => (out += t), err: () => {} }, NOW, { runner })
  assert.equal(code, 0)
  const body = JSON.parse(out)
  assert.equal(body.ok, true)
  assert.equal(body.id, 'rb-2026-10')
  assert.equal(body.decision, 'hold')
  assert.deepEqual(body.llm, { status: 'failed', reason: 'runner_unavailable', attempts: 0 })
})

test('open proposal -> refused, runner never called', async () => {
  const m = await load()
  const dir = tmpDir()
  const first = m.proposeEngineOnly({ kind: 'manual', triggers: ['manual'], today: TODAY, now: NOW, paths: paths(dir) })
  assert.equal(first.ok, true)
  const { runner, prompts } = fakeRunner([CHANGE])
  const r = await monthly(dir, runner)
  assert.equal(r.ok, false)
  if (!r.ok && first.ok) {
    assert.equal(r.reason, 'open_proposal_exists')
    assert.equal(r.openId, first.proposal.id)
  }
  assert.equal(prompts.length, 0)
})

test('hold decision -> hold, outlook stored', async () => {
  const { runner } = fakeRunner([HOLD])
  const r = await monthly(tmpDir(), runner)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual(r.proposal.targetChange, { decision: 'hold', sleeves: {}, boundsErrors: [] })
  assert.equal(r.proposal.llm?.status, 'ok')
  assert.deepEqual(r.proposal.outlook, outlook)
  assert.deepEqual(r.proposal.questionsForMaintainer, ['test question?'])
})

test('change where no target moves -> recorded as hold', async () => {
  const unmoved = answer({ decision: 'change', sleeves: { us_equity: { to: 45, reason: 'same' } } })
  const { runner } = fakeRunner([unmoved])
  const r = await monthly(tmpDir(), runner)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual(r.proposal.targetChange, { decision: 'hold', sleeves: {}, boundsErrors: [] })
  assert.equal(r.proposal.llm?.status, 'ok')
  assert.equal(r.proposal.outlook?.summary, outlook.summary)
})

test('--no-llm forces the engine-only proposal and never calls the runner', async () => {
  const { runRebalanceCli } = await import('../lib/rebalance/cli')
  await clearCliDrafts()
  const { runner, prompts } = fakeRunner([CHANGE])
  let out = ''
  const code = await runRebalanceCli(['propose', '--kind', 'monthly', '--no-llm', '--today', TODAY], { out: (t) => (out += t), err: () => {} }, NOW, { runner })
  assert.equal(code, 0)
  const body = JSON.parse(out)
  assert.equal(body.ok, true)
  assert.equal(body.decision, 'hold')
  assert.deepEqual(body.llm, { status: 'skipped', reason: null, attempts: 0 })
  assert.equal(prompts.length, 0)
  const { getProposal } = await import('../lib/rebalance/proposal-store')
  assert.deepEqual(getProposal(body.id, cliProposals)?.llm, { status: 'skipped', runner: null, model: null, attempts: [], reason: null })
})

test('--no-llm on a non-monthly kind keeps llm null', async () => {
  const { runRebalanceCli } = await import('../lib/rebalance/cli')
  await clearCliDrafts()
  let out = ''
  const code = await runRebalanceCli(['propose', '--kind', 'manual', '--no-llm', '--today', TODAY], { out: (t) => (out += t), err: () => {} }, NOW)
  assert.equal(code, 0)
  assert.equal(JSON.parse(out).llm, null)
})

/** A closed past proposal with no targetChange, newest of all, makes buildLlmInput throw reading past decisions. */
const writeMalformedPast = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'rb-2026-01-01.json')
  fs.writeFileSync(file, JSON.stringify({ id: 'rb-2026-01-01', status: 'rejected', createdAt: '2026-12-31T00:00:00.000Z', events: [] }))
  return file
}

test('a throw while building the LLM input -> hold runner_failed, message in attempts[0]', async () => {
  const dir = tmpDir()
  writeMalformedPast(dir)
  const { runner, prompts } = fakeRunner([CHANGE])
  const r = await monthly(dir, runner)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(prompts.length, 0)
  assert.deepEqual(r.proposal.targetChange, { decision: 'hold', sleeves: {}, boundsErrors: [] })
  assert.equal(r.proposal.llm?.status, 'failed')
  assert.equal(r.proposal.llm?.reason, 'runner_failed')
  assert.equal(r.proposal.llm?.attempts.length, 1)
  const [error] = r.proposal.llm!.attempts[0].errors
  assert.match(error, /^input: /)
  assert.ok(error.length <= 'input: '.length + 500)
})

test('a throw while building the LLM input -> CLI exit 0', async () => {
  const { runRebalanceCli } = await import('../lib/rebalance/cli')
  await clearCliDrafts()
  const file = writeMalformedPast(cliProposals)
  try {
    const { runner } = fakeRunner([CHANGE])
    let out = ''
    const code = await runRebalanceCli(['propose', '--kind', 'monthly', '--today', TODAY], { out: (t) => (out += t), err: () => {} }, NOW, { runner })
    assert.equal(code, 0)
    const body = JSON.parse(out)
    assert.equal(body.ok, true)
    assert.equal(body.decision, 'hold')
    assert.deepEqual(body.llm, { status: 'failed', reason: 'runner_failed', attempts: 1 })
  } finally {
    fs.rmSync(file)
    await clearCliDrafts()
  }
})

test('a non-object outlook in a stored file reads as null, and non-array ideas/questions as []', async () => {
  const m = await load()
  const dir = tmpDir()
  const first = m.proposeEngineOnly({ kind: 'manual', triggers: ['manual'], today: TODAY, now: NOW, paths: paths(dir) })
  assert.equal(first.ok, true)
  if (!first.ok) return
  const file = path.join(dir, `${first.proposal.id}.json`)
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  raw.outlook = 'text'
  raw.ideas = 'x'
  raw.questionsForMaintainer = { a: 1 }
  fs.writeFileSync(file, JSON.stringify(raw))
  const read = m.getProposal(first.proposal.id, dir)!
  assert.equal(read.outlook, null)
  assert.deepEqual(read.ideas, [])
  assert.deepEqual(read.questionsForMaintainer, [])
  // An object whose list fields are not arrays is not an outlook either.
  raw.outlook = { ...outlook, drivers: 'one' }
  fs.writeFileSync(file, JSON.stringify(raw))
  assert.equal(m.getProposal(first.proposal.id, dir)!.outlook, null)
  raw.outlook = outlook
  fs.writeFileSync(file, JSON.stringify(raw))
  assert.deepEqual(m.getProposal(first.proposal.id, dir)!.outlook, outlook)
})

test('an older proposal file without the LLM fields reads as null and empty lists', async () => {
  const m = await load()
  const dir = tmpDir()
  const first = m.proposeEngineOnly({ kind: 'manual', triggers: ['manual'], today: TODAY, now: NOW, paths: paths(dir) })
  assert.equal(first.ok, true)
  if (!first.ok) return
  const file = path.join(dir, `${first.proposal.id}.json`)
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  delete raw.outlook
  delete raw.llm
  delete raw.ideas
  delete raw.questionsForMaintainer
  fs.writeFileSync(file, JSON.stringify(raw))
  const read = m.getProposal(first.proposal.id, dir)!
  assert.equal(read.outlook, null)
  assert.equal(read.llm, null)
  assert.deepEqual(read.ideas, [])
  assert.deepEqual(read.questionsForMaintainer, [])
  const listed = m.listProposals(dir)[0]
  assert.deepEqual(listed.ideas, [])
  assert.deepEqual(listed.questionsForMaintainer, [])
})

test('health errors -> CLI exits 1 and the runner is never called', async () => {
  const { runRebalanceCli } = await import('../lib/rebalance/cli')
  await clearCliDrafts()
  const c = new Database(dbPath)
  c.exec("insert into validation_checks (name,status,detail,severity) values ('broken','fail','d','error')")
  c.close()
  try {
    const { runner, prompts } = fakeRunner([CHANGE])
    let out = ''
    const code = await runRebalanceCli(['propose', '--kind', 'monthly', '--today', TODAY], { out: (t) => (out += t), err: () => {} }, NOW, { runner })
    assert.equal(code, 1)
    const body = JSON.parse(out)
    assert.equal(body.ok, false)
    assert.equal(body.reason, 'health_errors')
    assert.equal(prompts.length, 0)
  } finally {
    const d = new Database(dbPath)
    d.exec("delete from validation_checks where name = 'broken'")
    d.close()
  }
})
