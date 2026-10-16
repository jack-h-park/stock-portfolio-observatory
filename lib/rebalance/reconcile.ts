import Database from 'better-sqlite3'
import { config } from '@/config'
import { allAssetsTable, selfOnlyAnd } from '@/lib/adapters/portfolio-db'
import { accountKey } from '@/lib/rebalance/allocation-policy'
import type { Proposal, ReconciliationResult } from '@/lib/rebalance/proposal-store'

export type { ReconciliationResult }
export type TxRow = {
  brokerage: string | null
  account: string
  market: string
  ticker: string
  type: string
  date: string
  quantity: number
}

const DAY_MS = 86_400_000
const DATE_WINDOW_DAYS = 3
const QTY_PCT = 0.01
const QTY_SHARES = 1

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS)
const tradeSide = (type: string): 'buy' | 'sell' | null => {
  const t = type.trim().toUpperCase()
  return t === 'BUY' ? 'buy' : t === 'SELL' ? 'sell' : null
}

function quantityMatches(planned: number, actual: number): boolean {
  const diff = Math.abs(planned - actual)
  return diff <= planned * QTY_PCT + 1e-9 || diff <= QTY_SHARES + 1e-9
}

/**
 * Compares a proposal's executed fills with the ingested transactions. Transfers are never matched
 * (the ingest has no record of a bank move at this grain) and do not count against `complete`.
 */
export function reconcile(p: Proposal, txs: TxRow[], today: string): ReconciliationResult {
  const since = dayNumber(p.createdAt)
  const candidates = txs.filter((t) => tradeSide(t.type) !== null && dayNumber(t.date) >= since)
  const used = new Set<number>()
  const matched: ReconciliationResult['matched'] = []
  const missing: ReconciliationResult['missing'] = []

  for (const instruction of p.plan.instructions) {
    if (instruction.kind === 'transfer') continue
    const fill = p.fills[instruction.id]
    if (!fill || fill.status !== 'executed' || fill.date === null || fill.quantity === null) continue
    const fillDay = dayNumber(fill.date)
    let best = -1
    let bestGap = Infinity
    candidates.forEach((t, index) => {
      if (used.has(index)) return
      if (t.account !== instruction.account || (t.brokerage ?? null) !== (instruction.brokerage ?? null)) return
      if (t.market !== instruction.market || t.ticker !== instruction.ticker) return
      if (tradeSide(t.type) !== instruction.kind) return
      const gap = Math.abs(dayNumber(t.date) - fillDay)
      if (gap > DATE_WINDOW_DAYS || !quantityMatches(fill.quantity as number, t.quantity)) return
      if (gap < bestGap) {
        best = index
        bestGap = gap
      }
    })
    if (best >= 0) {
      used.add(best)
      matched.push({ instructionId: instruction.id, txDate: candidates[best].date })
    } else {
      missing.push({ instructionId: instruction.id, daysSinceFill: dayNumber(today) - fillDay })
    }
  }

  const planAccounts = new Set(p.plan.instructions.map((i) => accountKey(i.brokerage, i.account)))
  const unplanned = candidates.filter((t, index) => !used.has(index) && planAccounts.has(accountKey(t.brokerage, t.account)))
  return { at: new Date().toISOString(), matched, missing, unplanned, complete: missing.length === 0 }
}

/** The maintainer's own BUY/SELL rows dated on or after `sinceDate`. */
export function loadTransactions(sinceDate: string, dbPath: string = config.stockDbPath): TxRow[] {
  const conn = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const table = allAssetsTable(conn, 'transactions')
    return conn
      .prepare(
        `select brokerage, account, market, ticker, type, date, coalesce(quantity, 0) as quantity from ${table}
          where upper(type) in ('BUY', 'SELL') and ticker is not null and date >= ?${selfOnlyAnd(conn, table)}
          order by date, account, ticker`
      )
      .all(sinceDate) as TxRow[]
  } finally {
    conn.close()
  }
}
