/**
 * Which accounts the database holds, and the span of each kind of record in
 * each one.
 *
 * /data-ops answers "what should I download next" with one cutoff per account.
 * This answers the question before it: which accounts exist at all, and from
 * when to when each table reaches. Kept free of the database so the grouping
 * rule can be tested on its own.
 */

export type RangeKind = 'transactions' | 'dividends' | 'holdings' | 'lots' | 'realized' | 'balances'

/** One table's span for one account name, as the query returns it. */
export type RangeRow = {
  kind: RangeKind
  market: string
  brokerage: string
  account: string
  /** Null where the table has no such column (realized_lots). */
  accountType: string | null
  start: string | null
  end: string | null
  count: number
}

export type DateRange = { start: string | null; end: string | null; count: number }

export type AccountDataRange = {
  id: string
  market: string
  brokerage: string
  name: string
  /** Other names the same account is stored under. */
  aliases: string[]
  accountType: string | null
  ranges: Partial<Record<RangeKind, DateRange>>
  firstDate: string | null
  lastDate: string | null
}

export type AccountRangeSummary = {
  total: number
  byMarket: Record<string, number>
  firstDate: string | null
  lastDate: string | null
}

const MARKET_ORDER = ['KR', 'US', 'CRYPTO', 'CASH']

function minDate(a: string | null, b: string | null) {
  if (!a) return b
  if (!b) return a
  return a < b ? a : b
}

function maxDate(a: string | null, b: string | null) {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}

function mergeRange(previous: DateRange | undefined, next: DateRange): DateRange {
  if (!previous) return { ...next }
  return { start: minDate(previous.start, next.start), end: maxDate(previous.end, next.end), count: previous.count + next.count }
}

export function groupAccountRanges(rows: RangeRow[]): AccountDataRange[] {
  const byName = new Map<string, AccountDataRange>()
  const nameKey = (market: string, brokerage: string, account: string) => `${market}|${brokerage}|${account}`

  for (const row of rows) {
    const key = nameKey(row.market, row.brokerage, row.account)
    let account = byName.get(key)
    if (!account) {
      account = { id: key, market: row.market, brokerage: row.brokerage, name: row.account, aliases: [], accountType: null, ranges: {}, firstDate: null, lastDate: null }
      byName.set(key, account)
    }
    if (!account.accountType && row.accountType) account.accountType = row.accountType
    account.ranges[row.kind] = mergeRange(account.ranges[row.kind], { start: row.start, end: row.end, count: row.count })
  }

  // Robinhood stores one account under two names: its number in the snapshot,
  // its type in the transaction CSVs. A name that is exactly "<brokerage>
  // <type>" is that second spelling, and it folds into the numbered account of
  // the same type — but only when there is exactly one, since with two the
  // history could belong to either.
  for (const alias of [...byName.values()]) {
    const type = alias.accountType
    if (!type || alias.name !== `${alias.brokerage} ${type}`) continue
    const owners = [...byName.values()].filter(
      (other) => other !== alias && other.market === alias.market && other.brokerage === alias.brokerage && other.accountType === type
    )
    if (owners.length !== 1) continue
    const [owner] = owners
    for (const [kind, range] of Object.entries(owner.ranges) as [RangeKind, DateRange][]) {
      alias.ranges[kind] = mergeRange(alias.ranges[kind], range)
    }
    // The type name is what the rest of the app shows for this account, so it
    // stays the heading and the number becomes the alias.
    alias.aliases.push(owner.name, ...owner.aliases)
    byName.delete(owner.id)
  }

  const accounts = [...byName.values()]
  for (const account of accounts) {
    for (const range of Object.values(account.ranges)) {
      if (!range) continue
      account.firstDate = minDate(account.firstDate, range.start)
      account.lastDate = maxDate(account.lastDate, range.end)
    }
  }

  const marketRank = (market: string) => {
    const index = MARKET_ORDER.indexOf(market)
    return index === -1 ? MARKET_ORDER.length : index
  }
  return accounts.sort(
    (a, b) =>
      marketRank(a.market) - marketRank(b.market) ||
      a.brokerage.localeCompare(b.brokerage, 'en') ||
      a.name.localeCompare(b.name, 'en')
  )
}

export function summarizeAccountRanges(accounts: AccountDataRange[]): AccountRangeSummary {
  const byMarket: Record<string, number> = {}
  let firstDate: string | null = null
  let lastDate: string | null = null
  for (const account of accounts) {
    byMarket[account.market] = (byMarket[account.market] ?? 0) + 1
    firstDate = minDate(firstDate, account.firstDate)
    lastDate = maxDate(lastDate, account.lastDate)
  }
  return { total: accounts.length, byMarket, firstDate, lastDate }
}
