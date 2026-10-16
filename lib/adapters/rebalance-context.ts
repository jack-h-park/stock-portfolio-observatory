import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/config'

export type MacroNote = { date: string; macro: string }
export type BriefingContext = { macro: MacroNote[]; benchmarks: unknown | null }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000
/** Same guard as the briefing archive adapter: newer documents are refused, not guessed at. */
const SCHEMA_VERSION = 2

/**
 * The briefing archive's macro narrative for the last `days` days up to `today`, oldest first, and
 * the benchmarks file beside it. Every failure (absent directory, unreadable day, bad file) costs
 * only the piece it touches; the result is always a usable, possibly empty, context.
 */
export function readBriefingContext(today: string, days = 30, dir: string = config.stockBriefingArchiveDir): BriefingContext {
  const empty: BriefingContext = { macro: [], benchmarks: null }
  if (!ISO_DATE.test(today)) return empty
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10)
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return empty
  }
  const macro: MacroNote[] = []
  for (const name of names.filter((f) => f.endsWith('.json') && ISO_DATE.test(f.slice(0, -5))).sort()) {
    const date = name.slice(0, -5)
    if (date < since || date > today) continue
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as {
        schemaVersion?: number
        narrative?: { macro?: unknown }
      }
      if (!(typeof doc.schemaVersion === 'number') || doc.schemaVersion > SCHEMA_VERSION || doc.schemaVersion < 1) continue
      const text = doc.narrative?.macro
      if (typeof text === 'string' && text.trim()) macro.push({ date, macro: text })
    } catch {
      continue
    }
  }
  let benchmarks: unknown | null = null
  try {
    benchmarks = JSON.parse(fs.readFileSync(path.join(dir, 'benchmarks.json'), 'utf8')) as unknown
  } catch {
    benchmarks = null
  }
  return { macro, benchmarks }
}
