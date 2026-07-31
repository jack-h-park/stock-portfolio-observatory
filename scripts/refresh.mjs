import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { loadLocalEnv } from './env.mjs'

loadLocalEnv()

const historyPath = process.env.STOCK_REFRESH_RUNS_PATH || path.join(process.cwd(), 'data/refresh-runs.json')
const maxRuns = Number(process.env.STOCK_REFRESH_RUNS_LIMIT || 30)
// FX first: the ingest converts every native amount into the base currency with
// it, so a stale rate misstates the whole portfolio no matter how fresh the
// prices are.
// `optional` steps do not abort the run. That is reserved for a dependency
// outside this machine: Toss can be down, its token can expire, and its IP
// allowlist stops matching the day the ISP hands out a new address — none of
// which is a reason to skip the price fetches and the ingest. The failure is
// still recorded and still printed, so the cron reports it; what changes is that
// the rest of the refresh survives it, and the ingest then works from the last
// snapshot with a freshness check that says how old it is.
const steps = [
  { name: 'fetch:fx', args: ['fetch:fx'] },
  { name: 'fetch:kr-prices', args: ['fetch:kr-prices'] },
  { name: 'fetch:toss', args: ['fetch:toss'], optional: true },
  { name: 'extract:us-pdf-evidence', args: ['extract:us-pdf-evidence'] },
  { name: 'fetch:us-prices', args: ['fetch:us-prices'] },
  // Extract before pricing: the crypto price step reads the activity snapshot to
  // learn which symbols are still held, so pricing a stale snapshot would quote
  // a position that has been exited and miss one that was just opened.
  { name: 'extract:crypto-activity', args: ['extract:crypto-activity'] },
  { name: 'fetch:crypto-prices', args: ['fetch:crypto-prices'] },
  { name: 'fetch:historical-prices', args: ['fetch:historical-prices'] },
  { name: 'ingest', args: ['ingest'] },
  { name: 'backfill:history', args: ['backfill:history'] },
]

const optionalSteps = new Set(steps.filter((step) => step.optional).map((step) => step.name))

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
  // Optional steps that failed. Present from the start so a consumer never has
  // to distinguish "no degraded steps" from "an older record that predates the
  // field".
  degradedSteps: [],
}

writeHistory(run)

for (const step of steps) {
  console.log(`\n== ${step.name} ==`)
  const result = await runStep(step)
  run.steps.push(result)
  if (result.status !== 'success' && step.optional) {
    console.log(`(optional step ${step.name} failed — continuing; downstream freshness checks report the age of its data)`)
    run.status = 'running'
    writeHistory(run)
    continue
  }
  run.status = result.status === 'success' ? 'running' : 'failed'
  writeHistory(run)
  if (result.status !== 'success') break
}

run.finishedAt = isoNow()
run.durationMs = Date.now() - started

// An optional step that failed must not fail the RUN.
//
// The loop above already resets the status to 'running' and carries on, but this
// line used to re-derive the verdict from `every(step => success)` and overwrite
// that decision — so a step declared optional still produced a failed run. The
// visible cost was not cosmetic: write-briefing-summary raises an `error` issue
// on any non-success status, so an absent Toss credential published a summary
// telling every consumer the whole portfolio was not to be trusted, while the
// data behind it was complete and correct.
//
// So: required steps decide the status, and the optional ones that failed are
// named in `degradedSteps` instead. A consumer reading `status` is told whether
// the figures can be trusted; one reading `degradedSteps` is told which source
// is running on older data — which is a different question, and the freshness
// checks answer it in more detail.
const failedOptional = run.steps.filter((step) => step.status !== 'success' && optionalSteps.has(step.name))
const failedRequired = run.steps.filter((step) => step.status !== 'success' && !optionalSteps.has(step.name))
run.degradedSteps = failedOptional.map((step) => step.name)
run.status = failedRequired.length === 0 && run.steps.length === steps.length ? 'success' : 'failed'
writeHistory(run)

console.log(
  `\nRefresh ${run.status}${run.degradedSteps.length ? ` (degraded: ${run.degradedSteps.join(', ')})` : ''}: ` +
  `${run.steps.length}/${steps.length} step(s), ${run.durationMs}ms`
)
// Exit 0 on a degraded run. The scheduler's non-zero exit is the alarm for "the
// portfolio data is wrong"; a third-party source being unreachable is not that,
// and paging on it teaches the operator to ignore the alarm.
if (run.status !== 'success') process.exitCode = 1

// Publish the machine-readable summary for the briefing and trading-agent crons.
//
// AFTER the run history is finalised, not as one of `steps` above: the summary
// reports the refresh's own outcome, and inside the loop that outcome is still
// 'running'.
//
// Runs even when the refresh FAILED. The summary is where a consumer learns the
// data is not to be trusted, so withholding it on failure would remove the signal
// at exactly the moment it carries the most — and leave yesterday's file in place
// with nothing to say it is yesterday's.
console.log('\n== summary ==')
const summary = await runStep({ name: 'summary', args: ['summary'] })
run.steps.push(summary)
writeHistory(run)
if (summary.status !== 'success') {
  console.log('Summary publish failed — consumers will fall back to the previous document or none.')
  process.exitCode = 1
}
