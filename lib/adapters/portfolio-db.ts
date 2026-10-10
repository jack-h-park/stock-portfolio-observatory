import fs from 'node:fs'
import { periodEndFromSource } from '@/lib/supplementary'
import path from 'node:path'
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { config } from '@/config'
import type { TaxPlanningLot } from '@/lib/tax-planning'
import { getTaxPolicyState, usTaxableWrappers, wrapperTreatment, type TaxPolicy, type WrapperTreatment } from '@/lib/tax-policy'
import { ASSET_CLASSES, depositsSeries, summarizeNetWorth, totalAssetsSeries, type AsOfNote, type CashBalanceRow, type NetWorth, type TotalAssetsSeries } from '@/lib/net-worth'
import type { PensionContributionYear } from '@/lib/pension'
import { groupAccountRanges, type AccountDataRange, type AssetType, type RangeKind, type RangeRow } from '@/lib/account-ranges'
import { foreignAccountMaxima, isUsBrokerage, isUsCashInstitution, maxBalance, treasuryRateFor, type BalancePoint, type ForeignAccountInput, type ForeignAccountMaxima } from '@/lib/fbar'
import treasuryRates from '@/data/treasury-reporting-rates.json'
import { loadAccountMap } from '@/scripts/account-map.mjs'
import { retiredBankAccounts, retiredBrokerageAccounts } from '@/lib/bank-accounts'
import { createLotValuer } from '@/scripts/lot-valuation.mjs'

/**
 * The default (Stocks) view: taxable and ISA securities only. Every holdings total goes through this.
 * Keep in step with STOCK_WRAPPERS in scripts/account-map.mjs.
 */
export const STOCK_WRAPPER_SQL = "account_wrapper in ('taxable','isa')"

/** The same filter with the column qualified, for a query that aliases holdings or joins another table that has the column. */
function stockWrapperFor(alias: string) {
  return `${alias}.${STOCK_WRAPPER_SQL}`
}

/** Keep in step with STOCK_ROW_PREDICATE in scripts/ingest-stock-data.mjs. */
export const STOCK_ROW_SQL = "account_wrapper in ('taxable', 'isa') and asset_class = 'security'"

/** Pension holdings in holdings_all: the two Korean pension wrappers. */
const PENSION_ROW_SQL = "account_wrapper in ('irp', 'pension_savings')"
/** Physical gold in holdings_all, whatever its wrapper. */
const GOLD_ROW_SQL = "asset_class = 'gold'"

/** The unfiltered table behind a stock-only view, or the plain table in a database older than the views. */
function allAssetsTable(conn: Database.Database, name: 'holdings' | 'tax_lots' | 'transactions' | 'dividends' | 'realized_lots') {
  const found = conn.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(`${name}_all`)
  return found ? `${name}_all` : name
}

export type Holding = {
  id: number
  market: string
  currency: string
  brokerage: string | null
  account: string
  ticker: string
  name: string
  quantity: number
  native_cost: number
  native_market_value: number | null
  native_unrealized_gl: number | null
  native_unrealized_gl_pct: number | null
  base_cost: number | null
  base_market_value: number | null
  base_unrealized_gl: number | null
  total_cost_krw: number
  long_term_qty: number | null
  short_term_qty: number | null
  lot_count: number | null
}

export type CostBasisStatus = 'ready' | 'missing_cost' | 'estimated' | 'unpriced'

export type CostBasisHolding = {
  id: number
  market: string
  currency: string
  brokerage: string | null
  account: string
  ticker: string
  name: string
  quantity: number
  native_price: number | null
  native_market_value: number | null
  native_cost: number | null
  native_unrealized_gl: number | null
  native_unrealized_gl_pct: number | null
  base_market_value: number | null
  base_cost: number | null
  day_change: number | null
  day_change_pct: number | null
  percent_of_total: number | null
  cost_status: CostBasisStatus
  cost_note: string
  source_method: string
  price_date: string | null
}

export type HealthCheck = {
  id: number
  name: string
  status: 'pass' | 'fail'
  detail: string
  severity: 'error' | 'warning'
  /** `stock` checks guard the Stocks view; `supplementary` ones cover deposits, pensions and gold. */
  scope: CheckScope
}

export type CheckScope = 'stock' | 'supplementary'

/** The scope column, or `'stock'` for a database written before checks had one. */
function checkScopeSql(conn: Database.Database) {
  const columns = (conn.prepare('pragma table_info(validation_checks)').all() as { name: string }[]).map((column) => column.name)
  return columns.includes('scope') ? 'scope' : "'stock'"
}

export type EvidenceReport = {
  id: number
  name: string
  category: string
  filename: string
  path: string
  account_hint: string | null
  pages: number | null
  row_count: number | null
  metrics_json: string | null
}

export type FxEvent = {
  id: number
  institution: string
  account: string
  date: string
  time: string | null
  event_type: 'EXCHANGE' | 'EXCHANGE_CANCEL' | 'TRANSFER'
  direction: string
  usd_amount: number
  krw_amount: number | null
  applied_rate: number | null
  rate_status: string
  preference_rate: number | null
  reference_base_rate: number | null
  reference_customer_rate: number | null
  reference_source: string | null
  spread_cost_krw: number | null
  spread_savings_krw: number | null
  realized_fx_gl_krw: number | null
  counterparty: string | null
  match_status: string
  confidence: string
  method: string
  balance_usd: number | null
  source: string
  page: number | null
  note: string | null
}

export type FxDashboard = {
  summary: {
    exchangeCount: number
    usdBought: number
    krwSpent: number
    weightedAverageRate: number | null
    spreadSavingsKrw: number
    realizedFxGlKrw: number | null
    realizedEventCount: number
    estimatedCount: number
    actualCount: number
    transferCount: number
    missingDestinationCount: number
    hanaOutboundTransferCount: number
    hanaOutboundUsd: number
    hanaKnownMiraeUsd: number
    hanaUnknownDestinationUsd: number
    hanaOutboundCostKrw: number
    hanaOutboundValueKrw: number
    hanaOutboundUnrealizedKrw: number
    hanaOutboundEstimatedCostRate: number | null
    hanaOutboundConfirmedUnrealizedKrw: number
    hanaOutboundEstimatedUnrealizedKrw: number
    hanaTossMatchedUsd: number
    hanaTossUnmatchedUsd: number
    hanaOtherInboundUsd: number
    currentUsdKrw: number | null
    currentUsdKrwAsOf: string | null
  }
  institutions: Array<{
    institution: string
    exchangeCount: number
    usdBought: number
    krwSpent: number
    weightedAverageRate: number | null
    estimatedCount: number
    actualCount: number
    spreadSavingsKrw: number
    latestBalanceUsd: number | null
    latestBalanceDate: string | null
  }>
  exchangeBreakdown: Array<{
    institution: string
    rateStatus: string
    exchangeCount: number
    usdBought: number
    krwSpent: number
    weightedAverageRate: number | null
    unrealizedKrw: number | null
  }>
  monthly: Array<{ month: string; usdBought: number; krwSpent: number; averageRate: number | null; spreadSavingsKrw: number }>
  transfers: FxEvent[]
  recent: FxEvent[]
}

export type PositionSourceRef = {
  source: string
  usages: string[]
  file: {
    name: string
    filename: string
    path: string
    bytes: number
    mtime_ms: number
    sha256: string
    row_count: number
  } | null
}

export type PositionDetail = {
  market: string
  ticker: string
  name: string
  currency: string
  holdings: Holding[]
  lots: any[]
  transactions: any[]
  dividends: any[]
  transactionSummary: { type: string; count: number; amount: number | null }[]
  totals: {
    account_count: number
    holding_count: number
    quantity: number
    native_cost: number
    native_market_value: number | null
    native_unrealized_gl: number | null
    base_cost: number
    base_market_value: number | null
    base_unrealized_gl: number | null
    long_term_qty: number
    short_term_qty: number
    lot_count: number
  }
  lotTotals: {
    lot_count: number
    open_quantity: number
    native_cost_basis: number
    cost_basis_krw: number
    long_term_count: number
    short_term_count: number
  }
  dividendTotals: {
    count: number
    native_amount: number
    amount_krw: number
  }
  sources: PositionSourceRef[]
}

export type FreshnessStatus = 'fresh' | 'stale' | 'drift' | 'missing'

export type FreshnessItem = {
  key: string
  label: string
  category: 'price' | 'fx' | 'source'
  status: FreshnessStatus
  observedAt: string | null
  thresholdMs: number | null
  ageMs: number | null
  detail: string
  path?: string | null
  rowCount?: number | null
}

export type OperationalHealth = {
  generatedAt: string
  items: FreshnessItem[]
  snapshots: FreshnessItem[]
  sourceDrift: FreshnessItem[]
  staleItems: FreshnessItem[]
  summary: {
    fresh: number
    stale: number
    drift: number
    missing: number
  }
}

export type AccountCoverageStatus = 'current' | 'due_soon' | 'action_needed' | 'missing'

/**
 * One of the separate artifacts an account's coverage is made of, when there is
 * more than one and each goes stale on its own. Robinhood is the case: its
 * positions come from the MCP snapshot and its trades from hand-downloaded CSVs,
 * and a fresh snapshot says nothing about whether the CSVs reach the same day.
 */
export type AccountCoverageSource = {
  /** Short name for a table cell: 'MCP', 'CSV'. */
  label: string
  method: 'inbox' | 'manual' | 'mcp'
  coveredThrough: string | null
  downloadFrom: string | null
  lagDays: number | null
  maxLagDays: number
  overdueDays: number | null
  status: AccountCoverageStatus
  requiredArtifact: string
  destination: string
  /**
   * Tickers whose disposal is missing from this artifact's history: the broker
   * no longer holds them, the replay still does. Non-empty forces the source to
   * 'action_needed' however recent its last row, because the sale is in the
   * window the next download covers and its gain is off the books until then.
   */
  missingDisposals?: string[]
}

export type AccountCoverage = {
  id: string
  market: string
  brokerage: string
  account: string
  coveredThrough: string | null
  downloadFrom: string | null
  lagDays: number | null
  apiCoveredThrough: string | null
  apiLagDays: number | null
  statementCoveredThrough: string | null
  statementLagDays: number | null
  maxLagDays: number
  overdueDays: number | null
  status: AccountCoverageStatus
  // 'manual': downloaded, but the inbox cannot file it, so it is named and
  // placed by hand. A Robinhood transactions CSV carries no account, and which
  // account it is exists only in the name someone gives it.
  method: 'inbox' | 'manual' | 'api' | 'mcp' | 'mixed'
  requiredArtifact: string
  format: string
  destination: string
  lastFile: string | null
  action: string
  detail: string
  /**
   * Non-empty when the row stands for several artifacts that age separately. The row's
   * own date, status and method are those of the one furthest behind, so a
   * reader that ignores this still reports the account as stale when any part is.
   */
  sources: AccountCoverageSource[]
  /** Tickers with a missing disposal in this account (see AccountCoverageSource). */
  missingDisposals: string[]
}

export type AccountCoverageSummary = {
  rows: AccountCoverage[]
  actionNeeded: number
  dueSoon: number
  current: number
  generatedAt: string
}

export type RefreshStep = {
  name: string
  command: string
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  status: 'success' | 'failed' | 'running'
  exitCode: number | null
  signal?: string | null
  stdoutTail?: string
  stderrTail?: string
}

export type RefreshRun = {
  id: string
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  status: 'success' | 'failed' | 'running'
  /**
   * Optional steps that failed while the run still succeeded.
   *
   * A run is degraded, not failed, when only optional steps broke: the figures
   * are complete and correct, one third-party source is just running on older
   * data. Kept separate from `status` so a consumer asking "can I trust these
   * numbers" and one asking "is anything stale" get different answers.
   */
  degradedSteps: string[]
  steps: RefreshStep[]
}

export type SourceInventoryItem = {
  id: string
  name: string
  filename: string
  relativePath: string
  path: string
  category: string
  status: 'used' | 'unused' | 'drift' | 'missing' | 'derived' | 'archive'
  bytes: number | null
  mtimeMs: number | null
  rowCount: number | null
  sha256: string | null
  detail: string
  retention: 'active' | 'fallback' | 'archive' | 'derived' | 'review'
  retentionReason: string
}

export type SourceInventory = {
  dataDir: string
  tracked: SourceInventoryItem[]
  untracked: SourceInventoryItem[]
  items: SourceInventoryItem[]
  summary: {
    used: number
    unused: number
    drift: number
    missing: number
    totalBytes: number
  }
}

export type ReviewPosition = {
  market: string
  currency: string
  ticker: string
  name: string
  account_count: number
  quantity: number
  native_cost: number
  native_market_value: number | null
  native_unrealized_gl: number | null
  native_unrealized_gl_pct: number | null
  base_cost: number
  base_market_value: number | null
  base_unrealized_gl: number | null
  base_unrealized_gl_pct: number | null
  long_term_qty: number
  short_term_qty: number
  short_term_ratio: number | null
  lot_count: number
}

/**
 * One market's figures in BOTH its own currency and the base currency.
 *
 * `PortfolioReview.byMarket` reports base amounts only, which is right for the
 * review screen — every row is comparable there. Consumers outside this app want
 * the native figure too ("US +$802"), and the pair has to be grouped together:
 * a market's native sum is only meaningful alongside the currency it is denominated
 * in, so `currency` is part of the grain rather than a label bolted on after.
 */
export type MarketBreakdown = {
  market: string
  currency: string
  position_count: number
  /** How many of those rows actually carry a market value. See `native_cost`. */
  priced_position_count: number
  native_cost: number
  native_market_value: number | null
  native_unrealized_gl: number | null
  native_unrealized_gl_pct: number | null
  base_cost: number
  base_market_value: number | null
  base_unrealized_gl: number | null
}

export type PortfolioReview = {
  totals: {
    position_count: number
    market_count: number
    account_count: number
    base_cost: number
    base_market_value: number
    base_unrealized_gl: number
    positive_positions: number
    negative_positions: number
  }
  concentration: {
    top1Share: number
    top5Share: number
    top10Share: number
  }
  byMarket: {
    market: string
    position_count: number
    base_cost: number
    base_market_value: number
    base_unrealized_gl: number
  }[]
  topGainers: ReviewPosition[]
  topLosers: ReviewPosition[]
  largestPositions: ReviewPosition[]
  shortTermHeavy: ReviewPosition[]
  noMarketValue: ReviewPosition[]
}

export type IncomeReview = {
  totals: {
    row_count: number
    tickerless_count: number
    base_income: number
    dividend_base_income: number
    interest_base_income: number
    other_base_income: number
    krw_income: number
    usd_income: number
    ytd_base_income: number
    trailing_12m_base_income: number
    yield_on_market: number | null
    yield_on_cost: number | null
  }
  byMonth: {
    month: string
    base_income: number
    dividend_base_income: number
    interest_base_income: number
    other_base_income: number
    row_count: number
  }[]
  byYear: {
    year: string
    currency: string
    native_income: number
    base_income: number
    row_count: number
  }[]
  byMarket: {
    market: string
    currency: string
    native_income: number
    base_income: number
    row_count: number
  }[]
  byPosition: {
    market: string
    currency: string
    ticker: string
    name: string
    native_income: number
    base_income: number
    row_count: number
    market_value: number | null
    cost_basis: number | null
    trailing_yield: number | null
    yield_on_cost: number | null
  }[]
  tickerless: {
    market: string
    currency: string
    name: string | null
    type: string | null
    native_income: number
    base_income: number
    row_count: number
  }[]
}

export type RebalanceReview = {
  policy: {
    baseCurrency: 'KRW'
    marketTargets: { market: string; targetPct: number }[]
    positionCapPct: number
  }
  totals: {
    base_market_value: number
    base_cost: number
    position_count: number
  }
  marketGaps: {
    market: string
    currentValue: number
    currentPct: number
    targetPct: number
    targetValue: number
    gapValue: number
    gapPct: number
    action: 'Add' | 'Reduce' | 'Hold'
  }[]
  reduceCandidates: (ReviewPosition & { currentPct: number; capGapPct: number; capGapValue: number })[]
  addContext: {
    market: string
    gapValue: number
    gapPct: number
    candidateCount: number
  }[]
  watchCandidates: (ReviewPosition & { reason: string })[]
  taxSensitive: (ReviewPosition & { reason: string })[]
  untargetedMarkets: {
    market: string
    currentValue: number
    currentPctOfPortfolio: number
  }[]
}

export type DataOpsReview = {
  manualMappings: {
    path: string
    version: number | null
    incomeRuleCount: number
    overrideCount: number
    instrumentAliasCount: number
  }
  mappingSummary: {
    mapping_status: string
    income_category: string
    row_count: number
    base_income: number
  }[]
  tickerlessIncome: {
    market: string
    currency: string
    brokerage: string | null
    account: string
    income_category: string
    mapping_status: string
    type: string | null
    name: string | null
    source: string | null
    row_count: number
    native_income: number
    base_income: number
    suggestion: string
    suggestedRule: string
  }[]
  missingValuation: {
    market: string
    currency: string
    brokerage: string | null
    account: string
    ticker: string
    name: string
    quantity: number
    native_cost: number
    base_cost: number | null
    reason: string
    suggestion: string
  }[]
  actionQueue: {
    priority: 'high' | 'medium' | 'low'
    area: string
    count: number
    action: string
    href: string
  }[]
  mappingSuggestions: {
    id: string
    market: string
    brokerage: string | null
    source: string | null
    income_category: string
    row_count: number
    base_income: number
    rule: string
    note: string
  }[]
  valuationFixes: {
    market: string
    ticker: string
    name: string
    brokerage: string | null
    reason: string
    suggestion: string
  }[]
  sourceIssues: FreshnessItem[]
  validationIssues: HealthCheck[]
}

export type ReconciliationReview = {
  totals: {
    issue_count: number
    market_count: number
    brokerage_count: number
    position_count: number
    lot_position_count: number
    tickerless_income_count: number
    missing_valuation_count: number
    source_issue_count: number
    validation_issue_count: number
  }
  coverage: {
    market: string
    brokerage: string
    holding_positions: number
    holding_accounts: number
    holding_base_cost: number
    lot_positions: number
    lot_rows: number
    lot_base_cost: number
    transaction_rows: number
    dividend_rows: number
  }[]
  positionBreaks: {
    market: string
    brokerage: string
    ticker: string
    name: string
    holding_accounts: number
    holding_quantity: number | null
    lot_quantity: number | null
    quantity_diff: number | null
    holding_base_cost: number | null
    lot_base_cost: number | null
    base_cost_diff: number | null
    status: 'holding_only' | 'lot_only' | 'quantity_break' | 'cost_break'
  }[]
  incomeBreaks: {
    market: string
    currency: string
    brokerage: string | null
    income_category: string
    row_count: number
    base_income: number
  }[]
  valuationBreaks: {
    market: string
    currency: string
    brokerage: string | null
    ticker: string
    name: string
    native_cost: number
    base_cost: number | null
  }[]
  actionQueue: {
    priority: 'high' | 'medium' | 'low'
    area: string
    count: number
    action: string
    href: string
  }[]
}

function db() {
  return new Database(config.stockDbPath, { readonly: true, fileMustExist: true })
}

export function dbAvailable() {
  return fs.existsSync(config.stockDbPath)
}

export function getMeta() {
  const conn = db()
  try {
    return Object.fromEntries(conn.prepare('select key, value from meta').all().map((r: any) => [r.key, r.value])) as Record<
      string,
      string
    >
  } finally {
    conn.close()
  }
}

export function getOverview() {
  const conn = db()
  try {
    const totals = conn
      .prepare(
        `with holding_terms as (
          select
            h.*,
            coalesce(sum(l.open_quantity), 0) as lot_term_qty,
            coalesce(sum(case when l.tax_term = 'Long-term' then l.open_quantity else 0 end), 0) as lot_long_term_qty,
            coalesce(sum(case when l.tax_term = 'Short-term' then l.open_quantity else 0 end), 0) as lot_short_term_qty
          from holdings h
          left join tax_lots l
            on l.market = h.market
           and l.account = h.account
           and l.ticker = h.ticker
          where ${stockWrapperFor("h")}
          group by h.id
        ), term_ready_holdings as (
          select
            *,
            case
              when coalesce(long_term_qty, 0) + coalesce(short_term_qty, 0) > 0 then coalesce(long_term_qty, 0)
              when lot_term_qty > 0 then lot_long_term_qty
              else 0
            end as term_long_qty,
            case
              when coalesce(long_term_qty, 0) + coalesce(short_term_qty, 0) > 0 then coalesce(short_term_qty, 0)
              when lot_term_qty > 0 then lot_short_term_qty
              else 0
            end as term_short_qty
          from holding_terms
        )
        select
          count(*) as holding_count,
          coalesce(sum(quantity), 0) as share_count,
          coalesce(sum(case when currency = 'KRW' then native_cost else 0 end), 0) as krw_cost,
          coalesce(sum(case when currency = 'KRW' then native_market_value else 0 end), 0) as krw_market_value,
          coalesce(sum(case when currency = 'KRW' then native_unrealized_gl else 0 end), 0) as krw_unrealized_gl,
          coalesce(sum(case when currency = 'USD' then native_cost else 0 end), 0) as usd_cost,
          coalesce(sum(case when currency = 'USD' then native_market_value else 0 end), 0) as usd_market_value,
          coalesce(sum(case when currency = 'USD' then native_unrealized_gl else 0 end), 0) as usd_unrealized_gl,
          coalesce(sum(base_cost), 0) as global_base_cost,
          coalesce(sum(case when base_market_value is not null then base_cost else 0 end), 0) as global_priced_base_cost,
          coalesce(sum(base_market_value), 0) as global_base_market_value,
          coalesce(sum(case when base_market_value is not null then base_market_value - base_cost else 0 end), 0) as global_base_unrealized_gl,
          -- Market-scoped totals in the base currency, alongside the
          -- currency-scoped ones above. The two used to be interchangeable
          -- because KR meant KRW and US meant USD. Crypto breaks that: it holds
          -- KRW positions on Bithumb and USD positions on Robinhood, so a card
          -- labelled "KR" that sums by CURRENCY would quietly include Korean
          -- crypto, and one labelled "US" would include the Robinhood coins.
          coalesce(sum(case when market = 'KR' then base_cost else 0 end), 0) as kr_base_cost,
          coalesce(sum(case when market = 'KR' and base_market_value is not null then base_cost else 0 end), 0) as kr_priced_base_cost,
          coalesce(sum(case when market = 'KR' then base_market_value else 0 end), 0) as kr_base_market_value,
          coalesce(sum(case when market = 'KR' and base_market_value is not null then base_market_value - base_cost else 0 end), 0) as kr_base_unrealized_gl,
          coalesce(sum(case when market = 'US' then base_cost else 0 end), 0) as us_base_cost,
          coalesce(sum(case when market = 'US' and base_market_value is not null then base_cost else 0 end), 0) as us_priced_base_cost,
          coalesce(sum(case when market = 'US' then base_market_value else 0 end), 0) as us_base_market_value,
          coalesce(sum(case when market = 'US' and base_market_value is not null then base_market_value - base_cost else 0 end), 0) as us_base_unrealized_gl,
          coalesce(sum(case when market = 'CRYPTO' then base_cost else 0 end), 0) as crypto_base_cost,
          coalesce(sum(case when market = 'CRYPTO' and base_market_value is not null then base_cost else 0 end), 0) as crypto_priced_base_cost,
          coalesce(sum(case when market = 'CRYPTO' then base_market_value else 0 end), 0) as crypto_base_market_value,
          coalesce(sum(case when market = 'CRYPTO' and base_market_value is not null then base_market_value - base_cost else 0 end), 0) as crypto_base_unrealized_gl,
          coalesce(sum(term_long_qty), 0) as long_term_qty,
          coalesce(sum(term_short_qty), 0) as short_term_qty,
          coalesce(sum(case
            when coalesce(term_long_qty, 0) + coalesce(term_short_qty, 0) > 0
            then coalesce(base_market_value, base_cost, 0)
            else 0
          end), 0) as term_classified_base_value,
          coalesce(sum(case
            when coalesce(term_long_qty, 0) + coalesce(term_short_qty, 0) > 0
            then coalesce(base_market_value, base_cost, 0) * coalesce(term_long_qty, 0) / (coalesce(term_long_qty, 0) + coalesce(term_short_qty, 0))
            else 0
          end), 0) as term_long_base_value,
          coalesce(sum(case
            when coalesce(term_long_qty, 0) + coalesce(term_short_qty, 0) > 0
            then coalesce(base_market_value, base_cost, 0) * coalesce(term_short_qty, 0) / (coalesce(term_long_qty, 0) + coalesce(term_short_qty, 0))
            else 0
          end), 0) as term_short_base_value,
          coalesce(sum(case
            when coalesce(term_long_qty, 0) + coalesce(term_short_qty, 0) = 0
            then coalesce(base_market_value, base_cost, 0)
            else 0
          end), 0) as term_unclassified_base_value,
          coalesce(sum(case
            when market = 'KR' and coalesce(term_long_qty, 0) + coalesce(term_short_qty, 0) > 0
            then coalesce(base_market_value, base_cost, 0) * coalesce(term_short_qty, 0) / (coalesce(term_long_qty, 0) + coalesce(term_short_qty, 0))
            else 0
          end), 0) as kr_term_short_base_value,
          coalesce(sum(case
            when market = 'US' and coalesce(term_long_qty, 0) + coalesce(term_short_qty, 0) > 0
            then coalesce(base_market_value, base_cost, 0) * coalesce(term_short_qty, 0) / (coalesce(term_long_qty, 0) + coalesce(term_short_qty, 0))
            else 0
          end), 0) as us_term_short_base_value,
          coalesce(sum(case
            when market = 'CRYPTO' and coalesce(term_long_qty, 0) + coalesce(term_short_qty, 0) > 0
            then coalesce(base_market_value, base_cost, 0) * coalesce(term_short_qty, 0) / (coalesce(term_long_qty, 0) + coalesce(term_short_qty, 0))
            else 0
          end), 0) as crypto_term_short_base_value
        from term_ready_holdings`
      )
      .get() as any
    const dividends = conn
      .prepare(
        `select
          count(*) as count,
          coalesce(sum(case when currency = 'KRW' then native_amount else 0 end), 0) as krw_amount,
          coalesce(sum(case when currency = 'USD' then native_amount else 0 end), 0) as usd_amount
         from dividends`
      )
      .get() as any
    const realized = conn
      .prepare('select count(*) as count, coalesce(sum(realized_gl_krw), 0) as amount from realized_lots')
      .get() as any
    const tx = conn.prepare('select count(*) as count, min(date) as first_date, max(date) as last_date from transactions').get() as any
    // The badge counts stock checks only: a supplementary warning is not a Stocks-view problem.
    const checks = conn
      .prepare(`select count(*) as failed from validation_checks where status != 'pass' and ${checkScopeSql(conn)} = 'stock'`)
      .get() as any
    const fxRates = conn.prepare('select * from fx_rates order by as_of_date desc, from_currency').all() as any[]
    return { totals, dividends, realized, tx, failedChecks: checks.failed as number, fxRates }
  } finally {
    conn.close()
  }
}

export type PortfolioSnapshot = {
  snapshot_date: string
  captured_at: string
  global_base_cost: number
  global_base_market_value: number | null
  global_base_unrealized_gl: number | null
  global_base_return_pct: number | null
  market_value_coverage: number | null
  priced_base_cost: number | null
  position_coverage: number | null
  kr_market_value_coverage: number | null
  us_market_value_coverage: number | null
  crypto_market_value_coverage: number | null
  kr_market_value: number | null
  us_market_value_base: number | null
  crypto_market_value_base: number | null
  kr_cost_basis: number | null
  us_cost_basis_base: number | null
  crypto_cost_basis_base: number | null
  kr_unrealized_gl: number | null
  us_unrealized_gl_base: number | null
  crypto_unrealized_gl_base: number | null
  kr_return_pct: number | null
  us_return_pct: number | null
  crypto_return_pct: number | null
  // Cumulative realized G/L in KRW as of the snapshot date. Not stored on the
  // snapshot row: derived from realized_lots when the series is read, so every
  // past snapshot picks up a lot the ingest learns about later.
  global_realized_gl: number | null
  kr_realized_gl: number | null
  us_realized_gl_base: number | null
  crypto_realized_gl_base: number | null
  krw_cost: number
  usd_cost: number
  dividends_krw: number
  dividends_usd: number
  holding_count: number
  share_count: number
}

export function getPortfolioSnapshots(days = 3650): PortfolioSnapshot[] {
  const conn = db()
  try {
    const table = conn
      .prepare("select 1 from sqlite_master where type = 'table' and name = 'portfolio_snapshots'")
      .get()
    if (!table) return []
    const columns = new Set(
      (conn.prepare('pragma table_info(portfolio_snapshots)').all() as { name: string }[]).map((column) => column.name)
    )
    const optional = (name: string, fallback = 'null') => columns.has(name) ? name : `${fallback} as ${name}`
    const costCoverage = columns.has('priced_base_cost') ? 'market_value_coverage' : 'null as market_value_coverage'
    const snapshots = conn
      .prepare(
        `select snapshot_date, captured_at, global_base_cost, global_base_market_value,
          global_base_unrealized_gl, global_base_return_pct, ${costCoverage},
          ${optional('priced_base_cost')}, ${optional('position_coverage')},
          ${optional('kr_market_value_coverage')},
          ${optional('us_market_value_coverage')},
          ${optional('crypto_market_value_coverage')},
          kr_market_value, us_market_value_base, crypto_market_value_base,
          kr_cost_basis, us_cost_basis_base, crypto_cost_basis_base,
          kr_unrealized_gl, us_unrealized_gl_base, crypto_unrealized_gl_base,
          kr_return_pct, us_return_pct, crypto_return_pct,
          krw_cost, usd_cost, dividends_krw, dividends_usd, holding_count, share_count
         from portfolio_snapshots
         where snapshot_date >= date('now', ?)
         order by snapshot_date`
      )
      .all(`-${Math.max(1, Math.floor(days))} days`) as PortfolioSnapshot[]
    return withCumulativeRealized(conn, snapshots)
  } finally {
    conn.close()
  }
}

const REALIZED_MARKET_FIELDS = {
  KR: 'kr_realized_gl',
  US: 'us_realized_gl_base',
  CRYPTO: 'crypto_realized_gl_base',
} as const

// Running sum of realized_gl_krw over every lot sold on or before each snapshot
// date, per market. The sum starts at the first sale ever, not at the start of
// the requested window, so a 2Y chart opens at the balance already realized.
// A replay row that a 1099-B filing replaced carries superseded_by and is
// skipped: counting both would realize the same sale twice.
function withCumulativeRealized(conn: Database.Database, snapshots: PortfolioSnapshot[]): PortfolioSnapshot[] {
  const empty = { global_realized_gl: null, kr_realized_gl: null, us_realized_gl_base: null, crypto_realized_gl_base: null }
  // realized_lots is a stock-only view in a current database and a table in an
  // older one; either is what this chart should read.
  const table = conn
    .prepare("select 1 from sqlite_master where type in ('table', 'view') and name = 'realized_lots'")
    .get()
  const columns = table
    ? new Set((conn.prepare('pragma table_info(realized_lots)').all() as { name: string }[]).map((column) => column.name))
    : new Set<string>()
  if (!columns.has('sold_date') || !columns.has('realized_gl_krw')) return snapshots.map((snapshot) => ({ ...snapshot, ...empty }))
  const notSuperseded = columns.has('superseded_by') ? "and coalesce(superseded_by, '') = ''" : ''
  const sales = conn
    .prepare(
      `select market, substr(sold_date, 1, 10) as sold_date, sum(realized_gl_krw) as amount
       from realized_lots
       where sold_date is not null and sold_date != '' and realized_gl_krw is not null ${notSuperseded}
       group by market, substr(sold_date, 1, 10)
       order by sold_date`
    )
    .all() as { market: string; sold_date: string; amount: number }[]
  const running = { KR: 0, US: 0, CRYPTO: 0 }
  let next = 0
  return snapshots.map((snapshot) => {
    while (next < sales.length && sales[next].sold_date <= snapshot.snapshot_date) {
      const market = sales[next].market as keyof typeof running
      if (market in running) running[market] += sales[next].amount
      next += 1
    }
    const realized = Object.fromEntries(
      Object.entries(REALIZED_MARKET_FIELDS).map(([market, field]) => [field, running[market as keyof typeof running]])
    ) as Pick<PortfolioSnapshot, (typeof REALIZED_MARKET_FIELDS)[keyof typeof REALIZED_MARKET_FIELDS]>
    return { ...snapshot, ...realized, global_realized_gl: running.KR + running.US + running.CRYPTO }
  })
}

// USD/KRW on a date: the latest historical rate on or before it, else the
// current spot rate. Shared by the deposits series and the total-assets series
// so both convert a dated balance the same way.
function usdKrwRateAt(conn: Database.Database): (date: string) => number | null {
  const hasTable = (name: string) =>
    Boolean(conn.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name))
  const usd = hasTable('fx_rates')
    ? (conn
        .prepare("select rate from fx_rates where from_currency = 'USD' and to_currency = 'KRW' order by as_of_date desc limit 1")
        .get() as { rate: number } | undefined)
    : undefined
  const rates = hasTable('historical_fx_rates')
    ? (conn.prepare('select price_date, rate from historical_fx_rates order by price_date').all() as { price_date: string; rate: number }[])
    : []
  return (date: string) => rates.filter((r) => r.price_date <= date).at(-1)?.rate ?? usd?.rate ?? null
}

// Every cash_balances row in (date, id) order, so a repeated date keeps its last
// row, the same as the latest-balance read in getNetWorth.
function cashBalanceRows(conn: Database.Database): CashBalanceRow[] {
  const hasCash = conn.prepare("select 1 from sqlite_master where type = 'table' and name = 'cash_balances'").get()
  return hasCash
    ? (conn.prepare('select institution, account, currency, as_of_date as date, balance from cash_balances order by as_of_date, id').all() as CashBalanceRow[])
    : []
}

// Deposits in KRW on each of the given dates: the cash class of the total-assets series.
export function getDepositsSeries(dates: string[]): ReturnType<typeof depositsSeries> {
  const conn = db()
  try {
    return depositsSeries(dates, cashBalanceRows(conn), usdKrwRateAt(conn))
  } finally {
    conn.close()
  }
}

/** Today in the ingest's time zone, the same calendar the snapshot dates use (scripts/portfolio-snapshot.mjs). */
export function portfolioToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.STOCK_TIME_ZONE || 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Snapshot dates within the last `days`, oldest first: the dates the total-assets chart plots. */
export function getSnapshotDates(days = 3650): string[] {
  const conn = db()
  try {
    const table = conn.prepare("select 1 from sqlite_master where type = 'table' and name = 'portfolio_snapshots'").get()
    if (!table) return []
    return (
      conn
        .prepare("select snapshot_date from portfolio_snapshots where snapshot_date >= date('now', ?) order by snapshot_date")
        .all(`-${Math.max(1, Math.floor(days))} days`) as { snapshot_date: string }[]
    ).map((row) => row.snapshot_date)
  } finally {
    conn.close()
  }
}

/**
 * Total assets by class on each date, for the stacked trend: stocks (KR + US)
 * and crypto from portfolio_snapshots, cash from cash_balances, pensions from
 * the certificate and snapshot totals in pension_points, gold from its BUY rows
 * and gold_prices. Then today is appended from getNetWorth(), replacing any
 * date on or after it, so the last point is the Total assets card exactly.
 */
export function getTotalAssetsSeries(dates: string[], precomputed?: NetWorth): TotalAssetsSeries {
  // A page that already has the net worth passes it, so getOverview() runs once.
  const netWorth = precomputed ?? getNetWorth()
  const today = portfolioToday()
  const conn = db()
  try {
    const hasTable = (name: string) =>
      Boolean(conn.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name))
    const columnsOf = (name: string) =>
      new Set((conn.prepare(`pragma table_info(${name})`).all() as { name: string }[]).map((column) => column.name))
    const past = [...new Set(dates)].filter((date) => date < today).sort()

    const snapshots = new Map(
      (hasTable('portfolio_snapshots')
        ? (conn
            .prepare('select snapshot_date as date, kr_market_value as kr, us_market_value_base as us, crypto_market_value_base as crypto from portfolio_snapshots')
            .all() as { date: string; kr: number | null; us: number | null; crypto: number | null }[])
        : []
      ).map((row) => [row.date, row])
    )
    const stocks: Record<string, number | null> = {}
    const crypto: Record<string, number | null> = {}
    for (const date of past) {
      const row = snapshots.get(date)
      stocks[date] = !row || (row.kr == null && row.us == null) ? null : Number(row.kr ?? 0) + Number(row.us ?? 0)
      crypto[date] = row?.crypto == null ? null : Number(row.crypto)
    }
    const cash = Object.fromEntries(depositsSeries(past, cashBalanceRows(conn), usdKrwRateAt(conn)).series.map((point) => [point.date, point.krw]))
    const pensionPoints = hasTable('pension_points')
      ? (conn.prepare('select account, date, value_krw as valueKrw from pension_points order by date, id').all() as { account: string; date: string; valueKrw: number }[])
      : []
    // Gold BUY rows carry grams as quantity and the purchase amount in KRW. No
    // gold sale is on file; the holding itself (getNetWorth) handles one.
    const goldBuys =
      hasTable('transactions_all') && columnsOf('transactions_all').has('asset_class')
        ? (
            conn
              .prepare(
                `select substr(date, 1, 10) as date, abs(coalesce(quantity, 0)) as grams, abs(coalesce(amount_krw, settlement_krw, 0)) as costKrw
                   from transactions_all where asset_class = 'gold' and type = 'BUY' order by date, id`
              )
              .all() as { date: string; grams: number; costKrw: number }[]
          ).filter((buy) => buy.grams > 0)
        : []
    const goldPrices = hasTable('gold_prices') ? (conn.prepare('select date, price from gold_prices order by date').all() as { date: string; price: number }[]) : []

    const history = totalAssetsSeries({ dates: past, stocks, crypto, cash, pensionPoints, gold: { buys: goldBuys, prices: goldPrices } })
    // Today, from the card's own figures. A class that is zero today and never
    // had data stays null, so it does not "start" on the last point.
    const latest = { date: today, total: netWorth.totalKrw } as TotalAssetsSeries['points'][number]
    for (const key of ASSET_CLASSES) {
      const value = netWorth.byClass[key]
      latest[key] = value !== 0 || history.startsOn[key] ? value : null
    }
    const startsOn = { ...history.startsOn }
    for (const key of ASSET_CLASSES) if (!startsOn[key] && latest[key] != null) startsOn[key] = today
    return { points: [...history.points, latest], startsOn }
  } finally {
    conn.close()
  }
}

export function getNetWorth(precomputed?: ReturnType<typeof getOverview>): NetWorth {
  const overview = precomputed ?? getOverview()
  const conn = db()
  try {
    const hasTable = (name: string) =>
      Boolean(conn.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name))
    // One row per (institution, account): the newest date, and the highest id when a date repeats.
    const latest = hasTable('cash_balances')
      ? (conn
          .prepare(
            `select institution, account, kind, currency, as_of_date as asOfDate, balance, derived
               from (
                 select *, row_number() over (partition by institution, account order by as_of_date desc, id desc) as rn
                   from cash_balances
               )
              where rn = 1
              order by institution, account`
          )
          .all() as any[])
      : []
    const usd = conn
      .prepare("select rate from fx_rates where from_currency = 'USD' and to_currency = 'KRW' order by as_of_date desc limit 1")
      .get() as { rate: number } | undefined
    // Pensions and gold live only in holdings_all, never in the stock view the
    // overview totals read. A row with no market value counts at cost.
    const others = hasTable('holdings_all')
      ? (conn
          .prepare(
            `select
               coalesce(sum(case when ${PENSION_ROW_SQL} then coalesce(base_market_value, base_cost, 0) end), 0) as pensions,
               coalesce(sum(case when ${GOLD_ROW_SQL} then coalesce(base_market_value, base_cost, 0) end), 0) as gold
               from holdings_all`
          )
          .get() as { pensions: number; gold: number })
      : { pensions: 0, gold: 0 }
    // Values from a dated snapshot or held at cost, one note per account and date.
    const asOfNotes = hasTable('holdings_all')
      ? (conn
          .prepare(
            `select distinct case when ${PENSION_ROW_SQL} then 'pensions' else 'gold' end as assetClass, account as label, as_of_date as asOf
               from holdings_all
              where (${PENSION_ROW_SQL} or ${GOLD_ROW_SQL})
                and (valuation_source in ('snapshot', 'cost') or base_market_value is null)
                and as_of_date is not null
              order by account, as_of_date`
          )
          .all() as AsOfNote[])
      : []
    return summarizeNetWorth({
      stocksKrw: (overview.totals.kr_base_market_value ?? 0) + (overview.totals.us_base_market_value ?? 0),
      cryptoKrw: overview.totals.crypto_base_market_value ?? 0,
      usdKrw: usd?.rate ?? null,
      cash: latest.map((row) => ({ ...row, derived: Boolean(row.derived) })),
      pensionsKrw: Number(others.pensions),
      goldKrw: Number(others.gold),
      asOfNotes,
    })
  } finally {
    conn.close()
  }
}

/**
 * A closed account's balance history: the points up to `retiredOn`, then zero
 * from the next day through the end of that year, so the closing year is read
 * as complete and nothing is carried past the closure.
 */
function closedOn(points: BalancePoint[], retiredOn: string): BalancePoint[] {
  const next = new Date(Date.parse(`${retiredOn}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  const yearEnd = `${retiredOn.slice(0, 4)}-12-31`
  return [...points.filter((point) => point.date <= retiredOn), { date: next, valueKrw: 0 }, { date: next > yearEnd ? next : yearEnd, valueKrw: 0 }]
}

/**
 * Each foreign account's maximum value in `year`, for FBAR and Form 8938. Foreign
 * is everything not held at a US institution:
 *
 * - cash outside the US banks (isUsCashInstitution), from daily balances
 *   carried forward; a USD account's maximum is read in dollars. A bankAccounts
 *   entry with `retiredOn` ends its account's series on that date;
 * - stock accounts outside the US brokerages (isUsBrokerage), KR and US market
 *   alike, so a Korean broker's US stocks count: month-end values of the lots
 *   held times the historical price, converted at that date's USD/KRW rate when
 *   the quote is in dollars (the reconstruction the month-end backfill uses),
 *   at cost where no price reaches a position, plus the uninvested cash the
 *   statements print (brokerage_cash) carried forward to each month-end, but
 *   never past or between the statement periods (brokerage_cash_coverage);
 *   `cashIncluded` says whether any reached the year. A brokerageAccounts
 *   entry with `retiredOn` ends its account's series on that date;
 * - crypto exchange accounts outside the US firms, valued the same way from
 *   their lots, as reference rows kept out of the aggregate;
 * - pension accounts, from their certificate and snapshot totals;
 * - the gold account, grams held times the latest KRX price, at cost before
 *   the first stored price (partial when any of the year is at cost).
 *
 * USD figures use the Treasury year-end rate in data/treasury-reporting-rates.json.
 * An account with nothing in or before the year, or a zero maximum, is left out.
 * A USD account no rate of any kind can convert stays in, with a null won figure.
 * Rows are identified by `institution|account`; for pensions and gold the
 * institution is the account name before its parenthesis. This can differ from
 * the institution `/pension` shows, which comes from the account map entry.
 */
export function getForeignAccountMaxima(year: number): ForeignAccountMaxima {
  const rate = treasuryRateFor(year, treasuryRates.rates)
  const today = portfolioToday()
  const start = `${year}-01-01`
  const end = `${year}-12-31`
  const conn = db()
  try {
    const hasTable = (name: string) =>
      Boolean(conn.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name))
    const columnsOf = (name: string) =>
      new Set((conn.prepare(`pragma table_info(${name})`).all() as { name: string }[]).map((column) => column.name))
    const accounts: ForeignAccountInput[] = []
    const institutionOf = (account: string) => account.split('(')[0].trim() || account
    const add = (
      institution: string,
      account: string,
      kind: ForeignAccountInput['kind'],
      found: { maxKrw: number | null; date: string; coverage: ForeignAccountInput['coverage'] } | null,
      extra: Partial<ForeignAccountInput> = {}
    ) => {
      if (!found) return
      const positive = found.maxKrw != null ? found.maxKrw > 0 : (extra.maxUsdNative ?? 0) > 0
      if (positive) accounts.push({ institution, account, kind, maxKrw: found.maxKrw, maxDate: found.date, coverage: found.coverage, ...extra })
    }

    // Cash: one series per (institution, account), in the account's own currency.
    // A retired account (the map's `retiredOn`) holds nothing after that date:
    // its series closes at zero, and a later year has no row for it.
    let retired = new Map<string, string | null>()
    let retiredBrokerage = new Map<string, string | null>()
    try {
      const accountMap = loadAccountMap(config.stockAccountMapPath)
      retired = retiredBankAccounts(accountMap.bankAccounts)
      retiredBrokerage = retiredBrokerageAccounts(accountMap.brokerageAccounts)
    } catch {
      // An unreadable map is the ingest's failure to report; here no account is retired.
    }
    const rateAt = usdKrwRateAt(conn)
    const cashByAccount = new Map<string, { institution: string; account: string; currency: string; points: BalancePoint[] }>()
    if (hasTable('cash_balances')) {
      const rows = conn
        .prepare('select institution, account, currency, as_of_date as date, balance from cash_balances order by as_of_date, id')
        .all() as { institution: string; account: string; currency: string; date: string; balance: number }[]
      for (const row of rows) {
        if (isUsCashInstitution(row.institution)) continue
        const key = `${row.institution}|${row.account}`
        const entry = cashByAccount.get(key) ?? { institution: row.institution, account: row.account, currency: row.currency, points: [] }
        entry.points.push({ date: row.date, valueKrw: Number(row.balance) })
        cashByAccount.set(key, entry)
      }
    }
    for (const [key, { institution, account, currency, points: history }] of cashByAccount) {
      const retiredOn = retired.get(key) ?? null
      if (retiredOn && retiredOn < start) continue
      const points = retiredOn ? closedOn(history, retiredOn) : history
      const found = maxBalance(points, year)
      if (!found) continue
      if (currency === 'USD') {
        // Dollars in, dollars out. Without a Treasury rate the won figure falls
        // back to the market rate on the date of the maximum, and with neither
        // it is null: the row stays, the page says why it has no won figure.
        const krwPerUsd = rate?.krwPerUsd ?? rateAt(found.date)
        add(institution, account, 'cash', { ...found, maxKrw: krwPerUsd == null ? null : found.maxKrw * krwPerUsd }, { maxUsdNative: found.maxKrw })
      } else if (currency === 'KRW') {
        add(institution, account, 'cash', found)
      }
    }

    // Brokerage and crypto exchange accounts outside the US firms: month-end
    // values, with the prior year-end as 1 January. Securities are the lots held
    // times the historical price (the month-end backfill's reconstruction); a
    // brokerage account adds its uninvested cash where the statements print it.
    const monthEnds = [`${year - 1}-12-31`]
    for (let month = 1; month <= 12; month += 1) monthEnds.push(new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10))
    const dates = monthEnds.filter((d) => d <= today)
    const identities = new Map<string, { institution: string; account: string; kind: 'brokerage' | 'crypto' }>()
    const identify = <T extends { brokerage: string | null; account: string }>(lots: T[], kind: 'brokerage' | 'crypto') =>
      lots
        .filter((lot) => !isUsBrokerage(lot.brokerage, lot.account))
        .map((lot) => {
          const institution = lot.brokerage?.trim() || institutionOf(lot.account)
          // Keyed by kind too: an account holding both stocks and crypto gets a
          // brokerage row and a crypto row, not one row that flips between them.
          const id = `${kind}|${institution}|${lot.account}`
          identities.set(id, { institution, account: lot.account, kind })
          // The valuer groups by account, so each lot's account becomes its identity.
          return { ...lot, account: id }
        })
    type OpenLot = { market: string; brokerage: string | null; account: string; ticker: string; acquired_date: string; open_quantity: number; cost_basis_krw: number }
    type RealizedLot = {
      market: string
      brokerage: string | null
      account: string
      ticker: string
      acquired_date: string | null
      sold_date: string | null
      quantity_sold: number | null
      cost_basis_krw: number | null
    }
    const lotsTable = hasTable('tax_lots_all') ? 'tax_lots_all' : hasTable('tax_lots') ? 'tax_lots' : null
    const realizedTable = hasTable('realized_lots_all') ? 'realized_lots_all' : hasTable('realized_lots') ? 'realized_lots' : null
    const stockOnly = (table: string) => (columnsOf(table).has('asset_class') ? ` and ${STOCK_ROW_SQL}` : '')
    const brokerageOf = (table: string) => (columnsOf(table).has('brokerage') ? 'brokerage' : 'null as brokerage')
    // Crypto lots carry no wrapper that matters; every exchange account counts.
    const lotFilter = { brokerage: (table: string) => `market in ('KR', 'US')${stockOnly(table)}`, crypto: () => "market = 'CRYPTO'" }
    const openLots: OpenLot[] = []
    const realizedLots: RealizedLot[] = []
    for (const kind of ['brokerage', 'crypto'] as const) {
      if (lotsTable) {
        openLots.push(
          ...identify(
            conn
              .prepare(
                `select market, ${brokerageOf(lotsTable)}, account, ticker, acquired_date, open_quantity, cost_basis_krw
                   from ${lotsTable} where ${lotFilter[kind](lotsTable)}`
              )
              .all() as OpenLot[],
            kind
          )
        )
      }
      if (lotsTable && realizedTable) {
        realizedLots.push(
          ...identify(
            conn
              .prepare(
                `select market, ${brokerageOf(realizedTable)}, account, ticker, acquired_date, sold_date, quantity_sold, cost_basis_krw
                   from ${realizedTable} where ${lotFilter[kind](realizedTable)}`
              )
              .all() as RealizedLot[],
            kind
          )
        )
      }
    }
    const historicalPrices =
      lotsTable && hasTable('historical_prices')
        ? (conn
            .prepare(
              `select market, ticker, ${columnsOf('historical_prices').has('currency') ? 'currency' : "case when market = 'KR' then 'KRW' end as currency"}, price_date, close
                 from historical_prices order by market, ticker, price_date`
            )
            .all() as { market: string; ticker: string; currency: string | null; price_date: string; close: number }[])
        : []
    const historicalFxRates = hasTable('historical_fx_rates')
      ? (conn.prepare('select price_date, rate from historical_fx_rates order by price_date').all() as { price_date: string; rate: number }[])
      : []
    const valuer = createLotValuer({ openLots, realizedLots, historicalPrices, historicalFxRates })
    const firstLot = new Map<string, string>()
    for (const lot of [...openLots, ...realizedLots]) {
      const date = String(lot.acquired_date ?? '').slice(0, 10)
      if (date && (!firstLot.has(lot.account) || date < firstLot.get(lot.account)!)) firstLot.set(lot.account, date)
    }
    const securities = new Map<string, Map<string, number>>()
    for (const date of dates) {
      const totals = new Map<string, number>()
      // A position no price reaches counts at cost rather than at nothing.
      for (const position of valuer.valuedPositionsAt(date)) totals.set(position.account, (totals.get(position.account) ?? 0) + (position.marketValue ?? position.cost))
      for (const [id, first] of firstLot) {
        if (first > date) continue
        const byDate = securities.get(id) ?? new Map<string, number>()
        byDate.set(date, totals.get(id) ?? 0)
        securities.set(id, byDate)
      }
    }

    // Uninvested cash: each pool's printed balance, carried forward, but only
    // inside the periods the account's statements cover. Stock wrappers only,
    // like the lots: a pension's cash is in its certificate totals.
    const cashPools = new Map<string, Map<string, { currency: string; points: { date: string; balance: number }[] }>>()
    if (hasTable('brokerage_cash')) {
      const filter = columnsOf('brokerage_cash').has('asset_class') ? ` where ${STOCK_ROW_SQL}` : ''
      const rows = conn
        .prepare(`select institution, account, pool, currency, as_of_date as date, balance from brokerage_cash${filter} order by as_of_date, id`)
        .all() as { institution: string; account: string; pool: string; currency: string; date: string; balance: number }[]
      for (const row of rows) {
        if (isUsBrokerage(row.institution, row.account)) continue
        const id = `brokerage|${row.institution}|${row.account}`
        if (!identities.has(id)) identities.set(id, { institution: row.institution, account: row.account, kind: 'brokerage' })
        const pools = cashPools.get(id) ?? new Map()
        const pool = pools.get(row.pool) ?? { currency: row.currency, points: [] }
        const last = pool.points.at(-1)
        // A repeated date keeps its last row.
        if (last?.date === row.date) last.balance = Number(row.balance)
        else pool.points.push({ date: row.date, balance: Number(row.balance) })
        pools.set(row.pool, pool)
        cashPools.set(id, pools)
      }
    }
    // Each account's statement periods, merged where they meet or overlap. An
    // older database without the table falls back to the account's first and
    // last cash row.
    const periods = new Map<string, { start: string; end: string }[]>()
    if (hasTable('brokerage_cash_coverage')) {
      const rows = conn
        .prepare('select institution, account, period_start as start, period_end as end from brokerage_cash_coverage order by period_start, id')
        .all() as { institution: string; account: string; start: string; end: string }[]
      for (const row of rows) {
        const id = `brokerage|${row.institution}|${row.account}`
        if (cashPools.has(id)) periods.set(id, [...(periods.get(id) ?? []), { start: row.start, end: row.end }])
      }
    }
    for (const [id, pools] of cashPools) {
      if (periods.has(id)) continue
      const all = [...pools.values()].flatMap((pool) => pool.points.map((p) => p.date)).sort()
      periods.set(id, [{ start: all[0], end: all.at(-1)! }])
    }
    const dayAfter = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    for (const [id, list] of periods) {
      const merged: { start: string; end: string }[] = []
      for (const period of [...list].sort((a, b) => a.start.localeCompare(b.start))) {
        const last = merged.at(-1)
        if (last && period.start <= dayAfter(last.end)) last.end = period.end > last.end ? period.end : last.end
        else merged.push({ ...period })
      }
      periods.set(id, merged)
    }
    const periodOn = (id: string, date: string) => (periods.get(id) ?? []).find((p) => p.start <= date && date <= p.end)
    const cashAt = (id: string, date: string): number | null => {
      const period = periodOn(id, date)
      if (!period) return null
      let total: number | null = null
      for (const { currency, points } of cashPools.get(id)?.values() ?? []) {
        // Only this period's lines: a balance from before a gap does not reach across it.
        const point = points.filter((p) => p.date >= period.start && p.date <= date).at(-1)
        if (!point) continue
        // A pool's currency, not its name, decides conversion: Toss's dollar
        // section is printed in won and is added as it stands.
        const krwPer = currency === 'KRW' ? 1 : currency === 'USD' ? valuer.fxRate(date) : null
        // A pool no rate converts adds nothing; the row is understated already.
        if (krwPer == null) continue
        total = (total ?? 0) + point.balance * krwPer
      }
      return total
    }
    // The cash history covers the year only when one unbroken statement period
    // runs from 1 January to 31 December and a cash line inside it falls on or
    // before 1 January. A first line in March leaves the months before it with
    // no cash, so that year is partial.
    const cashCovers = (id: string, until: string) => {
      const period = (periods.get(id) ?? []).find((p) => p.start <= start && p.end >= until)
      if (!period) return false
      return [...(cashPools.get(id)?.values() ?? [])].some((pool) => pool.points.some((p) => p.date >= period.start && p.date <= start))
    }

    for (const [id, { institution, account, kind }] of identities) {
      // A closed account (the map's brokerageAccounts `retiredOn`) holds nothing
      // after that date, whatever balance its last statement line left: its
      // series closes at zero, and a later year has no row for it.
      const retiredOn = kind === 'brokerage' ? (retiredBrokerage.get(account) ?? null) : null
      if (retiredOn && retiredOn < start) continue
      const points: BalancePoint[] = []
      let cashIncluded = false
      for (const date of dates) {
        const held = securities.get(id)?.get(date)
        const cash = kind === 'brokerage' ? cashAt(id, date) : null
        if (held == null && cash == null) continue
        if (cash != null) cashIncluded = true
        points.push({ date, valueKrw: (held ?? 0) + (cash ?? 0) })
      }
      // An account with no lots needs cash inside the year, not only a balance
      // carried in from the year before.
      if (!securities.has(id) && !points.some((point) => point.date >= start)) continue
      const closesInYear = retiredOn != null && retiredOn <= end
      const found = maxBalance(retiredOn ? closedOn(points, retiredOn) : points, year, 'month_end')
      // The year it closed needs cash only up to the closing date.
      const covered = cashCovers(id, closesInYear ? retiredOn : end)
      add(institution, account, kind, found && cashIncluded && !covered ? { ...found, coverage: 'partial' } : found, { cashIncluded })
    }

    // Pensions: certificate and snapshot totals.
    if (hasTable('pension_points')) {
      const rows = conn.prepare('select account, date, value_krw as valueKrw from pension_points order by date, id').all() as {
        account: string
        date: string
        valueKrw: number
      }[]
      const byAccount = new Map<string, BalancePoint[]>()
      for (const row of rows) byAccount.set(row.account, [...(byAccount.get(row.account) ?? []), { date: row.date, valueKrw: Number(row.valueKrw) }])
      for (const [account, points] of byAccount) add(institutionOf(account), account, 'pension', maxBalance(points, year, 'year_end'))
    }

    // Gold: the value changes only on a purchase or a price date, so a point on
    // each of those (and today, the holding still standing) is the daily series.
    if (hasTable('transactions_all') && columnsOf('transactions_all').has('asset_class')) {
      const buys = (
        conn
          .prepare(
            `select account, substr(date, 1, 10) as date, abs(coalesce(quantity, 0)) as grams, abs(coalesce(amount_krw, settlement_krw, 0)) as costKrw
               from transactions_all where asset_class = 'gold' and type = 'BUY' order by date, id`
          )
          .all() as { account: string; date: string; grams: number; costKrw: number }[]
      ).filter((buy) => buy.grams > 0)
      const prices = hasTable('gold_prices') ? (conn.prepare('select date, price from gold_prices order by date').all() as { date: string; price: number }[]) : []
      const byAccount = new Map<string, typeof buys>()
      for (const buy of buys) byAccount.set(buy.account, [...(byAccount.get(buy.account) ?? []), buy])
      for (const [account, list] of byAccount) {
        const valueOn = (date: string) => {
          const held = list.filter((buy) => buy.date <= date)
          const price = prices.filter((row) => row.date <= date).at(-1)
          return {
            valueKrw: price ? held.reduce((sum, buy) => sum + buy.grams, 0) * price.price : held.reduce((sum, buy) => sum + buy.costKrw, 0),
            atCost: held.length > 0 && !price,
          }
        }
        const dates = [...new Set([...list.map((buy) => buy.date), ...prices.map((row) => row.date).filter((d) => d >= list[0].date), today])].sort()
        const found = maxBalance(
          dates.map((date) => ({ date, valueKrw: valueOn(date).valueKrw })),
          year
        )
        if (!found) continue
        // Prices only accrue, so the year is at cost somewhere exactly when its first held day is.
        const firstHeld = list[0].date > start ? list[0].date : start
        const atCost = firstHeld <= end && valueOn(firstHeld).atCost
        add(institutionOf(account), account, 'gold', atCost ? { ...found, coverage: 'partial' } : found)
      }
    }

    return foreignAccountMaxima(year, rate, accounts)
  } finally {
    conn.close()
  }
}

export type PensionHolding = {
  name: string
  kind: 'ETF' | 'FUND' | 'CASH'
  valueKrw: number
  costKrw: number
  valuationSource: string | null
  /** The holding row's as-of date: the snapshot date for a snapshot-valued row. */
  asOf: string | null
}

export type PensionAccount = {
  account: string
  wrapper: string
  valueKrw: number
  costKrw: number
  returnPct: number | null
  /** The newest as-of date among the account's holdings: the snapshot it was read from. */
  snapshotDate: string | null
  holdings: PensionHolding[]
  contributionsByYear: PensionContributionYear[]
}

/**
 * One entry per pension account (IRP and pension savings), from holdings_all and
 * pension_flows. Cost is the holdings' cost basis, as the snapshot reports it.
 * A year's employer contribution is null unless the account's evidence names an
 * employer contribution in some year: unknown, not zero.
 */
export function getPensionAccounts(): PensionAccount[] {
  const conn = db()
  try {
    const hasTable = (name: string) =>
      Boolean(conn.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name))
    const hasHoldings = hasTable('holdings_all')
    const hasFlows = hasTable('pension_flows')
    if (!hasHoldings && !hasFlows) return []
    const accountSources = [
      hasHoldings ? `select account, account_wrapper from holdings_all where ${PENSION_ROW_SQL}` : null,
      hasFlows ? `select account, account_wrapper from pension_flows where ${PENSION_ROW_SQL}` : null,
    ].filter(Boolean)
    const accounts = conn
      .prepare(`select account, account_wrapper as wrapper from (${accountSources.join(' union ')}) order by account_wrapper, account`)
      .all() as { account: string; wrapper: string }[]
    const holdingsStmt = hasHoldings
      ? conn.prepare(
          `select ticker, name, coalesce(base_market_value, base_cost, 0) as valueKrw, coalesce(base_cost, total_cost_krw, 0) as costKrw,
                  valuation_source as valuationSource, as_of_date as asOf
             from holdings_all
            where account = ? and account_wrapper = ?
            order by id`
        )
      : null
    const flowsStmt = hasFlows
      ? conn.prepare(
          `select cast(substr(date, 1, 4) as integer) as year,
                  coalesce(sum(case when kind = 'contribution' then amount_krw end), 0) as ownKrw,
                  coalesce(sum(case when kind = 'employer_contribution' then amount_krw end), 0) as employerKrw,
                  count(case when kind = 'employer_contribution' then 1 end) as employerRows
             from pension_flows
            where account = ? and account_wrapper = ? and kind in ('contribution', 'employer_contribution')
            group by year
            order by year`
        )
      : null
    // A pension fund is `PENSION:<token>:<slug>`, cash `PENSION:<token>:cash:<slug>` (scripts/pension-ids.mjs), and an ETF its KR ticker.
    const kindOf = (ticker: string): PensionHolding['kind'] =>
      /^PENSION:[^:]+:cash:/.test(ticker) ? 'CASH' : ticker.startsWith('PENSION:') ? 'FUND' : 'ETF'
    return accounts.map(({ account, wrapper }) => {
      const holdings = ((holdingsStmt?.all(account, wrapper) ?? []) as (Omit<PensionHolding, 'kind'> & { ticker: string })[]).map(
        ({ ticker, ...row }) => ({ ...row, kind: kindOf(ticker), valueKrw: Number(row.valueKrw), costKrw: Number(row.costKrw) })
      )
      const flows = (flowsStmt?.all(account, wrapper) ?? []) as { year: number; ownKrw: number; employerKrw: number; employerRows: number }[]
      const hasEmployer = flows.some((row) => row.employerRows > 0)
      const valueKrw = holdings.reduce((sum, row) => sum + row.valueKrw, 0)
      const costKrw = holdings.reduce((sum, row) => sum + row.costKrw, 0)
      return {
        account,
        wrapper,
        valueKrw,
        costKrw,
        returnPct: costKrw > 0 ? ((valueKrw - costKrw) / costKrw) * 100 : null,
        snapshotDate: holdings.map((row) => row.asOf).filter((d): d is string => Boolean(d)).sort().at(-1) ?? null,
        holdings,
        contributionsByYear: flows.map((row) => ({
          year: Number(row.year),
          ownKrw: Number(row.ownKrw),
          employerKrw: hasEmployer ? Number(row.employerKrw) : null,
        })),
      }
    })
  } finally {
    conn.close()
  }
}

export function getHoldings(limit = 200): Holding[] {
  const conn = db()
  try {
    return conn
      .prepare(
        `select id, market, currency, brokerage, account, ticker, name, quantity, native_cost, native_market_value,
          native_unrealized_gl, native_unrealized_gl_pct, base_cost, base_market_value, base_unrealized_gl,
          total_cost_krw, long_term_qty, short_term_qty, lot_count
         from holdings
         where ${STOCK_WRAPPER_SQL}
         order by market, currency, native_cost desc
         limit ?`
      )
      .all(limit) as Holding[]
  } finally {
    conn.close()
  }
}

function costBasisStatus(row: any): Pick<CostBasisHolding, 'cost_status' | 'cost_note' | 'source_method'> {
  const cost = Number(row.native_cost ?? 0)
  const value = row.native_market_value == null ? null : Number(row.native_market_value)
  const lotCount = row.lot_count == null ? null : Number(row.lot_count)
  const sourceSystem = String(row.source_system ?? '').trim()
  if (cost <= 0) {
    return {
      cost_status: 'missing_cost',
      cost_note: 'Total Cost is missing or zero; verify this before relying on the row.',
      source_method: 'No usable cost basis is present in the holdings snapshot.',
    }
  }
  if (value == null) {
    return {
      cost_status: 'unpriced',
      cost_note: 'Cost exists, but current value/price is missing.',
      source_method: 'Cost comes from source holdings data; current valuation is unavailable.',
    }
  }
  if (lotCount == null || lotCount === 0 || sourceSystem.includes('csv')) {
    return {
      cost_status: 'estimated',
      cost_note: 'Cost is usable for manual sync, but tax-lot coverage is incomplete or CSV-derived.',
      source_method:
        'Estimated from the source holdings feed. For crypto-style activity, use net purchase cost minus sales/reward disposals when reconciling manually.',
    }
  }
  return {
    cost_status: 'ready',
    cost_note: 'Cost and current value are present.',
    source_method: 'Cost basis comes from tax-lot or gain/loss source data captured by the observatory ingest.',
  }
}

export function getCostBasisHoldings(limit = 1000): CostBasisHolding[] {
  const conn = db()
  try {
    const rows = conn
      .prepare(
        `with priced_holdings as (
          select
            h.id,
            h.market,
            h.currency,
            h.brokerage,
            h.account,
            h.ticker,
            h.name,
            h.quantity,
            h.native_price,
            h.native_cost,
            h.native_market_value,
            h.native_unrealized_gl,
            h.native_unrealized_gl_pct,
            h.base_cost,
            h.base_market_value,
            h.lot_count,
            h.source_system,
            (
              select hp.close
              from historical_prices hp
              where hp.market = h.market and hp.ticker = h.ticker
              order by hp.price_date desc
              limit 1 offset 1
            ) as previous_close,
            (
              select hp.price_date
              from historical_prices hp
              where hp.market = h.market and hp.ticker = h.ticker
              order by hp.price_date desc
              limit 1
            ) as price_date,
            sum(coalesce(h.base_market_value, 0)) over () as portfolio_base_market_value
          from holdings h
          where h.quantity != 0 and ${stockWrapperFor("h")}
        )
        select *
        from priced_holdings
        order by coalesce(base_market_value, 0) desc, ticker
        limit ?`
      )
      .all(limit) as any[]

    return rows.map((row) => {
      const price = row.native_price == null ? null : Number(row.native_price)
      const previousClose = row.previous_close == null ? null : Number(row.previous_close)
      const quantity = Number(row.quantity ?? 0)
      const baseMarketValue = row.base_market_value == null ? null : Number(row.base_market_value)
      const portfolioBaseMarketValue = Number(row.portfolio_base_market_value ?? 0)
      const dayUnitChange = price == null || previousClose == null ? null : price - previousClose
      const status = costBasisStatus(row)
      return {
        id: Number(row.id),
        market: String(row.market),
        currency: String(row.currency),
        brokerage: row.brokerage == null ? null : String(row.brokerage),
        account: String(row.account),
        ticker: String(row.ticker),
        name: String(row.name),
        quantity,
        native_price: price,
        native_market_value: row.native_market_value == null ? null : Number(row.native_market_value),
        native_cost: row.native_cost == null ? null : Number(row.native_cost),
        native_unrealized_gl: row.native_unrealized_gl == null ? null : Number(row.native_unrealized_gl),
        native_unrealized_gl_pct:
          row.native_unrealized_gl_pct == null ? null : Number(row.native_unrealized_gl_pct),
        base_market_value: baseMarketValue,
        base_cost: row.base_cost == null ? null : Number(row.base_cost),
        day_change: dayUnitChange == null ? null : dayUnitChange * quantity,
        day_change_pct:
          dayUnitChange == null || previousClose == null || previousClose === 0
            ? null
            : (dayUnitChange / previousClose) * 100,
        percent_of_total:
          baseMarketValue == null || portfolioBaseMarketValue <= 0 ? null : (baseMarketValue / portfolioBaseMarketValue) * 100,
        ...status,
        price_date: row.price_date == null ? null : String(row.price_date),
      }
    })
  } finally {
    conn.close()
  }
}

function addSource(sourceMap: Map<string, Set<string>>, source: string | null | undefined, usage: string) {
  if (!source) return
  const trimmed = String(source).trim()
  if (!trimmed) return
  if (!sourceMap.has(trimmed)) sourceMap.set(trimmed, new Set())
  sourceMap.get(trimmed)!.add(usage)
}

function sourceMatchesFile(source: string, file: any) {
  return source === file.filename || source === file.name || file.filename.includes(source) || source.includes(file.filename)
}

export function positionHref(market: string, ticker: string) {
  return `/positions/${encodeURIComponent(market)}/${encodeURIComponent(ticker)}`
}

function readJson(path: string) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8')) as any
  } catch {
    return null
  }
}

function asRefreshRun(value: any): RefreshRun | null {
  if (!value || typeof value !== 'object') return null
  if (!value.id || !value.startedAt || !Array.isArray(value.steps)) return null
  const status = ['success', 'failed', 'running'].includes(value.status) ? value.status : 'failed'
  return {
    id: String(value.id),
    startedAt: String(value.startedAt),
    finishedAt: value.finishedAt ? String(value.finishedAt) : null,
    durationMs: Number.isFinite(Number(value.durationMs)) ? Number(value.durationMs) : null,
    status,
    degradedSteps: Array.isArray(value.degradedSteps) ? value.degradedSteps.map((name: any) => String(name)) : [],
    steps: value.steps.map((step: any) => ({
      name: String(step.name ?? ''),
      command: String(step.command ?? ''),
      startedAt: String(step.startedAt ?? ''),
      finishedAt: step.finishedAt ? String(step.finishedAt) : null,
      durationMs: Number.isFinite(Number(step.durationMs)) ? Number(step.durationMs) : null,
      status: ['success', 'failed', 'running'].includes(step.status) ? step.status : 'failed',
      exitCode: Number.isFinite(Number(step.exitCode)) ? Number(step.exitCode) : null,
      signal: step.signal ? String(step.signal) : null,
      stdoutTail: step.stdoutTail ? String(step.stdoutTail) : '',
      stderrTail: step.stderrTail ? String(step.stderrTail) : '',
    })),
  }
}

function statMtimeIso(path: string) {
  try {
    return new Date(fs.statSync(path).mtimeMs).toISOString()
  } catch {
    return null
  }
}

function ageMs(observedAt: string | null) {
  if (!observedAt) return null
  const ms = Date.now() - new Date(observedAt).getTime()
  return Number.isFinite(ms) ? ms : null
}

function freshnessStatus(observedAt: string | null, thresholdMs: number): FreshnessStatus {
  const age = ageMs(observedAt)
  if (age == null) return 'missing'
  return age > thresholdMs ? 'stale' : 'fresh'
}

function snapshotFreshness({
  key,
  label,
  category,
  path,
  observedAt,
  thresholdMs,
  detail,
}: {
  key: string
  label: string
  category: 'price' | 'fx'
  path: string
  observedAt: string | null
  thresholdMs: number
  detail: string
}): FreshnessItem {
  const age = ageMs(observedAt)
  return {
    key,
    label,
    category,
    status: freshnessStatus(observedAt, thresholdMs),
    observedAt,
    thresholdMs,
    ageMs: age,
    detail,
    path,
  }
}

function sourceFreshness(source: any): FreshnessItem {
  if (!fs.existsSync(source.path)) {
    return {
      key: `source:${source.name}`,
      label: source.name,
      category: 'source',
      status: 'missing',
      observedAt: null,
      thresholdMs: null,
      ageMs: null,
      detail: 'Source file is missing from disk.',
      path: source.path,
      rowCount: source.row_count,
    }
  }
  const stat = fs.statSync(source.path)
  const recordedMtime = Number(source.mtime_ms)
  const mtimeChanged = Math.abs(stat.mtimeMs - recordedMtime) > 1000
  const sizeChanged = stat.size !== Number(source.bytes)
  // Generated snapshots can be rewritten with identical content, which changes
  // mtime without changing the source data. Use the recorded content hash as
  // the authoritative signal whenever it is available; retain the metadata
  // fallback for legacy source rows that predate SHA-256 recording.
  const currentSha256 = source.sha256 && !sizeChanged
    ? createHash('sha256').update(fs.readFileSync(source.path)).digest('hex')
    : null
  const contentChanged = sizeChanged || (source.sha256 ? currentSha256 !== source.sha256 : mtimeChanged)
  const observedAt = new Date(recordedMtime).toISOString()
  return {
    key: `source:${source.name}`,
    label: source.name,
    category: 'source',
    status: contentChanged ? 'drift' : 'fresh',
    observedAt,
    thresholdMs: null,
    ageMs: ageMs(observedAt),
    detail:
      contentChanged
        ? `Changed since ingest. Recorded ${source.bytes} bytes; current ${stat.size} bytes.`
        : mtimeChanged
          ? 'Content matches the SHA-256 captured at ingest; only modified time changed.'
          : 'Matches the content fingerprint captured at ingest.',
    path: source.path,
    rowCount: source.row_count,
  }
}

function fileCategory(filePath: string, relativePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  if (relativePath.startsWith('.codex_sheet_payloads/')) return 'kr sheet payload'
  if (relativePath.startsWith('outputs/')) return 'generated output'
  if (relativePath.startsWith('.codex_drive_pdfs/text/')) return 'extracted text'
  if (relativePath.startsWith('.codex_drive_pdfs/')) return 'drive pdf cache'
  if (ext === '.csv') return 'us csv export'
  if (ext === '.pdf') return 'pdf evidence'
  if (ext === '.tsv') return 'tsv payload'
  if (ext === '.xlsx' || ext === '.xls') return 'workbook'
  if (ext === '.json') return 'json snapshot'
  if (ext === '.db' || ext === '.sqlite' || ext === '.sqlite3') return 'database'
  if (ext === '.png') return 'image artifact'
  if (ext === '.txt') return 'text artifact'
  if (ext === '.md') return 'documentation'
  return ext ? `${ext.slice(1)} file` : 'file'
}

function inventoryCandidate(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  // .xls: some banks still export statements in the old Excel format.
  return new Set(['.csv', '.pdf', '.tsv', '.xlsx', '.xls', '.json', '.db', '.sqlite', '.sqlite3', '.png', '.txt', '.md']).has(ext)
}

function walkFiles(root: string, maxFiles = 2000) {
  const out: string[] = []
  function walk(dir: string) {
    if (out.length >= maxFiles) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) break
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile() && inventoryCandidate(fullPath)) {
        out.push(fullPath)
      }
    }
  }
  walk(root)
  return out
}

function relativeToDataDir(dataDir: string, filePath: string) {
  const rel = path.relative(dataDir, filePath)
  return rel && !rel.startsWith('..') ? rel : filePath
}

function retentionFor(relativePath: string, status: SourceInventoryItem['status']) {
  if (status === 'derived') {
    return {
      retention: 'derived' as const,
      retentionReason: '재생성 가능한 캐시·파생 산출물이며 현재 ingest 원본이 아닙니다.',
    }
  }
  if (relativePath.startsWith('briefing-archive/')) {
    return {
      retention: 'active' as const,
      retentionReason: '일일 브리핑 화면과 외부 브리핑 파이프라인이 읽는 운영 archive입니다.',
    }
  }
  if (relativePath.startsWith('briefing-archive.backup-')) {
    return {
      retention: 'archive' as const,
      retentionReason: '브리핑 archive의 백업 스냅샷입니다. 현재 runtime은 읽지 않습니다.',
    }
  }
  if (relativePath.startsWith('kr-statements-superseded/')) {
    return {
      retention: 'archive' as const,
      retentionReason: '더 긴 기간의 증명서로 대체된 과거 원본입니다. 원본 provenance 보존용입니다.',
    }
  }
  if (relativePath.startsWith('kr-statements/_partial-overlap/')) {
    return {
      retention: 'fallback' as const,
      retentionReason: '기간이 겹치는 한국 증권사 원본입니다. 자동 추출은 보류하지만 겹침 검증에 필요합니다.',
    }
  }
  if (relativePath.startsWith('kr-statements/')) {
    return {
      retention: 'active' as const,
      retentionReason: '거래·배당·tax lot을 재생성하는 사람이 받은 증권사 원본 PDF입니다.',
    }
  }
  // The supplementary originals: kept like the broker statements, because the
  // deposit balances, pension holdings and pension totals are rebuilt from them.
  if (relativePath.startsWith('bank-statements/')) {
    return {
      retention: 'active' as const,
      retentionReason: '예금·CMA 잔고를 재생성하는 사람이 받은 은행 거래내역 원본입니다.',
    }
  }
  if (relativePath.startsWith('pension/evidence/')) {
    return {
      retention: 'active' as const,
      retentionReason: '연금 계좌의 연말 잔고·납입 증명서 원본입니다. pension-evidence.json을 재생성합니다.',
    }
  }
  if (relativePath.startsWith('pension/')) {
    return {
      retention: 'active' as const,
      retentionReason: '연금 계좌 보유 현황을 사람이 캡처한 스냅샷 원본입니다.',
    }
  }
  if (
    relativePath === 'us-holdings/merrill-holdings-20260715.csv' ||
    relativePath === 'us-holdings/merrill-holdings-20260801.csv'
  ) {
    return {
      retention: 'fallback' as const,
      retentionReason: 'Cost Basis가 포함된 Merrill tax-lot fallback입니다. 최신 positions-only 파일을 보완합니다.',
    }
  }
  if (
    relativePath === 'us-transactions/chase-transactions-20260715-20260805.csv' ||
    relativePath === 'us-transactions/fidelity-transactions-20260721-20260811.csv'
  ) {
    return {
      retention: 'fallback' as const,
      retentionReason: '현재 resolver가 아직 사용하지 않는 최신 기간 거래내역입니다. 최신 export 대조 전 보존합니다.',
    }
  }
  if (relativePath.startsWith('us-holdings/') || relativePath.startsWith('us-transactions/')) {
    return {
      retention: 'archive' as const,
      retentionReason: '현재 선택된 export 이전의 broker snapshot입니다. 과거 시점 검증용으로 보존합니다.',
    }
  }
  if (relativePath === 'korea_stock_tax_lots_updated.xlsx') {
    return {
      retention: 'fallback' as const,
      retentionReason: '수동 tax-lot workbook입니다. 자동 ingest 입력은 아니지만 provenance 확인 전 보존합니다.',
    }
  }
  if (relativePath === '.codex_extracted_korea.json') {
    return {
      retention: 'archive' as const,
      retentionReason: '구형 한국 추출 snapshot입니다. 현재 ingest에는 사용하지 않지만 과거 결과 대조용입니다.',
    }
  }
  if (relativePath === 'README.md') {
    return {
      retention: 'archive' as const,
      retentionReason: '데이터 디렉터리 운영 문서입니다.',
    }
  }
  return {
    retention: status === 'unused' ? 'review' as const : 'active' as const,
    retentionReason: status === 'unused' ? '현재 사용 여부와 보존 정책을 추가 확인해야 합니다.' : '현재 ingest가 추적하는 원본입니다.',
  }
}

function trackedInventoryItem(dataDir: string, source: any): SourceInventoryItem {
  const freshness = sourceFreshness(source)
  const status = freshness.status === 'fresh' || freshness.status === 'stale' ? 'used' : freshness.status
  const retention = retentionFor(relativeToDataDir(dataDir, source.path), status)
  return {
    id: `tracked:${source.name}`,
    name: source.name,
    filename: source.filename,
    relativePath: relativeToDataDir(dataDir, source.path),
    path: source.path,
    category: fileCategory(source.path, relativeToDataDir(dataDir, source.path)),
    status,
    bytes: Number(source.bytes ?? 0),
    mtimeMs: Number(source.mtime_ms ?? 0),
    rowCount: Number(source.row_count ?? 0),
    sha256: source.sha256,
    detail: freshness.detail,
    ...retention,
  }
}

function untrackedInventoryItem(dataDir: string, filePath: string): SourceInventoryItem {
  const stat = fs.statSync(filePath)
  const relativePath = relativeToDataDir(dataDir, filePath)
  const derived =
    relativePath.startsWith('.codex_drive_pdfs/') ||
    relativePath.startsWith('.codex_sheet_payloads/') ||
    relativePath.startsWith('outputs/') ||
    relativePath.includes('/briefing-archive.backup-') ||
    relativePath.includes('.bak-') ||
    relativePath.endsWith('.sample.txt')
  const retention = retentionFor(relativePath, derived ? 'derived' : 'unused')
  return {
    id: `untracked:${relativePath}`,
    name: path.basename(filePath),
    filename: path.basename(filePath),
    relativePath,
    path: filePath,
    category: fileCategory(filePath, relativePath),
    status: derived ? 'derived' : 'unused',
    bytes: stat.size,
    mtimeMs: stat.mtimeMs,
    rowCount: null,
    sha256: null,
    detail: derived
      ? 'Derived, cached, or generated artifact; not a canonical ingest source.'
      : 'Detected in STOCK_DATA_DIR but not recorded in the latest ingest source_files table.',
    ...retention,
  }
}

export function getOperationalHealth(): OperationalHealth {
  const conn = db()
  try {
    const sourceRows = conn.prepare('select * from source_files order by name').all() as any[]
    const krPrices = readJson(config.stockKrPricesPath)
    const usPrices = readJson(config.stockUsPricesPath)
    const cryptoPrices = readJson(config.stockCryptoPricesPath)
    const fxRates = readJson(config.stockFxRatesPath)
    const fxRate = fxRates?.rates?.[0]
    const priceThresholdMs = 36 * 60 * 60 * 1000
    // Crypto trades continuously, so a quote is never "as fresh as the last
    // close" — it is simply old. The 36h equity threshold spans a weekend on
    // purpose and would pass a crypto quote that is a full trading day and a
    // half stale, which for this asset class is a different number entirely.
    const cryptoPriceThresholdMs = 8 * 60 * 60 * 1000
    const fxThresholdMs = 7 * 24 * 60 * 60 * 1000
    const snapshots: FreshnessItem[] = [
      snapshotFreshness({
        key: 'kr_prices',
        label: 'KR prices',
        category: 'price',
        path: config.stockKrPricesPath,
        observedAt: krPrices?.generatedAt ?? statMtimeIso(config.stockKrPricesPath),
        thresholdMs: priceThresholdMs,
        detail: `${krPrices?.prices?.length ?? 0} prices · market date ${krPrices?.prices?.[0]?.asOfDate ?? 'n/a'}`,
      }),
      snapshotFreshness({
        key: 'us_prices',
        label: 'US prices',
        category: 'price',
        path: config.stockUsPricesPath,
        observedAt: usPrices?.generatedAt ?? statMtimeIso(config.stockUsPricesPath),
        thresholdMs: priceThresholdMs,
        detail: `${usPrices?.prices?.length ?? 0} prices · market date ${usPrices?.prices?.[0]?.asOfDate ?? 'n/a'}`,
      }),
      snapshotFreshness({
        key: 'crypto_prices',
        label: 'Crypto prices',
        category: 'price',
        path: config.stockCryptoPricesPath,
        observedAt: cryptoPrices?.generatedAt ?? statMtimeIso(config.stockCryptoPricesPath),
        thresholdMs: cryptoPriceThresholdMs,
        detail: `${cryptoPrices?.prices?.length ?? 0} prices · ${
          cryptoPrices?.prices?.map((price: any) => `${price.venue} ${price.symbol}`).join(', ') || 'none'
        }`,
      }),
      snapshotFreshness({
        key: 'fx_rates',
        label: 'USD/KRW FX',
        category: 'fx',
        path: config.stockFxRatesPath,
        observedAt: fxRate?.asOfDate ? `${fxRate.asOfDate}T00:00:00.000Z` : statMtimeIso(config.stockFxRatesPath),
        thresholdMs: fxThresholdMs,
        detail: fxRate ? `${fxRate.rate} · ${fxRate.source}` : 'No FX rate configured.',
      }),
    ]
    const sourceDrift = sourceRows.map(sourceFreshness)
    const items = [...snapshots, ...sourceDrift]
    const summary = {
      fresh: items.filter((item) => item.status === 'fresh').length,
      stale: items.filter((item) => item.status === 'stale').length,
      drift: items.filter((item) => item.status === 'drift').length,
      missing: items.filter((item) => item.status === 'missing').length,
    }
    return {
      generatedAt: new Date().toISOString(),
      items,
      snapshots,
      sourceDrift,
      staleItems: items.filter((item) => item.status !== 'fresh'),
      summary,
    }
  } finally {
    conn.close()
  }
}

function reviewPositionSelect() {
  return `select
    market,
    currency,
    ticker,
    name,
    count(distinct account) as account_count,
    coalesce(sum(quantity), 0) as quantity,
    coalesce(sum(native_cost), 0) as native_cost,
    sum(native_market_value) as native_market_value,
    sum(native_unrealized_gl) as native_unrealized_gl,
    case
      when coalesce(sum(native_cost), 0) = 0 or sum(native_unrealized_gl) is null then null
      else sum(native_unrealized_gl) / sum(native_cost) * 100
    end as native_unrealized_gl_pct,
    coalesce(sum(coalesce(base_cost, total_cost_krw)), 0) as base_cost,
    sum(base_market_value) as base_market_value,
    sum(base_unrealized_gl) as base_unrealized_gl,
    case
      when coalesce(sum(coalesce(base_cost, total_cost_krw)), 0) = 0 or sum(base_unrealized_gl) is null then null
      else sum(base_unrealized_gl) / sum(coalesce(base_cost, total_cost_krw)) * 100
    end as base_unrealized_gl_pct,
    coalesce(sum(long_term_qty), 0) as long_term_qty,
    coalesce(sum(short_term_qty), 0) as short_term_qty,
    case
      when coalesce(sum(long_term_qty), 0) + coalesce(sum(short_term_qty), 0) = 0 then null
      else coalesce(sum(short_term_qty), 0) / (coalesce(sum(long_term_qty), 0) + coalesce(sum(short_term_qty), 0)) * 100
    end as short_term_ratio,
    coalesce(sum(lot_count), 0) as lot_count
   from holdings
   where ${STOCK_WRAPPER_SQL}
   group by market, currency, ticker, name`
}

export function getPortfolioReview(): PortfolioReview {
  const conn = db()
  try {
    const totals = conn
      .prepare(
        `select
          count(*) as position_count,
          count(distinct market) as market_count,
          count(distinct account) as account_count,
          coalesce(sum(coalesce(base_cost, total_cost_krw)), 0) as base_cost,
          coalesce(sum(base_market_value), 0) as base_market_value,
          coalesce(sum(base_unrealized_gl), 0) as base_unrealized_gl,
          sum(case when coalesce(base_unrealized_gl, 0) > 0 then 1 else 0 end) as positive_positions,
          sum(case when coalesce(base_unrealized_gl, 0) < 0 then 1 else 0 end) as negative_positions
         from holdings where ${STOCK_WRAPPER_SQL}`
      )
      .get() as PortfolioReview['totals']

    const byMarket = conn
      .prepare(
        `select market,
          count(*) as position_count,
          coalesce(sum(coalesce(base_cost, total_cost_krw)), 0) as base_cost,
          coalesce(sum(base_market_value), 0) as base_market_value,
          coalesce(sum(base_unrealized_gl), 0) as base_unrealized_gl
         from holdings
         where ${STOCK_WRAPPER_SQL}
         group by market
         order by base_market_value desc, base_cost desc`
      )
      .all() as PortfolioReview['byMarket']

    const baseSelect = reviewPositionSelect()
    const largestPositions = conn
      .prepare(`select * from (${baseSelect}) order by coalesce(base_market_value, base_cost) desc limit 10`)
      .all() as ReviewPosition[]
    const topGainers = conn
      .prepare(`select * from (${baseSelect}) where base_unrealized_gl is not null order by base_unrealized_gl desc limit 10`)
      .all() as ReviewPosition[]
    const topLosers = conn
      .prepare(`select * from (${baseSelect}) where base_unrealized_gl is not null order by base_unrealized_gl asc limit 10`)
      .all() as ReviewPosition[]
    const shortTermHeavy = conn
      .prepare(
        `select * from (${baseSelect})
         where short_term_ratio is not null and short_term_qty > 0
         order by short_term_ratio desc, coalesce(base_market_value, base_cost) desc
         limit 10`
      )
      .all() as ReviewPosition[]
    const noMarketValue = conn
      .prepare(
        `select * from (${baseSelect})
         where base_market_value is null or native_market_value is null
         order by base_cost desc
         limit 10`
      )
      .all() as ReviewPosition[]

    const topValue = (n: number) =>
      largestPositions.slice(0, n).reduce((sum, row) => sum + Number(row.base_market_value ?? row.base_cost ?? 0), 0)

    // Value the whole portfolio the way the numerator values its slice: market
    // value where there is one, cost where there is not. `totals.base_market_value`
    // cannot serve here — it sums the column, so a position with no price adds
    // nothing to it while still adding its cost to the numerator, and the share
    // runs past 100%. Positions without a market value are an expected state, not
    // an edge case: `noMarketValue` below exists to list them.
    //
    // Computed over the grouped select, not raw `holdings`, so the grain matches
    // too. A ticker whose lots are only partly priced sums to that partial value
    // on both sides; falling back per-row would put cost in the denominator that
    // the numerator never sees.
    const denominator = Number(
      (
        conn
          .prepare(`select coalesce(sum(coalesce(base_market_value, base_cost)), 0) as base_valuation from (${baseSelect})`)
          .get() as { base_valuation: number }
      ).base_valuation
    )
    const share = (value: number) => (denominator > 0 ? (value / denominator) * 100 : 0)

    return {
      totals,
      concentration: {
        top1Share: share(topValue(1)),
        top5Share: share(topValue(5)),
        top10Share: share(topValue(10)),
      },
      byMarket,
      topGainers,
      topLosers,
      largestPositions,
      shortTermHeavy,
      noMarketValue,
    }
  } finally {
    conn.close()
  }
}

/**
 * Per-market totals, native and base side by side.
 *
 * Grouped by market AND currency deliberately. Grouping by market alone would
 * sum native amounts across whatever currencies that market happens to hold and
 * produce a number in no currency at all; this way a market that ever holds two
 * reports two rows rather than one wrong one.
 */
export function getMarketBreakdown(): MarketBreakdown[] {
  const conn = db()
  try {
    return conn
      .prepare(
        `select market,
          currency,
          count(*) as position_count,
          sum(case when base_market_value is not null then 1 else 0 end) as priced_position_count,
          coalesce(sum(native_cost), 0) as native_cost,
          sum(native_market_value) as native_market_value,
          sum(native_unrealized_gl) as native_unrealized_gl,
          case
            when coalesce(sum(native_cost), 0) = 0 or sum(native_unrealized_gl) is null then null
            else sum(native_unrealized_gl) / sum(native_cost) * 100
          end as native_unrealized_gl_pct,
          coalesce(sum(coalesce(base_cost, total_cost_krw)), 0) as base_cost,
          sum(base_market_value) as base_market_value,
          sum(base_unrealized_gl) as base_unrealized_gl
         from holdings
         where ${STOCK_WRAPPER_SQL}
         group by market, currency
         order by base_market_value desc, base_cost desc`
      )
      .all() as MarketBreakdown[]
  } finally {
    conn.close()
  }
}

export function getIncomeReview(): IncomeReview {
  const conn = db()
  try {
    const currentYear = String(new Date().getFullYear())
    const trailingStart = new Date()
    trailingStart.setMonth(trailingStart.getMonth() - 12)
    const trailingStartMonth = trailingStart.toISOString().slice(0, 7)
    const portfolioTotals = conn
      .prepare(
        `select
          coalesce(sum(base_market_value), 0) as market_value,
          coalesce(sum(coalesce(base_cost, total_cost_krw)), 0) as cost_basis
         from holdings where ${STOCK_WRAPPER_SQL}`
      )
      .get() as { market_value: number; cost_basis: number }
    const totals = conn
      .prepare(
        `select
          count(*) as row_count,
          sum(case when ticker is null or trim(ticker) = '' then 1 else 0 end) as tickerless_count,
          coalesce(sum(amount_krw), 0) as base_income,
          coalesce(sum(case when income_category = 'dividend' then amount_krw else 0 end), 0) as dividend_base_income,
          coalesce(sum(case when income_category = 'interest' then amount_krw else 0 end), 0) as interest_base_income,
          coalesce(sum(case when income_category not in ('dividend', 'interest') then amount_krw else 0 end), 0) as other_base_income,
          coalesce(sum(case when currency = 'KRW' then native_amount else 0 end), 0) as krw_income,
          coalesce(sum(case when currency = 'USD' then native_amount else 0 end), 0) as usd_income,
          coalesce(sum(case when substr(date, 1, 4) = ? then amount_krw else 0 end), 0) as ytd_base_income,
          coalesce(sum(case when substr(date, 1, 7) >= ? then amount_krw else 0 end), 0) as trailing_12m_base_income
         from dividends`
      )
      .get(currentYear, trailingStartMonth) as Omit<IncomeReview['totals'], 'yield_on_market' | 'yield_on_cost'>
    const byMonth = conn
      .prepare(
        `select
          substr(date, 1, 7) as month,
          coalesce(sum(amount_krw), 0) as base_income,
          coalesce(sum(case when income_category = 'dividend' then amount_krw else 0 end), 0) as dividend_base_income,
          coalesce(sum(case when income_category = 'interest' then amount_krw else 0 end), 0) as interest_base_income,
          coalesce(sum(case when income_category not in ('dividend', 'interest') then amount_krw else 0 end), 0) as other_base_income,
          count(*) as row_count
         from dividends
         group by substr(date, 1, 7)
         order by month desc
         limit 24`
      )
      .all() as IncomeReview['byMonth']
    const byYear = conn
      .prepare(
        `select
          substr(date, 1, 4) as year,
          currency,
          coalesce(sum(native_amount), 0) as native_income,
          coalesce(sum(amount_krw), 0) as base_income,
          count(*) as row_count
         from dividends
         group by substr(date, 1, 4), currency
         order by year, currency`
      )
      .all() as IncomeReview['byYear']
    const byMarket = conn
      .prepare(
        `select market, currency, coalesce(sum(native_amount), 0) as native_income, coalesce(sum(amount_krw), 0) as base_income, count(*) as row_count
         from dividends
         group by market, currency
         order by base_income desc`
      )
      .all() as IncomeReview['byMarket']
    const byPosition = conn
      .prepare(
        `with income as (
           select market, currency, ticker, max(coalesce(name, ticker)) as name,
             coalesce(sum(native_amount), 0) as native_income,
             coalesce(sum(amount_krw), 0) as base_income,
             count(*) as row_count
           from dividends
           where ticker is not null and trim(ticker) != ''
           group by market, currency, ticker
         ),
         holding_values as (
           select market, ticker,
             sum(base_market_value) as market_value,
             sum(coalesce(base_cost, total_cost_krw)) as cost_basis
           from holdings
           where ${STOCK_WRAPPER_SQL}
           group by market, ticker
         )
         select income.*,
           holding_values.market_value,
           holding_values.cost_basis,
           case when holding_values.market_value > 0 then income.base_income / holding_values.market_value * 100 else null end as trailing_yield,
           case when holding_values.cost_basis > 0 then income.base_income / holding_values.cost_basis * 100 else null end as yield_on_cost
         from income
         left join holding_values on holding_values.market = income.market and holding_values.ticker = income.ticker
         order by income.base_income desc
         limit 20`
      )
      .all() as IncomeReview['byPosition']
    const tickerless = conn
      .prepare(
        `select market, currency, name, type,
          coalesce(sum(native_amount), 0) as native_income,
          coalesce(sum(amount_krw), 0) as base_income,
          count(*) as row_count
         from dividends
         where ticker is null or trim(ticker) = ''
         group by market, currency, name, type
         order by base_income desc
         limit 20`
      )
      .all() as IncomeReview['tickerless']
    return {
      totals: {
        ...totals,
        yield_on_market: portfolioTotals.market_value > 0 ? (totals.trailing_12m_base_income / portfolioTotals.market_value) * 100 : null,
        yield_on_cost: portfolioTotals.cost_basis > 0 ? (totals.trailing_12m_base_income / portfolioTotals.cost_basis) * 100 : null,
      },
      byMonth: byMonth.reverse(),
      byYear,
      byMarket,
      byPosition,
      tickerless,
    }
  } finally {
    conn.close()
  }
}

export type CryptoPremium = {
  generatedAt: string | null
  fx: { rate: number; asOfDate: string } | null
  /** One row per symbol quoted on both a KRW book and a USD book. */
  spot: {
    symbol: string
    krwPrice: number
    usdPrice: number
    impliedKrw: number
    premiumPct: number
    krwAsOfDate: string
    usdAsOfDate: string
    /** Held on a KRW venue, so the premium is actually carried. */
    heldQuantity: number
    heldValueKrw: number
    /** KRW of that value attributable to the premium — what reverting to parity costs. */
    premiumValueKrw: number
  }[]
  history: { date: string; bySymbol: Record<string, number> }[]
  symbols: string[]
  /** Portfolio-level: premium-bearing value, and the part of it that is premium. */
  exposure: { heldValueKrw: number; premiumValueKrw: number; weightedPremiumPct: number | null }
}

/**
 * The Korea premium — the gap between a coin's won order book and its dollar one.
 *
 * Worth watching separately from the position itself: it is a second, independent
 * way to lose money on a KRW-venue holding. A position can be flat in dollar
 * terms and still fall in won if the premium compresses, and that exposure is
 * invisible on every other screen, because each venue is marked at its own book
 * precisely so the premium does not distort valuation.
 */
export function getCryptoPremium(): CryptoPremium {
  const snapshot = readJson(config.stockCryptoPricesPath)
  const spotRows = snapshot?.premium?.spot ?? []
  const historyRows = snapshot?.premium?.history ?? []

  // Quantities come from the database rather than the price snapshot, so exposure
  // is measured against the positions the rest of the app reports.
  const conn = db()
  let held: { ticker: string; quantity: number }[] = []
  try {
    held = conn
      .prepare(
        `select ticker, coalesce(sum(quantity), 0) as quantity
         from holdings
         where ${STOCK_WRAPPER_SQL} and market = 'CRYPTO' and currency = 'KRW'
         group by ticker`
      )
      .all() as { ticker: string; quantity: number }[]
  } finally {
    conn.close()
  }
  const heldByTicker = new Map(held.map((row) => [String(row.ticker).toUpperCase(), Number(row.quantity) || 0]))

  const spot: CryptoPremium['spot'] = spotRows.map((row: any) => {
    const quantity = heldByTicker.get(String(row.symbol).toUpperCase()) ?? 0
    const heldValueKrw = quantity * Number(row.krwPrice)
    return {
      symbol: String(row.symbol),
      krwPrice: Number(row.krwPrice),
      usdPrice: Number(row.usdPrice),
      impliedKrw: Number(row.impliedKrw),
      premiumPct: Number(row.premiumPct),
      krwAsOfDate: String(row.krwAsOfDate ?? ''),
      usdAsOfDate: String(row.usdAsOfDate ?? ''),
      heldQuantity: quantity,
      heldValueKrw,
      premiumValueKrw: heldValueKrw - quantity * Number(row.impliedKrw),
    }
  })

  const byDate = new Map<string, Record<string, number>>()
  for (const row of historyRows as any[]) {
    const bucket = byDate.get(row.date) ?? {}
    bucket[row.symbol] = Number(row.premiumPct)
    byDate.set(row.date, bucket)
  }

  const heldValueKrw = spot.reduce((sum, row) => sum + row.heldValueKrw, 0)
  const premiumValueKrw = spot.reduce((sum, row) => sum + row.premiumValueKrw, 0)
  const impliedTotal = heldValueKrw - premiumValueKrw

  return {
    generatedAt: snapshot?.generatedAt ?? null,
    fx: spotRows[0] ? { rate: Number(spotRows[0].fxRate), asOfDate: String(spotRows[0].fxAsOfDate ?? '') } : null,
    spot: spot.sort((a, b) => b.heldValueKrw - a.heldValueKrw || a.symbol.localeCompare(b.symbol)),
    history: [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, bySymbol]) => ({ date, bySymbol })),
    symbols: [...new Set(historyRows.map((row: any) => String(row.symbol)))].sort() as string[],
    exposure: {
      heldValueKrw,
      premiumValueKrw,
      // Value-weighted, not a mean of the per-coin percentages: a 5% premium on a
      // 10,000-won USDT position is not worth the same as 5% on 13m won of BTC.
      weightedPremiumPct: impliedTotal > 0 ? (premiumValueKrw / impliedTotal) * 100 : null,
    },
  }
}

export function getRebalanceReview(): RebalanceReview {
  const conn = db()
  try {
    const marketTargets = [
      { market: 'KR', targetPct: 50 },
      { market: 'US', targetPct: 50 },
    ]
    const positionCapPct = 15
    const totals = conn
      .prepare(
        `select
          coalesce(sum(base_market_value), 0) as base_market_value,
          coalesce(sum(coalesce(base_cost, total_cost_krw)), 0) as base_cost,
          count(*) as position_count
         from holdings where ${STOCK_WRAPPER_SQL}`
      )
      .get() as RebalanceReview['totals']
    const baseSelect = reviewPositionSelect()
    const positions = conn
      .prepare(`select * from (${baseSelect}) order by coalesce(base_market_value, base_cost) desc`)
      .all() as ReviewPosition[]

    // Every ratio below — market gaps, position caps — divides by this, so it has
    // to value a position the same way the numerators do: market value where there
    // is one, cost where there is not. `sum(base_market_value)` cannot serve, as it
    // coalesces a missing price to zero: an unpriced position would count toward a
    // cap breach while adding nothing to the total it is measured against, pushing
    // every share up and tipping positions over the cap that are not over it.
    //
    // Derived from the grouped positions rather than a second query over holdings,
    // so the market totals and the position totals cannot drift apart at a ticker
    // whose lots are only partly priced.
    const positionValue = (row: ReviewPosition) => Number(row.base_market_value ?? row.base_cost ?? 0)
    const totalValue = positions.reduce((sum, row) => sum + positionValue(row), 0)
    const marketValue = (market: string) =>
      positions.reduce((sum, row) => (row.market === market ? sum + positionValue(row) : sum), 0)

    // Market gaps are measured against the TARGETED markets only, not the whole
    // portfolio. The 50/50 policy is a split between two equity books; a market
    // with no target — crypto — is not a third slice of it. Dividing by the full
    // portfolio would push both KR and US below their targets purely because
    // crypto exists, reporting "Add" on both sides of a split that is already
    // balanced, and the suggested amounts would be wrong by the crypto weight.
    //
    // Untargeted markets are returned separately rather than dropped, so a
    // position class with no policy is visible as exactly that instead of
    // silently missing from the rebalance view. Position caps below still divide
    // by the full portfolio: a 15% cap is a concentration limit over everything
    // held, and exempting crypto from it would be the wrong direction.
    const targetedValue = marketTargets.reduce((sum, target) => sum + marketValue(target.market), 0)
    const targetedMarkets = new Set(marketTargets.map((target) => target.market))
    const untargetedMarkets = [...new Set(positions.map((row) => row.market))]
      .filter((market) => !targetedMarkets.has(market))
      .map((market) => ({
        market,
        currentValue: marketValue(market),
        currentPctOfPortfolio: totalValue > 0 ? (marketValue(market) / totalValue) * 100 : 0,
      }))
      .filter((row) => row.currentValue > 0)
      .sort((a, b) => b.currentValue - a.currentValue)

    const marketGaps = marketTargets.map((target) => {
      const currentValue = marketValue(target.market)
      const currentPct = targetedValue > 0 ? (currentValue / targetedValue) * 100 : 0
      const targetValue = targetedValue * (target.targetPct / 100)
      const gapValue = targetValue - currentValue
      const gapPct = target.targetPct - currentPct
      return {
        market: target.market,
        currentValue,
        currentPct,
        targetPct: target.targetPct,
        targetValue,
        gapValue,
        gapPct,
        action: Math.abs(gapPct) < 2 ? 'Hold' : gapValue > 0 ? 'Add' : 'Reduce',
      } as RebalanceReview['marketGaps'][number]
    })

    const reduceCandidates = positions
      .map((row) => {
        const currentPct = totalValue > 0 ? (positionValue(row) / totalValue) * 100 : 0
        const capGapPct = currentPct - positionCapPct
        const capGapValue = totalValue * (capGapPct / 100)
        return { ...row, currentPct, capGapPct, capGapValue }
      })
      .filter((row) => row.capGapPct > 0)
      .slice(0, 10)
    const addContext = marketGaps
      .filter((row) => row.action === 'Add')
      .map((row) => ({
        market: row.market,
        gapValue: row.gapValue,
        gapPct: row.gapPct,
        candidateCount: positions.filter((position) => position.market === row.market).length,
      }))
    const watchCandidates = positions
      .filter((row) => row.base_market_value == null || row.native_market_value == null)
      .map((row) => ({ ...row, reason: 'Missing market value; refresh price data before sizing action.' }))
      .slice(0, 10)
    const taxSensitive = positions
      .filter((row) => Number(row.short_term_ratio ?? 0) >= 50 && Number(row.base_market_value ?? row.base_cost ?? 0) > 0)
      .map((row) => ({ ...row, reason: 'Short-term lot exposure is high; review lots before reducing.' }))
      .slice(0, 10)
    return {
      policy: {
        baseCurrency: 'KRW',
        marketTargets,
        positionCapPct,
      },
      totals,
      marketGaps,
      reduceCandidates,
      addContext,
      watchCandidates,
      taxSensitive,
      untargetedMarkets,
    }
  } finally {
    conn.close()
  }
}

function tickerlessSuggestion(category: string | null | undefined) {
  if (category === 'interest') return 'Keep tickerless; category explains non-position cash interest.'
  if (category === 'stock_lending') return 'Keep tickerless or add source-specific ticker override only when position identity matters.'
  if (category === 'other') return 'Keep tickerless as other income unless the source row clearly belongs to a security.'
  return 'Review source/name and add dividendOverrides entry if this income belongs to a specific ticker.'
}

function compactRuleValue(value: string | null | undefined) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return text.replace(/\s+/g, ' ').slice(0, 80)
}

function mappingRuleSuggestion(row: {
  income_category: string
  mapping_status: string
  type: string | null
  name: string | null
  source: string | null
}) {
  const match: Record<string, string> = {}
  const type = compactRuleValue(row.type)
  const name = compactRuleValue(row.name)
  const source = compactRuleValue(row.source)
  if (type) match.typeIncludes = type
  if (!type && name) match.nameIncludes = name
  if (source && row.mapping_status.includes('tickerless')) match.sourceIncludes = source
  const category = row.income_category || 'dividend'
  const payload = {
    match,
    category,
    note: tickerlessSuggestion(category),
  }
  return JSON.stringify(payload)
}

/**
 * Which price snapshot backs a market. Crypto has its own because it is priced
 * per venue rather than per exchange listing, and because a KRW-quoted crypto
 * holding is not in the KR equity snapshot.
 */
function priceSnapshotNameFor(market: string) {
  if (market === 'KR') return 'kr_prices'
  if (market === 'CRYPTO') return 'crypto_prices'
  return 'us_prices'
}

function priceSnapshotPathFor(market: string) {
  if (market === 'KR') return config.stockKrPricesPath
  if (market === 'CRYPTO') return config.stockCryptoPricesPath
  return config.stockUsPricesPath
}

function valuationReason(row: { market: string; ticker: string }) {
  const prices = readJson(priceSnapshotPathFor(row.market))
  const tickers = new Set((prices?.prices ?? []).map((price: any) => String(price.ticker ?? '').toUpperCase()))
  if (!prices) return 'price_snapshot_missing'
  if (!tickers.has(String(row.ticker).toUpperCase())) return 'ticker_missing_from_price_snapshot'
  return 'source_missing_market_value'
}

function valuationSuggestion(reason: string) {
  if (reason === 'price_snapshot_missing') return 'Run pnpm refresh or restore the local price snapshot file.'
  if (reason === 'ticker_missing_from_price_snapshot') return 'Check ticker normalization and refresh the relevant price snapshot.'
  return 'Review source valuation fields; tax-lot-only sources may need external price enrichment.'
}

function calendarAgeDays(value: string | null) {
  if (!value) return null
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const then = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const now = new Date()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.max(0, Math.floor((today - then) / 86400000))
}

function isoDate(value: string | null | undefined) {
  if (!value) return null
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1] ?? null
}

function subtractCalendarDays(value: string | null, days: number) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

function coverageStatus(lagDays: number | null, maxLagDays: number): AccountCoverageStatus {
  if (lagDays == null) return 'missing'
  if (lagDays > maxLagDays) return 'action_needed'
  if (lagDays >= Math.max(1, maxLagDays - 4)) return 'due_soon'
  return 'current'
}

function latestSourceFilename(sourceRows: any[], needles: string[]) {
  const matches = sourceRows.filter((row) => needles.some((needle) => String(row.filename ?? '').toLowerCase().includes(needle)))
  return matches.sort((a, b) => Number(b.mtime_ms ?? 0) - Number(a.mtime_ms ?? 0))[0]?.filename ?? null
}

type CoverageDbRow = { market: string; brokerage: string; account: string; account_type: string | null; covered_through: string | null }

const COVERAGE_STATUS_RANK: Record<AccountCoverageStatus, number> = { missing: 0, action_needed: 1, due_soon: 2, current: 3 }

function coverageSource(input: Pick<AccountCoverageSource, 'label' | 'method' | 'coveredThrough' | 'maxLagDays' | 'requiredArtifact' | 'destination'>): AccountCoverageSource {
  const lagDays = calendarAgeDays(input.coveredThrough)
  return {
    ...input,
    // A regenerated snapshot has no start date; only a download does.
    downloadFrom: input.method === 'mcp' ? null : subtractCalendarDays(input.coveredThrough, 1),
    lagDays,
    overdueDays: lagDays == null ? null : Math.max(0, lagDays - input.maxLagDays),
    status: coverageStatus(lagDays, input.maxLagDays),
  }
}

/** The source the account's own status should report: the worst status, then the oldest date. */
function worstSource(sources: AccountCoverageSource[]) {
  return [...sources].sort(
    (a, b) =>
      COVERAGE_STATUS_RANK[a.status] - COVERAGE_STATUS_RANK[b.status] ||
      String(a.coveredThrough ?? '').localeCompare(String(b.coveredThrough ?? ''))
  )[0]
}

/**
 * The name one Robinhood account goes by on both sides of the database.
 *
 * Transactions carry the strategy name the CSV was filed under ("Mid-term", in
 * `account_type`), holdings the last four of the account number ("Robinhood
 * 1234"), so the same account used to arrive here as two rows. The snapshot is
 * what ties them: each of its accounts has both. Without a snapshot the lots
 * come from the Gain/Loss PDFs, which know only the number, and the two names
 * are left apart — a wrong fold would put one account's trades under another's
 * positions, where two rows for one account only cost a line of the table.
 */
function robinhoodAccountResolver(snapshot: any, transactionRows: CoverageDbRow[]) {
  const strategies = new Set(
    transactionRows
      .filter((row) => row.market === 'US' && row.brokerage === 'Robinhood' && row.account_type)
      .map((row) => String(row.account_type))
  )
  const strategyByLabel = new Map<string, string>()
  for (const account of snapshot?.accounts ?? []) {
    const nickname = String(account?.nickname ?? '').trim()
    const hint = String(account?.accountNumber ?? account?.account_number ?? '').slice(-4)
    const label = String(account?.account ?? '').trim() || `Robinhood ${hint}`.trim()
    if (nickname && strategies.has(nickname)) strategyByLabel.set(label, nickname)
  }
  return (row: CoverageDbRow) => {
    const accountType = String(row.account_type ?? '')
    if (strategies.has(accountType) && row.account === `Robinhood ${accountType}`) return accountType
    return strategyByLabel.get(row.account) ?? row.account
  }
}

// Written by the ingest on fills it bridges from the MCP's orders after the
// newest CSV (docs/robinhood-orders-bridge.md). Not a CSV, so not CSV coverage.
const ROBINHOOD_ORDERS_SOURCE_SYSTEM = 'robinhood_mcp_orders'

/** The last day a Robinhood transactions file says it covers, from its name. */
export function robinhoodCsvPeriodEnd(filename: string): { account: string; end: string } | null {
  const match = path.basename(filename).match(/^robinhood-transactions-([a-z]+)-(\d{8}-\d{8}|\d{4}-\d{4}|\d{8})\.csv$/i)
  if (!match) return null
  const period = match[2]
  const ymd = (value: string) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
  const end = /^\d{8}-\d{8}$/.test(period) ? ymd(period.slice(9)) : /^\d{4}-\d{4}$/.test(period) ? `${period.slice(5)}-12-31` : ymd(period)
  return { account: match[1].toLowerCase(), end }
}

/**
 * How far each Robinhood account's transaction CSVs reach, keyed by the
 * strategy name the CSVs are filed under ("Mid-term").
 *
 * The later of two dates: the newest row a CSV holds, and the newest period a
 * CSV's NAME declares. The row alone understated a quiet account: an export
 * asked for through 10-09 whose last trade was 09-23 read as covering 09-23,
 * and the reminder kept asking for a file that had already been downloaded.
 * The name is what says which days the export answers for, and the ingest's
 * seam resolution reads it the same way.
 *
 * Fills bridged from orders are excluded. They are in the same table under the
 * same account, and counting them made a two-week-old CSV read current for as
 * long as the account kept trading.
 */
function robinhoodCsvCoverage(conn: Database.Database, sourceRows: any[]) {
  const through = new Map<string, string>()
  const raise = (account: string, date: string | null) => {
    if (date && date > (through.get(account) ?? '')) through.set(account, date)
  }
  const rows = conn
    .prepare(`select account_type, max(date) as last from transactions
              where market = 'US' and brokerage = 'Robinhood' and coalesce(source_system, '') != ?
              group by account_type`)
    .all(ROBINHOOD_ORDERS_SOURCE_SYSTEM) as { account_type: string | null; last: string | null }[]
  // The filename token is the strategy name lowercased to fit the filename
  // grammar ("midterm" for "Mid-term"), so the two are matched the same way.
  const byToken = new Map<string, string>()
  for (const row of rows) {
    if (!row.account_type) continue
    byToken.set(row.account_type.toLowerCase().replace(/[^a-z]/g, ''), row.account_type)
    raise(row.account_type, isoDate(row.last))
  }
  // A period ending after today is a typo in a hand-typed name, not coverage;
  // trusting it would mark the account current until that day arrives.
  const today = new Date().toISOString().slice(0, 10)
  for (const source of sourceRows) {
    const period = robinhoodCsvPeriodEnd(String(source.filename ?? ''))
    const account = period && byToken.get(period.account)
    if (account && period.end <= today) raise(account, period.end)
  }
  return through
}

/**
 * "Robinhood Mid-term · 1234" for a folded account; the plain label otherwise.
 * Separated by spaces, not wrapped in brackets, so the briefing summary's
 * account masking reads the number as the bare token it already knows.
 */
function robinhoodAccountLabel(key: string, names: string[]) {
  const primary = names.find((name) => name === `Robinhood ${key}`)
  if (!primary) return names.join(' / ')
  const others = names.filter((name) => name !== primary).map((name) => name.replace(/^Robinhood\s+/, ''))
  return [primary, ...others].join(' · ')
}

/**
 * Translate the ingest's source and validation evidence into an account-level
 * checklist. File fingerprints answer “did the file change?”; this answers
 * the operator's separate question: “how far through the account's activity
 * have the numbers actually reached, and what should I obtain next?”
 */
export function getAccountCoverage(): AccountCoverageSummary {
  const conn = db()
  try {
    const sourceRows = conn.prepare('select * from source_files order by name').all() as any[]
    const holdingRows = conn
      .prepare(`select market, coalesce(brokerage, 'Unknown') as brokerage, account, account_type, max(as_of_date) as covered_through
                from holdings where ${STOCK_WRAPPER_SQL} group by market, brokerage, account, account_type`)
      .all() as CoverageDbRow[]
    const transactionRows = conn
      .prepare(`select market, coalesce(brokerage, 'Unknown') as brokerage, account, account_type, max(date) as covered_through
                from transactions group by market, brokerage, account, account_type`)
      .all() as CoverageDbRow[]
    // The period end each Korean 거래내역서 declares, per account, written by
    // extract-kr-statements.py beside its TSVs. This is what a KR account's
    // statement actually covers. The newest open tax lot, used here before, is
    // not: 삼성증권 never holds an open lot (every vest moves straight to Toss),
    // so its coverage read as its last vest, weeks before the statement's own
    // end; and 토스증권's lots include fills bridged from the Open API, so its
    // "statement" date ran ahead of the statement.
    const krStatementAsOf: Record<string, string> = readJson(path.join(config.stockKrStatementsDir, 'as-of.json'))?.accounts ?? {}
    const statementRows = conn
      .prepare(`select market, coalesce(brokerage, 'Unknown') as brokerage, account, account_type, max(as_of_date) as covered_through
                from tax_lots group by market, brokerage, account, account_type`)
      .all() as CoverageDbRow[]
    const checkRows = conn.prepare('select name, detail, status from validation_checks').all() as { name: string; detail: string; status: string }[]
    const checks = new Map(checkRows.map((row) => [row.name, row]))
    const robinhoodSnapshot = readJson(config.stockRobinhoodSnapshotPath)
    const robinhoodAccount = robinhoodAccountResolver(robinhoodSnapshot, transactionRows)
    const robinhoodCsvThrough = robinhoodCsvCoverage(conn, sourceRows)
    // Written by the ingest per account (the strategy name, which is the
    // Robinhood coverage key). Absent from a database older than the table.
    const missingDisposalsByAccount = new Map<string, string[]>()
    if (conn.prepare("select 1 from sqlite_master where type = 'table' and name = 'missing_disposals'").get()) {
      for (const row of conn
        .prepare('select brokerage, account_type, ticker from missing_disposals order by ticker')
        .all() as { brokerage: string; account_type: string; ticker: string }[]) {
        const key = `${row.brokerage}|${row.account_type}`
        missingDisposalsByAccount.set(key, [...(missingDisposalsByAccount.get(key) ?? []), row.ticker])
      }
    }
    const coverageKey = (row: CoverageDbRow) => {
      if (row.market === 'US' && row.brokerage === 'Robinhood') return `US|Robinhood|${robinhoodAccount(row)}`
      return row.market === 'US' ? `${row.market}|${row.brokerage}|${row.brokerage}` : `${row.market}|${row.brokerage}|${row.account}`
    }
    const holdingsByKey = new Map<string, (typeof holdingRows)[number]>()
    const txByKey = new Map<string, (typeof transactionRows)[number]>()
    const statementByKey = new Map<string, (typeof statementRows)[number]>()
    const accountNames = new Map<string, Set<string>>()
    for (const row of holdingRows) {
      const key = coverageKey(row)
      accountNames.set(key, (accountNames.get(key) ?? new Set()).add(row.account))
      const previous = holdingsByKey.get(key)
      if (!previous || String(row.covered_through ?? '') > String(previous.covered_through ?? '')) holdingsByKey.set(key, row)
    }
    for (const row of transactionRows) {
      const key = coverageKey(row)
      accountNames.set(key, (accountNames.get(key) ?? new Set()).add(row.account))
      const previous = txByKey.get(key)
      if (!previous || String(row.covered_through ?? '') > String(previous.covered_through ?? '')) txByKey.set(key, row)
    }
    for (const row of statementRows) {
      const key = coverageKey(row)
      const previous = statementByKey.get(key)
      if (!previous || String(row.covered_through ?? '') > String(previous.covered_through ?? '')) statementByKey.set(key, row)
    }
    const keys = new Set([...holdingRows, ...transactionRows].map(coverageKey))
    const rows: AccountCoverage[] = []

    for (const key of keys) {
      const [market, brokerage, rawAccount] = key.split('|')
      const holding = holdingsByKey.get(key)
      const transaction = txByKey.get(key)
      const statement = statementByKey.get(key)
      const names = [...(accountNames.get(key) ?? new Set<string>())]
      const account = (market === 'US' && brokerage === 'Robinhood' ? robinhoodAccountLabel(rawAccount, names) : names.join(' / ')) || rawAccount || brokerage
      let sources: AccountCoverageSource[] = []
      let missingDisposals: string[] = []
      let coveredThrough = isoDate(holding?.covered_through ?? transaction?.covered_through)
      let apiCoveredThrough: string | null = null
      const statementCoveredThrough = isoDate(market === 'KR' ? krStatementAsOf[account] ?? statement?.covered_through : statement?.covered_through)
      let maxLagDays = market === 'US' ? 14 : market === 'CRYPTO' ? 35 : 35
      let method: AccountCoverage['method'] = 'inbox'
      let requiredArtifact = '최근 거래내역서'
      let format = 'PDF'
      let destination = 'kr-statements/'
      let action = '최근 조회기간이 오늘까지 포함된 자료를 다운로드해 inbox에 넣으세요.'
      let detail = '문서가 선언한 조회기간의 마지막 날짜를 기준으로 계산합니다.'
      const brokerLower = brokerage.toLowerCase()

      if (market === 'KR' && statementCoveredThrough) coveredThrough = statementCoveredThrough

      if (market === 'US' && brokerLower === 'robinhood') {
        // Two artifacts, aging separately. The snapshot gives positions and lots;
        // the CSVs give the trades the replay checks walk. Reading the snapshot
        // alone, a freshly regenerated one marked every account current while
        // its CSVs stopped two months earlier, and the ingest failed on sales
        // with no disposal behind them — so the account is only as current as
        // the older of the two, and each says what to do about itself.
        const snapshotRow = sourceRows.find((row) => row.name === 'robinhood_snapshot')
        const snapshotDate =
          isoDate(robinhoodSnapshot?.fetchedAt) ?? (snapshotRow?.mtime_ms ? isoDate(new Date(Number(snapshotRow.mtime_ms)).toISOString()) : null)
        sources = [coverageSource({
          label: 'MCP',
          method: 'mcp',
          coveredThrough: snapshotDate,
          maxLagDays: 7,
          requiredArtifact: 'Robinhood MCP snapshot + tax lots',
          destination: 'data/robinhood-snapshot.json',
        })]
        // An account the CSVs do not know by name (a holdings label with no
        // snapshot to translate it) keeps the snapshot alone, as before, rather
        // than reporting transactions it may well have under another label.
        if (transaction) {
          const token = rawAccount.toLowerCase().replace(/[^a-z]/g, '')
          const csv = coverageSource({
            label: 'CSV',
            method: 'manual',
            coveredThrough: robinhoodCsvThrough.get(rawAccount) ?? null,
            maxLagDays: 14,
            requiredArtifact: 'Robinhood transactions CSV',
            // The export names no account, so the file is named by hand; the
            // window shape is what the ingest reads beside the year-to-date.
            destination: `us-transactions/robinhood-transactions-${token}-YYYYMMDD-YYYYMMDD.csv`,
          })
          missingDisposals = missingDisposalsByAccount.get(`${brokerage}|${rawAccount}`) ?? []
          sources.push(missingDisposals.length ? { ...csv, status: 'action_needed', missingDisposals } : csv)
        }
        const behind = worstSource(sources)
        method = behind.method
        requiredArtifact = sources.map((source) => source.requiredArtifact).join(' + ')
        format = sources.length > 1 ? 'JSON + CSV' : 'JSON'
        destination = sources.length > 1 ? 'data/robinhood-snapshot.json + us-transactions/' : 'data/robinhood-snapshot.json'
        coveredThrough = behind.coveredThrough
        maxLagDays = behind.maxLagDays
        action = (missingDisposals.length
          ? `매도 기록 누락 ${missingDisposals.length}종목(${missingDisposals.join(', ')}): 이 계좌의 거래내역 CSV가 들어와야 실현손익이 잡힙니다. `
          : '') + (sources.length > 1
          ? 'snapshot은 Robinhood MCP에서 다시 생성하고, 거래내역 CSV는 계좌별로 다운로드해 이름을 붙여 us-transactions/에 넣으세요. 둘 중 오래된 쪽이 계좌 기준일입니다.'
          : 'Robinhood MCP에서 계좌 snapshot과 lot을 다시 생성하세요. broker CSV를 inbox에 넣는 작업이 아닙니다.')
        detail = sources.length > 1
          ? 'MCP snapshot의 fetchedAt과 거래내역 CSV가 다루는 마지막 날(파일 이름의 기간 끝, 또는 그보다 늦은 거래일) 중 오래된 쪽을 기준으로 계산합니다.'
          : checks.get('robinhood_snapshot_fresh')?.detail ?? 'MCP snapshot의 fetchedAt을 기준으로 계산합니다.'
      } else if (market === 'US') {
        requiredArtifact = `${brokerage} holdings CSV + transactions CSV`
        format = 'CSV × 2'
        destination = 'us-holdings/ + us-transactions/'
        action = `${brokerage}의 holdings/positions와 최신 transactions CSV를 같은 기준일로 다운로드해 inbox에 넣으세요.`
        detail = '두 CSV 중 더 오래된 기준일을 계좌 coverage로 사용합니다.'
        const dates = [holding?.covered_through, transaction?.covered_through].filter(Boolean) as string[]
        coveredThrough = dates.length ? dates.sort()[0] : null
      } else if (market === 'CRYPTO' && brokerLower === 'bithumb') {
        requiredArtifact = '빗썸 거래내역확인서 PDF + 기간별 거래내역 XLSX'
        format = 'PDF + XLSX'
        destination = 'crypto-bithumb/'
        maxLagDays = 14
        // Crypto holdings are derived with a quote's as-of date, which can be
        // today even when the statement activity stops earlier. The statement
        // transaction cutoff is the authoritative coverage date here.
        coveredThrough = isoDate(transaction?.covered_through)
        action = '같은 조회기간의 PDF와 XLSX를 모두 다운로드해 inbox에 넣으세요.'
        detail = 'PDF가 거래 원장이고 XLSX는 입출금 사유 보강용입니다.'
      } else if (market === 'CRYPTO') {
        requiredArtifact = 'Robinhood Crypto monthly statement'
        format = 'PDF'
        destination = 'crypto-robinhood/'
        coveredThrough = isoDate(transaction?.covered_through)
        action = '누락된 최신 월의 Crypto Statement PDF를 다운로드해 inbox에 넣으세요.'
        detail = '월별 statement가 끊기지 않는지 기준일을 계산합니다.'
      } else if (market === 'KR' && (brokerLower.includes('toss') || brokerLower.includes('토스'))) {
        method = 'mixed'
        requiredArtifact = '토스증권 거래내역서 PDF (Open API 보완)'
        maxLagDays = 35
        action = 'Open API가 최신이면 조치하지 않아도 됩니다. statement cutoff가 뒤처지면 새 거래내역서를 다운로드하세요.'
        detail = checks.get('toss_positions_fresh')?.detail ?? 'statement와 Open API snapshot을 함께 표시합니다.'
        apiCoveredThrough = [holding?.covered_through, transaction?.covered_through]
          .filter(Boolean)
          .map((date) => isoDate(date))
          .filter(Boolean)
          .sort()
          .at(-1) ?? null
        // The API fills the days after the statement, so the account is as current
        // as the newer of the two. The download range below still starts from the
        // statement, since a 거래내역서 is what a download would replace.
        coveredThrough = [statementCoveredThrough, apiCoveredThrough].filter(Boolean).sort().at(-1) ?? null
      } else if (market === 'KR' && brokerLower.includes('삼성')) {
        requiredArtifact = '삼성증권 주식보상 계좌거래내역서'
        maxLagDays = 120
        action = '주식보상 계좌의 최신 계좌거래내역서를 다운로드해 inbox에 넣으세요.'
        detail = checks.get('samsung_statement_fresh')?.detail ?? detail
      } else if (market === 'KR') {
        requiredArtifact = `${brokerage} ${account} 거래내역증명서`
        action = `${brokerage} ${account}의 최신 거래내역증명서를 다운로드해 inbox에 넣으세요.`
        coveredThrough = statementCoveredThrough ?? coveredThrough
      }

      const lagDays = calendarAgeDays(coveredThrough)
      // Ask for one day before the last covered date so the next export has a
      // deliberate overlap and cannot hide an edge-of-window transaction. With
      // separate sources, the one that is downloaded is the one that has a start.
      const downloadFrom = sources.length
        ? sources.find((source) => source.method !== 'mcp')?.downloadFrom ?? null
        : subtractCalendarDays(method === 'mixed' ? statementCoveredThrough ?? coveredThrough : coveredThrough, 1)
      const apiLagDays = calendarAgeDays(apiCoveredThrough)
      const statementLagDays = calendarAgeDays(statementCoveredThrough)
      const overdueDays = lagDays == null ? null : Math.max(0, lagDays - maxLagDays)
      const status = sources.length ? worstSource(sources).status : coverageStatus(lagDays, maxLagDays)
      const sourceNeedles = [brokerLower.replace(/증권|\s+/g, ''), account.toLowerCase().replace(/\s+/g, '')]
      rows.push({
        id: key,
        market,
        brokerage,
        account,
        coveredThrough,
        downloadFrom,
        lagDays,
        apiCoveredThrough,
        apiLagDays,
        statementCoveredThrough,
        statementLagDays,
        maxLagDays,
        overdueDays,
        status,
        method,
        requiredArtifact,
        format,
        destination,
        lastFile: latestSourceFilename(sourceRows, sourceNeedles),
        action,
        detail,
        sources,
        missingDisposals,
      })
    }

    rows.sort((a, b) => {
      const score = { action_needed: 0, missing: 1, due_soon: 2, current: 3 }
      return score[a.status] - score[b.status] || (b.lagDays ?? 999) - (a.lagDays ?? 999) || a.brokerage.localeCompare(b.brokerage)
    })
    return {
      rows,
      actionNeeded: rows.filter((row) => row.status === 'action_needed' || row.status === 'missing').length,
      dueSoon: rows.filter((row) => row.status === 'due_soon').length,
      current: rows.filter((row) => row.status === 'current').length,
      generatedAt: new Date().toISOString(),
    }
  } finally {
    conn.close()
  }
}

/**
 * Every account in the database, with the first and last date each table
 * reaches for it. Tax lots span from the oldest open acquisition to the
 * snapshot that listed them; the other tables span their own date column.
 */
export function getAccountDataRanges(): AccountDataRange[] {
  const conn = db()
  try {
    // /accounts lists every account, pensions included, so it reads the tables
    // behind the stock-only views.
    const spans: {
      kind: RangeKind
      table: 'holdings' | 'tax_lots' | 'transactions' | 'dividends' | 'realized_lots'
      start: string
      end: string
      type: string
    }[] = [
      { kind: 'transactions', table: 'transactions', start: 'date', end: 'date', type: 'account_type' },
      { kind: 'dividends', table: 'dividends', start: 'date', end: 'date', type: 'account_type' },
      { kind: 'holdings', table: 'holdings', start: 'as_of_date', end: 'as_of_date', type: 'account_type' },
      { kind: 'lots', table: 'tax_lots', start: 'acquired_date', end: 'as_of_date', type: 'account_type' },
      { kind: 'realized', table: 'realized_lots', start: 'sold_date', end: 'sold_date', type: 'null' },
    ]
    const rows: RangeRow[] = []
    for (const span of spans) {
      const table = allAssetsTable(conn, span.table)
      const columns = new Set((conn.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((column) => column.name))
      // A database older than the wrapper and asset-class columns holds stock rows only.
      const assetType = [
        columns.has('account_wrapper') ? `when ${PENSION_ROW_SQL} then 'pension'` : '',
        columns.has('asset_class') ? `when ${GOLD_ROW_SQL} then 'gold'` : '',
      ].join(' ')
      const assetTypeSql = assetType.trim() ? `case ${assetType} else 'stock' end` : `'stock'`
      const found = conn
        .prepare(
          `select market, coalesce(brokerage, 'Unknown') as brokerage, account, max(${span.type}) as account_type, ${assetTypeSql} as asset_type,
                  min(${span.start}) as start, max(${span.end}) as end, count(*) as count
             from ${table} group by market, brokerage, account, asset_type`
        )
        .all() as { market: string; brokerage: string; account: string; account_type: string | null; asset_type: AssetType; start: string | null; end: string | null; count: number }[]
      for (const row of found) {
        rows.push({
          kind: span.kind,
          market: row.market,
          brokerage: row.brokerage,
          account: row.account,
          accountType: row.account_type || null,
          start: isoDate(row.start),
          end: isoDate(row.end),
          count: row.count,
          assetType: row.asset_type,
        })
      }
    }
    const hasBalances = conn.prepare("select 1 from sqlite_master where type = 'table' and name = 'cash_balances'").get()
    const balanceSpans = hasBalances
      ? (conn
          .prepare(
            `select 'CASH' as market, institution as brokerage, account, max(kind) as account_type,
                    min(as_of_date) as start, max(as_of_date) as end, count(*) as count
               from cash_balances group by institution, account`
          )
          .all() as { market: string; brokerage: string; account: string; account_type: string | null; start: string | null; end: string | null; count: number }[])
      : []
    for (const row of balanceSpans) {
      rows.push({ kind: 'balances', market: row.market, brokerage: row.brokerage, account: row.account, accountType: row.account_type, start: isoDate(row.start), end: isoDate(row.end), count: row.count })
    }
    return groupAccountRanges(rows)
  } finally {
    conn.close()
  }
}

export type SupplementaryCoverageKind = 'deposit' | 'cma' | 'pension' | 'gold' | 'gold_price'

export type SupplementaryCoverageRow = {
  kind: SupplementaryCoverageKind
  label: string
  latestDate: string | null
  lagDays: number | null
  maxLagDays: number
  status: AccountCoverageStatus
  /** What to file next, in the reminder's words. */
  action: string
}

export type SupplementaryCoverage = {
  rows: SupplementaryCoverageRow[]
  /** Names of the failing `supplementary` validation checks. */
  failingChecks: string[]
}

/** Days each kind may go without a newer file before the reminder names it. */
const SUPPLEMENTARY_MAX_LAG_DAYS: Record<SupplementaryCoverageKind, number> = {
  deposit: 90,
  cma: 90,
  pension: 180,
  gold: 90,
  gold_price: 7,
}

/**
 * How far each supplementary asset's files reach: one row per cash account (less
 * the ones the map marks `retired` or `retiredOn`), per
 * pension account in the map, per gold account, and one for the gold price.
 * Dates, labels and status only, never an amount: this feeds the weekly
 * reminder, which leaves the machine. Deposits, pensions and gold have no
 * download schedule of their own, so like the broker statements they go stale
 * only when nobody files the next export, and nothing said so.
 */
/** The latest ISO date among the given ones, ignoring nulls. */
function latestOf(...dates: (string | null | undefined)[]): string | null {
  return dates.filter((d): d is string => Boolean(d)).sort().at(-1) ?? null
}

export function getSupplementaryCoverage(): SupplementaryCoverage {
  const conn = db()
  try {
    const hasTable = (name: string) =>
      Boolean(conn.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name))
    const hasColumn = (table: string, column: string) =>
      (conn.prepare(`pragma table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column)
    const rows: SupplementaryCoverageRow[] = []
    const push = (kind: SupplementaryCoverageKind, label: string, latest: string | null, action: string) => {
      const latestDate = isoDate(latest)
      const lagDays = calendarAgeDays(latestDate)
      const maxLagDays = SUPPLEMENTARY_MAX_LAG_DAYS[kind]
      rows.push({ kind, label, latestDate, lagDays, maxLagDays, status: coverageStatus(lagDays, maxLagDays), action })
    }

    // The map's retired accounts, and its pension list. An unreadable map is the
    // ingest's failure to report; here it means none of either.
    let accountMap: ReturnType<typeof loadAccountMap> | null = null
    try {
      accountMap = loadAccountMap(config.stockAccountMapPath)
    } catch {
      accountMap = null
    }
    const retired = retiredBankAccounts(accountMap?.bankAccounts)

    if (hasTable('cash_balances')) {
      const cash = conn
        .prepare(
          `select institution, account, max(case when kind = 'cma' then 1 else 0 end) as isCma, max(as_of_date) as latest,
                  ${hasColumn('cash_balances', 'source') ? 'group_concat(distinct source)' : 'null'} as sources
             from cash_balances group by institution, account order by institution, account`
        )
        .all() as { institution: string; account: string; isCma: number; latest: string | null; sources: string | null }[]
      for (const row of cash) {
        // A closed account has nothing more to download.
        if (retired.has(`${row.institution}|${row.account}`)) continue
        const label = `${row.institution} ${row.account}`
        // A quiet account has no balance row near its statement's end, so the
        // statement's own period end counts too; otherwise a fresh download of a
        // dormant account would never clear the reminder.
        const latest = latestOf(row.latest, ...String(row.sources ?? '').split(',').map(periodEndFromSource))
        push(row.isCma ? 'cma' : 'deposit', label, latest, `${label} 거래내역을 ${isoDate(latest)}부터 받아 inbox에 넣으세요`)
      }
    }

    // Every pension account the map lists, filed or not: one with no snapshot yet
    // is 'missing', which is the reminder's whole point.
    const pensionAccounts: { token?: unknown; account?: unknown; wrapper?: unknown }[] = accountMap?.pensionAccounts ?? []
    const snapshotStmt = hasTable('holdings_all')
      ? conn.prepare(
          `select max(as_of_date) as latest from holdings_all where account = ? and (? is null or account_wrapper = ?) and ${PENSION_ROW_SQL}`
        )
      : null
    for (const entry of pensionAccounts) {
      const token = String(entry?.token ?? '').trim()
      const account = String(entry?.account ?? '').trim()
      if (!token || !account) continue
      const wrapper = String(entry?.wrapper ?? '').trim() || null
      const latest = (snapshotStmt?.get(account, wrapper, wrapper) as { latest: string | null } | undefined)?.latest ?? null
      push('pension', account, latest, `${account} 보유 현황을 캡처해 pension/${token}-holdings-YYYYMMDD.csv로 넣으세요`)
    }

    // Gold: how far each account's 금현물 statement reaches, and how old the price is.
    if (hasTable('transactions_all')) {
      const gold = conn
        .prepare(
          `select account, max(date) as latest, ${hasColumn('transactions_all', 'source') ? 'group_concat(distinct source)' : 'null'} as sources
             from transactions_all where ${GOLD_ROW_SQL} group by account order by account`
        )
        .all() as { account: string; latest: string | null; sources: string | null }[]
      for (const row of gold) {
        // The certificate's period end, not the last purchase: months without a
        // trade must not keep the reminder open after a fresh certificate is filed.
        const latest = latestOf(row.latest, ...String(row.sources ?? '').split(',').map(periodEndFromSource))
        push('gold', row.account, latest, `${row.account} 금현물 거래내역증명서를 ${isoDate(latest)}부터 새로 받아 inbox에 넣으세요`)
      }
    }
    const holdsGold = hasTable('holdings_all') && Boolean(conn.prepare(`select 1 from holdings_all where ${GOLD_ROW_SQL} limit 1`).get())
    if (holdsGold) {
      const latest = hasTable('gold_prices')
        ? ((conn.prepare('select max(date) as latest from gold_prices').get() as { latest: string | null }).latest ?? null)
        : null
      push('gold_price', 'KRX 금 시세', latest, 'KRX 금 시세를 갱신하세요 (pnpm fetch:gold-price)')
    }

    const failingChecks = hasTable('validation_checks')
      ? (
          conn
            .prepare(`select name from validation_checks where status != 'pass' and ${checkScopeSql(conn)} = 'supplementary' order by name`)
            .all() as { name: string }[]
        ).map((row) => row.name)
      : []
    return { rows, failingChecks }
  } finally {
    conn.close()
  }
}

export function getDataOpsReview(): DataOpsReview {
  const operational = getOperationalHealth()
  const manualMappings = readJson(config.stockManualMappingsPath) ?? {}
  const conn = db()
  try {
    const mappingSummary = conn
      .prepare(
        `select
          coalesce(mapping_status, 'unknown') as mapping_status,
          coalesce(income_category, 'unknown') as income_category,
          count(*) as row_count,
          coalesce(sum(amount_krw), 0) as base_income
         from dividends
         group by coalesce(mapping_status, 'unknown'), coalesce(income_category, 'unknown')
         order by mapping_status, income_category`
      )
      .all() as DataOpsReview['mappingSummary']
    const tickerlessIncome = (
      conn
        .prepare(
          `select
            market,
            currency,
            brokerage,
            account,
            coalesce(income_category, 'unknown') as income_category,
            coalesce(mapping_status, 'unknown') as mapping_status,
            type,
            name,
            source,
            count(*) as row_count,
            coalesce(sum(native_amount), 0) as native_income,
            coalesce(sum(amount_krw), 0) as base_income
           from dividends
           where (ticker is null or trim(ticker) = '')
             and coalesce(mapping_status, 'tickerless') = 'tickerless'
           group by market, currency, brokerage, account, income_category, mapping_status, type, name, source
           order by base_income desc
           limit 50`
        )
        .all() as Omit<DataOpsReview['tickerlessIncome'][number], 'suggestion'>[]
    ).map((row) => ({
      ...row,
      suggestion: tickerlessSuggestion(row.income_category),
      suggestedRule: mappingRuleSuggestion(row),
    }))
    const missingValuationRows = conn
      .prepare(
        `select market, currency, brokerage, account, ticker, name, quantity, native_cost, base_cost
         from holdings
         where ${STOCK_WRAPPER_SQL} and (native_market_value is null or base_market_value is null)
           and not (market = 'KR' and length(trim(ticker)) != 6)
         order by coalesce(base_cost, total_cost_krw) desc
         limit 50`
      )
      .all() as Omit<DataOpsReview['missingValuation'][number], 'reason' | 'suggestion'>[]
    const missingValuation = missingValuationRows.map((row) => {
      const reason = valuationReason(row)
      return { ...row, reason, suggestion: valuationSuggestion(reason) }
    })
    const validationIssues = conn
      .prepare("select * from validation_checks where status != 'pass' order by severity, name")
      .all() as HealthCheck[]
    const mappingSuggestions = tickerlessIncome.slice(0, 20).map((row, index) => ({
      id: `${index}:${row.market}:${row.brokerage}:${row.source}:${row.name}:${row.type}`,
      market: row.market,
      brokerage: row.brokerage,
      source: row.source,
      income_category: row.income_category,
      row_count: row.row_count,
      base_income: row.base_income,
      rule: row.suggestedRule,
      note: row.suggestion,
    }))
    const valuationFixes = missingValuation.slice(0, 20).map((row) => ({
      market: row.market,
      ticker: row.ticker,
      name: row.name,
      brokerage: row.brokerage,
      reason: row.reason,
      suggestion: row.suggestion,
    }))
    const actionQueue: DataOpsReview['actionQueue'] = []
    if (validationIssues.length > 0) {
      actionQueue.push({
        priority: 'high',
        area: 'Validation',
        count: validationIssues.length,
        action: 'Fix failing ingest validation checks before acting on downstream triage.',
        href: '/health',
      })
    }
    if (operational.staleItems.length > 0) {
      actionQueue.push({
        priority: operational.summary.missing || operational.summary.drift ? 'high' : 'medium',
        area: 'Source freshness',
        count: operational.staleItems.length,
        action: 'Resolve stale, drifted, or missing inputs and rerun pnpm refresh.',
        href: '/health',
      })
    }
    if (mappingSuggestions.length > 0) {
      actionQueue.push({
        priority: 'medium',
        area: 'Manual mappings',
        count: mappingSuggestions.reduce((sum, row) => sum + Number(row.row_count ?? 0), 0),
        action: 'Review suggested read-only mapping rules and apply the useful ones to data/manual-mappings.json.',
        href: '/data-ops',
      })
    }
    if (valuationFixes.length > 0) {
      actionQueue.push({
        priority: 'low',
        area: 'Valuation',
        count: valuationFixes.length,
        action: 'Refresh price snapshots or resolve ticker normalization for missing valuation rows.',
        href: '/data-ops',
      })
    }
    return {
      manualMappings: {
        path: config.stockManualMappingsPath,
        version: typeof manualMappings.version === 'number' ? manualMappings.version : null,
        incomeRuleCount: manualMappings.incomeRules?.length ?? 0,
        overrideCount: manualMappings.dividendOverrides?.length ?? 0,
        instrumentAliasCount: manualMappings.instrumentAliases?.length ?? 0,
      },
      mappingSummary,
      tickerlessIncome,
      missingValuation,
      actionQueue,
      mappingSuggestions,
      valuationFixes,
      sourceIssues: operational.staleItems,
      validationIssues,
    }
  } finally {
    conn.close()
  }
}

function reconciliationStatus(row: any): ReconciliationReview['positionBreaks'][number]['status'] {
  if (!row.holding_present) return 'lot_only'
  if (!row.lot_present) return 'holding_only'
  if (Math.abs(Number(row.quantity_diff ?? 0)) > 0.0001) return 'quantity_break'
  return 'cost_break'
}

export function getReconciliationReview(): ReconciliationReview {
  const conn = db()
  try {
    const operational = getOperationalHealth()
    const validationIssues = conn.prepare("select count(*) as count from validation_checks where status != 'pass'").get() as { count: number }
    const coverage = conn
      .prepare(
        `with holding_summary as (
           select market, coalesce(brokerage, 'Unassigned') as brokerage,
             count(distinct ticker) as holding_positions,
             count(distinct account) as holding_accounts,
             coalesce(sum(coalesce(base_cost, total_cost_krw)), 0) as holding_base_cost
           from holdings
           where ${STOCK_WRAPPER_SQL}
           group by market, coalesce(brokerage, 'Unassigned')
         ),
         lot_summary as (
           select market, coalesce(brokerage, 'Unassigned') as brokerage,
             count(distinct ticker) as lot_positions,
             count(*) as lot_rows,
             coalesce(sum(cost_basis_krw), 0) as lot_base_cost
           from tax_lots
           group by market, coalesce(brokerage, 'Unassigned')
         ),
         transaction_summary as (
           select market, coalesce(brokerage, 'Unassigned') as brokerage, count(*) as transaction_rows
           from transactions
           group by market, coalesce(brokerage, 'Unassigned')
         ),
         dividend_summary as (
           select market, coalesce(brokerage, 'Unassigned') as brokerage, count(*) as dividend_rows
           from dividends
           group by market, coalesce(brokerage, 'Unassigned')
         ),
         keys as (
           select market, brokerage from holding_summary
           union
           select market, brokerage from lot_summary
           union
           select market, brokerage from transaction_summary
           union
           select market, brokerage from dividend_summary
         )
         select keys.market, keys.brokerage,
           coalesce(holding_summary.holding_positions, 0) as holding_positions,
           coalesce(holding_summary.holding_accounts, 0) as holding_accounts,
           coalesce(holding_summary.holding_base_cost, 0) as holding_base_cost,
           coalesce(lot_summary.lot_positions, 0) as lot_positions,
           coalesce(lot_summary.lot_rows, 0) as lot_rows,
           coalesce(lot_summary.lot_base_cost, 0) as lot_base_cost,
           coalesce(transaction_summary.transaction_rows, 0) as transaction_rows,
           coalesce(dividend_summary.dividend_rows, 0) as dividend_rows
         from keys
         left join holding_summary on holding_summary.market = keys.market and holding_summary.brokerage = keys.brokerage
         left join lot_summary on lot_summary.market = keys.market and lot_summary.brokerage = keys.brokerage
         left join transaction_summary on transaction_summary.market = keys.market and transaction_summary.brokerage = keys.brokerage
         left join dividend_summary on dividend_summary.market = keys.market and dividend_summary.brokerage = keys.brokerage
         order by keys.market, keys.brokerage`
      )
      .all() as ReconciliationReview['coverage']

    const positionRows = conn
      .prepare(
        `with h as (
           select market, coalesce(brokerage, 'Unassigned') as brokerage, ticker, max(name) as name,
             count(distinct account) as holding_accounts,
             coalesce(sum(quantity), 0) as holding_quantity,
             coalesce(sum(coalesce(base_cost, total_cost_krw)), 0) as holding_base_cost,
             1 as holding_present
           from holdings
           where ${STOCK_WRAPPER_SQL}
           group by market, coalesce(brokerage, 'Unassigned'), ticker
         ),
         l as (
           select market, coalesce(brokerage, 'Unassigned') as brokerage, ticker, max(name) as name,
             coalesce(sum(open_quantity), 0) as lot_quantity,
             coalesce(sum(cost_basis_krw), 0) as lot_base_cost,
             1 as lot_present
           from tax_lots
           group by market, coalesce(brokerage, 'Unassigned'), ticker
         ),
         keys as (
           select market, brokerage, ticker from h
           union
           select market, brokerage, ticker from l
         )
         select keys.market, keys.brokerage, keys.ticker,
           coalesce(h.name, l.name, keys.ticker) as name,
           coalesce(h.holding_accounts, 0) as holding_accounts,
           h.holding_quantity,
           l.lot_quantity,
           case when h.holding_present = 1 and l.lot_present = 1 then h.holding_quantity - l.lot_quantity else null end as quantity_diff,
           h.holding_base_cost,
           l.lot_base_cost,
           case when h.holding_present = 1 and l.lot_present = 1 then h.holding_base_cost - l.lot_base_cost else null end as base_cost_diff,
           coalesce(h.holding_present, 0) as holding_present,
           coalesce(l.lot_present, 0) as lot_present
         from keys
         left join h on h.market = keys.market and h.brokerage = keys.brokerage and h.ticker = keys.ticker
         left join l on l.market = keys.market and l.brokerage = keys.brokerage and l.ticker = keys.ticker
         where h.holding_present is null
            or l.lot_present is null
            or abs(coalesce(h.holding_quantity, 0) - coalesce(l.lot_quantity, 0)) > 0.0001
            or abs(coalesce(h.holding_base_cost, 0) - coalesce(l.lot_base_cost, 0)) > 1000
         order by
           case when h.holding_present is null or l.lot_present is null then 0 else 1 end,
           abs(coalesce(h.holding_base_cost, 0) - coalesce(l.lot_base_cost, 0)) desc
         limit 100`
      )
      .all() as any[]
    const positionBreaks = positionRows.map((row) => ({
      market: row.market,
      brokerage: row.brokerage,
      ticker: row.ticker,
      name: row.name,
      holding_accounts: row.holding_accounts,
      holding_quantity: row.holding_quantity,
      lot_quantity: row.lot_quantity,
      quantity_diff: row.quantity_diff,
      holding_base_cost: row.holding_base_cost,
      lot_base_cost: row.lot_base_cost,
      base_cost_diff: row.base_cost_diff,
      status: reconciliationStatus(row),
    })) as ReconciliationReview['positionBreaks']

    const incomeBreaks = conn
      .prepare(
        `select market, currency, brokerage, income_category,
          count(*) as row_count,
          coalesce(sum(amount_krw), 0) as base_income
         from dividends
         where ticker is null or trim(ticker) = ''
         group by market, currency, brokerage, income_category
         order by row_count desc, base_income desc
         limit 20`
      )
      .all() as ReconciliationReview['incomeBreaks']
    const valuationBreaks = conn
      .prepare(
        `select market, currency, brokerage, ticker, name, native_cost, base_cost
         from holdings
         where ${STOCK_WRAPPER_SQL} and native_market_value is null
           and not (market = 'KR' and length(trim(ticker)) != 6)
         order by coalesce(base_cost, total_cost_krw) desc
         limit 30`
      )
      .all() as ReconciliationReview['valuationBreaks']
    const totals = conn
      .prepare(
        `select
          count(distinct market) as market_count,
          count(distinct coalesce(brokerage, 'Unassigned')) as brokerage_count,
          count(distinct market || ':' || ticker) as position_count
         from holdings where ${STOCK_WRAPPER_SQL}`
      )
      .get() as Pick<ReconciliationReview['totals'], 'market_count' | 'brokerage_count' | 'position_count'>
    const lotTotals = conn.prepare("select count(distinct market || ':' || ticker) as count from tax_lots").get() as { count: number }

    const actionQueue: ReconciliationReview['actionQueue'] = []
    if (operational.staleItems.length > 0) {
      actionQueue.push({
        priority: operational.summary.missing || operational.summary.drift ? 'high' : 'medium',
        area: 'Source freshness',
        count: operational.staleItems.length,
        action: 'Resolve stale, drifted, or missing source inputs before trusting reconciliation deltas.',
        href: '/health',
      })
    }
    if (validationIssues.count > 0) {
      actionQueue.push({
        priority: 'high',
        area: 'Validation checks',
        count: validationIssues.count,
        action: 'Fix failing validation checks from the latest ingest.',
        href: '/health',
      })
    }
    if (positionBreaks.length > 0) {
      actionQueue.push({
        priority: 'medium',
        area: 'Holdings vs lots',
        count: positionBreaks.length,
        action: 'Review quantity and cost-basis differences by ticker and brokerage.',
        href: '/reconciliation',
      })
    }
    if (valuationBreaks.length > 0) {
      actionQueue.push({
        priority: 'low',
        area: 'Valuation',
        count: valuationBreaks.length,
        action: 'Refresh or map missing market valuation rows.',
        href: '/data-ops',
      })
    }

    const issueCount =
      positionBreaks.length +
      valuationBreaks.length +
      operational.staleItems.length +
      validationIssues.count

    return {
      totals: {
        issue_count: issueCount,
        market_count: totals.market_count,
        brokerage_count: totals.brokerage_count,
        position_count: totals.position_count,
        lot_position_count: lotTotals.count,
        tickerless_income_count: incomeBreaks.reduce((sum, row) => sum + Number(row.row_count ?? 0), 0),
        missing_valuation_count: valuationBreaks.length,
        source_issue_count: operational.staleItems.length,
        validation_issue_count: validationIssues.count,
      },
      coverage,
      positionBreaks,
      incomeBreaks,
      valuationBreaks,
      actionQueue,
    }
  } finally {
    conn.close()
  }
}

export function getPositionDetail(market: string, ticker: string): PositionDetail | null {
  const conn = db()
  try {
    const holdings = conn
      .prepare(
        `select id, market, currency, brokerage, account, ticker, name, quantity, native_cost, native_market_value,
          native_unrealized_gl, native_unrealized_gl_pct, base_cost, base_market_value, base_unrealized_gl,
          total_cost_krw, long_term_qty, short_term_qty, lot_count
         from holdings
         where ${STOCK_WRAPPER_SQL} and market = ? and ticker = ?
         order by coalesce(base_market_value, base_cost, total_cost_krw) desc, account`
      )
      .all(market, ticker) as Holding[]
    const lots = conn
      .prepare(
        `with holding_prices as (
           select market, brokerage, account, ticker,
             max(current_price) as current_price,
             max(case when quantity > 0 then native_market_value / quantity else null end) as implied_price
           from holdings
           where ${STOCK_WRAPPER_SQL}
           group by market, brokerage, account, ticker
         )
         select tax_lots.id, tax_lots.market, tax_lots.currency, tax_lots.brokerage, tax_lots.account, tax_lots.ticker,
           tax_lots.name, tax_lots.acquired_date, tax_lots.open_quantity, tax_lots.native_cost_basis,
           coalesce(
             tax_lots.native_market_value,
             tax_lots.open_quantity * coalesce(holding_prices.current_price, holding_prices.implied_price)
           ) as native_market_value,
           coalesce(
             tax_lots.native_unrealized_gl,
             tax_lots.open_quantity * coalesce(holding_prices.current_price, holding_prices.implied_price) - tax_lots.native_cost_basis
           ) as native_unrealized_gl,
           tax_lots.cost_basis_krw, tax_lots.native_unit_cost, tax_lots.unit_cost, tax_lots.holding_days, tax_lots.tax_term, tax_lots.source
         from tax_lots
         left join holding_prices
           on holding_prices.market = tax_lots.market
          and coalesce(holding_prices.brokerage, '') = coalesce(tax_lots.brokerage, '')
          and holding_prices.account = tax_lots.account
          and holding_prices.ticker = tax_lots.ticker
         where tax_lots.market = ? and tax_lots.ticker = ?
         order by tax_lots.account, tax_lots.tax_term, tax_lots.acquired_date desc, tax_lots.native_cost_basis desc`
      )
      .all(market, ticker) as any[]
    const transactions = conn
      .prepare(
        `select market, currency, brokerage, date, account, type, raw_type, ticker, name, quantity, native_amount,
          native_settlement, native_unit_price, amount_krw, settlement_krw, unit_price, fee, tax, source, page
         from transactions
         where market = ? and ticker = ?
         order by date desc, id desc
         limit 500`
      )
      .all(market, ticker) as any[]
    const dividends = conn
      .prepare(
        `select market, currency, brokerage, date, account, ticker, name, native_amount, native_tax_withheld, amount_krw, type, source, page
         from dividends
         where market = ? and ticker = ?
         order by date desc, id desc
         limit 300`
      )
      .all(market, ticker) as any[]

    if (holdings.length === 0 && lots.length === 0 && transactions.length === 0 && dividends.length === 0) return null

    const totals = conn
      .prepare(
        `select
          count(distinct account) as account_count,
          count(*) as holding_count,
          coalesce(sum(quantity), 0) as quantity,
          coalesce(sum(native_cost), 0) as native_cost,
          sum(native_market_value) as native_market_value,
          sum(native_unrealized_gl) as native_unrealized_gl,
          coalesce(sum(coalesce(base_cost, total_cost_krw)), 0) as base_cost,
          sum(base_market_value) as base_market_value,
          sum(base_unrealized_gl) as base_unrealized_gl,
          coalesce(sum(long_term_qty), 0) as long_term_qty,
          coalesce(sum(short_term_qty), 0) as short_term_qty,
          coalesce(sum(lot_count), 0) as lot_count
         from holdings
         where ${STOCK_WRAPPER_SQL} and market = ? and ticker = ?`
      )
      .get(market, ticker) as PositionDetail['totals']
    const lotTotals = conn
      .prepare(
        `select
          count(*) as lot_count,
          coalesce(sum(open_quantity), 0) as open_quantity,
          coalesce(sum(native_cost_basis), 0) as native_cost_basis,
          coalesce(sum(cost_basis_krw), 0) as cost_basis_krw,
          sum(case when tax_term = 'Long-term' then 1 else 0 end) as long_term_count,
          sum(case when tax_term = 'Short-term' then 1 else 0 end) as short_term_count
         from tax_lots
         where market = ? and ticker = ?`
      )
      .get(market, ticker) as PositionDetail['lotTotals']
    const dividendTotals = conn
      .prepare(
        `select count(*) as count, coalesce(sum(native_amount), 0) as native_amount, coalesce(sum(amount_krw), 0) as amount_krw
         from dividends
         where market = ? and ticker = ?`
      )
      .get(market, ticker) as PositionDetail['dividendTotals']
    const transactionSummary = conn
      .prepare(
        `select type, count(*) as count, sum(native_amount) as amount
         from transactions
         where market = ? and ticker = ?
         group by type
         order by count desc, type`
      )
      .all(market, ticker) as PositionDetail['transactionSummary']
    const files = conn.prepare('select * from source_files order by name').all() as any[]

    const sourceMap = new Map<string, Set<string>>()
    const canonicalSources = ['holdings', 'taxlots', 'transactions', 'dividends', 'fx_rates', priceSnapshotNameFor(market)]
    canonicalSources.forEach((source) => addSource(sourceMap, source, 'snapshot'))
    lots.forEach((row) => addSource(sourceMap, row.source, 'tax lots'))
    transactions.forEach((row) => addSource(sourceMap, row.source, 'transactions'))
    dividends.forEach((row) => addSource(sourceMap, row.source, 'dividends'))

    const sources = Array.from(sourceMap.entries())
      .map(([source, usages]) => ({
        source,
        usages: Array.from(usages).sort(),
        file: files.find((file) => sourceMatchesFile(source, file)) ?? null,
      }))
      .sort((a, b) => a.source.localeCompare(b.source))

    const first = holdings[0] ?? lots[0] ?? transactions[0] ?? dividends[0]
    return {
      market,
      ticker,
      name: first.name || ticker,
      currency: first.currency,
      holdings,
      lots,
      transactions,
      dividends,
      transactionSummary,
      totals,
      lotTotals,
      dividendTotals,
      sources,
    }
  } finally {
    conn.close()
  }
}

/**
 * Open lots for the tax planner: the lots of every wrapper whose US treatment is
 * `taxable` in the policy. The brokerage wrapper always is; `isa` is by default,
 * so with the defaults this is exactly the stock view. An `isa` set to anything
 * else drops the ISA lots, and a pension wrapper set to `taxable` adds its lots.
 */
export function getTaxPlanningLots(limit = 500, policy: TaxPolicy = getTaxPolicyState().policy): TaxPlanningLot[] {
  const conn = db()
  try {
    const wrappers = ['taxable', ...usTaxableWrappers(policy)]
    const lotsTable = allAssetsTable(conn, 'tax_lots')
    const holdingsTable = allAssetsTable(conn, 'holdings')
    // A database older than the *_all tables has only the stock rows, and is
    // read as it always was.
    const scoped = lotsTable === 'tax_lots_all'
    const rowFilter = (alias: string) =>
      scoped
        ? `(${alias}.account_wrapper in (${wrappers.map(() => '?').join(', ')}) and ${alias}.asset_class = 'security')`
        : alias === 'h'
          ? `${alias}.${STOCK_WRAPPER_SQL}`
          : '1 = 1'
    const params = scoped ? [...wrappers, ...wrappers, limit] : [limit]
    return conn
      .prepare(
        `with holding_prices as (
           select market, brokerage, account, ticker,
             max(current_price) as current_price,
             max(case when quantity > 0 then native_market_value / quantity else null end) as implied_price
           from ${holdingsTable} as h
           where ${rowFilter('h')}
           group by market, brokerage, account, ticker
         ),
         enriched_lots as (
           select
             tax_lots.id,
             tax_lots.market,
             tax_lots.currency,
             tax_lots.brokerage,
             tax_lots.account,
             tax_lots.ticker,
             tax_lots.name,
             tax_lots.acquired_date,
             tax_lots.fx_rate_to_base,
             tax_lots.open_quantity,
             tax_lots.native_cost_basis,
             coalesce(
               tax_lots.native_market_value,
               tax_lots.open_quantity * coalesce(holding_prices.current_price, holding_prices.implied_price)
             ) as native_market_value,
             coalesce(
               tax_lots.native_unrealized_gl,
               tax_lots.open_quantity * coalesce(holding_prices.current_price, holding_prices.implied_price) - tax_lots.native_cost_basis
             ) as native_unrealized_gl,
             tax_lots.cost_basis_krw,
             tax_lots.holding_days,
             tax_lots.tax_term,
             tax_lots.account_wrapper
           from ${lotsTable} as tax_lots
           left join holding_prices
             on holding_prices.market = tax_lots.market
            and coalesce(holding_prices.brokerage, '') = coalesce(tax_lots.brokerage, '')
            and holding_prices.account = tax_lots.account
            and holding_prices.ticker = tax_lots.ticker
           where tax_lots.open_quantity > 0
             and ${rowFilter('tax_lots')}
         )
         select *
         from enriched_lots
         order by
           case when native_market_value is null then 1 else 0 end,
           coalesce(native_unrealized_gl, native_market_value - native_cost_basis, 0) asc,
           coalesce(native_market_value, native_cost_basis) desc
         limit ?`
      )
      .all(...params) as TaxPlanningLot[]
  } finally {
    conn.close()
  }
}

export type WrapperReviewRow = {
  account: string
  wrapper: string
  usTreatment: WrapperTreatment
  realizedGainKrw: number
  dividendsKrw: number
  /** Korean funds and ETFs in the account: every `PENSION:` fund id plus every KR ETF ticker, never cash. */
  likelyPficCount: number
}

/**
 * Whether the database holds any supplementary data: a cash balance, or a row
 * in holdings_all outside the stock view (a pension wrapper, or gold). Cheap
 * enough for the layout, which hides the All assets section without it.
 */
export function hasSupplementaryAssets(): boolean {
  if (!dbAvailable()) return false
  const conn = db()
  try {
    const hasTable = (name: string) => Boolean(conn.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name))
    if (hasTable('cash_balances') && conn.prepare('select 1 from cash_balances limit 1').get()) return true
    if (hasTable('holdings_all') && conn.prepare(`select 1 from holdings_all where not (${STOCK_ROW_SQL}) limit 1`).get()) return true
    return false
  } finally {
    conn.close()
  }
}

/**
 * One row per account under a wrapper other than `taxable` or `isa`, from the
 * `*_all` tables: what a US preparer needs to settle its treatment. Realized
 * gains and dividends are to date, in KRW. Empty on a database older than the
 * `*_all` tables, which holds no such account.
 */
export function getWrapperReview(policy: TaxPolicy = getTaxPolicyState().policy): WrapperReviewRow[] {
  const conn = db()
  try {
    if (allAssetsTable(conn, 'holdings') !== 'holdings_all') return []
    const nonStock = "account_wrapper not in ('taxable', 'isa') and asset_class = 'security'"
    const accounts = conn
      .prepare(
        `select account, account_wrapper as wrapper from (
           select account, account_wrapper from holdings_all where ${nonStock}
           union select account, account_wrapper from transactions_all where ${nonStock}
           union select account, account_wrapper from tax_lots_all where ${nonStock}
           union select account, account_wrapper from dividends_all where ${nonStock}
           union select account, account_wrapper from realized_lots_all where ${nonStock}
         )
         order by account_wrapper, account`
      )
      .all() as { account: string; wrapper: string }[]
    const realized = conn.prepare(
      'select coalesce(sum(realized_gl_krw), 0) as total from realized_lots_all where account = ? and account_wrapper = ? and superseded_by is null'
    )
    const dividends = conn.prepare(
      'select coalesce(sum(amount_krw), 0) as total from dividends_all where account = ? and account_wrapper = ?'
    )
    // A pension fund is stored under `PENSION:<token>:<slug>` and an ETF under its KR
    // ticker; cash is `PENSION:<token>:cash:<slug>` and is not a PFIC.
    const pfics = conn.prepare(
      `select count(distinct ticker) as total from holdings_all
        where account = ? and account_wrapper = ?
          and ticker not like 'PENSION:%:cash:%'
          and (ticker like 'PENSION:%' or market = 'KR')`
    )
    return accounts.map(({ account, wrapper }) => ({
      account,
      wrapper,
      usTreatment: wrapperTreatment(policy, 'US', wrapper),
      realizedGainKrw: Number((realized.get(account, wrapper) as { total: number }).total),
      dividendsKrw: Number((dividends.get(account, wrapper) as { total: number }).total),
      likelyPficCount: Number((pfics.get(account, wrapper) as { total: number }).total),
    }))
  } finally {
    conn.close()
  }
}

export function getTopHoldings(limit = 10) {
  const conn = db()
  try {
    return conn
      .prepare(
        `select
           min(id) as id,
           market,
           base_currency as currency,
           ticker,
           (
             select h2.name
             from holdings h2
             where ${stockWrapperFor("h2")} and h2.market = holdings.market and h2.ticker = holdings.ticker
             order by coalesce(h2.base_cost, 0) desc, h2.id
             limit 1
           ) as name,
           coalesce(sum(base_cost), 0) as value,
           coalesce(sum(base_cost), 0) as base_cost
         from holdings
         where ${STOCK_WRAPPER_SQL}
         group by market, ticker
         order by base_cost desc, value desc
         limit ?`
      )
      .all(limit) as { id: number; market: string; currency: string; ticker: string; name: string; value: number; base_cost: number }[]
  } finally {
    conn.close()
  }
}

export function getAccountAllocation() {
  const conn = db()
  try {
    return conn
      .prepare(
        `select market, currency, account, coalesce(sum(native_cost), 0) as value, count(*) as count
         from holdings
         where ${STOCK_WRAPPER_SQL}
         group by market, currency, account
         order by market, currency, value desc`
      )
      .all() as { market: string; currency: string; account: string; value: number; count: number }[]
  } finally {
    conn.close()
  }
}

export function getDividendByYear() {
  const conn = db()
  try {
    return conn
      .prepare(
        `select currency, substr(date, 1, 4) as year, coalesce(sum(native_amount), 0) as amount, count(*) as count
         from dividends
         group by currency, year
         order by currency, year`
      )
      .all() as { currency: string; year: string; amount: number; count: number }[]
  } finally {
    conn.close()
  }
}

export function getTransactionTypes() {
  const conn = db()
  try {
    return conn
      .prepare(
        `select market, type, count(*) as count
         from transactions
         group by market, type
         order by count desc`
      )
      .all() as { market: string; type: string; count: number }[]
  } finally {
    conn.close()
  }
}

export function getRecentTransactions(limit = 30) {
  const conn = db()
  try {
    return conn
      .prepare(
        `select market, currency, brokerage, date, account, type, ticker, name, quantity, native_amount, amount_krw, source, page
         from transactions
         order by date desc, id desc
         limit ?`
      )
      .all(limit) as any[]
  } finally {
    conn.close()
  }
}

export function getFxDashboard(recentLimit = 120): FxDashboard {
  const conn = db()
  try {
    const events = conn
      .prepare(
        `select id, institution, account, date, time, event_type, direction, usd_amount, krw_amount,
                applied_rate, rate_status, preference_rate, reference_base_rate, reference_customer_rate, reference_source,
                spread_cost_krw, spread_savings_krw, realized_fx_gl_krw, counterparty, match_status,
                confidence, method, balance_usd, source, page, note
           from fx_events
          order by date, coalesce(time, ''), id`
      )
      .all() as FxEvent[]
    const balances = conn
      .prepare(`select institution, as_of_date, balance_usd from fx_account_balances order by as_of_date`)
      .all() as Array<{ institution: string; as_of_date: string; balance_usd: number }>
    const currentRate = conn
      .prepare(
        `select rate, as_of_date from fx_rates
          where from_currency = 'USD' and to_currency = 'KRW'
          order by as_of_date desc, id desc limit 1`
      )
      .get() as { rate: number; as_of_date: string } | undefined
    const historicalRates = conn
      .prepare(`select price_date, rate from historical_fx_rates order by price_date`)
      .all() as Array<{ price_date: string; rate: number }>
    const historicalRateByDate = new Map(historicalRates.map((row) => [row.price_date, row.rate]))
    const tossLots = events
      .filter((event) => event.institution === 'Toss Securities' && event.event_type === 'EXCHANGE' && event.direction === 'BUY_USD')
      .map((event) => ({ remainingUsd: event.usd_amount, costRate: event.usd_amount ? (event.krw_amount ?? 0) / event.usd_amount : null, confirmed: event.rate_status === 'actual' }))
    let tossLotIndex = 0

    const institutions = new Map<string, FxDashboard['institutions'][number]>()
    const monthly = new Map<string, FxDashboard['monthly'][number]>()
    const exchangeBreakdown = new Map<string, FxDashboard['exchangeBreakdown'][number]>()
    let usdBought = 0
    let krwSpent = 0
    let spreadSavingsKrw = 0
    let exchangeCount = 0
    let estimatedCount = 0
    let actualCount = 0
    let transferCount = 0
    let missingDestinationCount = 0
    let hanaOutboundTransferCount = 0
    let hanaOutboundUsd = 0
    let hanaKnownMiraeUsd = 0
    let hanaUnknownDestinationUsd = 0
    let hanaSourceUsd = 0
    let hanaSourceCostKrw = 0
    let hanaConfirmedSourceUsd = 0
    let hanaConfirmedSourceCostKrw = 0
    let hanaTossMatchedUsd = 0
    let hanaTossUnmatchedUsd = 0
    let hanaOtherInboundUsd = 0
    let realizedEventCount = 0
    let realizedFxGlKrw = 0

    for (const event of events) {
      let institution = institutions.get(event.institution)
      if (!institution) {
        institution = {
          institution: event.institution,
          exchangeCount: 0,
          usdBought: 0,
          krwSpent: 0,
          weightedAverageRate: null,
          estimatedCount: 0,
          actualCount: 0,
          spreadSavingsKrw: 0,
          latestBalanceUsd: null,
          latestBalanceDate: null,
        }
        institutions.set(event.institution, institution)
      }
      if (event.balance_usd != null && (!institution.latestBalanceDate || event.date >= institution.latestBalanceDate)) {
        institution.latestBalanceUsd = event.balance_usd
        institution.latestBalanceDate = event.date
      }
      if (event.event_type === 'TRANSFER') {
        transferCount += 1
        if (event.match_status === 'destination_account_missing') missingDestinationCount += 1
        if (event.institution === 'Hana Bank' && event.direction === 'OUT') {
          hanaOutboundTransferCount += 1
          hanaOutboundUsd += event.usd_amount
          if (event.counterparty === 'Mirae Asset Securities') hanaKnownMiraeUsd += event.usd_amount
          else if (!event.counterparty) hanaUnknownDestinationUsd += event.usd_amount
        }
        if (event.institution === 'Hana Bank' && event.direction === 'IN') {
          let matchedUsd = 0
          let matchedCostKrw = 0
          let matchedConfirmedUsd = 0
          if (event.counterparty === 'Toss Securities') {
            let remaining = event.usd_amount
            while (remaining > 0.000001 && tossLotIndex < tossLots.length) {
              const lot = tossLots[tossLotIndex]
              const take = Math.min(remaining, lot.remainingUsd)
              if (lot.costRate != null) {
                matchedUsd += take
                matchedCostKrw += take * lot.costRate
                if (lot.confirmed) matchedConfirmedUsd += take
              }
              remaining -= take
              lot.remainingUsd -= take
              if (lot.remainingUsd <= 0.000001) tossLotIndex += 1
            }
            hanaTossMatchedUsd += matchedUsd
            hanaTossUnmatchedUsd += Math.max(0, event.usd_amount - matchedUsd)
          } else hanaOtherInboundUsd += event.usd_amount
          const assumedRate = historicalRateByDate.get(event.date) ?? currentRate?.rate ?? null
          const estimatedUsd = event.usd_amount - matchedUsd
          hanaSourceUsd += event.usd_amount
          hanaSourceCostKrw += matchedCostKrw + (assumedRate ? estimatedUsd * assumedRate : 0)
          hanaConfirmedSourceUsd += matchedConfirmedUsd
          hanaConfirmedSourceCostKrw += matchedCostKrw
        }
        continue
      }
      const sign = event.event_type === 'EXCHANGE_CANCEL' ? -1 : 1
      exchangeCount += sign
      usdBought += sign * event.usd_amount
      krwSpent += sign * (event.krw_amount ?? 0)
      spreadSavingsKrw += sign * (event.spread_savings_krw ?? 0)
      institution.exchangeCount += sign
      institution.usdBought += sign * event.usd_amount
      institution.krwSpent += sign * (event.krw_amount ?? 0)
      institution.spreadSavingsKrw += sign * (event.spread_savings_krw ?? 0)
      if (event.rate_status === 'estimated') {
        estimatedCount += sign
        institution.estimatedCount += sign
      } else if (event.rate_status === 'actual') {
        actualCount += sign
        institution.actualCount += sign
      }
      if (event.event_type === 'EXCHANGE' && (event.rate_status === 'actual' || event.rate_status === 'estimated')) {
        const key = `${event.institution}|${event.rate_status}`
        const breakdown = exchangeBreakdown.get(key) ?? { institution: event.institution, rateStatus: event.rate_status, exchangeCount: 0, usdBought: 0, krwSpent: 0, weightedAverageRate: null, unrealizedKrw: null }
        breakdown.exchangeCount += sign
        breakdown.usdBought += sign * event.usd_amount
        breakdown.krwSpent += sign * (event.krw_amount ?? 0)
        exchangeBreakdown.set(key, breakdown)
      }
      if (event.realized_fx_gl_krw != null) {
        realizedEventCount += 1
        realizedFxGlKrw += event.realized_fx_gl_krw
      }
      if (event.institution === 'Hana Bank') {
        hanaSourceUsd += sign * event.usd_amount
        hanaSourceCostKrw += sign * (event.krw_amount ?? 0)
        if (event.rate_status === 'actual') {
          hanaConfirmedSourceUsd += sign * event.usd_amount
          hanaConfirmedSourceCostKrw += sign * (event.krw_amount ?? 0)
        }
      }
      const monthKey = event.date.slice(0, 7)
      const month = monthly.get(monthKey) ?? { month: monthKey, usdBought: 0, krwSpent: 0, averageRate: null, spreadSavingsKrw: 0 }
      month.usdBought += sign * event.usd_amount
      month.krwSpent += sign * (event.krw_amount ?? 0)
      month.spreadSavingsKrw += sign * (event.spread_savings_krw ?? 0)
      monthly.set(monthKey, month)
    }
    for (const item of institutions.values()) {
      item.weightedAverageRate = item.usdBought ? item.krwSpent / item.usdBought : null
      const reported = balances.filter((row) => row.institution === item.institution).at(-1)
      if (reported) {
        item.latestBalanceUsd = reported.balance_usd
        item.latestBalanceDate = reported.as_of_date
      }
    }
    for (const item of monthly.values()) item.averageRate = item.usdBought ? item.krwSpent / item.usdBought : null
    for (const item of exchangeBreakdown.values()) {
      item.weightedAverageRate = item.usdBought ? item.krwSpent / item.usdBought : null
      item.unrealizedKrw = currentRate && item.usdBought ? item.usdBought * currentRate.rate - item.krwSpent : null
    }

    const hanaOutboundCostRate = hanaSourceUsd ? hanaSourceCostKrw / hanaSourceUsd : null
    const hanaOutboundCostKrw = hanaOutboundUsd && hanaSourceUsd ? hanaOutboundUsd * hanaOutboundCostRate! : 0
    const hanaOutboundValueKrw = hanaOutboundUsd && currentRate ? hanaOutboundUsd * currentRate.rate : 0
    const hanaConfirmedAllocatedUsd = hanaOutboundUsd && hanaSourceUsd ? hanaOutboundUsd * hanaConfirmedSourceUsd / hanaSourceUsd : 0
    const hanaConfirmedAllocatedCostKrw = hanaConfirmedSourceUsd && hanaSourceUsd ? hanaOutboundUsd * hanaConfirmedSourceCostKrw / hanaSourceUsd : 0
    const hanaOutboundConfirmedUnrealizedKrw = hanaConfirmedAllocatedUsd && currentRate ? hanaConfirmedAllocatedUsd * currentRate.rate - hanaConfirmedAllocatedCostKrw : 0
    const hanaOutboundUnrealizedKrw = hanaOutboundValueKrw - hanaOutboundCostKrw
    const hanaOutboundEstimatedUnrealizedKrw = hanaOutboundUnrealizedKrw - hanaOutboundConfirmedUnrealizedKrw

    return {
      summary: {
        exchangeCount,
        usdBought,
        krwSpent,
        weightedAverageRate: usdBought ? krwSpent / usdBought : null,
        spreadSavingsKrw,
        realizedFxGlKrw: realizedEventCount ? realizedFxGlKrw : null,
        realizedEventCount,
        estimatedCount,
        actualCount,
        transferCount,
        missingDestinationCount,
        hanaOutboundTransferCount,
        hanaOutboundUsd,
        hanaKnownMiraeUsd,
        hanaUnknownDestinationUsd,
        hanaOutboundCostKrw,
        hanaOutboundValueKrw,
        hanaOutboundUnrealizedKrw,
        hanaOutboundEstimatedCostRate: hanaOutboundCostRate,
        hanaOutboundConfirmedUnrealizedKrw,
        hanaOutboundEstimatedUnrealizedKrw,
        hanaTossMatchedUsd,
        hanaTossUnmatchedUsd,
        hanaOtherInboundUsd,
        currentUsdKrw: currentRate?.rate ?? null,
        currentUsdKrwAsOf: currentRate?.as_of_date ?? null,
      },
      institutions: [...institutions.values()].sort((a, b) => b.krwSpent - a.krwSpent),
      exchangeBreakdown: [...exchangeBreakdown.values()].sort((a, b) => a.institution.localeCompare(b.institution) || a.rateStatus.localeCompare(b.rateStatus)),
      monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)),
      transfers: events.filter((event) => event.event_type === 'TRANSFER').sort((a, b) => b.date.localeCompare(a.date)),
      recent: events.slice(-recentLimit).reverse(),
    }
  } finally {
    conn.close()
  }
}

export function getTaxLots(limit = 300) {
  const conn = db()
  try {
    return conn
      .prepare(
        `select market, currency, brokerage, account, ticker, name, acquired_date, open_quantity, native_cost_basis, cost_basis_krw,
          native_unit_cost, unit_cost, holding_days, tax_term, source
         from tax_lots
         order by market, holding_days desc, native_cost_basis desc
         limit ?`
      )
      .all(limit) as any[]
  } finally {
    conn.close()
  }
}

export function getSourceFiles() {
  const conn = db()
  try {
    return conn.prepare('select * from source_files order by name').all() as any[]
  } finally {
    conn.close()
  }
}

export function getSourceInventory(): SourceInventory {
  const conn = db()
  try {
    const meta = Object.fromEntries(conn.prepare('select key, value from meta').all().map((r: any) => [r.key, r.value])) as Record<
      string,
      string
    >
    const dataDir = meta.data_dir || config.stockDataDir
    const sourceRows = conn.prepare('select * from source_files order by name').all() as any[]
    const tracked = sourceRows.map((source) => trackedInventoryItem(dataDir, source))
    const trackedPaths = new Set(
      sourceRows.map((source) => {
        try {
          return path.resolve(source.path)
        } catch {
          return String(source.path)
        }
      })
    )
    const discovered = fs.existsSync(dataDir)
      ? walkFiles(dataDir)
          .filter((filePath) => !trackedPaths.has(path.resolve(filePath)))
          .map((filePath) => untrackedInventoryItem(dataDir, filePath))
      : []
    const items = [...tracked, ...discovered].sort((a, b) => {
      const statusScore = { missing: 0, drift: 1, unused: 2, archive: 3, derived: 4, used: 5 } as Record<SourceInventoryItem['status'], number>
      return statusScore[a.status] - statusScore[b.status] || a.relativePath.localeCompare(b.relativePath)
    })
    return {
      dataDir,
      tracked,
      untracked: discovered,
      items,
      summary: {
        used: items.filter((item) => item.status === 'used').length,
        unused: items.filter((item) => item.status === 'unused').length,
        drift: items.filter((item) => item.status === 'drift').length,
        missing: items.filter((item) => item.status === 'missing').length,
        totalBytes: items.reduce((sum, item) => sum + Number(item.bytes ?? 0), 0),
      },
    }
  } finally {
    conn.close()
  }
}

export function getRefreshRuns(limit = 10): RefreshRun[] {
  const history = readJson(config.stockRefreshRunsPath)
  if (!history || !Array.isArray(history.runs)) return []
  return history.runs.map(asRefreshRun).filter(Boolean).slice(0, limit) as RefreshRun[]
}

export function getEvidenceReports(): EvidenceReport[] {
  const conn = db()
  try {
    return conn.prepare('select * from evidence_reports order by category, name').all() as EvidenceReport[]
  } finally {
    conn.close()
  }
}

export function getValidationChecks(): HealthCheck[] {
  const conn = db()
  try {
    return conn
      .prepare(
        `select id, name, status, detail, severity, ${checkScopeSql(conn)} as scope from validation_checks order by status desc, severity, name`
      )
      .all() as HealthCheck[]
  } finally {
    conn.close()
  }
}
