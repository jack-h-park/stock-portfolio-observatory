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
  repo: string
  lock: string
  attempts: string
  pnpmLog: string
  rarLog: string
  sendLog: string
  ledger: string
  env: Record<string, string | undefined>
}

// fake pnpm: -s <script> [args]; records the call and prints the canned JSON for that script.
// The nth `rebalance:notify` listing prints FAKE_NOTIFY_JSON_<n> when set, else FAKE_NOTIFY_JSON.
// FAKE_STEAL_LOCK simulates another run taking the lock over mid-run.
const FAKE_PNPM = `#!/usr/bin/env bash
shift
script="$1"; shift
echo "$script $*" >> "$FAKE_PNPM_LOG"
[ -n "\${FAKE_STEAL_LOCK:-}" ] && [ -d "$FAKE_STEAL_LOCK" ] && echo 999999 > "$FAKE_STEAL_LOCK/pid"
case "$script" in
  rebalance:propose)  printf '%s\\n' "$FAKE_PROPOSE_JSON"; exit "\${FAKE_PROPOSE_RC:-0}" ;;
  rebalance:triggers) printf '%s\\n' "$FAKE_TRIGGERS_JSON"; exit "\${FAKE_TRIGGERS_RC:-0}" ;;
  rebalance:notify)
    if [ "\${1:-}" = "--mark" ]; then printf '{"ok":true}\\n'; exit "\${FAKE_MARK_RC:-0}"; fi
    n=$(( $(cat "$FAKE_PNPM_LOG.n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$FAKE_PNPM_LOG.n"
    var="FAKE_NOTIFY_JSON_$n"
    empty='{"ok":true,"events":[]}'
    json="\${!var:-\${FAKE_NOTIFY_JSON:-$empty}}"
    printf '%s\\n' "$json"; exit "\${FAKE_NOTIFY_RC:-0}" ;;
esac
exit 9
`

// Records its arguments one per line, then a separator.
const FAKE_RAR = `#!/usr/bin/env bash
for a in "$@"; do printf '%s\\n' "$a" >> "$FAKE_RAR_LOG"; done
echo "--end--" >> "$FAKE_RAR_LOG"
[ "\${HERMES_HOME_OPS:-}" = "$EXPECT_HERMES_HOME_OPS" ] || { echo "HERMES_HOME_OPS not passed" >&2; exit 7; }
exit "\${FAKE_RAR_RC:-0}"
`

// Stands in for "python send_discord.py ...": records which interpreter ran, argv and stdin.
const FAKE_PY = `#!/usr/bin/env bash
printf 'ARGS %s %s\\n' "$0" "$*" >> "$FAKE_SEND_LOG"
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
    repo,
    lock: path.join(repo, 'data', 'rebalance-cron.lock'),
    attempts: path.join(repo, 'data', 'rebalance-discord-attempts.json'),
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
    REBALANCE_LOCK_WAIT: '2',
    REBALANCE_LOCK_POLL: '1',
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

function run(f: Fixture, wrapper: string, prelude = '') {
  const script = path.join(DEPLOY, wrapper)
  const r = prelude
    ? spawnSync('bash', ['-c', `${prelude}\nexec bash "$0"`, script], { env: f.env as NodeJS.ProcessEnv, encoding: 'utf8' })
    : spawnSync('bash', [script], { env: f.env as NodeJS.ProcessEnv, encoding: 'utf8' })
  return { code: r.status, out: r.stdout, lines: r.stdout.split('\n').filter(Boolean), err: r.stderr }
}

const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')
const calls = (f: Fixture) => read(f.pnpmLog).split('\n').filter(Boolean)
const marks = (f: Fixture) => calls(f).filter((l) => l.includes('--mark'))
const rarCalls = (f: Fixture) => read(f.rarLog).split('--end--\n').filter(Boolean).length

/** A lock another live process holds, fresh. */
function holdLock(f: Fixture) {
  fs.mkdirSync(f.lock, { recursive: true })
  fs.writeFileSync(path.join(f.lock, 'pid'), `${process.pid}\n`)
}

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
const statusEvent = (over: Record<string, unknown> = {}) =>
  event({ id: 'rb-1:status_changed:plan_approved', kind: 'status_changed', detail: 'plan_approved', channels: ['discord'], telegram: null, discord: 'Status → plan approved.', threadTitle: null, threadPrompt: null, ...over })
const notifyJson = (events: unknown[]) => JSON.stringify({ schemaVersion: 1, ok: true, command: 'notify', events })
const created = JSON.stringify({ ok: true, command: 'propose', id: 'rb-1', status: 'draft', decision: 'hold', instructions: 3, llm: { status: 'ok', reason: null, attempts: 1 } })

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

test('monthly: notify is seeded before proposing; created prints no line of its own', opts, () => {
  const f = fixture({ FAKE_PROPOSE_JSON: created, FAKE_NOTIFY_JSON: notifyJson([]) })
  const r = run(f, 'rebalance-monthly-cron.sh')
  assert.equal(r.code, 0, r.err)
  assert.equal(r.out, '')
  assert.deepEqual(calls(f), ['rebalance:notify ', 'rebalance:propose --kind monthly', 'rebalance:notify '])
})

test('monthly on a fresh install: exactly one created line, and the thread is opened', opts, () => {
  const f = fixture({
    FAKE_PROPOSE_JSON: created,
    FAKE_NOTIFY_JSON_1: JSON.stringify({ ok: true, events: [], seeded: true }),
    FAKE_NOTIFY_JSON_2: notifyJson([event({})]),
  })
  const r = run(f, 'rebalance-monthly-cron.sh')
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(r.lines, ['TG created rb-1'])
  assert.equal(rarCalls(f), 1)
  assert.match(read(f.rarLog), /proposal:rb-1/)
  assert.deepEqual(marks(f), ['rebalance:notify --mark rb-1:created:new --channel telegram', 'rebalance:notify --mark rb-1:created:new --channel discord'])
})

test('monthly: open proposal → one line, exit 0', opts, () => {
  const f = fixture({ FAKE_PROPOSE_JSON: JSON.stringify({ ok: false, command: 'propose', reason: 'open_proposal_exists', detail: 'x', openId: 'rb-0' }) })
  const r = run(f, 'rebalance-monthly-cron.sh')
  assert.equal(r.code, 0)
  assert.equal(r.lines.length, 1)
  assert.match(r.lines[0], /rb-0 is still open/)
})

test('monthly: health errors → held line pointing at /health and the forced re-run', opts, () => {
  const f = fixture({ FAKE_PROPOSE_JSON: JSON.stringify({ ok: false, command: 'propose', reason: 'health_errors', detail: 'Failing error checks: a' }), FAKE_PROPOSE_RC: '1' })
  const r = run(f, 'rebalance-monthly-cron.sh')
  assert.equal(r.code, 0)
  assert.equal(r.lines.length, 1)
  assert.match(r.lines[0], /held/)
  assert.match(r.lines[0], /\/health/)
  assert.match(r.lines[0], /REBALANCE_FORCE_MONTHLY=1/)
})

test('monthly: not_configured → one line, exit 1, no notify after it', opts, () => {
  const f = fixture({
    FAKE_PROPOSE_JSON: JSON.stringify({ ok: false, command: 'propose', reason: 'not_configured', detail: '/private/path/policy.json missing' }),
    FAKE_PROPOSE_RC: '1',
  })
  const r = run(f, 'rebalance-monthly-cron.sh')
  assert.equal(r.code, 1)
  assert.equal(r.lines.length, 1)
  assert.match(r.lines[0], /not configured/)
  assert.doesNotMatch(r.out, /private/)
  assert.deepEqual(calls(f), ['rebalance:notify ', 'rebalance:propose --kind monthly'])
})

test('monthly: a crashed CLI (no JSON) → one line, exit 1', opts, () => {
  const f = fixture({ FAKE_PROPOSE_JSON: 'Error: boom', FAKE_PROPOSE_RC: '1' })
  const r = run(f, 'rebalance-monthly-cron.sh')
  assert.equal(r.code, 1)
  assert.equal(r.lines.length, 1)
  assert.match(r.lines[0], /could not run/)
})

// --- lock ------------------------------------------------------------------------------------------------

test('monthly and triggers wait for a held lock, then report and exit 1', opts, () => {
  for (const [wrapper, label] of [['rebalance-monthly-cron.sh', 'monthly'], ['rebalance-triggers-cron.sh', 'triggers']]) {
    const f = fixture({ FAKE_PROPOSE_JSON: created, FAKE_TRIGGERS_JSON: JSON.stringify({ ok: true, due: [] }) })
    holdLock(f)
    const r = run(f, wrapper)
    assert.equal(r.code, 1, label)
    assert.equal(r.lines.length, 1)
    assert.match(r.lines[0], new RegExp(`Rebalance ${label} skipped: another rebalance job held the lock`))
    assert.equal(read(f.pnpmLog), '')
    assert.equal(fs.existsSync(f.lock), true, 'a lock it never owned is left alone')
  }
})

test('monthly proceeds once a held lock is released while it waits', opts, () => {
  const f = fixture({ FAKE_PROPOSE_JSON: created, REBALANCE_LOCK_WAIT: '10' })
  holdLock(f)
  const r = run(f, 'rebalance-monthly-cron.sh', `( sleep 1; rm -rf '${f.lock}' ) &`)
  assert.equal(r.code, 0, r.out + r.err)
  assert.match(read(f.pnpmLog), /rebalance:propose --kind monthly/)
})

test('notify: a held lock (under the repo data/) → exit 0 silently, no wait', opts, () => {
  const f = fixture({ FAKE_NOTIFY_JSON: notifyJson([event({ channels: ['telegram'] })]), REBALANCE_LOCK_WAIT: '30' })
  holdLock(f)
  const started = Date.now()
  const r = run(f, 'rebalance-notify-cron.sh')
  assert.equal(r.code, 0)
  assert.equal(r.out, '')
  assert.equal(read(f.pnpmLog), '')
  assert.ok(Date.now() - started < 5000)
})

test('a stale lock is taken over; the lock is released by its owner only', opts, () => {
  const f = fixture({ FAKE_NOTIFY_JSON: notifyJson([event({ channels: ['telegram'] })]) })
  holdLock(f)
  const old = new Date(Date.now() - 31 * 60_000)
  fs.utimesSync(f.lock, old, old)
  const stale = run(f, 'rebalance-notify-cron.sh')
  assert.equal(stale.code, 0, stale.err)
  assert.deepEqual(stale.lines, ['TG created rb-1'])
  assert.equal(fs.existsSync(f.lock), false, 'the owner releases the lock on exit')

  const stolen = fixture({ FAKE_STEAL_LOCK: '' })
  stolen.env.FAKE_STEAL_LOCK = stolen.lock
  assert.equal(run(stolen, 'rebalance-notify-cron.sh').code, 0)
  assert.equal(read(path.join(stolen.lock, 'pid')).trim(), '999999', 'a lock another run took over is not removed')
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

test('triggers: seeds notify first; created prints only the notify flow line', opts, () => {
  const f = fixture({
    FAKE_TRIGGERS_JSON: JSON.stringify({ ok: true, created: 'rb-2-band', due: ['band:us_equity', 'cap:US:AAPL'] }),
    FAKE_NOTIFY_JSON_1: JSON.stringify({ ok: true, events: [], seeded: true }),
    FAKE_NOTIFY_JSON_2: notifyJson([event({ id: 'rb-2-band:created:new', proposalId: 'rb-2-band', telegram: 'TG created rb-2-band' })]),
  })
  const r = run(f, 'rebalance-triggers-cron.sh')
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(r.lines, ['TG created rb-2-band'])
  assert.equal(calls(f)[0], 'rebalance:notify ')
  assert.equal(calls(f)[1], 'rebalance:triggers ')
  assert.doesNotMatch(r.out, /AAPL/)
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

test('notify: control plane absent → the notice comes with the created line only', opts, () => {
  const f = fixture({ FAKE_NOTIFY_JSON: notifyJson([event({}), statusEvent()]) }, { controlPlane: false })
  const r = run(f, 'rebalance-notify-cron.sh')
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(r.lines, ['TG created rb-1', 'Discord thread not opened: control plane not configured'])
  assert.deepEqual(marks(f), ['rebalance:notify --mark rb-1:created:new --channel telegram'])
  assert.equal(read(f.rarLog), '')
  assert.equal(read(f.sendLog), '')

  // The next run: the created line was already sent, the Discord side is still pending. Silent.
  const again = fixture({ FAKE_NOTIFY_JSON: notifyJson([event({ channels: ['discord'], telegram: null }), statusEvent()]) }, { controlPlane: false })
  const r2 = run(again, 'rebalance-notify-cron.sh')
  assert.equal(r2.code, 0)
  assert.equal(r2.out, '')
})

test('notify: trader Discord env missing → notice with the created line, discord pending', opts, () => {
  const f = fixture({ FAKE_NOTIFY_JSON: notifyJson([event({})]) }, { discordEnv: false })
  const r = run(f, 'rebalance-notify-cron.sh')
  assert.equal(r.code, 0, r.err)
  assert.equal(r.lines.length, 2)
  assert.match(r.lines[1], /^Discord thread not opened: /)
  assert.deepEqual(marks(f), ['rebalance:notify --mark rb-1:created:new --channel telegram'])
})

test('notify: a failed thread call says so once, retries, and gives up after 6 attempts', opts, () => {
  const f = fixture({ FAKE_NOTIFY_JSON: notifyJson([event({ channels: ['discord'], telegram: null })]), FAKE_RAR_RC: '4' })
  const outs: string[][] = []
  for (let i = 0; i < 6; i += 1) {
    const r = run(f, 'rebalance-notify-cron.sh')
    assert.equal(r.code, 0, r.err)
    outs.push(r.lines)
  }
  assert.deepEqual(outs[0], ['Discord thread for rb-1 not opened (exit 4); will retry'])
  for (const lines of outs.slice(1, 5)) assert.deepEqual(lines, [])
  assert.equal(outs[5].length, 1)
  assert.match(outs[5][0], /rb-1.*6 attempts/)
  assert.equal(rarCalls(f), 6)
  assert.deepEqual(marks(f), ['rebalance:notify --mark rb-1:created:new --channel discord'])
  assert.ok(JSON.parse(read(f.attempts)).gaveUp['rb-1:created:new'], 'the give-up is recorded')
})

test('notify: a thread opened on retry clears the attempt count', opts, () => {
  const f = fixture({ FAKE_NOTIFY_JSON: notifyJson([event({ channels: ['discord'], telegram: null })]), FAKE_RAR_RC: '1' })
  run(f, 'rebalance-notify-cron.sh')
  assert.equal(JSON.parse(read(f.attempts)).attempts['rb-1:created:new'], 1)
  f.env.FAKE_RAR_RC = '0'
  const r = run(f, 'rebalance-notify-cron.sh')
  assert.equal(r.out, '')
  assert.deepEqual(marks(f), ['rebalance:notify --mark rb-1:created:new --channel discord'])
  assert.equal(JSON.parse(read(f.attempts)).attempts['rb-1:created:new'], undefined)
})

test('notify: a status line goes to the ledger thread and is marked', opts, () => {
  const f = fixture({ FAKE_NOTIFY_JSON: notifyJson([statusEvent()]) })
  write(f.ledger, JSON.stringify({ version: 1, subjects: { 'proposal:rb-1': { thread_id: '998877' } } }))
  const r = run(f, 'rebalance-notify-cron.sh')
  assert.equal(r.code, 0, r.err)
  assert.equal(r.out, '')
  const sent = read(f.sendLog)
  assert.match(sent, /send_discord\.py --bot-token tok-123 --channel-id 998877 --usage-unit-key rebalance-notify/)
  assert.match(sent, /TEXT Status → plan approved\./)
  assert.deepEqual(marks(f), ['rebalance:notify --mark rb-1:status_changed:plan_approved --channel discord'])
})

test('notify: send_discord.py runs under the Hermes venv python when present', opts, () => {
  const f = fixture({ FAKE_NOTIFY_JSON: notifyJson([statusEvent()]), REBALANCE_PYTHON: undefined })
  const venv = path.join(f.root, '.hermes', 'hermes-agent', 'venv', 'bin', 'python')
  write(venv, FAKE_PY, 0o755)
  write(f.ledger, JSON.stringify({ version: 1, subjects: { 'proposal:rb-1': { thread_id: '1' } } }))
  run(f, 'rebalance-notify-cron.sh')
  assert.ok(read(f.sendLog).startsWith(`ARGS ${venv} `), read(f.sendLog))
})

test('notify: a status line that cannot be delivered retries silently, then gives up after 6', opts, () => {
  const noThread = fixture({ FAKE_NOTIFY_JSON: notifyJson([statusEvent()]) })
  for (let i = 0; i < 5; i += 1) assert.equal(run(noThread, 'rebalance-notify-cron.sh').out, '')
  assert.deepEqual(marks(noThread), [])
  run(noThread, 'rebalance-notify-cron.sh')
  assert.deepEqual(marks(noThread), ['rebalance:notify --mark rb-1:status_changed:plan_approved --channel discord'])
  assert.equal(read(noThread.sendLog), '')

  const failed = fixture({ FAKE_NOTIFY_JSON: notifyJson([statusEvent()]), FAKE_SEND_RC: '1' })
  write(failed.ledger, JSON.stringify({ version: 1, subjects: { 'proposal:rb-1': { thread_id: '55' } } }))
  const outs: string[] = []
  for (let i = 0; i < 6; i += 1) outs.push(run(failed, 'rebalance-notify-cron.sh').out)
  assert.deepEqual(outs.slice(0, 5), ['', '', '', '', ''])
  assert.match(outs[5], /not delivered after 6 attempts/)
  assert.match(read(failed.sendLog), /--channel-id 55/)
  assert.deepEqual(marks(failed), ['rebalance:notify --mark rb-1:status_changed:plan_approved --channel discord'])
})

test('notify: a Telegram receipt that cannot be recorded → one line, exit 1', opts, () => {
  const f = fixture({ FAKE_NOTIFY_JSON: notifyJson([event({ channels: ['telegram'] })]), FAKE_MARK_RC: '1' })
  const r = run(f, 'rebalance-notify-cron.sh')
  assert.equal(r.code, 1)
  assert.equal(r.lines[0], 'TG created rb-1')
  assert.match(r.lines[1], /could not record the Telegram receipts/)
  assert.equal(r.lines.length, 2)
})

test('notify: a Discord receipt that cannot be recorded → one line, exit 1', opts, () => {
  const f = fixture({ FAKE_NOTIFY_JSON: notifyJson([statusEvent()]), FAKE_MARK_RC: '1' })
  write(f.ledger, JSON.stringify({ version: 1, subjects: { 'proposal:rb-1': { thread_id: '7' } } }))
  const r = run(f, 'rebalance-notify-cron.sh')
  assert.equal(r.code, 1)
  assert.equal(r.lines.length, 1)
  assert.match(r.lines[0], /could not record a Discord receipt/)
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
