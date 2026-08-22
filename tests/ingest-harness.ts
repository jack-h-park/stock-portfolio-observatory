import { execFileSync } from 'node:child_process'
import path from 'node:path'

/**
 * Run the ingest against a scratch directory and NOTHING else.
 *
 * The ingest reads sixteen paths, every one of them env-configurable and every
 * one of them defaulting into the repo's own `data/`. The end-to-end tests used
 * to override five. The other eleven kept reading whatever the developer
 * happened to have on disk — gitignored files that exist on a working machine
 * and on no clean checkout — so `pnpm test` passed in CI, passed for a
 * contributor, and failed here: a real `data/crypto-activity.json` put 35 extra
 * rows in a dividends table a test asserted held one. A test whose result
 * depends on untracked local data is a test that reports the wrong thing to
 * whoever is least able to explain it.
 *
 * Two doors were open, and both are shut here:
 *
 *   1. the DEFAULTS, closed by naming every path — including the ones no test
 *      cares about, because a path no test cares about is exactly the one that
 *      gets forgotten. They point inside `<scratch>/absent/`, a directory that
 *      is never created: absent is what a clean checkout has, so absent is what
 *      the tests run against, and a stray write fails loudly instead of landing
 *      in `data/`.
 *   2. the INHERITED environment, closed at both ends. `STOCK_*` is stripped
 *      from the parent env, and the child runs with `cwd` set to the scratch dir
 *      so the ingest's `loadLocalEnv()` finds no `.env.local` to read. Both ends
 *      are real: `.env.example` asks for a value for STOCK_FX_RATES_PATH and a
 *      dozen more, and a developer who has followed it has them in `.env.local`,
 *      in their shell, or both. The second one also covers the knobs that are not
 *      paths — STOCK_TIME_ZONE, STOCK_KR_AS_OF, the `*_MAX_DAYS` staleness
 *      windows — which change what the validation checks conclude and which no
 *      list of paths would have caught.
 *
 * The ingest reads no relative path other than those defaults and spawns no
 * child process, so moving `cwd` off the repo root costs nothing.
 */

export const REPO_ROOT = path.resolve(import.meta.dirname, '..')

const INGEST_SCRIPT = path.join(REPO_ROOT, 'scripts/ingest-stock-data.mjs')

/** Every path env var `scripts/ingest-stock-data.mjs` reads, and the file each names. */
const INGEST_PATHS: Record<string, string> = {
  STOCK_KR_STATEMENTS_DIR: 'kr-statements',
  STOCK_FX_RATES_PATH: 'fx-rates.json',
  STOCK_KR_PRICES_PATH: 'kr-prices.json',
  STOCK_US_PRICES_PATH: 'us-prices.json',
  STOCK_HISTORICAL_PRICES_PATH: 'historical-prices.json',
  STOCK_HISTORICAL_FX_RATES_PATH: 'historical-fx-rates.json',
  STOCK_US_PDF_EVIDENCE_PATH: 'us-pdf-evidence.json',
  STOCK_ROBINHOOD_SNAPSHOT_PATH: 'robinhood-snapshot.json',
  STOCK_TOSS_SNAPSHOT_PATH: 'toss-snapshot.json',
  STOCK_CRYPTO_ACTIVITY_PATH: 'crypto-activity.json',
  STOCK_CRYPTO_PRICES_PATH: 'crypto-prices.json',
  STOCK_MANUAL_MAPPINGS_PATH: 'manual-mappings.json',
  STOCK_REFRESH_RUNS_PATH: 'refresh-runs.json',
  STOCK_TAX_POLICY_PATH: 'tax-policy.json',
}

/**
 * The environment for one ingest run: the parent's, minus every `STOCK_*`, plus
 * a scratch value for each path the ingest reads. `overrides` names the ones the
 * test actually supplies.
 */
export function ingestEnv(dir: string, overrides: Record<string, string> = {}) {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith('STOCK_')) continue
    env[key] = value
  }
  env.STOCK_DATA_DIR = dir
  env.STOCK_DB_PATH = path.join(dir, 'out.db')
  for (const [key, name] of Object.entries(INGEST_PATHS)) {
    env[key] = path.join(dir, 'absent', name)
  }
  return { ...env, ...overrides }
}

/**
 * Run the ingest over `dir` and return the database it wrote.
 *
 * A failing validation check exits non-zero and still writes the database —
 * that is what the checks table is for — so tests that provoke one pass
 * `allowFailure` and read the check rather than the exit status. Everything
 * else treats a non-zero exit as the failure it is.
 */
export function runIngest(
  dir: string,
  { env = {}, allowFailure = false }: { env?: Record<string, string>; allowFailure?: boolean } = {}
) {
  const full = ingestEnv(dir, env)
  try {
    // `full` is a plain string map by construction; Next's ProcessEnv insists on
    // NODE_ENV, which the child inherits when the parent has it and does not need
    // when it does not.
    execFileSync(process.execPath, [INGEST_SCRIPT], {
      cwd: dir,
      stdio: 'pipe',
      env: full as NodeJS.ProcessEnv,
    })
  } catch (err) {
    if (!allowFailure || !(err as { status?: number }).status) throw err
  }
  return full.STOCK_DB_PATH
}
