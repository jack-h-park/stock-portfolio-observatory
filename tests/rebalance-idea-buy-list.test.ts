import assert from 'node:assert/strict'
import fs, { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { RebalanceInput } from '../lib/adapters/rebalance-input'
import { getAllocationPolicy, validateAllocationPolicy, type AllocationPolicy } from '../lib/rebalance/allocation-policy'
import type { RebalancePosition } from '../lib/rebalance/allocation'
import type { TradePlan } from '../lib/rebalance/engine'
import { getInstrumentClasses } from '../lib/rebalance/instrument-classes'
import type { LlmIdea } from '../lib/rebalance/llm-contract'
import { addIdeaToBuyList, ideaAccountOptions, ideaListed } from '../lib/rebalance/proposal-actions'
import { createProposal, getProposal } from '../lib/rebalance/proposal-store'
import { policyFromSettingsForm } from '../lib/rebalance/settings-form'

const example = (): AllocationPolicy => {
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
  name: 'AAA',
  asset_class: 'security',
  quantity: 1,
  valueKrw: 1_000_000,
  costKrw: 1_000_000,
  dataAsOf: '2026-10-15',
  ...over,
})

const snapshot = (): RebalanceInput => ({
  asOf: '2026-10-15',
  usdKrwRate: 1000,
  positions: [pos({}), pos({ brokerage: 'BrokerK', account: 'kr-1', market: 'KR', currency: 'KRW', ticker: 'KRX1' })],
  cash: [],
  lots: [],
  recentBuys: [],
  washSaleBlockedBuys: [],
  accountDataAsOf: {},
  ytd: { year: 2026, krTaxableGainKrw: 0, usShortUsd: 0, usLongUsd: 0, lotCount: 0 },
  healthErrors: [],
})

const IDEAS: LlmIdea[] = [
  { market: 'US', ticker: 'NEW', sleeve: 'us_equity', why: 'w' },
  { market: 'KR', ticker: 'KRX1', sleeve: 'gold', why: 'already classified elsewhere' },
  { ticker: 'OLD', sleeve: 'us_equity', why: 'stored before ideas had a market' },
]

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-ideas-'))
  const paths = { policy: path.join(dir, 'policy.json'), classes: path.join(dir, 'classes.json'), proposals: path.join(dir, 'proposals') }
  fs.writeFileSync(paths.policy, JSON.stringify(example(), null, 2))
  fs.writeFileSync(paths.classes, JSON.stringify({ 'KR:KRX1': 'kr_equity' }))
  const p = createProposal(
    {
      id: 'rb-2026-10-15-ideas',
      kind: 'manual',
      triggers: [],
      policyAtCreation: example(),
      inputSnapshot: snapshot(),
      outlook: null,
      llm: null,
      targetChange: { decision: 'hold', sleeves: {}, boundsErrors: [] },
      plan: { moves: [], instructions: [], warnings: [], taxSummary: {} } as unknown as TradePlan,
      planSkips: [],
      ideas: IDEAS,
    },
    new Date('2026-10-15T00:00:00Z'),
    paths.proposals,
  )
  return { id: p.id, paths }
}

const form = (fields: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.append(k, v)
  return f
}

test('ideaAccountOptions lists the accounts that hold the market, and buy-list accounts for it', () => {
  const { id, paths } = setup()
  const p = getProposal(id, paths.proposals)!
  const policy = example()
  assert.deepEqual(ideaAccountOptions(p, policy, 'US').map((o) => o.key), ['BrokerA::acct-1'])
  policy.preferredInstruments.us_equity = [{ market: 'US', ticker: 'VVV', brokerage: 'BrokerB', account: 'acct-2' }]
  assert.deepEqual(ideaAccountOptions(p, policy, 'US').map((o) => o.key), ['BrokerA::acct-1', 'BrokerB::acct-2'])
  assert.deepEqual(ideaAccountOptions(p, policy, 'CRYPTO'), [])
})

test('addIdeaToBuyList adds the entry, classifies a new security, and is idempotent', () => {
  const { id, paths } = setup()
  const out = addIdeaToBuyList(id, form({ ideaIndex: '0', account: 'BrokerA::acct-1' }), paths)
  assert.equal(out.ok, true)
  const policy = getAllocationPolicy(paths.policy).policy!
  assert.deepEqual(policy.preferredInstruments.us_equity, [{ market: 'US', ticker: 'NEW', brokerage: 'BrokerA', account: 'acct-1' }])
  assert.equal(getInstrumentClasses(paths.classes)['US:NEW'], 'us_equity')
  assert.equal(ideaListed(policy, IDEAS[0]), true)
  assert.equal(addIdeaToBuyList(id, form({ ideaIndex: '0', account: 'BrokerA::acct-1' }), paths).ok, true)
  assert.equal(getAllocationPolicy(paths.policy).policy!.preferredInstruments.us_equity!.length, 1)
})

test('addIdeaToBuyList refuses a bad index, an idea without a market, and an account outside the options', () => {
  const { id, paths } = setup()
  const before = fs.readFileSync(paths.policy)
  const code = (fields: Record<string, string>) => {
    const out = addIdeaToBuyList(id, form(fields), paths)
    return out.ok ? 'ok' : out.code
  }
  assert.equal(code({ ideaIndex: '9', account: 'BrokerA::acct-1' }), 'idea_invalid')
  assert.equal(code({ ideaIndex: 'x', account: 'BrokerA::acct-1' }), 'idea_invalid')
  assert.equal(code({ ideaIndex: '2', account: 'BrokerA::acct-1' }), 'idea_invalid')
  // A KR account for a US idea is not an option.
  assert.equal(code({ ideaIndex: '0', account: 'BrokerK::kr-1' }), 'idea_account_invalid')
  assert.deepEqual(fs.readFileSync(paths.policy), before)
})

test('addIdeaToBuyList will not move a security classified into another sleeve', () => {
  const { id, paths } = setup()
  const out = addIdeaToBuyList(id, form({ ideaIndex: '1', account: 'BrokerK::kr-1' }), paths)
  assert.equal(!out.ok && out.code, 'idea_class_conflict')
  assert.equal(getInstrumentClasses(paths.classes)['KR:KRX1'], 'kr_equity')
  assert.equal(getAllocationPolicy(paths.policy).policy!.preferredInstruments.gold, undefined)
})

test('investor profile: the limits form sets it, and validation refuses a malformed one', () => {
  const limits = form({ positionCapPct: '15', maxTargetShiftPctPerCycle: '5', maxTurnoverPctPerProposal: '10', minTradeKrw: '100000', staleDataDays: '35', harvestThresholdKrw: '0' })
  const off = policyFromSettingsForm(limits, example())
  assert.deepEqual(off.errors, [])
  assert.deepEqual(off.policy.investor, { usTaxPerson: false })
  limits.append('investor_usTaxPerson', 'on')
  assert.deepEqual(policyFromSettingsForm(limits, example()).policy.investor, { usTaxPerson: true })
  // Another section's form leaves it alone.
  const kept = { ...example(), investor: { usTaxPerson: true } }
  assert.deepEqual(policyFromSettingsForm(form({ buy_gold: '' }), kept).policy.investor, { usTaxPerson: true })
  assert.deepEqual(validateAllocationPolicy(example()), [])
  const bad = { ...example(), investor: { usTaxPerson: 'yes' } } as unknown as AllocationPolicy
  assert.ok(validateAllocationPolicy(bad).some((e) => e.startsWith('investor.usTaxPerson')))
})

test('scope: the limits form sets includeIsa, rebalanceWrappers follows it, and validation refuses a malformed one', async () => {
  const { rebalanceWrappers } = await import('../lib/rebalance/allocation-policy')
  const limits = form({ positionCapPct: '15', maxTargetShiftPctPerCycle: '5', maxTurnoverPctPerProposal: '10', minTradeKrw: '100000', staleDataDays: '35', harvestThresholdKrw: '0', scope_includeIsa: 'on' })
  const parsed = policyFromSettingsForm(limits, example())
  assert.deepEqual(parsed.policy.scope, { includeIsa: true })
  assert.deepEqual(rebalanceWrappers(parsed.policy), ['taxable', 'isa'])
  assert.deepEqual(rebalanceWrappers(example()), ['taxable'])
  assert.deepEqual(rebalanceWrappers(null), ['taxable'])
  const bad = { ...example(), scope: { includeIsa: 1 } } as unknown as AllocationPolicy
  assert.ok(validateAllocationPolicy(bad).some((e) => e.startsWith('scope.includeIsa')))
})
