import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { AS_OF, buildCliFixture, CASH, FX, runCli, TAXABLE, type Fixture } from './cli-fixture'

// The read-only CLIs end to end, against a scratch database of synthetic lots
// (tests/cli-fixture.ts has every number used here).

const fixture = buildCliFixture()

const ESTIMATE_KEYS = ['federalUsd', 'niitUsd', 'stateUsd', 'usTotalUsd', 'krTaxKrw', 'krCreditUsd', 'totalUsd']
const PROVENANCE_KEYS = ['dbPath', 'dbBuiltAt', 'dbMtime', 'policyPath', 'policySha256', 'policyMtime', 'priceSource', 'pricesAsOf', 'fxDates', 'krCreditMode', 'disclaimer']
const SALE_KEYS = ['ticker', 'account', 'acquiredDate', 'quantity', 'basisUsd', 'proceedsUsd', 'gainUsd', 'term', 'becomesLongTermOn', 'gainKrw']

function sha(file: string) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function ok(f: Fixture, args: string[]) {
  const result = runCli(f, [...args, '--json'])
  assert.equal(result.code, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
  assert.ok(result.json, `stdout is one JSON object: ${result.stdout}`)
  assert.equal(result.json.ok, true)
  assert.equal(result.json.schemaVersion, 1)
  assert.ok(!Number.isNaN(Date.parse(result.json.generatedAt)))
  for (const key of PROVENANCE_KEYS) assert.ok(key in result.json.provenance, `provenance.${key}`)
  assert.equal(result.json.provenance.disclaimer, 'Estimate under the stated inputs; not tax advice.')
  return result.json
}

test('every command is read-only: the database and the policy are byte-for-byte unchanged', () => {
  const f = buildCliFixture()
  const before = { db: sha(f.dbPath), dbMtime: statSync(f.dbPath).mtimeMs, policy: sha(f.policyPath), policyMtime: statSync(f.policyPath).mtimeMs }
  for (const scenario of ['lt-now', 'wait-lt', 'sell-all', 'harvest', 'filing-compare']) ok(f, ['tax:scenario', '--scenario', scenario, '--as-of', AS_OF])
  ok(f, ['tax:scenario', '--scenario', 'date-shift', '--as-of', AS_OF, '--sell-date', '2026-12-01'])
  ok(f, ['tax:calendar', '--as-of', AS_OF])
  ok(f, ['tax:realized', '--since', '2026-01-01'])
  ok(f, ['sources:status'])
  assert.equal(sha(f.dbPath), before.db)
  assert.equal(statSync(f.dbPath).mtimeMs, before.dbMtime)
  assert.equal(sha(f.policyPath), before.policy)
  assert.equal(statSync(f.policyPath).mtimeMs, before.policyMtime)
})

test('a held refresh lock exits 3 with the refresh-in-progress envelope; a stale one does not block', () => {
  const f = buildCliFixture()
  mkdirSync(f.lockPath)
  writeFileSync(path.join(f.lockPath, 'pid'), `${process.pid}\n`)
  for (const args of [['tax:scenario', '--scenario', 'sell-all', '--json'], ['tax:calendar'], ['tax:realized', '--since', '2026-01-01', '--json'], ['sources:status', '--json']]) {
    const result = runCli(f, args)
    assert.equal(result.code, 3, args.join(' '))
    assert.deepEqual(JSON.parse(result.stdout), { ok: false, error: 'refresh-in-progress', schemaVersion: 1 })
  }
  // A lock whose owner is gone is stale: refresh.mjs reclaims it, and readers ignore it.
  writeFileSync(path.join(f.lockPath, 'pid'), '999999999\n')
  assert.equal(runCli(f, ['sources:status', '--json']).code, 0)
  rmSync(f.lockPath, { recursive: true })
})

test('usage errors exit 2; a missing database exits 1 with the error envelope', () => {
  for (const args of [
    ['tax:scenario', '--scenario', 'sell-everything', '--json'],
    ['tax:scenario', '--scenario', 'date-shift', '--json'],
    ['tax:scenario', '--scenario', 'sell-all', '--sell-date', '2026-12-01', '--json'],
    ['tax:scenario', '--scenario', 'sell-all', '--filing', 'kr-only', '--json'],
    ['tax:scenario', '--scenario', 'sell-all', '--as-of', '2026-02-30', '--json'],
    ['tax:scenario', '--scenario', 'sell-all', '--sel-date', '2026-12-01', '--json'],
    ['tax:realized', '--json'],
  ]) {
    const result = runCli(fixture, args)
    assert.equal(result.code, 2, `${args.join(' ')}: ${result.stdout}${result.stderr}`)
    assert.equal(result.json?.ok, false)
  }
  const missing = runCli({ ...fixture, env: { ...fixture.env, STOCK_DB_PATH: path.join(fixture.dir, 'absent.db') } }, ['tax:calendar', '--json'])
  assert.equal(missing.code, 1)
  assert.equal(missing.json.ok, false)
  assert.match(missing.json.error, /no database/)
})

test('tax:scenario sell-all: contract shape, per-lot terms, and the won gain at the sale-date rate', () => {
  const json = ok(fixture, ['tax:scenario', '--scenario', 'sell-all', '--as-of', AS_OF])
  assert.equal(json.scenario, 'sell-all')
  assert.deepEqual(json.inputs, { asOf: AS_OF, sellDate: AS_OF, tickers: null, filing: 'us-kr', taxYear: 2026 })
  for (const key of ESTIMATE_KEYS) assert.equal(typeof json.estimate[key], 'number', key)
  assert.equal(json.sales.length, 4)
  for (const sale of json.sales) for (const key of SALE_KEYS) assert.ok(key in sale, key)
  assert.ok(json.sales.every((s: any) => s.account === TAXABLE))

  const byTicker = Object.fromEntries(json.sales.map((s: any) => [s.ticker, s]))
  assert.equal(byTicker.AAA.term, 'long')
  assert.equal(byTicker.AAA.becomesLongTermOn, null)
  assert.equal(byTicker.BBB.term, 'short')
  assert.equal(byTicker.BBB.becomesLongTermOn, '2027-01-21')
  assert.equal(byTicker.CCC.becomesLongTermOn, '2026-09-02')

  // The sale on 2026-06-15 (a Monday) uses the last rate on or before it: 2026-06-12, 1300.
  assert.deepEqual(json.provenance.fxDates, { latest: '2026-06-30', used: { [AS_OF]: '2026-06-12' } })
  assert.equal(byTicker.AAA.gainUsd, 1000)
  assert.equal(byTicker.AAA.gainKrw, 2000 * 1300 - 1_100_000)
  assert.notEqual(byTicker.AAA.gainKrw, 1000 * 1300, 'not the dollar gain at one rate')
  assert.notEqual(byTicker.AAA.gainKrw, 2000 * 1400 - 1_100_000, "not the lot's current rate")

  const e = json.estimate
  assert.ok(Math.abs(e.usTotalUsd - (e.federalUsd + e.niitUsd + e.stateUsd)) < 0.02)
  assert.ok(Math.abs(e.totalUsd - (e.usTotalUsd + e.krTaxKrw / 1300 - e.krCreditUsd)) < 0.05)
  assert.equal(json.provenance.krCreditMode, 'estimated-us-source')
  assert.equal(json.provenance.policySha256, sha(fixture.policyPath))
  assert.equal(json.provenance.policyPath, fixture.policyPath)
  assert.equal(json.provenance.priceSource, 'db')
  assert.equal(json.lowestEstimate, null)
  assert.ok(!('frontier' in json))
})

test('tax:scenario lt-now sells only the lots already long-term; --tickers narrows the set', () => {
  const lt = ok(fixture, ['tax:scenario', '--scenario', 'lt-now', '--as-of', AS_OF])
  assert.deepEqual(lt.sales.map((s: any) => s.ticker), ['AAA', 'DDD'])
  const narrowed = ok(fixture, ['tax:scenario', '--scenario', 'sell-all', '--as-of', AS_OF, '--tickers', 'ccc,ZZZ'])
  assert.deepEqual(narrowed.sales.map((s: any) => s.ticker), ['CCC'])
  assert.deepEqual(narrowed.inputs.tickers, ['CCC', 'ZZZ'])
  assert.ok(narrowed.notes.some((n: string) => n.includes('ZZZ')))
})

test('tax:scenario wait-lt sells each lot on its long-term date and compares with selling now', () => {
  const json = ok(fixture, ['tax:scenario', '--scenario', 'wait-lt', '--as-of', AS_OF])
  const byTicker = Object.fromEntries(json.sales.map((s: any) => [s.ticker, s]))
  assert.equal(byTicker.AAA.saleDate, AS_OF)
  assert.equal(byTicker.CCC.saleDate, '2026-09-02')
  assert.equal(byTicker.BBB.saleDate, '2027-01-21')
  assert.ok(json.sales.every((s: any) => s.term === 'long'))
  assert.equal(json.inputs.sellDate, null)
  assert.ok(json.comparison.length >= 2)
  assert.ok(json.comparison.some((c: any) => c.label.startsWith('wait-lt')))
  assert.ok(json.comparison.some((c: any) => c.label.includes(AS_OF)))
  assert.equal(json.lowestEstimate.note, 'lowest estimated tax under the stated inputs')
  // Future sale dates are past the last stored rate: the latest is used, and the output says so.
  assert.ok(json.notes.some((n: string) => n.includes('2027-01-21') && n.includes('2026-06-30')))
})

test('tax:scenario date-shift: terms move with the date, and a future date uses the latest rate', () => {
  const json = ok(fixture, ['tax:scenario', '--scenario', 'date-shift', '--as-of', AS_OF, '--sell-date', '2026-12-01'])
  assert.equal(json.inputs.sellDate, '2026-12-01')
  const ccc = json.sales.find((s: any) => s.ticker === 'CCC')
  assert.equal(ccc.term, 'long')
  assert.equal(ccc.gainKrw, 3000 * 1350 - 2_780_000)
  assert.equal(json.provenance.fxDates.used['2026-12-01'], '2026-06-30')
  assert.deepEqual(json.comparison.map((c: any) => c.label), [`sell on ${AS_OF}`, 'sell on 2026-12-01'])
  const lowest = json.comparison.slice().sort((a: any, b: any) => a.estimate.totalUsd - b.estimate.totalUsd)[0]
  assert.equal(json.lowestEstimate.label, lowest.label)
})

test('tax:scenario filing-compare: KR filing adds Korea tax; the credit follows the policy mode', () => {
  const json = ok(fixture, ['tax:scenario', '--scenario', 'filing-compare', '--as-of', AS_OF])
  const [usOnly, usKr] = json.comparison
  assert.equal(usOnly.label, 'us-only')
  assert.equal(usKr.label, 'us-kr')
  assert.equal(usOnly.estimate.krTaxKrw, 0)
  assert.ok(usKr.estimate.krTaxKrw > 0)
  assert.equal(usOnly.estimate.usTotalUsd, usKr.estimate.usTotalUsd)
  assert.ok(usKr.estimate.krCreditUsd > 0, 'estimated-us-source credits US tax against Korea')
  const forced = ok(fixture, ['tax:scenario', '--scenario', 'sell-all', '--as-of', AS_OF, '--filing', 'us-only'])
  assert.equal(forced.inputs.filing, 'us-only')
  assert.equal(forced.estimate.krTaxKrw, 0)
})

test('tax:scenario harvest: a frontier of loss tickers, ordered by marginal saving per dollar', () => {
  const json = ok(fixture, ['tax:scenario', '--scenario', 'harvest', '--as-of', AS_OF])
  assert.deepEqual(new Set(json.frontier.map((f: any) => f.ticker)), new Set(['BBB', 'DDD']))
  for (const step of json.frontier) {
    for (const key of ['ticker', 'lossUsd', 'taxSavedUsd', 'savingPerDollar', 'cumulativeLossUsd', 'cumulativeSavedUsd']) assert.ok(key in step, key)
    assert.ok(step.lossUsd < 0)
  }
  for (let i = 1; i < json.frontier.length; i += 1) assert.ok(json.frontier[i].savingPerDollar <= json.frontier[i - 1].savingPerDollar)
  assert.equal(json.frontier.at(-1).cumulativeLossUsd, -1300)
  assert.ok(json.frontier[0].taxSavedUsd > 0, 'year-to-date gains give the losses something to offset')
  const [none, all] = json.comparison
  assert.ok(Math.abs(none.estimate.totalUsd - all.estimate.totalUsd - json.frontier.at(-1).cumulativeSavedUsd) < 0.05)
  assert.ok(json.sales.every((s: any) => s.gainUsd < 0))
})

test('tax:scenario --prices overrides stored prices and is named in provenance', () => {
  const file = path.join(fixture.dir, 'quotes.json')
  writeFileSync(file, JSON.stringify({ asOf: '2026-06-15T13:00:00Z', quotes: { AAA: 300 } }))
  const json = ok(fixture, ['tax:scenario', '--scenario', 'sell-all', '--as-of', AS_OF, '--prices', file])
  assert.equal(json.provenance.priceSource, 'file:quotes.json')
  assert.equal(json.provenance.pricesAsOf, '2026-06-15T13:00:00Z')
  assert.equal(json.sales.find((s: any) => s.ticker === 'AAA').proceedsUsd, 3000)
  assert.equal(json.sales.find((s: any) => s.ticker === 'CCC').proceedsUsd, 3000, 'no quote: the stored price stays')
  writeFileSync(file, '{"quotes": {}}')
  assert.equal(runCli(fixture, ['tax:scenario', '--scenario', 'sell-all', '--prices', file, '--json']).code, 2)
})

test('tax:scenario without --json prints a table and the provenance lines', () => {
  const result = runCli(fixture, ['tax:scenario', '--scenario', 'sell-all', '--as-of', AS_OF])
  assert.equal(result.code, 0)
  assert.match(result.stdout, /^tax:scenario sell-all/)
  assert.match(result.stdout, /AAA\s+Example Taxable/)
  assert.match(result.stdout, /not tax advice/)
})

test('tax:calendar: wash-sale window with DRIP, cash-account settlement, coverage', () => {
  const json = ok(fixture, ['tax:calendar', '--as-of', AS_OF])
  assert.equal(json.asOf, AS_OF)
  assert.deepEqual(json.washSaleWindows, [
    {
      ticker: 'EEE',
      soldDate: '2026-06-01',
      blockedThrough: '2026-07-01',
      daysLeft: 16,
      realizedLossUsd: -300,
      accounts: [TAXABLE],
      boughtSinceSale: true,
      dripActive: true,
    },
  ])
  assert.deepEqual(json.drip, [{ ticker: 'EEE', lastReinvestDate: '2026-06-05', accounts: [TAXABLE] }])
  assert.equal(json.settlement.status, 'ok')
  assert.equal(json.settlement.reason, null)
  assert.deepEqual(json.settlement.items, [
    { account: CASH, ticker: 'HHH', buyDate: '2026-06-12', fundedBySaleDate: '2026-06-12', settlesOn: '2026-06-15', earliestSaleDate: '2026-06-15' },
  ])
  assert.deepEqual(json.coverage, { brokerages: ['Example Broker'], excludes: ['KR', 'crypto', 'options'] })
})

test('tax:calendar settlement is unavailable until an account is marked cashAccount', () => {
  const f = buildCliFixture({ accountMap: false })
  const json = ok(f, ['tax:calendar', '--as-of', AS_OF])
  assert.equal(json.settlement.status, 'unavailable')
  assert.match(json.settlement.reason, /cashAccount/)
  assert.deepEqual(json.settlement.items, [])
})

test('tax:realized lists US sales in range, without superseded or Korean rows', () => {
  const json = ok(fixture, ['tax:realized', '--since', '2026-01-01', '--until', '2026-06-30'])
  assert.deepEqual(json.rows, [
    { account: TAXABLE, brokerage: 'Example Broker', ticker: 'FFF', soldDate: '2026-02-10', quantity: 2, proceedsUsd: 250, gainUsd: 150, term: 'long', basis: 'replay' },
    { account: TAXABLE, brokerage: 'Example Broker', ticker: 'EEE', soldDate: '2026-06-01', quantity: 3, proceedsUsd: 600, gainUsd: -300, term: 'short', basis: 'replay' },
  ])
  assert.deepEqual(ok(fixture, ['tax:realized', '--since', '2026-03-01', '--until', '2026-05-31']).rows, [])
})

test('sources:status: last push, newest file per folder with account digits masked, what is due', () => {
  const json = ok(fixture, ['sources:status'])
  assert.equal(json.lastPush.at, '2026-06-15T10:00:00.000Z')
  assert.equal(typeof json.lastPush.ageHours, 'number')
  const byFolder = Object.fromEntries(json.sources.map((s: any) => [s.folder, s]))
  assert.equal(byFolder['us-holdings'].latestFile, 'example-holdings-20260610.csv')
  assert.equal(byFolder['bank-statements'].latestFile, 'example-checking-****-20260501-20260531.pdf')
  assert.equal(byFolder['kr-statements'].latestFile, null)
  assert.equal(json.due.length, 1)
  assert.equal(json.due[0].kind, 'account')
  assert.deepEqual(json.due[0].accounts, [TAXABLE])
  assert.equal(json.due[0].status, 'action_needed')
})

test('the FX table is what the fixture says it is', () => {
  // Guards the hand-derived figures above against a fixture edit.
  assert.deepEqual(FX.map((r) => r.rate), [1100, 1300, 1350])
})
