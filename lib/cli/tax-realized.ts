/**
 * `pnpm tax:realized` — US realized lots in a date range, as the database holds them.
 *
 * For matching broker fills against what the Observatory has booked. A sale the
 * broker shows and this list does not is usually a statement not yet downloaded
 * and refreshed, not an error; `provenance.dbBuiltAt` says how current the list is.
 *
 * Rows: US securities in the default (taxable and ISA) view, the maintainer's own
 * accounts, replay rows a filed form has replaced left out. `basis` says where the
 * figure came from ('replay' = this repo's FIFO walk, '1099b' = the broker's form).
 *
 * `--include-gold` adds physical gold (KRX 금현물) sales. They are a Korean account's
 * won lots, so the dollar figures are measured the way the IRS does: cost at the
 * rate on the purchase date, proceeds (net of the sale commission) at the rate on
 * the sale date. Gold is a collectible, so its rows carry `collectible: true`.
 */
import type Database from 'better-sqlite3'
import {
  buildProvenance,
  columnsOf,
  dateFlag,
  hasTable,
  provenanceLines,
  round,
  table,
  todayLosAngeles,
  UsageError,
  usd,
  type CliContext,
  type Command,
  type ParsedFlags,
} from '@/lib/cli/common'

export type RealizedRow = {
  kind: 'security' | 'gold'
  /** Gold is a collectible: its long-term gain is taxed at a different maximum rate than a stock's. */
  collectible: boolean
  account: string
  brokerage: string | null
  ticker: string
  soldDate: string
  quantity: number | null
  proceedsUsd: number | null
  costUsd: number | null
  gainUsd: number | null
  term: 'short' | 'long' | null
  basis: string | null
}

function term(value: string | null): RealizedRow['term'] {
  const text = String(value ?? '').toLowerCase()
  if (text.includes('long')) return 'long'
  if (text.includes('short')) return 'short'
  return null
}

export function realizedRows(conn: Database.Database, since: string, until: string, includeGold = false): RealizedRow[] {
  if (!hasTable(conn, 'realized_lots')) return []
  const columns = columnsOf(conn, 'realized_lots')
  const pick = (name: string) => (columns.has(name) ? name : 'null')
  const filters = [
    columns.has('superseded_by') ? ' and superseded_by is null' : '',
    columns.has('owner') ? " and coalesce(owner, 'self') = 'self'" : '',
  ].join('')
  const rows = conn
    .prepare(
      `select account, brokerage, ticker, substr(sold_date, 1, 10) as soldDate, quantity_sold as quantity,
              ${pick('native_proceeds')} as proceeds, ${pick('native_realized_gl')} as gain, tax_term, ${pick('basis')} as basis
         from realized_lots
        where market = 'US' and sold_date is not null and substr(sold_date, 1, 10) between ? and ?${filters}
        order by sold_date, account, ticker, id`
    )
    .all(since, until) as {
    account: string
    brokerage: string | null
    ticker: string
    soldDate: string
    quantity: number | null
    proceeds: number | null
    gain: number | null
    tax_term: string | null
    basis: string | null
  }[]
  const securities = rows.map(
    (row): RealizedRow => ({
      kind: 'security',
      collectible: false,
      account: row.account,
      brokerage: row.brokerage,
      ticker: row.ticker,
      soldDate: row.soldDate,
      quantity: round(row.quantity, 6),
      proceedsUsd: usd(row.proceeds),
      costUsd: row.proceeds == null || row.gain == null ? null : usd(row.proceeds - row.gain),
      gainUsd: usd(row.gain),
      term: term(row.tax_term),
      basis: row.basis,
    })
  )
  return includeGold ? [...securities, ...goldRows(conn, since, until)].sort(bySoldDate) : securities
}

const bySoldDate = (a: RealizedRow, b: RealizedRow) => a.soldDate.localeCompare(b.soldDate)

/**
 * Physical gold sales, one row per purchase lot a sale consumed. The dollar
 * columns are written by the ingest (proceeds_usd, realized_gl_usd and
 * acquisition_cost_usd); a database built before they existed has no gold rows.
 */
function goldRows(conn: Database.Database, since: string, until: string): RealizedRow[] {
  if (!hasTable(conn, 'realized_lots_all')) return []
  const columns = columnsOf(conn, 'realized_lots_all')
  if (!columns.has('asset_class') || !columns.has('proceeds_usd')) return []
  const rows = conn
    .prepare(
      `select account, brokerage, ticker, substr(sold_date, 1, 10) as soldDate, quantity_sold as quantity,
              proceeds_usd as proceeds, acquisition_cost_usd as cost, realized_gl_usd as gain, tax_term, basis
         from realized_lots_all
        where asset_class = 'gold' and coalesce(owner, 'self') = 'self' and coalesce(superseded_by, '') = ''
          and sold_date is not null and substr(sold_date, 1, 10) between ? and ?
        order by sold_date, account, acquired_date, id`
    )
    .all(since, until) as {
    account: string
    brokerage: string | null
    ticker: string
    soldDate: string
    quantity: number | null
    proceeds: number | null
    cost: number | null
    gain: number | null
    tax_term: string | null
    basis: string | null
  }[]
  return rows.map(
    (row): RealizedRow => ({
      kind: 'gold',
      collectible: true,
      account: row.account,
      brokerage: row.brokerage,
      ticker: row.ticker,
      soldDate: row.soldDate,
      quantity: round(row.quantity, 6),
      proceedsUsd: usd(row.proceeds),
      costUsd: usd(row.cost),
      gainUsd: usd(row.gain),
      term: term(row.tax_term),
      basis: row.basis,
    })
  )
}

/** Gain by term for the listed rows, collectibles apart: their long-term rate differs. */
export function gainTotals(rows: RealizedRow[]) {
  const sum = (pick: (row: RealizedRow) => boolean) => usd(rows.filter(pick).reduce((total, row) => total + (row.gainUsd ?? 0), 0)) ?? 0
  return {
    shortTermUsd: sum((row) => row.term === 'short' && !row.collectible),
    longTermUsd: sum((row) => row.term === 'long' && !row.collectible),
    collectibleShortTermUsd: sum((row) => row.term === 'short' && row.collectible),
    collectibleLongTermUsd: sum((row) => row.term === 'long' && row.collectible),
    unclassifiedUsd: sum((row) => row.term == null),
  }
}

export function runTaxRealized(flags: ParsedFlags, ctx: CliContext) {
  const since = dateFlag(flags, 'since')
  if (!since) throw new UsageError('--since YYYY-MM-DD is required')
  const until = dateFlag(flags, 'until') ?? todayLosAngeles()
  if (until < since) throw new UsageError(`--until ${until} is before --since ${since}`)
  const rows = realizedRows(ctx.conn, since, until, flags['include-gold'] === true)
  return {
    provenance: buildProvenance({ conn: ctx.conn, policyState: ctx.policyState, dbPath: ctx.dbPath }),
    since,
    until,
    includeGold: flags['include-gold'] === true,
    rows,
    totals: gainTotals(rows),
  }
}

function textTaxRealized(r: Record<string, any>) {
  const t = r.totals
  return [
    `tax:realized — US sales ${r.since}..${r.until}${r.includeGold ? ' (physical gold included)' : ''}: ${r.rows.length} lot(s)`,
    '',
    table(
      ['sold', 'account', 'brokerage', 'ticker', 'qty', 'proceeds USD', 'cost USD', 'gain USD', 'term', 'basis', 'collectible'],
      r.rows.map((row: RealizedRow) => [
        row.soldDate,
        row.account,
        row.brokerage,
        row.kind === 'gold' ? 'KRX gold (g)' : row.ticker,
        row.quantity,
        row.proceedsUsd,
        row.costUsd,
        row.gainUsd,
        row.term,
        row.basis,
        row.collectible ? 'yes' : '',
      ])
    ),
    '',
    `gain USD — short ${t.shortTermUsd} · long ${t.longTermUsd}` +
      (r.includeGold ? ` · collectible short ${t.collectibleShortTermUsd} · collectible long ${t.collectibleLongTermUsd}` : ''),
    '',
    provenanceLines(r.provenance),
  ].join('\n')
}

export const taxRealizedCommand: Command = {
  name: 'tax:realized',
  usage: 'pnpm tax:realized --since YYYY-MM-DD [--until YYYY-MM-DD] [--include-gold] [--json]',
  flags: { since: 'string', until: 'string', 'include-gold': 'boolean' },
  run: runTaxRealized as Command['run'],
  text: textTaxRealized,
}
