// summary-health.mjs — is the published summary healthy, and is anyone being told?
//
// The refresh runs under launchd, which records an exit code and delivers nothing.
// This reads the artifact that refresh publishes and speaks only when something is
// wrong, so the alerting the Hermes wrapper used to provide survives the move to a
// scheduler that cannot alert.
//
// It watches the OUTPUT, not the job. That is the point: a job monitor tells you a
// run exited non-zero, but the failure that actually hides here is the refresh
// stopping altogether — the summary then keeps saying "success, 0 issues" while
// quietly ageing, and every reader downstream repeats figures from days ago in
// perfect confidence. Nothing INSIDE the document can show that. Only its age can,
// which is why staleness is checked first and treated as the loudest signal.
//
// Silent when healthy. The positive signal is /health and the briefing's `Data:`
// badge; a daily "all good" here would only teach the channel to be ignored.
//
// usage: node scripts/summary-health.mjs [--summary <path>] [--state <file>]
//                                        [--max-age-hours <n>] [--no-state]
//
// Exit 0 always — this is an alerting path, and a checker that fails loudly about
// itself in a Telegram channel is worse than one that says nothing.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { loadLocalEnv } from './env.mjs'

loadLocalEnv()

/** The summary schema this checker understands. Newer is refused, not guessed at. */
const SCHEMA_VERSION = 1

/**
 * How old the summary may be before it is treated as a stopped refresh.
 *
 * The launchd job uses StartInterval, so runs drift and two consecutive ones can
 * legitimately land further apart than six hours. 13h clears two intervals plus
 * slack: late enough not to flap on drift, early enough that a refresh which died
 * overnight is reported in the morning rather than after the weekend.
 */
const DEFAULT_MAX_AGE_HOURS = 13

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback
}
const has = (flag) => process.argv.includes(flag)

const summaryPath =
  arg('--summary') ||
  process.env.STOCK_BRIEFING_SUMMARY_PATH ||
  path.join(os.homedir(), 'workspace/data/stock-management/outputs/stock-portfolio-observatory/briefing-summary.json')
const statePath = arg('--state', path.join(os.homedir(), '.config/stock-portfolio-observatory/summary-health-state.json'))
const maxAgeHours = Number(arg('--max-age-hours', DEFAULT_MAX_AGE_HOURS))

function hours(ms) {
  return Math.round((ms / 3_600_000) * 10) / 10
}

// ── Read the artifact ────────────────────────────────────────────────────────
// Each branch produces both a `fingerprint` (what "the same problem" means, for
// the repeat check) and a `message`. Fingerprints deliberately exclude numbers
// that move on their own — an age in hours would change every run and re-alert
// forever, which is the failure mode --state exists to prevent.

let state = { fingerprint: null }
let firstRun = true
try {
  state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  firstRun = false
} catch {
  // No state yet. A first run still reports a problem it finds — that is the whole
  // job — but it must not announce a recovery, because there is nothing to have
  // recovered from. See the report step.
}

let fingerprint
let message

let doc = null
try {
  doc = JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
} catch {
  fingerprint = 'unavailable'
  message = `⚠️ Observatory summary unavailable — ${summaryPath}\nThe refresh has not written it, or it cannot be read. Check: make refresh-status`
}

if (doc && (typeof doc.schemaVersion !== 'number' || doc.schemaVersion < 1)) {
  fingerprint = 'no-schema'
  message = `⚠️ Observatory summary has no usable schemaVersion — ${summaryPath}`
} else if (doc && doc.schemaVersion > SCHEMA_VERSION) {
  fingerprint = `schema-${doc.schemaVersion}`
  message = `⚠️ Observatory summary is schemaVersion ${doc.schemaVersion}; this checker understands ${SCHEMA_VERSION}. It is no longer being read — update the checker.`
} else if (doc) {
  const builtAt = Date.parse(doc.ingestedAt ?? doc.generatedAt ?? '')
  const ageMs = Number.isFinite(builtAt) ? Date.now() - builtAt : null
  const stale = ageMs != null && ageMs > maxAgeHours * 3_600_000
  const issues = Array.isArray(doc.health?.issues) ? doc.health.issues : []
  const refreshStatus = doc.refresh?.status ?? 'unknown'

  if (ageMs == null) {
    fingerprint = 'no-timestamp'
    message = `⚠️ Observatory summary carries no usable timestamp — its age cannot be checked, so a stopped refresh would go unnoticed.`
  } else if (stale) {
    // Checked before the contents on purpose. A stale document's "success, 0
    // issues" describes a run that happened long ago and says nothing about now.
    fingerprint = 'stale'
    message = `⚠️ Observatory summary is ${hours(ageMs)}h old (limit ${maxAgeHours}h) — the refresh appears to have stopped.\nIt still reads "${refreshStatus}", but from ${doc.ingestedAt ?? doc.generatedAt}. Check: make refresh-status`
  } else if (refreshStatus !== 'success') {
    fingerprint = `refresh-${refreshStatus}-${doc.refresh?.failedStep ?? 'unknown'}`
    message = `⚠️ Observatory refresh ${refreshStatus}${doc.refresh?.failedStep ? ` at ${doc.refresh.failedStep}` : ''} — figures are from the previous good data.`
  } else if (issues.length) {
    // Keys, not details: a validation detail can carry a count that ticks with
    // every run, and re-alerting on "the same gap, slightly different" is exactly
    // how this channel would stop being read.
    const keys = issues.map((i) => i.key ?? i.label ?? 'unknown').sort()
    fingerprint = `issues:${keys.join(',')}`
    const named = issues.map((i) => `${i.label ?? i.key} (${i.status})`).join(', ')
    message = `⚠️ Observatory: ${issues.length} issue${issues.length === 1 ? '' : 's'} — ${named}\nOpen /health.`
  } else {
    fingerprint = 'clean'
    message = null
  }
}

// ── Report only on change ────────────────────────────────────────────────────
// These conditions persist until someone acts on them: a missing brokerage export
// is missing every six hours until the file arrives. Reporting each run would make
// the alert furniture. Recovery IS reported — a channel that only ever brings bad
// news leaves you unsure whether silence means fixed or forgotten.

const changed = fingerprint !== state.fingerprint

if (changed && fingerprint === 'clean') {
  // Not on a first run: "back to clean" on a system that was never reported broken
  // is a message that says nothing, delivered at install time.
  if (!firstRun) process.stdout.write('✅ Observatory back to clean — no validation or freshness issues.\n')
} else if (changed && message) {
  process.stdout.write(`${message}\n`)
}

if (!has('--no-state')) {
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    const tmp = `${statePath}.tmp-${process.pid}`
    fs.writeFileSync(tmp, `${JSON.stringify({ fingerprint, at: new Date().toISOString() }, null, 2)}\n`)
    fs.renameSync(tmp, statePath)
  } catch {
    // A state file that cannot be written costs repeat alerts, not a missed one.
    // Failing here would turn a noise problem into a silence problem.
  }
}
