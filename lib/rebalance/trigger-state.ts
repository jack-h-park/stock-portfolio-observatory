import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/config'
import type { TriggerHit } from './triggers'

/** When each trigger key last fired and how large it was then. Host-owned, never pushed. */
export type TriggerState = { version: 1; fired: Record<string, { at: string; magnitude: number }> }

/** A key fires at most once per this many days... */
export const DEBOUNCE_DAYS = 14
/** ...unless its magnitude has grown by at least this factor since it last fired. */
export const GROWTH_FACTOR = 1.25
const DAY_MS = 86_400_000

const empty = (): TriggerState => ({ version: 1, fired: {} })

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / DAY_MS)
}

/** A missing file is an empty state; an unreadable one throws, so the run fails instead of refiring everything. */
export function readTriggerState(filePath: string = config.stockRebalanceTriggerStatePath): TriggerState {
  if (!fs.existsSync(filePath)) return empty()
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<TriggerState>
  if (raw === null || typeof raw !== 'object' || raw.version !== 1 || raw.fired === null || typeof raw.fired !== 'object') {
    throw new Error(`Trigger state unreadable: ${path.basename(filePath)}`)
  }
  return { version: 1, fired: { ...raw.fired } }
}

/** Written to a temporary file and renamed, so a reader never sees half a file. */
export function writeTriggerState(state: TriggerState, filePath: string = config.stockRebalanceTriggerStatePath): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`)
  fs.renameSync(temporaryPath, filePath)
}

/**
 * The hits that should act today: never fired, fired at least DEBOUNCE_DAYS ago, or grown by GROWTH_FACTOR
 * since. A year-end key names its year and fires once, ever.
 */
export function dueTriggers(hits: TriggerHit[], state: TriggerState, today: string): TriggerHit[] {
  return hits.filter((hit) => {
    const last = state.fired[hit.key]
    if (!last) return true
    if (hit.key.startsWith('yearend:')) return false
    return daysBetween(last.at, today) >= DEBOUNCE_DAYS || hit.magnitude >= last.magnitude * GROWTH_FACTOR
  })
}

/** A copy of `state` with each hit recorded as fired today at its current magnitude. */
export function markFired(state: TriggerState, hits: TriggerHit[], today: string): TriggerState {
  const fired = { ...state.fired }
  for (const hit of hits) fired[hit.key] = { at: today, magnitude: hit.magnitude }
  return { version: 1, fired }
}
