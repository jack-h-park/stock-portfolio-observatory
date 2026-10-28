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
    // A 1099-B row carries the form's long description; a statement row the short name.
    const name = [...c, ...o].map((row) => row.name).filter(Boolean).sort((a, b) => a.length - b.length)[0] ?? first.ticker
    const episodes = spans.map((span): InvestmentEpisode => ({
      kind: 'investment', market: first.market, ticker: first.ticker, name,
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
    // A dividend belongs to the latest period that began on or before it: one paid
    // after a sell-out (a Korean year-end dividend arrives in April) or on a
    // leftover observation lot was earned by that period's shares. One before
    // the first period was earned below the floor and counts nowhere.
    for (const row of dividends.filter((d) => key(d) === k)) {
      const owner = spans.findLastIndex((span) => span.start <= row.date)
      if (owner >= 0) episodes[owner].dividendsKrw += row.amountKrw
    }
    for (const episode of episodes) episode.gainKrw = episode.realizedKrw + episode.unrealizedKrw + episode.dividendsKrw
    out.push(...episodes)
  }
  return out
}

export type InflowEvent = { kind: 'inflow'; start: string; end: string; label: string | null; category: string | null; amountKrw: number; arrivals: number }
export type AssetEvent = InflowEvent | InvestmentEpisode

/** Inflows of at least the threshold and episodes whose gain is at least ± the threshold, by start date, an inflow before an episode on the same day. */
export function mergeAssetEvents(inflows: InflowEvent[], episodes: InvestmentEpisode[], thresholdKrw = EVENT_THRESHOLD_KRW): AssetEvent[] {
  return [...inflows.filter((e) => e.amountKrw >= thresholdKrw), ...episodes.filter((e) => Math.abs(e.gainKrw) >= thresholdKrw)].sort(
    (a, b) => a.start.localeCompare(b.start) || (a.kind === b.kind ? 0 : a.kind === 'inflow' ? -1 : 1)
  )
}

export type EventMarker = { n: number; date: string; event: AssetEvent }

/**
 * Numbers the events from 1 in list order and places each on the chart's x axis,
 * which is the list of plotted dates: the first date on or after the event's
 * start, or the last date for an event after every point.
 */
export function snapEventDates(events: AssetEvent[], pointDates: string[]): EventMarker[] {
  const dates = [...pointDates].sort()
  return events.map((event, i) => ({ n: i + 1, date: dates.find((d) => d >= event.start) ?? dates.at(-1) ?? event.start, event }))
}

/**
 * The markers a chart draws: one line per plotted date, labelled with the
 * numbers of the events on it. An event that starts before the first plotted
 * date (a range that does not reach back to it) gets no marker; it stays in the list.
 */
export function chartMarkers(markers: EventMarker[], firstDate: string | undefined): { date: string; label: string }[] {
  const byDate = new Map<string, number[]>()
  for (const m of markers) {
    if (!firstDate || m.event.start < firstDate) continue
    byDate.set(m.date, [...(byDate.get(m.date) ?? []), m.n])
  }
  return [...byDate.entries()].map(([date, ns]) => ({ date, label: ns.join(',') }))
}

/**
 * The tax planner's aggregate tax for selling every open lot now, shared out by
 * each lot's share of the positive gain. The aggregate applies the deduction,
 * loss netting and the cross-border credit; a lot's own flat-rate figure does
 * not. A lot at a loss carries none, and an unvalued lot (gain null) gets null.
 */
export function allocateTax(lots: { id: number; gainKrw: number | null }[], totalTaxKrw: number): Map<number, number | null> {
  const positive = lots.reduce((sum, lot) => sum + Math.max(lot.gainKrw ?? 0, 0), 0)
  return new Map(
    lots.map((lot) => [lot.id, lot.gainKrw == null ? null : positive > 0 ? (totalTaxKrw * Math.max(lot.gainKrw, 0)) / positive : 0])
  )
}
