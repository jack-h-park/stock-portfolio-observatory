import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/config'

// Read-only view of the daily portfolio briefing archive.
//
// The briefing pipeline (jack-h-park/stock-portfolio-briefing, a Hermes cron on
// the iMac) writes one self-contained document per trading day and publishes the
// same content to briefing.jackpark.me. This adapter is the second reader of
// that same directory, so the LAN dashboard and the public-URL site can never
// show different numbers for a date.
//
// Every document is already fully derived — rows parsed, aggregates computed —
// so nothing here re-implements the holdings sheet's column layout or the
// mover-selection rules. Deliberate: those rules living in two codebases is
// exactly how the page and the research agent used to disagree.
//
// This module only ever reads. The archive is not part of the Observatory's
// config write surface and must never be written from the app.

/**
 * Schema this reader understands. A document written by NEWER code is refused
 * rather than guessed at; an older one is upgraded in memory (see `upgrade`),
 * so raising this never orphans days already archived.
 */
const SCHEMA_VERSION = 2

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** How soon an action deserves attention — a time horizon, independent of `kind`. */
export type BriefingPriority = 'act-now' | 'this-week' | 'fyi'

export type BriefingAction = {
  kind: 'trim' | 'watch' | 'hold' | string
  /** Absent on documents archived before the field existed; treat as 'fyi'. */
  priority?: BriefingPriority | string
  head: string
  body: string
}

export type BriefingMoverNote = { why: string; dir?: 'up' | 'down' }

export type BriefingPosition = {
  ticker: string
  /** The sheet's company name, where it has one (the Korean sheet does). */
  name?: string | null
  cost: number
  gl: number
  pct: number
  quantity: number
  currentPrice: number | null
  marketValue: number
  accounts: string[]
}

/** One position's price move since the previous archived snapshot. */
export type BriefingSessionMove = {
  ticker: string
  name?: string | null
  pctChange: number
  valueChange: number
  priceFrom: number
  priceTo: number
  quantity: number
  marketValue: number
}

/** A share-count change between snapshots — a trade the sheet revealed. */
export type BriefingActivity = {
  ticker: string
  kind: 'bought' | 'sold' | 'opened' | 'closed'
  quantityChange: number
  quantity: number
  cost: number
}

/**
 * Day-over-day view, derived by the writer from consecutive snapshots.
 * Absent on documents archived before the field existed; `available: false`
 * when there was nothing to compare against.
 */
export type BriefingSession = {
  available: boolean
  reason: string | null
  previousDate: string | null
  marketClosed: boolean
  totals: {
    pl: number
    plPct: number
    priorMarketValue: number
    coveredPositions: number
    uncoveredPositions: number
  } | null
  gainers: BriefingSessionMove[]
  losers: BriefingSessionMove[]
  activity: BriefingActivity[]
}

export type BriefingTotals = {
  cost: number
  gl: number
  pct: number
  marketValue: number
  positions: number
  rows: number
}

/**
 * One market's portfolio for the day. US and Korean holdings are kept apart
 * end to end: different currencies, different trading sessions, and the
 * briefing carries no FX snapshot, so their figures are never combined.
 */
export type BriefingMarket = {
  id: string
  label: string
  flag: string
  currency: string
  symbol: string
  /** Decimal places for prices in this currency — KRW has none. */
  priceDigits: number
  /** Size floor for mover selection, in THIS market's currency. */
  moverMinCost: number
  holdings: {
    available: boolean
    markdown: string | null
    rows: {
      account: string
      ticker: string
      name?: string | null
      quantity: number | null
      avgCost: number | null
      totalCost: number
      currentPrice: number | null
      glAmount: number
      glPct: number
    }[]
  }
  aggregates: {
    totals: BriefingTotals
    positions: BriefingPosition[]
    gainers: BriefingPosition[]
    losers: BriefingPosition[]
    largest: BriefingPosition[]
  } | null
  /** Null on documents archived before the session view existed. */
  session: BriefingSession | null
}

export type BriefingDocument = {
  schemaVersion: number
  date: string
  dateLabel: string
  generatedAt: string
  narrative: {
    macro: string
    moverNotes: Record<string, BriefingMoverNote>
    actions: BriefingAction[]
  }
  markets: BriefingMarket[]
}

export type BriefingArchiveStatus = {
  dir: string
  /** False when the directory is absent — a dev checkout, or the path is unset. */
  present: boolean
  dates: string[]
}

/**
 * What the archive currently holds, newest first.
 * A missing directory is a normal state (dev checkout, archive not yet
 * created), not an error — the page explains it rather than crashing.
 */
export function getArchiveStatus(): BriefingArchiveStatus {
  const dir = config.stockBriefingArchiveDir
  if (!fs.existsSync(dir)) return { dir, present: false, dates: [] }
  const dates = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && ISO_DATE.test(f.slice(0, -5)))
    .map((f) => f.slice(0, -5))
    .sort()
    .reverse()
  return { dir, present: true, dates }
}

/**
 * Read one archived briefing. Returns null when the date is absent or the file
 * cannot be read/parsed — a single bad document must cost that day, not the page.
 */
export function getBriefing(date: string): BriefingDocument | null {
  if (!ISO_DATE.test(date)) return null
  const file = path.join(config.stockBriefingArchiveDir, `${date}.json`)
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as BriefingDocument & Record<string, any>
    if (doc.schemaVersion > SCHEMA_VERSION || doc.schemaVersion < 1) return null
    return upgrade(doc)
  } catch {
    return null
  }
}

/**
 * Bring a v1 document up to the current shape, in memory only.
 * v1 held exactly one portfolio, inline, and it was always the US sheet.
 * Mirrors the writer's own upgrade so neither reader orphans the archive.
 */
function upgrade(doc: BriefingDocument & Record<string, any>): BriefingDocument {
  if (doc.schemaVersion !== 1) return doc
  return {
    ...doc,
    schemaVersion: SCHEMA_VERSION,
    markets: [
      {
        id: 'US',
        label: 'US',
        flag: '\u{1F1FA}\u{1F1F8}',
        currency: 'USD',
        symbol: '$',
        priceDigits: 2,
        moverMinCost: 300,
        holdings: doc.holdings ?? { available: false, markdown: null, rows: [] },
        aggregates: doc.aggregates ?? null,
        session: doc.session ?? null,
      },
    ],
  }
}

/** The public URL for a given briefing date on briefing.jackpark.me. */
export function publicBriefingUrl(date: string, isLatest: boolean) {
  return isLatest ? 'https://briefing.jackpark.me/' : `https://briefing.jackpark.me/${date}/`
}
