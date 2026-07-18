import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { loadLocalEnv } from './env.mjs'

loadLocalEnv()

const historyPath = process.env.STOCK_REFRESH_RUNS_PATH || path.join(process.cwd(), 'data/refresh-runs.json')
const maxRuns = Number(process.env.STOCK_REFRESH_RUNS_LIMIT || 30)
const steps = [
  { name: 'fetch:kr-prices', args: ['fetch:kr-prices'] },
  { name: 'extract:us-pdf-evidence', args: ['extract:us-pdf-evidence'] },
  { name: 'fetch:us-prices', args: ['fetch:us-prices'] },
  { name: 'ingest', args: ['ingest'] },
]

function isoNow() {
  return new Date().toISOString()
}

function tail(text, max = 4000) {
  return text.length > max ? text.slice(-max) : text
}

function readHistory() {
  try {
    const parsed = JSON.parse(fs.readFileSync(historyPath, 'utf8'))
    return Array.isArray(parsed.runs) ? parsed.runs : []
  } catch {
    return []
  }
}

function writeHistory(run) {
  const runs = [run, ...readHistory().filter((item) => item.id !== run.id)].slice(0, maxRuns)
  fs.mkdirSync(path.dirname(historyPath), { recursive: true })
  fs.writeFileSync(historyPath, `${JSON.stringify({ runs }, null, 2)}\n`)
}

function runStep(step) {
  const startedAt = isoNow()
  const started = Date.now()
  let stdout = ''
  let stderr = ''

  return new Promise((resolve) => {
    const child = spawn('pnpm', step.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      process.stdout.write(text)
    })
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      process.stderr.write(text)
    })
    child.on('close', (code, signal) => {
      const finishedAt = isoNow()
      resolve({
        name: step.name,
        command: `pnpm ${step.args.join(' ')}`,
        startedAt,
        finishedAt,
        durationMs: Date.now() - started,
        status: code === 0 ? 'success' : 'failed',
        exitCode: code,
        signal,
        stdoutTail: tail(stdout.trim()),
        stderrTail: tail(stderr.trim()),
      })
    })
  })
}

const startedAt = isoNow()
const started = Date.now()
const run = {
  id: startedAt,
  startedAt,
  finishedAt: null,
  durationMs: null,
  status: 'running',
  steps: [],
}

writeHistory(run)

for (const step of steps) {
  console.log(`\n== ${step.name} ==`)
  const result = await runStep(step)
  run.steps.push(result)
  run.status = result.status === 'success' ? 'running' : 'failed'
  writeHistory(run)
  if (result.status !== 'success') break
}

run.finishedAt = isoNow()
run.durationMs = Date.now() - started
run.status = run.steps.every((step) => step.status === 'success') && run.steps.length === steps.length ? 'success' : 'failed'
writeHistory(run)

console.log(`\nRefresh ${run.status}: ${run.steps.length}/${steps.length} step(s), ${run.durationMs}ms`)
if (run.status !== 'success') process.exitCode = 1
