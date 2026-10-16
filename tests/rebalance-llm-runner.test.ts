import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test, { mock } from 'node:test'
import type { spawn } from 'node:child_process'
import { buildPrompt } from '../lib/rebalance/llm-prompt'
import { claudeRunner, codexRunner, LlmTimeoutError, runnerFromConfig } from '../lib/rebalance/llm-runner'
import { MAX_ITEMS, MAX_TEXT } from '../lib/rebalance/llm-contract'
import { SLEEVES } from '../lib/rebalance/allocation-policy'
import type { LlmInput } from '../lib/rebalance/llm-input'

type Script = { stdout?: string; stderr?: string; code?: number | null; hang?: boolean }
type Call = { cmd: string; args: string[]; opts: unknown; stdin: string; signals: (string | number | undefined)[] }

function fakeSpawn(script: Script) {
  const calls: Call[] = []
  const fn = ((cmd: string, args: string[], opts: unknown) => {
    const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: (s?: string) => boolean }
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    const call: Call = { cmd, args, opts, stdin: '', signals: [] }
    calls.push(call)
    child.stdin.on('data', (d) => (call.stdin += d))
    child.kill = (signal) => {
      call.signals.push(signal)
      if (script.hang) setImmediate(() => child.emit('close', null, signal ?? 'SIGTERM'))
      return true
    }
    if (!script.hang) {
      setImmediate(() => {
        if (script.stdout) child.stdout.write(script.stdout)
        if (script.stderr) child.stderr.write(script.stderr)
        child.stdout.end()
        child.stderr.end()
        child.emit('close', script.code ?? 0, null)
      })
    }
    return child
  }) as unknown as typeof spawn
  return { fn, calls }
}

test('claude runner reads .result', async () => {
  const { fn, calls } = fakeSpawn({ stdout: JSON.stringify({ result: '{"a":1}', model: 'claude-x' }) })
  const out = await claudeRunner(fn).run('PROMPT', { model: 'opus', timeoutMs: 1000 })
  assert.deepEqual(out, { raw: '{"a":1}', model: 'claude-x' })
  assert.equal(calls[0].cmd, 'claude')
  assert.deepEqual(calls[0].args, ['-p', '--output-format', 'json', '--allowedTools', 'WebSearch,WebFetch', '--model', 'opus'])
  assert.equal(calls[0].stdin, 'PROMPT')
  assert.ok(!(calls[0].opts as { shell?: boolean }).shell)
})

test('claude runner omits --model when null and falls back to the requested model', async () => {
  const { fn, calls } = fakeSpawn({ stdout: JSON.stringify({ result: 'x' }) })
  const out = await claudeRunner(fn).run('P', { model: null, timeoutMs: 1000 })
  assert.equal(out.model, null)
  assert.ok(!calls[0].args.includes('--model'))
})

test('claude runner rejects unparseable stdout', async () => {
  const { fn } = fakeSpawn({ stdout: 'not json' })
  await assert.rejects(claudeRunner(fn).run('P', { model: null, timeoutMs: 1000 }), /not valid JSON/)
})

test('codex runner returns stdout', async () => {
  const { fn, calls } = fakeSpawn({ stdout: 'answer' })
  const out = await codexRunner(fn).run('PROMPT', { model: 'gpt-x', timeoutMs: 1000 })
  assert.deepEqual(out, { raw: 'answer', model: 'gpt-x' })
  assert.deepEqual(calls[0].args, ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-m', 'gpt-x', '-'])
  assert.equal(calls[0].stdin, 'PROMPT')
})

test('non-zero exit throws with code and truncated stderr', async () => {
  const { fn } = fakeSpawn({ stderr: 'e'.repeat(900), code: 3 })
  await assert.rejects(codexRunner(fn).run('P', { model: null, timeoutMs: 1000 }), (err: Error) => {
    assert.match(err.message, /exit code 3/)
    assert.ok(err.message.length < 700)
    assert.ok(!(err instanceof LlmTimeoutError))
    return true
  })
})

test('timeout kills with SIGTERM and throws LlmTimeoutError', async () => {
  const { fn, calls } = fakeSpawn({ hang: true })
  await assert.rejects(claudeRunner(fn).run('P', { model: null, timeoutMs: 20 }), LlmTimeoutError)
  assert.equal(calls[0].signals[0], 'SIGTERM')
})

test('spawn error rejects', async () => {
  const fn = (() => {
    const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough }
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    setImmediate(() => child.emit('error', new Error('ENOENT')))
    return child
  }) as unknown as typeof spawn
  await assert.rejects(codexRunner(fn).run('P', { model: null, timeoutMs: 1000 }), /ENOENT/)
})

const input = (): LlmInput =>
  ({
    asOf: '2026-10-16',
    allocation: [],
    bounds: {},
    positions: [],
    tax: { krDeductionRemainingKrw: 1, ytdKrTaxableGainKrw: 2, ytdUsShortUsd: 3, ytdUsLongUsd: 4, harvestableLossKrw: 5 },
    context: { macro: [] },
    pastDecisions: [],
  }) as unknown as LlmInput

test('prompt contains rules, schema and input, and the retry section only when errors are given', () => {
  const p = buildPrompt(input())
  assert.match(p, /not investment advice/)
  assert.match(p, /hold/)
  assert.match(p, /web search/i)
  assert.match(p, /Return only the JSON object/)
  assert.match(p, /whatWouldChangeMyView/)
  assert.match(p, /questionsForMaintainer/)
  assert.match(p, /macro.*empty/i)
  assert.ok(p.includes(JSON.stringify(input(), null, 2)))
  assert.ok(!p.includes('Your previous answer was rejected for:'))
  const retry = buildPrompt(input(), ['targetChange.sleeves.x: bad', 'outlook.summary: must not be empty'])
  assert.match(retry, /Your previous answer was rejected for:/)
  assert.match(retry, /- targetChange\.sleeves\.x: bad/)
  assert.ok(buildPrompt(input(), []).indexOf('rejected for') < 0)
  assert.ok(p.replace(JSON.stringify(input(), null, 2), '').length < 6000)
})

test('runnerFromConfig picks by env', () => {
  const base = { stockRebalanceLlmRunner: 'claude', stockRebalanceLlmModel: '', stockRebalanceLlmTimeoutMs: '600000' }
  assert.equal(runnerFromConfig(base).name, 'claude')
  assert.equal(runnerFromConfig({ ...base, stockRebalanceLlmRunner: 'codex' }).name, 'codex')
  assert.equal(runnerFromConfig({ ...base, stockRebalanceLlmRunner: 'bogus' }).name, 'claude')
})

test('prompt states the validator limits and sleeve keys', () => {
  const p = buildPrompt(input())
  assert.ok(p.includes(`at most ${MAX_ITEMS} items`))
  assert.ok(p.includes(`at most ${MAX_TEXT} characters`))
  assert.match(p, /no string field may be empty/)
  assert.ok(p.includes(SLEEVES.join(', ')))
  assert.match(p, /maxTargetShiftPctPerCycle percentage points, per sleeve/)
  for (const field of ['outlook.sources', 'ideas', 'questionsForMaintainer']) assert.ok(p.includes(field))
})

test('claude runner takes model from modelUsage when .model is absent', async () => {
  const { fn } = fakeSpawn({ stdout: JSON.stringify({ result: 'x', modelUsage: { 'claude-y': {} } }) })
  const out = await claudeRunner(fn).run('P', { model: null, timeoutMs: 1000 })
  assert.equal(out.model, 'claude-y')
})

test('claude runner throws when is_error is true', async () => {
  const { fn } = fakeSpawn({ stdout: JSON.stringify({ is_error: true, result: 'boom' }) })
  await assert.rejects(claudeRunner(fn).run('P', { model: null, timeoutMs: 1000 }), /claude reported an error/)
})

test('timeout escalates to SIGKILL after the 5s grace', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const calls: Call[] = []
    const fn = ((cmd: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: (s?: string) => boolean }
      child.stdin = new PassThrough()
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      const call: Call = { cmd, args, opts: {}, stdin: '', signals: [] }
      calls.push(call)
      child.kill = (signal) => {
        call.signals.push(signal)
        if (signal === 'SIGKILL') child.emit('close', null, 'SIGKILL')
        return true
      }
      return child
    }) as unknown as typeof spawn
    const p = claudeRunner(fn).run('P', { model: null, timeoutMs: 100 })
    const settled = assert.rejects(p, LlmTimeoutError)
    mock.timers.tick(100)
    assert.deepEqual(calls[0].signals, ['SIGTERM'])
    mock.timers.tick(4999)
    assert.deepEqual(calls[0].signals, ['SIGTERM'])
    mock.timers.tick(1)
    assert.deepEqual(calls[0].signals, ['SIGTERM', 'SIGKILL'])
    await settled
  } finally {
    mock.timers.reset()
  }
})
