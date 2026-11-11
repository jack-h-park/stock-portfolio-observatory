import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'
import example from '../examples/tax-history.synthetic.json'
import { validateTaxHistory, emptyTaxHistory } from '../lib/domain/taxes/history'
import { readTaxHistory, commitTaxHistory } from '../lib/adapters/tax-history-store'
import { previewTaxHistoryImport, applyTaxHistoryImport } from '../lib/application/import-tax-history'
import { getFinanceOverview } from '../lib/application/finance-overview'
import { getTaxHistoryView } from '../lib/application/tax-history-query'
import { resolveTaxEvidence, indexEvidenceRoot } from '../lib/application/evidence-index'
import { planFinanceStateMigration, applyFinanceStateMigration } from '../scripts/migrate-finance-state.mjs'
import { ingestEnv } from './ingest-harness'
import { writeScenario } from './pension-fixtures'

const repo = process.cwd()
function sandbox(t: TestContext) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'finance-review-')))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !['STOCK_', 'FINANCE_', 'SAMPLE_'].some((prefix) => key.startsWith(prefix)),
      ),
    ),
    ...extra,
  } as NodeJS.ProcessEnv
}
function seed(dir: string, extra: Record<string, string> = {}) {
  return spawnSync(process.execPath, [path.join(repo, 'scripts/seed-sample.mjs')], {
    cwd: dir,
    env: cleanEnv(extra),
    encoding: 'utf8',
  })
}
const options = (incoming = validateTaxHistory(example)) => ({
  expectedRevision: 0,
  incoming,
  reason: 'Reviewed synthetic records',
  reviewedRecordChanges: [],
  reviewedMatchDecisions: [],
})

test('explicit private mode and dangling sample leaves cannot overwrite files outside the sample root', (t) => {
  const dir = sandbox(t)
  fs.mkdirSync(path.join(dir, 'data'))
  fs.writeFileSync(path.join(dir, 'data/manual-mappings.json'), 'private sentinel')
  assert.notEqual(seed(dir, { FINANCE_MODE: 'private', SAMPLE_FORCE: '1' }).status, 0)
  assert.equal(fs.readFileSync(path.join(dir, 'data/manual-mappings.json'), 'utf8'), 'private sentinel')
  assert.equal(seed(dir).status, 0)
  const leaf = path.join(dir, 'private-data/personal-finance-sample/runtime/fx-rates.json'),
    outside = path.join(dir, 'never-created.json')
  fs.unlinkSync(leaf)
  fs.symlinkSync(outside, leaf)
  assert.notEqual(seed(dir).status, 0)
  assert.equal(fs.existsSync(outside), false)
})
test('a synthetic DB is refused before a publisher reads credentials or reaches a sheet', (t) => {
  const dir = sandbox(t)
  assert.equal(seed(dir).status, 0)
  const result = spawnSync(
    process.execPath,
    [path.join(repo, 'scripts/publish-sheet.mjs'), '--market', 'KR', '--apply'],
    {
      cwd: dir,
      env: cleanEnv({
        FINANCE_MODE: 'sample',
        STOCK_KR_SHEET_ID: 'synthetic-never-contacted',
        STOCK_SHEETS_SA_KEY: path.join(dir, 'absent-key.json'),
      }),
      encoding: 'utf8',
    },
  )
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /sample|synthetic/i)
  assert.doesNotMatch(result.stderr, /cannot read the service-account key/)
})
test('operational consumers retain their private fallback without a file/runtime override', async () => {
  const module = await import('../scripts/finance-paths.mjs')
  const resolver = (
    module as unknown as { financeOperationalFile: (key: string, fallback: string, env: object, cwd: string) => string }
  ).financeOperationalFile
  assert.equal(typeof resolver, 'function')
  assert.equal(resolver('STOCK_DB_PATH', '/legacy/operational.db', {}, '/sandbox'), '/legacy/operational.db')
  assert.equal(
    resolver(
      'STOCK_BRIEFING_SUMMARY_PATH',
      '/legacy/summary.json',
      { FINANCE_BRIEFING_SUMMARY_PATH: '/new/summary.json' },
      '/sandbox',
    ),
    '/new/summary.json',
  )
})
test('serialized audit growth cannot publish a store that the next read rejects', (t) => {
  const dir = sandbox(t),
    file = path.join(dir, 'history.json')
  const first = commitTaxHistory(file, {
    expectedRevision: 0,
    next: validateTaxHistory(example),
    actor: 'import',
    reason: 'Initial',
    stateWritable: true,
  })
  const next = structuredClone(first)
  for (let i = 0; i < 40000; i++)
    next.taxUnits.push({
      id: `unit-${i}-${'x'.repeat(80)}`,
      recordRevision: 1,
      year: 2025,
      kind: 'individual',
      ownerIds: [`owner-${i}`],
    })
  assert.throws(
    () =>
      commitTaxHistory(file, {
        expectedRevision: 1,
        next,
        actor: 'import',
        reason: 'Oversized history',
        stateWritable: true,
      }),
    /size|limit|large/i,
  )
  assert.deepEqual(readTaxHistory(file), first)
})
test('duplicate review can keep distinct equal payments and detects candidates within a first batch', (t) => {
  const dir = sandbox(t),
    file = path.join(dir, 'history.json'),
    incoming = validateTaxHistory(example)
  incoming.events.push({ ...incoming.events[1], id: 'payment-copy' })
  const preview = previewTaxHistoryImport(emptyTaxHistory(), incoming)
  assert.ok(
    preview.possibleDuplicates.some(
      (row) => row.incomingEventId === 'payment-copy' && row.existingEventId === 'payment',
    ),
  )
  const result = applyTaxHistoryImport(file, {
    ...options(incoming),
    reviewedMatchDecisions: [{ incomingEventId: 'payment-copy', existingEventId: 'payment', action: 'keep-separate' }],
  } as Parameters<typeof applyTaxHistoryImport>[1])
  assert.equal(result.events.length, 5)
})
test('portable fresh imports rebase only the accepted content version of a reviewed liability', (t) => {
  const dir = sandbox(t),
    file = path.join(dir, 'history.json'),
    incoming = validateTaxHistory(example)
  incoming.assessments[0].recordRevision = 3
  incoming.obligations[0].effectiveBasis!.recordRevision = 3
  const after = applyTaxHistoryImport(file, options(incoming))
  assert.equal(after.assessments[0].recordRevision, 1)
  assert.equal(after.obligations[0].effectiveBasis!.recordRevision, 1)
  assert.deepEqual(applyTaxHistoryImport(file, { ...options(incoming), expectedRevision: 1 }), after)
})
test('equivalent allocation merges retain evidence and never use tombstones as live matches', (t) => {
  const dir = sandbox(t)
  for (const tombstone of [false, true]) {
    const file = path.join(dir, `merge-${tombstone}.json`)
    let current = applyTaxHistoryImport(file, options())
    if (tombstone) {
      const next = structuredClone(current)
      next.allocations.find((row) => row.id === 'alloc-p25')!.deleted = true
      current = commitTaxHistory(file, {
        expectedRevision: 1,
        next,
        actor: 'local-user',
        reason: 'Retired allocation',
        stateWritable: true,
      })
    }
    const incoming = structuredClone(current)
    incoming.evidence.push({ ...incoming.evidence[1], id: 'doc-3' })
    incoming.events.push({
      ...incoming.events.find((row) => row.id === 'payment')!,
      id: 'pay-copy',
      recordRevision: 1,
      evidenceIds: ['doc-3'],
    })
    incoming.allocations.push({
      ...incoming.allocations.find((row) => row.id === 'alloc-p25')!,
      id: 'new-p25',
      recordRevision: 1,
      deleted: false,
      eventId: 'pay-copy',
      evidenceIds: ['doc-3'],
    })
    const preview = previewTaxHistoryImport(current, incoming)
    const after = applyTaxHistoryImport(file, {
      ...options(incoming),
      expectedRevision: current.revision,
      reviewedMatchDecisions: preview.possibleDuplicates,
    })
    const allocations = after.allocations.filter(
      (row) => !row.deleted && row.eventId === 'payment' && row.obligationId === 'us-2025',
    )
    assert.equal(allocations.length, 1)
    assert.ok(allocations[0].evidenceIds.includes('doc-3'))
    assert.equal(allocations[0].id, tombstone ? 'new-p25' : 'alloc-p25')
  }
})
test('an assessment-content change cannot silently carry an old reviewed basis forward', (t) => {
  const dir = sandbox(t),
    file = path.join(dir, 'basis.json'),
    current = applyTaxHistoryImport(file, options())
  const incoming = structuredClone(current)
  incoming.assessments[0].liability.minor = '12000'
  const preview = previewTaxHistoryImport(current, incoming)
  assert.deepEqual(
    preview.basisInvalidations.map((row) => row.obligationId),
    ['us-2025'],
  )
  assert.throws(
    () =>
      applyTaxHistoryImport(file, {
        ...options(incoming),
        expectedRevision: 1,
        reviewedRecordChanges: preview.changes,
      }),
    /basis|provisional/i,
  )
  const after = applyTaxHistoryImport(file, {
    ...options(incoming),
    expectedRevision: 1,
    reviewedRecordChanges: preview.changes,
    reviewedProvisionalBases: ['us-2025'],
  })
  assert.equal(after.obligations[0].effectiveBasis!.recordRevision, 1)
  assert.equal(after.assessments[0].recordRevision, 2)
})
test('pension cash products reconcile against account cash and both allocation axes equal current assets', async (t) => {
  const dir = sandbox(t)
  assert.equal(seed(dir).status, 0)
  const file = path.join(dir, 'private-data/personal-finance-sample/runtime/observatory.db'),
    db = new Database(file)
  db.exec(`delete from holdings_all; delete from cash_balances; delete from fx_account_balances;
    insert into holdings_all(market,currency,base_currency,brokerage,account,ticker,name,quantity,native_cost,total_cost_krw,base_market_value,base_cost,account_wrapper,asset_class,owner,as_of_date) values
    ('KR','KRW','KRW','Example','pension','PENSION:sample:cash:a','Cash A',0,100,100,100,100,'irp','security','self','2026-10-01'),
    ('KR','KRW','KRW','Example','pension','PENSION:sample:cash:b','Cash B',0,200,200,200,200,'irp','security','self','2026-10-01'),
    ('US','USD','KRW','Example','cash','SPAXX','Sweep',1,1,1,1300,1300,'taxable','security','self','2026-10-01');
    create table brokerage_cash(id integer,institution text,account text,pool text,currency text,as_of_date text,balance real,account_wrapper text,asset_class text);
    insert into brokerage_cash values(1,'Example','pension','krw','KRW','2026-10-01',300,'irp','security'),(2,'Example','cash','usd','USD','2026-10-01',1,'taxable','security');`)
  db.close()
  assert.equal(getFinanceOverview(file).totalKrw, 1600)
  const { config } = await import('../config'),
    prior = config.stockDbPath
  try {
    config.stockDbPath = file
    const { getAssetAllocation } = await import('../lib/adapters/portfolio-db'),
      result = getAssetAllocation()
    assert.equal(result.totalKrw, 1600)
    assert.equal(result.classes.find((row) => row.key === 'cash')?.valueKrw, 1600)
    assert.equal(result.wrappers.find((row) => row.key === 'pension')?.valueKrw, 300)
    assert.equal(
      result.wrappers.reduce((n, row) => n + row.valueKrw, 0),
      1600,
    )
  } finally {
    config.stockDbPath = prior
  }
})
test('same-root and nested-root links are refused even when their bytes match', (t) => {
  const dir = sandbox(t),
    tax = path.join(dir, 'tax')
  fs.mkdirSync(tax)
  fs.writeFileSync(path.join(tax, 'real.pdf'), 'same bytes')
  fs.symlinkSync(path.join(tax, 'real.pdf'), path.join(dir, 'alias.pdf'))
  const record = {
    id: 'document',
    recordRevision: 1,
    root: 'records' as const,
    relativePath: 'alias.pdf',
    sha256: '0'.repeat(64),
  }
  assert.throws(() => resolveTaxEvidence(record, { records: dir, tax }), /symlink|real file/i)
})
test('a document that cannot be read makes a hash search incomplete', t=>{
  const dir=sandbox(t),file=path.join(dir,'unreadable.pdf');fs.writeFileSync(file,'synthetic')
  const open=fs.openSync
  fs.openSync=((target:fs.PathLike,...args:unknown[])=>{if(target===file)throw Object.assign(new Error('denied'),{code:'EACCES'});return (open as (...values:unknown[])=>number)(target,...args)}) as typeof fs.openSync
  try{assert.equal(indexEvidenceRoot(dir,'0'.repeat(64)).complete,false)}finally{fs.openSync=open}
})
test('migration rejects a conflicting destination introduced after preflight', (t) => {
  const dir = sandbox(t),
    source = path.join(dir, 'source.json'),
    destination = path.join(dir, 'destination.json')
  fs.writeFileSync(source, 'source')
  const plan = planFinanceStateMigration([{ source, destination, owner: 'operator', kind: 'state' }])
  const exists = fs.existsSync
  let probes = 0
  fs.existsSync = ((file: fs.PathLike) => {
    if (file === destination && ++probes === 2) fs.writeFileSync(destination, 'interloper')
    return exists(file)
  }) as typeof fs.existsSync
  try {
    assert.throws(() => applyFinanceStateMigration(plan), /conflict|hash|changed/i)
  } finally {
    fs.existsSync = exists
  }
  assert.equal(fs.readFileSync(destination, 'utf8'), 'interloper')
})
test('direct ingest provisions a new runtime DB and keeps generated reports there', (t) => {
  const dir = sandbox(t),
    scenario = writeScenario(dir, { withPensions: false }),
    runtime = path.join(dir, 'brand-new/runtime')
  const env = ingestEnv(dir, { ...scenario, STOCK_DB_PATH: '', FINANCE_RUNTIME_DIR: runtime })
  spawnSync(process.execPath, [path.join(repo, 'scripts/ingest-stock-data.mjs')], {
    cwd: dir,
    env: env as NodeJS.ProcessEnv,
    encoding: 'utf8',
  })
  assert.equal(fs.existsSync(path.join(runtime, 'observatory.db')), true)
  assert.equal(fs.existsSync(path.join(runtime, 'validation-report.json')), true)
  assert.equal(fs.existsSync(path.join(dir, 'outputs/stock-portfolio-observatory/validation-report.json')), false)
})
test('date-bounded unallocated history includes interest/penalty and excludes other dates', () => {
  const store = validateTaxHistory(example)
  store.events.push({
    ...store.events[1],
    id: 'interest-only',
    date: '2026-04-10',
    principal: '0',
    interest: '250',
    penalty: '25',
  })
  store.events.push({ ...store.events[1], id: 'outside-range', date: '2026-04-11' })
  const view = getTaxHistoryView(store, {
    taxUnitId: '__all__',
    view: 'cash-date',
    cashDateFrom: '2026-04-10',
    cashDateTo: '2026-04-10',
  })
  assert.deepEqual(
    view.unallocated.map((row) => row.eventId),
    ['interest-only'],
  )
  assert.equal(view.unallocated[0].interest, '250')
  assert.equal((view.unallocated[0] as unknown as { date: string }).date, '2026-04-10')
})
test('read-only record detail retains filing versions, adjustments, evidence and collection-aware audit', async () => {
  const module = await import('../lib/application/tax-record-detail')
  const store = validateTaxHistory(example)
  store.adjustments.push({
    id: 'credit',
    recordRevision: 1,
    obligationId: 'us-2025',
    amount: { currency: 'USD', minor: '100' },
    effectiveDate: '2026-04-01',
    evidenceIds: ['doc-2'],
  })
  const detail = module.getTaxRecordDetail(store, 'us-2025')
  assert.ok(detail)
  assert.equal(detail.versions.length, 3)
  assert.equal(detail.versions.find((row) => row.id === 'return-amended')?.status, 'submitted')
  assert.equal(detail.adjustments[0].amount.minor, '100')
  assert.ok(detail.evidenceIds.includes('doc-2'))
  const unrelated = { ...store.events[0], id: 'us-2025', deleted: true }
  store.events.push(unrelated)
  store.revision = 2
  store.changes = [
    {
      id: 'unrelated',
      storeRevision: 1,
      changedAt: '2026-04-01T00:00:00Z',
      actor: 'import',
      reason: 'Unrelated event shares a bare ID',
      records: [{ collection: 'events', id: 'us-2025', before: null, after: unrelated }],
    },
    {
      id: 'related',
      storeRevision: 2,
      changedAt: '2026-04-02T00:00:00Z',
      actor: 'import',
      reason: 'Related adjustment',
      records: [{ collection: 'adjustments', id: 'credit', before: null, after: store.adjustments[0] }],
    },
  ]
  assert.deepEqual(
    module.getTaxRecordDetail(store, 'us-2025')!.auditChanges.map((change) => change.id),
    ['related'],
  )
})
