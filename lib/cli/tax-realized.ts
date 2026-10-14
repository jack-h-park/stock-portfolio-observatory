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
  account: string
  brokerage: string | null
  ticker: string
  soldDate: string
  quantity: number | null
  proceedsUsd: number | null
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

export function realizedRows(conn: Database.Database, since: string, until: string): RealizedRow[] {
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
  return rows.map((row) => ({
    account: row.account,
    brokerage: row.brokerage,
    ticker: row.ticker,
    soldDate: row.soldDate,
    quantity: round(row.quantity, 6),
    proceedsUsd: usd(row.proceeds),
    gainUsd: usd(row.gain),
    term: term(row.tax_term),
    basis: row.basis,
  }))
}

export function runTaxRealized(flags: ParsedFlags, ctx: CliContext) {
  const since = dateFlag(flags, 'since')
  if (!since) throw new UsageError('--since YYYY-MM-DD is required')
  const until = dateFlag(flags, 'until') ?? todayLosAngeles()
  if (until < since) throw new UsageError(`--until ${until} is before --since ${since}`)
  return {
    provenance: buildProvenance({ conn: ctx.conn, policyState: ctx.policyState, dbPath: ctx.dbPath }),
    since,
    until,
    rows: realizedRows(ctx.conn, since, until),
  }
}

function textTaxRealized(r: Record<string, any>) {
  return [
    `tax:realized — US sales ${r.since}..${r.until}: ${r.rows.length} lot(s)`,
    '',
    table(
      ['sold', 'account', 'brokerage', 'ticker', 'qty', 'proceeds USD', 'gain USD', 'term', 'basis'],
      r.rows.map((row: RealizedRow) => [row.soldDate, row.account, row.brokerage, row.ticker, row.quantity, row.proceedsUsd, row.gainUsd, row.term, row.basis])
    ),
    '',
    provenanceLines(r.provenance),
  ].join('\n')
}

export const taxRealizedCommand: Command = {
  name: 'tax:realized',
  usage: 'pnpm tax:realized --since YYYY-MM-DD [--until YYYY-MM-DD] [--json]',
  flags: { since: 'string', until: 'string' },
  run: runTaxRealized as Command['run'],
  text: textTaxRealized,
}
