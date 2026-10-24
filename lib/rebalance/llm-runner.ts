import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { config } from '@/config'

export type LlmRunResult = { raw: string; model: string | null }
export type LlmRunner = {
  name: 'claude' | 'codex'
  available(): boolean
  run(prompt: string, opts: { model: string | null; timeoutMs: number }): Promise<LlmRunResult>
}

export class LlmTimeoutError extends Error {
  constructor(message = 'LLM runner timed out') {
    super(message)
    this.name = 'LlmTimeoutError'
  }
}

const STDERR_MAX = 500
const KILL_GRACE_MS = 5000

function resolvesOnPath(binary: string): boolean {
  // `command -v` is a shell builtin; the binary name is a fixed literal, never user input.
  return spawnSync('sh', ['-c', `command -v ${binary}`], { stdio: 'ignore' }).status === 0
}

/** Runs `cmd args` in `cwd` with `prompt` on stdin and no shell. SIGTERM at the timeout, SIGKILL 5s later. */
function runProcess(
  spawnFn: typeof spawn,
  cmd: string,
  args: string[],
  prompt: string,
  timeoutMs: number,
  cwd: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnFn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let killTimer: NodeJS.Timeout | undefined
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(killTimer)
      fn()
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS)
      killTimer.unref?.()
    }, timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (d: string) => (stdout += d))
    child.stderr?.on('data', (d: string) => (stderr += d))
    child.on('error', (err) => finish(() => reject(timedOut ? new LlmTimeoutError() : err)))
    child.on('close', (code, signal) =>
      finish(() => {
        if (timedOut) return reject(new LlmTimeoutError(`LLM runner timed out after ${timeoutMs} ms`))
        if (code !== 0) {
          const tail = stderr.length > STDERR_MAX ? stderr.slice(0, STDERR_MAX) : stderr
          return reject(new Error(`${cmd} failed with exit code ${code ?? `null (signal ${signal ?? 'unknown'})`}: ${tail}`))
        }
        resolve({ stdout, stderr })
      })
    )
    child.stdin?.on('error', () => {
      // the child may exit before reading the prompt; the close handler reports the outcome
    })
    child.stdin?.end(prompt)
  })
}

/**
 * A fresh empty directory for one run, removed afterwards (best effort). The runner never starts in the repo, so no
 * project CLAUDE.md, settings, MCP config or data file is discoverable from its working directory.
 */
async function inTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebalance-llm-'))
  try {
    return await fn(dir)
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // best effort: the directory holds only the runner's own output
    }
  }
}

const WEB_TOOLS = 'WebSearch,WebFetch'

/**
 * Exactly the two web tools exist (`--tools`) and run without a prompt (`--allowedTools`); anything else that would
 * prompt is denied (`--permission-prompts none`). `--restricted` ignores user, project and local settings files,
 * `--strict-mcp-config` loads no MCP server, and `--no-session-persistence` saves nothing to disk.
 */
export function claudeArgs(model: string | null): string[] {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--tools',
    WEB_TOOLS,
    '--allowedTools',
    WEB_TOOLS,
    '--restricted',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--permission-prompts',
    'none',
  ]
  if (model) args.push('--model', model)
  return args
}

export function claudeRunner(spawnFn: typeof spawn = spawn): LlmRunner {
  return {
    name: 'claude',
    available: () => resolvesOnPath('claude'),
    run: (prompt, { model, timeoutMs }) =>
      inTempDir(async (dir) => {
        const { stdout } = await runProcess(spawnFn, 'claude', claudeArgs(model), prompt, timeoutMs, dir)
        let parsed: unknown
        try {
          parsed = JSON.parse(stdout)
        } catch {
          throw new Error('claude output was not valid JSON')
        }
        const obj = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
        if (obj.is_error === true) throw new Error('claude reported an error')
        if (typeof obj.result !== 'string') throw new Error('claude output had no string "result" field')
        const usage = obj.modelUsage !== null && typeof obj.modelUsage === 'object' ? Object.keys(obj.modelUsage) : []
        const reported = typeof obj.model === 'string' ? obj.model : (usage[0] ?? model)
        return { raw: obj.result, model: reported }
      }),
  }
}

const CODEX_LAST_MESSAGE = 'last-message.txt'

/**
 * Rooted in the temp dir (`-C`), read-only sandbox, no session files (`--ephemeral`), no colour codes, and the final
 * message written to a file in the temp dir. Unlike claude, codex cannot be limited to web tools.
 */
export function codexArgs(dir: string, model: string | null): string[] {
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--ephemeral',
    '--color',
    'never',
    '-C',
    dir,
    '--output-last-message',
    path.join(dir, CODEX_LAST_MESSAGE),
  ]
  if (model) args.push('-m', model)
  args.push('-')
  return args
}

export function codexRunner(spawnFn: typeof spawn = spawn): LlmRunner {
  return {
    name: 'codex',
    available: () => resolvesOnPath('codex'),
    run: (prompt, { model, timeoutMs }) =>
      inTempDir(async (dir) => {
        // stdout can echo the prompt, input JSON included; only the final message is the answer.
        await runProcess(spawnFn, 'codex', codexArgs(dir, model), prompt, timeoutMs, dir)
        let raw: string
        try {
          raw = fs.readFileSync(path.join(dir, CODEX_LAST_MESSAGE), 'utf8')
        } catch {
          throw new Error('codex wrote no final message file')
        }
        return { raw, model }
      }),
  }
}

export const KNOWN_RUNNERS = ['claude', 'codex'] as const

type RunnerConfig = Pick<typeof config, 'stockRebalanceLlmRunner' | 'stockRebalanceLlmModel' | 'stockRebalanceLlmTimeoutMs'>

/** `codex` selects codex; anything else, including a typo, selects the default `claude`. */
export function runnerFromConfig(cfg: RunnerConfig = config): LlmRunner {
  return cfg.stockRebalanceLlmRunner === 'codex' ? codexRunner() : claudeRunner()
}
