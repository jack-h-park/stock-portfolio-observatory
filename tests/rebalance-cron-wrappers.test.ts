// The rebalance cron wrappers (deploy/hermes/rebalance-*-cron.sh), run under bash against a throwaway
// directory: a fake `pnpm` that prints canned CLI JSON and records every call, a fake control plane whose
// run-agent-request.sh records its arguments, and a fake python that stands in for send_discord.py.
// Nothing here reaches Discord, Telegram, Hermes or the real repo's data.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const DEPLOY = path.join(HERE, '..', 'deploy', 'hermes')
const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0
const opts = { skip: hasBash ? false : 'bash is not available' }

type Fixture = {
  root: string
  pnpmLog: string
  rarLog: string
  sendLog: string
  ledger: string
  env: Record<string, string | undefined>
}

const FAKE_PNPM = `#!/usr/bin/env bash
# fake pnpm: -s <script> [args]; records the call, prints the canned JSON for that script.
shift
script="$1"; shift
echo "$script $*" >> "$FAKE_PNPM_LOG"
case "$script" in
  rebalance:propose)  printf '%s\\n' "$FAKE_PROPOSE_JSON"; exit "\${FAKE_PROPOSE_RC:-0}" ;;
  rebalance:triggers) printf '%s\\n' "$FAKE_TRIGGERS_JSON"; exit "\${FAKE_TRIGGERS_RC:-0}" ;;
  rebalance:notify)
    if [ "\${1:-}" = "--mark" ]; then printf '{"ok":true}\\n'; exit "\${FAKE_MARK_RC:-0}"; fi
    empty='{"ok":true,"events":[]}'
    printf '%s\\n' "\${FAKE_NOTIFY_JSON:-$empty}"; exit "\${FAKE_NOTIFY_RC:-0}" ;;
esac
exit 9
`

// Records its arguments one per line, then a separator, and writes the ledger entry the real one would.
const FAKE_RAR = `#!/usr/bin/env bash
for a in "$@"; do printf '%s\\n' "$a" >> "$FAKE_RAR_LOG"; done
echo "--end--" >> "$FAKE_RAR_LOG"
[ "\${HERMES_HOME_OPS:-}" = "$EXPECT_HERMES_HOME_OPS" ] || { echo "HERMES_HOME_OPS not passed" >&2; exit 7; }
exit "\${FAKE_RAR_RC:-0}"
`

// Stands in for "python3 send_discord.py ...": records argv and stdin.
const FAKE_PY = `#!/usr/bin/env bash
printf 'ARGS %s\\n' "$*" >> "$FAKE_SEND_LOG"
printf 'TEXT %s\\n' "$(cat)" >> "$FAKE_SEND_LOG"
exit "\${FAKE_SEND_RC:-0}"
`

function write(file: string, body: string, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body)
  fs.chmodSync(file, mode)
}

function fixture(over: Record<string, string | undefined> = {}, { controlPlane = true, discordEnv = true } = {}): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-cron-'))
  const repo = path.join(root, 'repo')
  write(path.join(repo, 'package.json'), '{}\n')
  const bin = path.join(root, 'bin')
  write(path.join(bin, 'pnpm'), FAKE_PNPM, 0o755)
  write(path.join(bin, 'fake-python'), FAKE_PY, 0o755)
  const cp = path.join(root, 'control-plane')
  write(path.join(cp, 'gateway', 'scripts', 'run-agent-request.sh'), FAKE_RAR, 0o755)
  write(path.join(cp, 'gateway', 'scripts', 'send_discord.py'), '# placeholder; the fake python never runs it\n')
  const opsHome = path.join(root, 'ops-home')
  const envFile = path.join(root, 'trader.env')
  if (discordEnv) write(envFile, 'OTHER_SECRET=nope\nDISCORD_BOT_TOKEN="tok-123"\n')
  const f: Fixture = {
    root,
    pnpmLog: path.join(root, 'pnpm.log'),
    rarLog: path.join(root, 'rar.log'),
    sendLog: path.join(root, 'send.log'),
    ledger: path.join(opsHome, 'state', 'rebalance-proposal-threads.json'),
    env: {},
  }
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: root,
    TMPDIR: root,
    OBSERVATORY_REPO: repo,
    REBALANCE_PNPM: path.join(bin, 'pnpm'),
    REBALANCE_PYTHON: path.join(bin, 'fake-python'),
    REBALANCE_DISCORD_ENV: envFile,
    REBALANCE_LOCK_DIR: path.join(root, 'lock'),
    HERMES_HOME_OPS: opsHome,
    EXPECT_HERMES_HOME_OPS: opsHome,
    FAKE_PNPM_LOG: f.pnpmLog,
    FAKE_RAR_LOG: f.rarLog,
    FAKE_SEND_LOG: f.sendLog,
    REBALANCE_TODAY_DOW: '1',
    REBALANCE_TODAY_DOM: '05',
  }
  if (controlPlane) env.HERMES_CONTROL_PLANE = cp
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete env[k]
    else env[k] = v
  }
  f.env = env
  return f
}

function run(f: Fixture, wrapper: string) {
  const r = spawnSync('bash', [path.join(DEPLOY, wrapper)], { env: f.env as NodeJS.ProcessEnv, encoding: 'utf8' })
  return { code: r.status, out: r.stdout, lines: r.stdout.split('\n').filter(Boolean), err: r.stderr }
}

const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')
const marks = (f: Fixture) => read(f.pnpmLog).split('\n').filter((l) => l.includes('--mark'))

function event(over: Record<string, unknown>) {
  return {
    id: 'rb-1:created:new',
    proposalId: 'rb-1',
    kind: 'created',
    detail: 'new',
    channels: ['telegram', 'discord'],
    telegram: 'TG created rb-1',
    discord: null,
    threadTitle: 'Rebalance rb-1',
    threadPrompt: 'Line one\nLine two',
    ...over,
  }
}
const notifyJson = (events: unknown[]) => JSON.stringify({ schemaVersion: 1, ok: true, command: 'notify', events })

// --- monthly ---------------------------------------------------------------------------------------------

test('monthly: not the first Monday → silent, exit 0, nothing run', opts, () => {
  for (const [dow, dom] of [['2', '03'], ['1', '08'], ['1', '15']]) {
    const f = fixture({ REBALANCE_TODAY_DOW: dow, REBALANCE_TODAY_DOM: dom })
    const r = run(f, 'rebalance-monthly-cron.sh')
    assert.equal(r.code, 0)
    assert.equal(r.out, '')
    assert.equal(read(f.pnpmLog), '')
  }
})

test('monthly: REBALANCE_FORCE_MONTHLY=1 bypasses the guard', opts, () => {
  const f = fixture({
    REBALANCE_TODAY_DOW: '3',
    REBALANCE_TODAY_DOM: '20',
    REBALANCE_FORCE_MONTHLY: '1',
    FAKE_PROPOSE_JSON: JSON.stringify({ ok: false, command: 'propose', reason: 'open_proposal_exists', openId: 'rb-0' }),
  })
  const r = run(f, 'rebalance-monthly-cron.sh')
  assert.equal(r.code, 0)
  assert.match(read(f.pnpmLog), /rebalance:propose --kind monthly/)
})

test('monthly: created → one line naming the proposal, then the notify flow', opts, () => {
  const f = fixture({
    FAKE_PROPOSE_JSON: JSON.stringify({ ok: true, command: 'propose', id: 'rb-1', status: 'draft', decision: 'hold', instructions: 3, llm: { status: 'ok', reason: null, attempts: 1 } }),
    FAKE_NOTIFY_JSON: notifyJson([]),
  })
  const r = run(f, 'rebalance-monthly-cron.sh')
  assert.equal(r.code, 0, r.err)
  assert.equal(r.lines.length, 1)
  assert.match(r.lines[0], /rb-1/)
  assert.match(r.lines[0], /3 instructions/)
  const calls = read(f.pnpmLog).split('\n').filter(Boolean)
  assert.deepEqual(calls, ['rebalance:propose --kind monthly', 'rebalance:notify '])
})

test('monthly: open proposal → one line, exit 0', opts, () => {
  const f = fixture({ FAKE_PROPOSE_JSON: JSON.stringify({ ok: false, command: 'propose', reason: 'open_proposal_exists', detail: 'x', openId: 'rb-0' }) })
  const r = run(f, 'rebalance-monthly-cron.sh')
  assert.equal(r.code, 0)
  assert.equal(r.lines.length, 1)
  assert.match(r.lines[0], /rb-0 is still open/)
})

test('monthly: not_configured → one line, exit 1, no notify', opts, () => {
  const f = fixture({
    FAKE_PROPOSE_JSON: JSON.stringify({ ok: false, command: 'propose', reason: 'not_configured', detail: '/private/path/policy.json missing' }),
    FAKE_PROPOSE_RC: '1',
  })
  const r = run(f, 'rebalance-monthly-cron.sh')
  assert.equal(r.code, 1)
  assert.equal(r.lines.length, 1)
  assert.match(r.lines[0], /not configured/)
  assert.doesNotMatch(r.out, /private/)
  assert.doesNotMatch(read(f.pnpmLog), /rebalance:notify/)
})

test('monthly: a crashed CLI (no JSON) → one line, exit 1', opts, () => {
  const f = fixture({ FAKE_PROPOSE_JSON: 'Error: boom', FAKE_PROPOSE_RC: '1' })
  const r = run(f, 'rebalance-monthly-cron.sh')
  assert.equal(r.code, 1)
  assert.equal(r.lines.length, 1)
  assert.match(r.lines[0], /could not run/)
})

// --- triggers --------------------------------------------------------------------------------------------

test('triggers: nothing due or skipped → silent', opts, () => {
  for (const json of [{ ok: true, due: [] }, { ok: true, skipped: 'refresh_in_progress' }]) {
    const f = fixture({ FAKE_TRIGGERS_JSON: JSON.stringify(json) })
    const r = run(f, 'rebalance-triggers-cron.sh')
    assert.equal(r.code, 0)
    assert.equal(r.out, '')
  }
})

test('triggers: created → one line with the id and trigger kinds, no tickers', opts, () => {
  const f = fixture({ FAKE_TRIGGERS_JSON: JSON.stringify({ ok: true, created: 'rb-2-band', due: ['band:us_equity', 'cap:US:AAPL'] }) })
  const r = run(f, 'rebalance-triggers-cron.sh')
  assert.equal(r.code, 0, r.err)
  assert.equal(r.lines.length, 1)
  assert.match(r.lines[0], /rb-2-band/)
  assert.match(r.lines[0], /2 trigger/)
  assert.doesNotMatch(r.lines[0], /AAPL/)
  assert.match(read(f.pnpmLog), /rebalance:notify/)
})

test('triggers: appended → one line', opts, () => {
  const f = fixture({ FAKE_TRIGGERS_JSON: JSON.stringify({ ok: true, appendedTo: 'rb-1', due: ['harvest'] }) })
  const r = run(f, 'rebalance-triggers-cron.sh')
  assert.equal(r.lines.length, 1)
  assert.match(r.lines[0], /added to open proposal rb-1/)
})

test('triggers: blocked by health errors → one line, exit 0', opts, () => {
  const f = fixture({ FAKE_TRIGGERS_JSON: JSON.stringify({ ok: true, blocked: 'health_errors' }) })
  const r = run(f, 'rebalance-triggers-cron.sh')
  assert.equal(r.code, 0)
  assert.equal(r.lines.length, 1)
  assert.match(r.lines[0], /held/)
  assert.match(r.lines[0], /\/health/)
})

test('triggers: not_configured → one line, exit 1', opts, () => {
  const f = fixture({ FAKE_TRIGGERS_JSON: JSON.stringify({ ok: false, reason: 'not_configured', detail: 'x' }), FAKE_TRIGGERS_RC: '1' })
  const r = run(f, 'rebalance-triggers-cron.sh')
  assert.equal(r.code, 1)
  assert.equal(r.lines.length, 1)
  assert.match(r.lines[0], /not configured/)
})

// --- notify ----------------------------------------------------------------------------------------------

test('notify: telegram lines printed and marked; created opens the thread and marks discord', opts, () => {
  const f = fixture({
    FAKE_NOTIFY_JSON: notifyJson([
      event({}),
      event({ id: 'rb-1:llm_failed:timeout', kind: 'llm_failed', detail: 'timeout', channels: ['telegram'], telegram: 'TG llm failed', threadTitle: null, threadPrompt: null }),
    ]),
  })
  const r = run(f, 'rebalance-notify-cron.sh')
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(r.lines, ['TG created rb-1', 'TG llm failed'])
  assert.deepEqual(marks(f), [
    'rebalance:notify --mark rb-1:created:new,rb-1:llm_failed:timeout --channel telegram',
    'rebalance:notify --mark rb-1:created:new --channel discord',
  ])
  const args = read(f.rarLog).split('\n')
  const at = (flag: string) => args[args.indexOf(flag) + 1]
  assert.equal(at('--kind'), 'proposal')
  assert.equal(at('--key'), 'proposal:rb-1')
  assert.equal(at('--title'), 'Rebalance rb-1')
  assert.equal(at('--origin'), 'sweep')
  assert.ok(read(f.rarLog).includes('Line one\nLine two'), 'the prompt is passed whole, newlines included')
  assert.doesNotMatch(r.out + r.err, /tok-123/)
})

test('notify: control plane absent → one notice line, discord left pending', opts, () => {
  const f = fixture({
    FAKE_NOTIFY_JSON: notifyJson([
      event({}),
      event({ id: 'rb-1:status_changed:plan_approved', kind: 'status_changed', detail: 'plan_approved', channels: ['discord'], telegram: null, discord: 'Status → plan approved.', threadTitle: null, threadPrompt: null }),
    ]),
  }, { controlPlane: false })
  const r = run(f, 'rebalance-notify-cron.sh')
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(r.lines, ['TG created rb-1', 'Discord thread not opened: control plane not configured'])
  assert.deepEqual(marks(f), ['rebalance:notify --mark rb-1:created:new --channel telegram'])
  assert.equal(read(f.rarLog), '')
  assert.equal(read(f.sendLog), '')
})

test('notify: trader Discord env missing → notice line, discord pending', opts, () => {
  const f = fixture({ FAKE_NOTIFY_JSON: notifyJson([event({ channels: ['discord'], telegram: null })]) }, { discordEnv: false })
  const r = run(f, 'rebalance-notify-cron.sh')
  assert.equal(r.code, 0, r.err)
  assert.equal(r.lines.length, 1)
  assert.match(r.lines[0], /^Discord thread not opened: /)
  assert.deepEqual(marks(f), [])
})

test('notify: a failed thread call leaves discord pending', opts, () => {
  const f = fixture({ FAKE_NOTIFY_JSON: notifyJson([event({ channels: ['discord'], telegram: null })]), FAKE_RAR_RC: '1' })
  const r = run(f, 'rebalance-notify-cron.sh')
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(marks(f), [])
  assert.match(read(f.rarLog), /proposal:rb-1/)
})

test('notify: a status line goes to the ledger thread and is marked', opts, () => {
  const f = fixture({
    FAKE_NOTIFY_JSON: notifyJson([
      event({ id: 'rb-1:status_changed:plan_approved', kind: 'status_changed', detail: 'plan_approved', channels: ['discord'], telegram: null, discord: 'Status → plan approved.', threadTitle: null, threadPrompt: null }),
    ]),
  })
  write(f.ledger, JSON.stringify({ version: 1, subjects: { 'proposal:rb-1': { thread_id: '998877' } } }))
  const r = run(f, 'rebalance-notify-cron.sh')
  assert.equal(r.code, 0, r.err)
  assert.equal(r.out, '')
  const sent = read(f.sendLog)
  assert.match(sent, /send_discord\.py --bot-token tok-123 --channel-id 998877 --usage-unit-key rebalance-notify/)
  assert.match(sent, /TEXT Status → plan approved\./)
  assert.deepEqual(marks(f), ['rebalance:notify --mark rb-1:status_changed:plan_approved --channel discord'])
})

test('notify: a status line with no thread in the ledger, or a failed send, stays pending', opts, () => {
  const ev = event({ id: 'rb-1:reminder:draft3d', kind: 'reminder', detail: 'draft3d', channels: ['discord'], telegram: null, discord: 'Reminder.', threadTitle: null, threadPrompt: null })
  const noThread = fixture({ FAKE_NOTIFY_JSON: notifyJson([ev]) })
  assert.equal(run(noThread, 'rebalance-notify-cron.sh').code, 0)
  assert.equal(read(noThread.sendLog), '')
  assert.deepEqual(marks(noThread), [])

  const failed = fixture({ FAKE_NOTIFY_JSON: notifyJson([ev]), FAKE_SEND_RC: '1' })
  write(failed.ledger, JSON.stringify({ version: 1, subjects: { 'proposal:rb-1': { thread_id: '55' } } }))
  assert.equal(run(failed, 'rebalance-notify-cron.sh').code, 0)
  assert.match(read(failed.sendLog), /--channel-id 55/)
  assert.deepEqual(marks(failed), [])
})

test('notify: nothing pending → silent; a failed notify command → one line, exit 1', opts, () => {
  const quiet = fixture({ FAKE_NOTIFY_JSON: JSON.stringify({ ok: true, events: [], seeded: true }) })
  const q = run(quiet, 'rebalance-notify-cron.sh')
  assert.equal(q.code, 0)
  assert.equal(q.out, '')

  const broken = fixture({ FAKE_NOTIFY_JSON: JSON.stringify({ ok: false, reason: 'error', detail: 'x' }), FAKE_NOTIFY_RC: '1' })
  const b = run(broken, 'rebalance-notify-cron.sh')
  assert.equal(b.code, 1)
  assert.equal(b.lines.length, 1)
  assert.match(b.lines[0], /Rebalance notify/)
})

test('a held lock → exit 0 silently; a stale one is taken over', opts, () => {
  const f = fixture({ FAKE_NOTIFY_JSON: notifyJson([event({ channels: ['telegram'], discord: null })]) })
  const lock = f.env.REBALANCE_LOCK_DIR as string
  fs.mkdirSync(lock)
  const held = run(f, 'rebalance-notify-cron.sh')
  assert.equal(held.code, 0)
  assert.equal(held.out, '')
  assert.equal(read(f.pnpmLog), '')

  const old = new Date(Date.now() - 31 * 60_000)
  fs.utimesSync(lock, old, old)
  const stale = run(f, 'rebalance-notify-cron.sh')
  assert.equal(stale.code, 0, stale.err)
  assert.deepEqual(stale.lines, ['TG created rb-1'])
  assert.equal(fs.existsSync(lock), false, 'the lock is released on exit')
})
