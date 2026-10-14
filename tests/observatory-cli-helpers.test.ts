import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { parseFlags, refreshLockHeld, UsageError } from '@/lib/cli/common'
import { maskFileName, SOURCE_FOLDERS } from '@/lib/cli/sources-status'
import { nextBusinessDay, settlementConstraints, usSettlementDate } from '@/lib/cli/tax-calendar'
import { buildPathFor, publishBuiltDb, removeAbandonedBuilds } from '@/scripts/db-swap.mjs'
import { REPO_ROOT, runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

test('flags: values, booleans, a pnpm "--", and unknown options refused', () => {
  const spec = { scenario: 'string', json: 'boolean' } as const
  assert.deepEqual(parseFlags(['--', '--scenario', 'harvest', '--json'], spec), { scenario: 'harvest', json: true })
  assert.deepEqual(parseFlags(['--scenario=lt-now'], spec), { scenario: 'lt-now' })
  assert.throws(() => parseFlags(['--scenaro', 'x'], spec), UsageError)
  assert.throws(() => parseFlags(['--scenario'], spec), UsageError)
  assert.throws(() => parseFlags(['--scenario', '--json'], spec), UsageError)
  assert.throws(() => parseFlags(['harvest'], spec), UsageError)
})

test('the refresh lock is held while its owner lives, or before its owner is written', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lock-'))
  const lock = path.join(dir, '.refresh.lock')
  assert.equal(refreshLockHeld(lock), false)
  mkdirSync(lock)
  assert.equal(refreshLockHeld(lock), true, 'no pid yet: a refresh that has just taken it')
  writeFileSync(path.join(lock, 'pid'), `${process.pid}\n`)
  assert.equal(refreshLockHeld(lock), true)
  writeFileSync(path.join(lock, 'pid'), '999999999\n')
  assert.equal(refreshLockHeld(lock), false, 'a dead owner is a stale lock')
})

test('settlement is T+1 on business days; a buy before its funding sale settles is listed', () => {
  assert.equal(nextBusinessDay('2026-06-12'), '2026-06-15') // Friday → Monday
  assert.equal(usSettlementDate('2026-06-10'), '2026-06-11')
  const trades = [
    { account: 'Cash A', ticker: 'GGG', date: '2026-06-10', type: 'SELL' as const },
    { account: 'Cash A', ticker: 'HHH', date: '2026-06-10', type: 'BUY' as const },
    { account: 'Cash A', ticker: 'III', date: '2026-06-11', type: 'BUY' as const },
    { account: 'Margin B', ticker: 'JJJ', date: '2026-06-10', type: 'BUY' as const },
    { account: 'Margin B', ticker: 'GGG', date: '2026-06-10', type: 'SELL' as const },
  ]
  assert.deepEqual(settlementConstraints(trades, ['Cash A'], '2026-06-10'), [
    { account: 'Cash A', ticker: 'HHH', buyDate: '2026-06-10', fundedBySaleDate: '2026-06-10', settlesOn: '2026-06-11', earliestSaleDate: '2026-06-11' },
  ])
  assert.deepEqual(settlementConstraints(trades, ['Cash A'], '2026-06-12'), [], 'once settled, nothing constrains')
})

test('file names keep their dates and lose any other long digit run', () => {
  assert.equal(maskFileName('example-holdings-20260610.csv'), 'example-holdings-20260610.csv')
  assert.equal(maskFileName('example-transactions-2025.csv'), 'example-transactions-2025.csv')
  assert.equal(maskFileName('example-statement-202509.pdf'), 'example-statement-202509.pdf')
  assert.equal(maskFileName('example-checking-4321-20260501-20260531.pdf'), 'example-checking-****-20260501-20260531.pdf')
  assert.equal(maskFileName('example-12345678901.pdf'), 'example-***********.pdf')
  assert.equal(maskFileName('example-99999999.csv'), 'example-********.csv', 'not a valid date')
  assert.equal(maskFileName('part-2.pdf'), 'part-2.pdf')
})

test('sources:status reads the same folders push-sources.sh carries', () => {
  const script = readFileSync(path.join(REPO_ROOT, 'scripts/push-sources.sh'), 'utf8')
  const block = script.match(/^SOURCES=\(\n([\s\S]*?)^\)/m)
  assert.ok(block)
  const pushed = block[1].split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
  assert.deepEqual([...SOURCE_FOLDERS], pushed)
})

test('db swap: the build replaces the live file whole, and a reader holding the old file keeps it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'db-swap-'))
  const live = path.join(dir, 'app.db')
  const old = new Database(live)
  old.pragma('journal_mode = WAL')
  old.exec("create table t (v text); insert into t values ('old')")
  old.close()

  const reader = new Database(live, { readonly: true, fileMustExist: true })
  assert.equal((reader.prepare('select v from t').get() as { v: string }).v, 'old')

  const build = buildPathFor(live)
  const next = new Database(build)
  next.pragma('journal_mode = WAL')
  next.exec("create table t (v text); insert into t values ('new')")
  next.pragma('wal_checkpoint(TRUNCATE)')
  next.close()
  publishBuiltDb(build, live)

  assert.equal((reader.prepare('select v from t').get() as { v: string }).v, 'old', 'an open reader is not pulled onto a half-built file')
  reader.close()
  const fresh = new Database(live, { readonly: true, fileMustExist: true })
  assert.equal((fresh.prepare('select v from t').get() as { v: string }).v, 'new')
  fresh.close()
  assert.ok(!existsSync(build))
})

test('db swap: a build whose owner died is removed; a live one is left alone', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'db-swap-'))
  const live = path.join(dir, 'app.db')
  writeFileSync(`${live}.building-999999999`, '')
  writeFileSync(`${live}.building-999999999-wal`, '')
  writeFileSync(`${live}.building-${process.ppid}`, '')
  removeAbandonedBuilds(live)
  assert.deepEqual(readdirSync(dir).sort(), [`app.db.building-${process.ppid}`])
})

test('ingest swaps its database in whole: no build file is left, and an open reader is undisturbed', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ingest-swap-'))
  writeSheetPayloads(dir)
  const dbPath = runIngest(dir, { allowFailure: true })
  const marker = new Database(dbPath)
  marker.exec("create table swap_marker (v text); insert into swap_marker values ('first build')")
  marker.close()

  const reader = new Database(dbPath, { readonly: true, fileMustExist: true })
  runIngest(dir, { allowFailure: true })
  assert.equal((reader.prepare('select v from swap_marker').get() as { v: string }).v, 'first build')
  reader.close()

  const after = new Database(dbPath, { readonly: true, fileMustExist: true })
  assert.equal(after.prepare("select 1 from sqlite_master where name = 'swap_marker'").get(), undefined, 'the second build replaced the file')
  assert.ok(after.prepare("select value from meta where key = 'ingested_at'").get())
  after.close()
  assert.deepEqual(readdirSync(path.dirname(dbPath)).filter((name) => name.includes('.building-')), [])
})

test('refresh-now.sh: exits 3 under a held lock, otherwise reports validation, failing checks, missing sources and rc', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'refresh-now-home-'))
  const bin = path.join(home, '.local/app-toolchain/bin')
  mkdirSync(bin, { recursive: true })
  // A stand-in pnpm: the ingest's lines, one missing export, a failing exit.
  writeFileSync(
    path.join(bin, 'pnpm'),
    '#!/bin/sh\necho "== ingest =="\necho "Wrote /tmp/x.db"\necho "Validation: 14/15 checks passing"\necho "[source] MISSING — example export"\nexit 1\n'
  )
  chmodSync(path.join(bin, 'pnpm'), 0o755)

  const data = mkdtempSync(path.join(tmpdir(), 'refresh-now-data-'))
  writeSheetPayloads(data)
  const dbPath = runIngest(data, { allowFailure: true })
  const db = new Database(dbPath)
  db.exec('delete from validation_checks')
  db.prepare("insert into validation_checks (name, status, detail, severity, scope) values ('example_check_ok', 'pass', '', 'error', 'stock')").run()
  db.prepare("insert into validation_checks (name, status, detail, severity, scope) values ('example_check_bad', 'fail', '', 'warning', 'stock')").run()
  db.close()

  const lock = path.join(home, '.refresh.lock')
  const log = path.join(home, 'refresh.log')
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !key.startsWith('STOCK_')) env[key] = value
  Object.assign(env, { HOME: home, OBSERVATORY_REPO: REPO_ROOT, OBSERVATORY_REFRESH_LOG: log, STOCK_REFRESH_LOCK_PATH: lock, STOCK_DB_PATH: dbPath })
  const run = () => spawnSync('bash', [path.join(REPO_ROOT, 'deploy/hermes/refresh-now.sh')], { env: env as NodeJS.ProcessEnv, encoding: 'utf8' })

  mkdirSync(lock)
  writeFileSync(path.join(lock, 'pid'), `${process.pid}\n`)
  const held = run()
  assert.equal(held.status, 3)
  assert.equal(held.stdout.trim(), 'Refresh already running')
  assert.ok(!existsSync(log), 'nothing ran')

  writeFileSync(path.join(lock, 'pid'), '999999999\n')
  const ran = run()
  assert.equal(ran.status, 1, ran.stdout + ran.stderr)
  assert.deepEqual(ran.stdout.trim().split('\n'), [
    'Validation: 14/15 checks passing',
    'Failing checks: example_check_bad (warning)',
    '[source] MISSING — example export',
    'rc=1',
  ])
  assert.match(readFileSync(log, 'utf8'), /refresh-now \(rc=1\)/)
})
