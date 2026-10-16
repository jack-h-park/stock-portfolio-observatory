import { spawn, spawnSync } from 'node:child_process'
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

/** Runs `cmd args` with `prompt` on stdin and no shell. SIGTERM at the timeout, SIGKILL 5s later. */
function runProcess(
  spawnFn: typeof spawn,
  cmd: string,
  args: string[],
  prompt: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnFn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
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

export function claudeRunner(spawnFn: typeof spawn = spawn): LlmRunner {
  return {
    name: 'claude',
    available: () => resolvesOnPath('claude'),
    async run(prompt, { model, timeoutMs }) {
      const args = ['-p', '--output-format', 'json', '--allowedTools', 'WebSearch,WebFetch']
      if (model) args.push('--model', model)
      const { stdout } = await runProcess(spawnFn, 'claude', args, prompt, timeoutMs)
      let parsed: unknown
      try {
        parsed = JSON.parse(stdout)
      } catch {
        throw new Error('claude output was not valid JSON')
      }
      const obj = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
      if (typeof obj.result !== 'string') throw new Error('claude output had no string "result" field')
      return { raw: obj.result, model: typeof obj.model === 'string' ? obj.model : model }
    },
  }
}

export function codexRunner(spawnFn: typeof spawn = spawn): LlmRunner {
  return {
    name: 'codex',
    available: () => resolvesOnPath('codex'),
    async run(prompt, { model, timeoutMs }) {
      const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only']
      if (model) args.push('-m', model)
      args.push('-')
      const { stdout } = await runProcess(spawnFn, 'codex', args, prompt, timeoutMs)
      return { raw: stdout, model }
    },
  }
}

type RunnerConfig = Pick<typeof config, 'stockRebalanceLlmRunner' | 'stockRebalanceLlmModel' | 'stockRebalanceLlmTimeoutMs'>

/** `codex` selects codex; anything else, including a typo, selects the default `claude`. */
export function runnerFromConfig(cfg: RunnerConfig = config): LlmRunner {
  return cfg.stockRebalanceLlmRunner === 'codex' ? codexRunner() : claudeRunner()
}
