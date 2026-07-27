// write-briefing-summary.ts — publish the machine-readable portfolio summary.
//
// The briefing and the trading agent need things this app already knows: the
// FX-combined portfolio total (they cannot compute it — the briefing carries no
// FX snapshot, so it keeps US and KR apart end to end), how fresh the data behind
// that total is, and which positions carry concentration or tax weight.
//
// This PUBLISHES a file. It is not an API and nothing calls back: consumers read
// the artifact if it is there and say so when it is not. That keeps their crons
// independent of whether this app's server is running, and keeps the dependency
// one-way — the Observatory already reads the briefing's archive, and a second
// edge in the other direction would make each system wait on the other.
//
// TypeScript on purpose. Every figure comes from the same adapter the pages
// render from, so the summary can never disagree with /review or /health. A plain
// .mjs step could not import it (the adapter is TS behind the `@/` alias), and
// re-implementing the queries is exactly the two-codebases divergence this repo
// keeps designing away from. Hence `tsx`, and hence `pnpm summary`.
//
// usage: pnpm summary [--out <path>] [--stdout]

import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/config'
import {
  dbAvailable,
  getMarketBreakdown,
  getMeta,
  getOperationalHealth,
  getOverview,
  getPortfolioReview,
  getRebalanceReview,
  getRefreshRuns,
  getValidationChecks,
} from '@/lib/adapters/portfolio-db'

/**
 * The contract with every consumer.
 *
 * A reader must REFUSE a document whose schemaVersion is greater than the one it
 * was written against rather than guess at it, and upgrade an older one in memory.
 * This is the same discipline the briefing archive reader already follows, for the
 * same reason: raising the version must never orphan a consumer, and a consumer
 * must never silently misread a field that changed meaning.
 */
const SCHEMA_VERSION = 1

/** How many positions each list carries. Enough to act on, small enough to read. */
const LIST_LIMIT = 5

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback
}
const has = (flag: string) => process.argv.includes(flag)

/**
 * Anything wrong with the data behind these numbers, freshness and validation
 * alike, in one list.
 *
 * A list, not a count. The refresh cron already reports "expected brokerage
 * export missing — <name>"; a consumer that could only say "2 issues" would be a
 * step backwards from what the operator gets today.
 *
 * `severity` appears only where the source actually records one — the validation
 * table does, freshness does not. Inventing a severity for staleness would be
 * this file making a policy call that belongs to whoever reads it.
 */
type SummaryIssue = {
  key: string
  label: string
  category: 'price' | 'fx' | 'source' | 'validation' | 'refresh'
  status: string
  detail: string
  severity?: 'error' | 'warning'
}

const outPath = arg('--out', config.stockBriefingSummaryPath)!
const toStdout = has('--stdout')

if (!dbAvailable()) {
  console.error(`no database at ${config.stockDbPath} — run \`pnpm refresh\` (or \`pnpm seed:sample\`) first`)
  process.exit(2)
}

const meta = getMeta()
const health = getOperationalHealth()
const checks = getValidationChecks()
const review = getPortfolioReview()
const rebalance = getRebalanceReview()
const markets = getMarketBreakdown()
const lastRun = getRefreshRuns(1)[0] ?? null

// The FX row the ingest actually converted with, read back from the database
// rather than the snapshot file, so the summary reports the rate baked into these
// figures and not a newer one fetched since. The identity row (KRW→KRW) is not a
// conversion and would report a meaningless "KRW/KRW 1".
const conversionRate = getOverview().fxRates.find((r: any) => r.from_currency !== r.to_currency) ?? null

const snapshotAt = (key: string) => health.snapshots.find((item) => item.key === key)?.observedAt ?? null

const issues: SummaryIssue[] = [
  // A failed refresh belongs in this list even though nothing on /health may look
  // wrong. When a step fails, the snapshot it was meant to rewrite is simply left
  // as it was — still recent, still reading "fresh" — so the failure is invisible
  // from freshness alone. Observed: a run that died at fetch:kr-prices published a
  // summary with zero issues. `refresh.status` also carries this, but a consumer
  // should be able to trust one list rather than having to know to check two.
  ...(lastRun && lastRun.status !== 'success'
    ? [
        {
          key: 'refresh',
          label: 'Observatory refresh',
          category: 'refresh' as const,
          status: lastRun.status,
          detail:
            lastRun.status === 'failed'
              ? `Last refresh failed${
                  lastRun.steps.find((step) => step.status === 'failed')?.name
                    ? ` at ${lastRun.steps.find((step) => step.status === 'failed')!.name}`
                    : ''
                }; figures below are from the previous good data.`
              : 'A refresh is still running; figures below may be mid-update.',
          severity: 'error' as const,
        },
      ]
    : []),
  ...health.items
    .filter((item) => item.status !== 'fresh')
    .map((item) => ({
      key: item.key,
      label: item.label,
      category: item.category,
      status: item.status,
      detail: item.detail,
    })),
  ...checks
    .filter((check) => check.status !== 'pass')
    .map((check) => ({
      key: `validation:${check.name}`,
      label: check.name,
      category: 'validation' as const,
      status: check.status,
      detail: check.detail,
      severity: check.severity,
    })),
]

/**
 * Positions are projected, never passed through whole.
 *
 * Two reasons. This file leaves the machine that computed it, so it carries the
 * least that answers the question — quantities and lot counts are not needed to
 * say what moved or what is concentrated. And the names stay DESCRIPTIVE: no
 * `doNotAdd`, no `avoid`. A field named like an instruction becomes one, and
 * these figures are context for a judgement, not the judgement.
 */
const movement = (p: {
  market: string
  ticker: string
  name: string
  currency: string
  native_unrealized_gl: number | null
  native_unrealized_gl_pct: number | null
  base_unrealized_gl: number | null
}) => ({
  market: p.market,
  ticker: p.ticker,
  name: p.name,
  currency: p.currency,
  nativeUnrealizedGl: p.native_unrealized_gl,
  nativeUnrealizedGlPct: p.native_unrealized_gl_pct,
  baseUnrealizedGl: p.base_unrealized_gl,
})

const summary = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),

  // When the data was made, as three separate facts. One `asOf` would hide the
  // thing that matters most on /health: prices, FX, and the ingest are refreshed
  // by different steps and can be different ages, and a total is only as current
  // as its oldest input.
  ingestedAt: meta.ingested_at ?? null,
  pricesAsOf: { US: snapshotAt('us_prices'), KR: snapshotAt('kr_prices') },
  fxAsOf: snapshotAt('fx_rates'),

  // The refresh that produced all of the above. Present even when it failed —
  // see the write below.
  refresh: lastRun
    ? {
        status: lastRun.status,
        startedAt: lastRun.startedAt,
        finishedAt: lastRun.finishedAt,
        failedStep: lastRun.steps.find((step) => step.status === 'failed')?.name ?? null,
      }
    : null,

  health: { issues },

  // The reason this artifact exists. Only this app holds an FX snapshot, so only
  // this app can state the portfolio as one number; every consumer either repeats
  // this figure or has none. Required, not optional.
  portfolio: {
    baseCurrency: 'KRW',
    marketValue: review.totals.base_market_value,
    cost: review.totals.base_cost,
    unrealizedGl: review.totals.base_unrealized_gl,
    unrealizedGlPct:
      review.totals.base_cost > 0 ? (review.totals.base_unrealized_gl / review.totals.base_cost) * 100 : null,
    positionCount: review.totals.position_count,

    // How much of the portfolio those figures actually cover. `cost` counts every
    // position; `marketValue` and `unrealizedGl` can only count the priced ones,
    // so when these two numbers differ the return above is measured against a
    // larger base than it was earned on and reads low. Stated rather than
    // smoothed over: a consumer repeating the total deserves to know it is
    // partial, and `health.issues` will say which price snapshot came up short.
    pricedPositionCount: markets.reduce((sum, m) => sum + m.priced_position_count, 0),
    unpricedPositionCount: markets.reduce((sum, m) => sum + (m.position_count - m.priced_position_count), 0),
  },

  // The rate the base figures above were converted at — as a pair, not a bare
  // number. "1386.4" alone invites being applied upside down.
  fx: conversionRate
    ? {
        pair: `${conversionRate.from_currency}/${conversionRate.to_currency}`,
        rate: conversionRate.rate,
        asOfDate: conversionRate.as_of_date,
        source: conversionRate.source,
      }
    : null,

  byMarket: markets.map((m) => ({
    market: m.market,
    currency: m.currency,
    positionCount: m.position_count,
    nativeMarketValue: m.native_market_value,
    nativeUnrealizedGl: m.native_unrealized_gl,
    nativeUnrealizedGlPct: m.native_unrealized_gl_pct,
    baseMarketValue: m.base_market_value,
    baseUnrealizedGl: m.base_unrealized_gl,
  })),

  positions: {
    topGainers: review.topGainers.slice(0, LIST_LIMIT).map(movement),
    topLosers: review.topLosers.slice(0, LIST_LIMIT).map(movement),
    concentration: {
      top1Share: review.concentration.top1Share,
      top5Share: review.concentration.top5Share,
      top10Share: review.concentration.top10Share,
      // Positions already past the policy's per-position cap, with the size of
      // the overshoot. What to do about it is the reader's call.
      overCap: rebalance.reduceCandidates.slice(0, LIST_LIMIT).map((p) => ({
        market: p.market,
        ticker: p.ticker,
        name: p.name,
        currentPct: p.currentPct,
        capPct: rebalance.policy.positionCapPct,
        capGapPct: p.capGapPct,
      })),
    },
    // Positions where selling has a tax consequence worth knowing before acting.
    taxSensitive: rebalance.taxSensitive.slice(0, LIST_LIMIT).map((p) => ({
      market: p.market,
      ticker: p.ticker,
      name: p.name,
      reason: p.reason,
      shortTermRatio: p.short_term_ratio,
    })),
  },
}

const json = `${JSON.stringify(summary, null, 2)}\n`

if (toStdout) {
  process.stdout.write(json)
} else {
  // Atomic: a consumer must never read a half-written document. Same-directory
  // temp file so the rename stays within one filesystem.
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  const tmp = `${outPath}.tmp-${process.pid}`
  fs.writeFileSync(tmp, json)
  fs.renameSync(tmp, outPath)
  const worst = issues.length === 0 ? 'no issues' : `${issues.length} issue(s)`
  console.log(`briefing summary written: ${outPath} (${worst}, refresh ${summary.refresh?.status ?? 'unknown'})`)
}
