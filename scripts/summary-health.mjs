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

/**
 * How old the PRICES are, which is not how old the document is.
 *
 * `ingestedAt` is rewritten on every run, including a run that failed — `summary`
 * is sequenced after the step loop, so it publishes even when the loop broke at
 * step 5. The snapshots that a skipped step was meant to rewrite are left exactly
 * as they were, which `write-briefing-summary.ts` already says out loud: "still
 * recent, still reading fresh, so the failure is invisible from freshness alone".
 *
 * So the staleness check below, reading `ingestedAt`, can never fire while
 * anything at all is still running. From 2026-08-26 extract:fx-ledger failed on
 * every run and aborted the loop before fetch:us-prices; the summary stayed young
 * the whole time and the briefing's own badge read "Data: 9h ago" while it
 * published a TSLA price captured mid-session two days earlier. `pricesAsOf` is
 * the field that actually moved, so it is the one to age.
 *
 * Oldest of the two markets wins: a frozen US feed is a frozen US feed whatever
 * KR is doing.
 */
function priceAgeMs(doc) {
  const stamps = Object.values(doc?.pricesAsOf ?? {})
    .map((value) => Date.parse(value ?? ''))
    .filter((value) => Number.isFinite(value))
  return stamps.length ? Date.now() - Math.min(...stamps) : null
}

/**
 * Day bucket for a fingerprint, so a fault that is getting worse can say so.
 *
 * The rule this file states — keep numbers that move on their own out of
 * fingerprints — exists to stop an age in hours re-alerting every single run. A
 * day boundary is not that: at a six-hourly cadence it changes once a day, which
 * is the rate a worsening condition should be repeated at. Without it the first
 * report is also the last, and "the refresh failed" reads the same on hour one as
 * on day three, which is how a real outage stayed quiet after one message.
 */
function ageBucket(ms) {
  return ms == null ? 'unknown' : `d${Math.floor(ms / 86_400_000)}`
}

/** "2.5h" under a day, "3d" beyond it — a reader needs the scale, not the precision. */
function ageLabel(ms) {
  if (ms == null) return 'unknown age'
  return ms >= 86_400_000 ? `${Math.floor(ms / 86_400_000)}d` : `${hours(ms)}h`
}

/**
 * What breaks downstream when prices stop moving. The old message ended at
 * "figures are from the previous good data", which describes a fallback behaving
 * correctly and reads as reassurance. Nothing in it said the frozen numbers are
 * republished as current ones — the briefing prints them as the day's closes at
 * 08:00 and the trading review reads them at 13:30 — so two consecutive alerts
 * were accurate, and neither prompted anyone to look.
 */
const CONSUMERS = 'The 08:00 briefing and 13:30 trading review publish these as current figures.'

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
  const pricesAgeMs = priceAgeMs(doc)
  const pricesStale = pricesAgeMs != null && pricesAgeMs > maxAgeHours * 3_600_000

  if (ageMs == null) {
    fingerprint = 'no-timestamp'
    message = `⚠️ Observatory summary carries no usable timestamp — its age cannot be checked, so a stopped refresh would go unnoticed.`
  } else if (stale) {
    // Checked before the contents on purpose. A stale document's "success, 0
    // issues" describes a run that happened long ago and says nothing about now.
    fingerprint = 'stale'
    message = `⚠️ Observatory summary is ${hours(ageMs)}h old (limit ${maxAgeHours}h) — the refresh appears to have stopped.\nIt still reads "${refreshStatus}", but from ${doc.ingestedAt ?? doc.generatedAt}. Check: make refresh-status`
  } else if (refreshStatus !== 'success') {
    // The day bucket is what makes a second report possible. The fault string
    // alone never changes while the fault persists, so this used to speak once
    // and then hold its peace no matter how far the data drifted behind.
    const frozenFor = priceAgeMs(doc)
    fingerprint = `refresh-${refreshStatus}-${doc.refresh?.failedStep ?? 'unknown'}-${ageBucket(frozenFor)}`
    const at = doc.refresh?.failedStep ? ` at ${doc.refresh.failedStep}` : ''
    message =
      `⚠️ Observatory refresh ${refreshStatus}${at} — prices frozen for ${ageLabel(frozenFor)}` +
      `${doc.pricesAsOf?.US ? ` (US last priced ${doc.pricesAsOf.US.slice(0, 16).replace('T', ' ')}Z)` : ''}.\n` +
      `${CONSUMERS} Check: make refresh-status`
  } else if (pricesStale) {
    // Prices can be stale while the run says success: an OPTIONAL step is allowed
    // to fail without failing the run, and a price fetch that quietly returned
    // nothing leaves the old snapshot in place. `refresh.status` cannot see either,
    // and the document's own age cannot either, so without this the state is
    // reachable and reported by nothing.
    fingerprint = `prices-stale-${ageBucket(pricesAgeMs)}`
    message =
      `⚠️ Observatory prices are ${ageLabel(pricesAgeMs)} old (limit ${maxAgeHours}h) though the last refresh reported success.\n` +
      `${CONSUMERS} Check: make refresh-status`
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
