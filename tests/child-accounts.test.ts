import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { config } from '@/config'
import { runIngest } from './ingest-harness'
import { CHILD_LABEL, CHILD_OWNER, CHILD_PENSION, CHILD_TOKEN, writeScenario } from './pension-fixtures'

// A child's account is owned by the child: it is shown apart, labelled, and is
// never inside a total-assets, FBAR, tax, stock or briefing figure. Every
// account, label and amount here is invented; the repository is public.

function scenario(withChildren: boolean) {
  const dir = mkdtempSync(path.join(tmpdir(), 'child-accounts-'))
  const env = writeScenario(dir, { withPensions: true, withChildren })
  return { dbPath: runIngest(dir, { env, allowFailure: true }), mapPath: env.STOCK_ACCOUNT_MAP_PATH }
}

const without = scenario(false)
const withKids = scenario(true)

async function adapter(which: { dbPath: string; mapPath: string }) {
  config.stockDbPath = which.dbPath
  config.stockAccountMapPath = which.mapPath
  return import('../lib/adapters/portfolio-db')
}

test('the ingest tags the child account with its owner, and loads nothing for a retired entry', () => {
  const db = new Database(withKids.dbPath, { readonly: true })
  const owners = db.prepare('select distinct account, owner from holdings_all where owner != ?').all('self') as { account: string; owner: string }[]
  assert.deepEqual(owners, [{ account: CHILD_PENSION, owner: CHILD_OWNER }])
  // The stored total; the deposit before it is a derived point (tests/child-pension-history.test.ts).
  const points = db.prepare('select account, owner, value_krw as v from pension_points where owner != ? and derivation is null').all('self') as { account: string; owner: string; v: number }[]
  assert.deepEqual(points, [{ account: CHILD_PENSION, owner: CHILD_OWNER, v: 190_000 }])
  assert.deepEqual(db.prepare('select account, owner, owner_label as label from account_owners').all(), [
    { account: CHILD_PENSION, owner: CHILD_OWNER, label: CHILD_LABEL },
  ])
  const flows = db.prepare('select owner, kind, amount_krw as amount from pension_flows where account = ?').all(CHILD_PENSION)
  assert.deepEqual(flows, [{ owner: CHILD_OWNER, kind: 'contribution', amount: 300_000 }])
  assert.equal((db.prepare("select count(*) as n from holdings_all where account like '%해지%'").get() as { n: number }).n, 0)
  db.close()
})

test("the maintainer's own pension snapshot never picks up a child's file", () => {
  const db = new Database(withKids.dbPath, { readonly: true })
  const sources = db.prepare("select distinct account, source from pension_points where source like 'snapshot:%' order by account").all() as { account: string; source: string }[]
  for (const row of sources) {
    if (row.account === CHILD_PENSION) assert.ok(row.source.includes(CHILD_TOKEN))
    else assert.ok(!row.source.includes('child-'), `${row.account} read ${row.source}`)
  }
  db.close()
})

test('net worth, the total-assets trend and FBAR are self only; the child is reported apart', async () => {
  const base = await adapter(without)
  const beforeWorth = base.getNetWorth()
  const beforeSeries = base.getTotalAssetsSeries(['2026-01-01', '2026-10-08'], beforeWorth)
  const beforeFbar = base.getForeignAccountMaxima(2026)

  const kids = await adapter(withKids)
  const worth = kids.getNetWorth()
  assert.deepEqual(worth.byClass, beforeWorth.byClass)
  assert.equal(worth.totalKrw, beforeWorth.totalKrw)
  assert.ok(!worth.asOfNotes.some((note) => note.label === CHILD_PENSION))
  const series = kids.getTotalAssetsSeries(['2026-01-01', '2026-10-08'], worth)
  assert.deepEqual(series.points.slice(0, -1), beforeSeries.points.slice(0, -1))
  const fbar = kids.getForeignAccountMaxima(2026)
  assert.deepEqual(fbar.rows, beforeFbar.rows)
  assert.ok(!fbar.rows.some((row) => row.account === CHILD_PENSION))

  const children = kids.getChildAssets(['2026-01-01', '2026-10-08', '9999-12-31'])
  assert.deepEqual(
    children.owners.map((owner) => [owner.owner, owner.label, owner.totalKrw, owner.accounts.map((account) => account.account)]),
    [[CHILD_OWNER, CHILD_LABEL, 200_000, [CHILD_PENSION]]]
  )
  // Before the snapshot nothing; on its date the snapshot total; today the priced holdings.
  assert.deepEqual(
    children.points.map((point) => point.total),
    [null, 190_000, 200_000]
  )
})

test('the pension page data labels the child account, and the limits and tax review leave it out', async () => {
  const { getPensionAccounts, getWrapperReview } = await adapter(withKids)
  const { contributionsAgainstLimits } = await import('../lib/pension')
  const accounts = getPensionAccounts()
  const child = accounts.find((account) => account.account === CHILD_PENSION)!
  assert.equal(child.owner, CHILD_OWNER)
  assert.equal(child.ownerLabel, CHILD_LABEL)
  assert.ok(accounts.filter((account) => account.account !== CHILD_PENSION).every((account) => account.owner === 'self' && account.ownerLabel === null))
  const selfYears = contributionsAgainstLimits(accounts.filter((account) => account.owner === 'self'), {} as never)
  const before = await adapter(without)
  const baseYears = contributionsAgainstLimits(before.getPensionAccounts(), {} as never)
  assert.deepEqual(selfYears, baseYears)

  const kids = await adapter(withKids)
  assert.ok(!kids.getWrapperReview().some((row) => row.account === CHILD_PENSION))
})

test('stock pages, the briefing figures, tax planning and the stock checks never see the child account', async () => {
  const base = await adapter(without)
  const beforeOverview = base.getOverview().totals
  const beforeChecks = base.getValidationChecks().map((check) => [check.name, check.status])
  const beforeTop = base.getTopHoldings(100)

  const kids = await adapter(withKids)
  assert.deepEqual(kids.getOverview().totals, beforeOverview)
  assert.ok(!kids.getHoldings().some((row) => row.account === CHILD_PENSION))
  assert.deepEqual(kids.getTopHoldings(100), beforeTop)
  assert.ok(!kids.getTaxPlanningLots().some((lot) => lot.account === CHILD_PENSION))
  assert.ok(!JSON.stringify(kids.getPortfolioReview()).includes(CHILD_PENSION))
  const checks = kids.getValidationChecks()
  assert.deepEqual(
    checks.filter((check) => !check.name.startsWith('pension_')).map((check) => [check.name, check.status]),
    beforeChecks.filter(([name]) => !String(name).startsWith('pension_'))
  )
  for (const check of checks.filter((check) => !check.name.startsWith('pension_'))) {
    assert.ok(!String(check.detail ?? '').includes(CHILD_PENSION), `${check.name} names the child account`)
  }
})

test('the weekly reminder lists the child account under its owner label, never a retired one', async () => {
  const { getSupplementaryCoverage } = await adapter(withKids)
  const items = JSON.stringify(getSupplementaryCoverage())
  assert.ok(items.includes(`${CHILD_LABEL} ${CHILD_PENSION}`))
  assert.ok(!items.includes('해지'))
})
