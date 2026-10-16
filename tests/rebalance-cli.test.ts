import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-cli-'))
process.env.STOCK_REBALANCE_PROPOSALS_DIR = path.join(root, 'proposals')
process.env.STOCK_ALLOCATION_POLICY_PATH = path.join(root, 'none.json')
// A typo'd runner: the monthly path warns on stderr and falls back to claude.
process.env.STOCK_REBALANCE_LLM_RUNNER = 'bogus-runner'

const run = async (argv: string[]) => {
  const { runRebalanceCli } = await import('../lib/rebalance/cli')
  let out = ''
  let err = ''
  const code = await runRebalanceCli(argv, { out: (t) => (out += t), err: (t) => (err += t) }, new Date('2026-10-15T01:00:00Z'))
  return { code, out, err }
}

test('status with no open proposal reports open: null in the envelope', async () => {
  const r = await run(['status'])
  assert.equal(r.code, 0)
  assert.deepEqual(JSON.parse(r.out), { schemaVersion: 1, ok: true, command: 'status', open: null })
})

test('an unknown command exits 2 with usage on stderr', async () => {
  const r = await run(['bogus'])
  assert.equal(r.code, 2)
  assert.equal(r.out, '')
  assert.match(r.err, /unknown command/)
})

test('propose with no policy exits 1 with ok:false', async () => {
  const r = await run(['propose'])
  assert.equal(r.code, 1)
  const body = JSON.parse(r.out)
  assert.equal(body.schemaVersion, 1)
  assert.equal(body.ok, false)
  assert.equal(body.command, 'propose')
  assert.equal(body.reason, 'not_configured')
})

test('reconcile with nothing executing exits 0', async () => {
  const r = await run(['reconcile'])
  assert.equal(r.code, 0)
  assert.deepEqual(JSON.parse(r.out), { schemaVersion: 1, ok: true, command: 'reconcile', expired: [], reconciled: [], failed: [] })
})

test('the default today is the portfolio calendar (STOCK_TIME_ZONE), the same as the UI', async () => {
  const { defaultToday } = await import('../lib/rebalance/cli')
  const { portfolioToday } = await import('../lib/adapters/portfolio-db')
  const previous = process.env.STOCK_TIME_ZONE
  process.env.STOCK_TIME_ZONE = 'America/Los_Angeles'
  try {
    // 20:00 UTC is already the 16th in Seoul but still the 15th in Los Angeles.
    const at = new Date('2026-10-15T20:00:00Z')
    assert.equal(defaultToday(at), '2026-10-15')
    assert.equal(defaultToday(at), portfolioToday(at))
  } finally {
    if (previous === undefined) delete process.env.STOCK_TIME_ZONE
    else process.env.STOCK_TIME_ZONE = previous
  }
})

test('an unknown STOCK_REBALANCE_LLM_RUNNER warns on stderr and leaves stdout JSON unchanged', async () => {
  const monthly = await run(['propose', '--kind', 'monthly'])
  assert.equal(monthly.code, 1)
  assert.equal(monthly.err, 'warning: STOCK_REBALANCE_LLM_RUNNER="bogus-runner" is not one of claude, codex; using claude\n')
  assert.deepEqual(Object.keys(JSON.parse(monthly.out)), ['schemaVersion', 'ok', 'command', 'reason', 'detail', 'openId'])
  assert.equal(monthly.out.trim().split('\n').length, 1)
  // No LLM step, no warning.
  for (const argv of [['propose'], ['propose', '--kind', 'monthly', '--no-llm']]) assert.equal((await run(argv)).err, '')
})
