/**
 * Large events behind the total-assets trend: money that arrived from outside,
 * and investment episodes. An episode runs while a ticker's open cost basis
 * stays at or above EPISODE_FLOOR_KRW, so a small observation lot left after
 * selling out does not keep it open.
 */
export const EVENT_THRESHOLD_KRW = 10_000_000
export const EPISODE_FLOOR_KRW = 1_000_000

export type EpisodeLot = { id: number; market: string; ticker: string; name: string; acquiredDate: string; costKrw: number }
export type ClosedLot = EpisodeLot & { soldDate: string; realizedKrw: number }
export type OpenLot = EpisodeLot & { marketValueKrw: number | null; estimatedTaxKrw: number | null }
export type DividendRow = { market: string; ticker: string; date: string; amountKrw: number }
export type InvestmentEpisode = {
  kind: 'investment'
  market: string
  ticker: string
  name: string
  start: string
  end: string | null
  peakCostKrw: number
  realizedKrw: number
  unrealizedKrw: number
  dividendsKrw: number
  gainKrw: number
  estimatedTaxKrw: number | null
  unpricedLots: number
}

export function buildInvestmentEpisodes({
  closed,
  open,
  dividends,
  floorKrw = EPISODE_FLOOR_KRW,
}: {
  closed: ClosedLot[]
  open: OpenLot[]
  dividends: DividendRow[]
  floorKrw?: number
}): InvestmentEpisode[] {
  const key = (row: { market: string; ticker: string }) => `${row.market}\t${row.ticker}`
  const keys = [...new Set([...closed, ...open].map(key))].sort()
  const out: InvestmentEpisode[] = []
  for (const k of keys) {
    const c = closed.filter((row) => key(row) === k)
    const o = open.filter((row) => key(row) === k)
    const days = new Map<string, number>()
    const bump = (date: string, delta: number) => days.set(date, (days.get(date) ?? 0) + delta)
    for (const row of [...c, ...o]) bump(row.acquiredDate, row.costKrw)
    for (const row of c) bump(row.soldDate, -row.costKrw)
    // Episodes as [start, end] spans of the running end-of-day cost.
    const spans: { start: string; end: string | null; peak: number }[] = []
    let running = 0
    let current: { start: string; end: string | null; peak: number } | null = null
    for (const date of [...days.keys()].sort()) {
      running += days.get(date)!
      if (Math.abs(running) < 0.5) running = 0
      if (!current && running >= floorKrw) current = { start: date, end: null, peak: running }
      else if (current && running >= floorKrw) current.peak = Math.max(current.peak, running)
      else if (current && running < floorKrw) {
        current.end = date
        spans.push(current)
        current = null
      }
    }
    if (current) spans.push(current)
    if (!spans.length) continue
    const spanFor = (date: string) => {
      const inside = spans.findIndex((span) => date >= span.start && date <= (span.end ?? '9999-12-31'))
      if (inside >= 0) return inside
      const next = spans.findIndex((span) => span.start > date)
      return next >= 0 ? next : spans.length - 1
    }
    const first = (c[0] ?? o[0])!
    const episodes = spans.map((span): InvestmentEpisode => ({
      kind: 'investment', market: first.market, ticker: first.ticker, name: first.name,
      start: span.start, end: span.end, peakCostKrw: span.peak,
      realizedKrw: 0, unrealizedKrw: 0, dividendsKrw: 0, gainKrw: 0, estimatedTaxKrw: null, unpricedLots: 0,
    }))
    for (const row of c) episodes[spanFor(row.acquiredDate)].realizedKrw += row.realizedKrw
    for (const row of o) {
      const episode = episodes[spanFor(row.acquiredDate)]
      if (row.marketValueKrw == null) episode.unpricedLots += 1
      else episode.unrealizedKrw += row.marketValueKrw - row.costKrw
      if (row.estimatedTaxKrw != null) episode.estimatedTaxKrw = (episode.estimatedTaxKrw ?? 0) + row.estimatedTaxKrw
    }
    for (const row of dividends.filter((d) => key(d) === k)) {
      const inside = spans.findIndex((span) => row.date >= span.start && row.date <= (span.end ?? '9999-12-31'))
      if (inside >= 0) episodes[inside].dividendsKrw += row.amountKrw
    }
    for (const episode of episodes) episode.gainKrw = episode.realizedKrw + episode.unrealizedKrw + episode.dividendsKrw
    out.push(...episodes)
  }
  return out
}
