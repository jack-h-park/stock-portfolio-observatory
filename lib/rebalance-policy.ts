import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/config'

/**
 * The KR/US split the rebalance view measures against.
 *
 * One number is stored: the US share. KR is whatever is left, so the two always
 * sum to 100 and a saved file can never describe a policy the page cannot draw.
 * It used to be a constant inside getRebalanceReview(), which made "I want more
 * US" a code change.
 */
export const DEFAULT_US_TARGET_PCT = 50

export type RebalanceMarketTarget = { market: string; targetPct: number }

export type RebalancePolicy = {
  usTargetPct: number
  marketTargets: RebalanceMarketTarget[]
  updatedAt: string | null
  source: 'saved' | 'default'
}

/** Clamp to 0–100 and keep one decimal. Anything that is not a number is `null`. */
export function parseUsTargetPct(raw: unknown): number | null {
  if (raw == null || raw === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value)) return null
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10
}

export function marketTargetsFor(usTargetPct: number): RebalanceMarketTarget[] {
  // Rounded again so 100 - 33.3 prints as 66.7, not 66.7 plus float noise.
  return [
    { market: 'KR', targetPct: Math.round((100 - usTargetPct) * 10) / 10 },
    { market: 'US', targetPct: usTargetPct },
  ]
}

export function getRebalancePolicy(filePath = config.stockRebalancePolicyPath): RebalancePolicy {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { usTargetPct?: unknown }
    const saved = parseUsTargetPct(raw.usTargetPct)
    if (saved != null) {
      return {
        usTargetPct: saved,
        marketTargets: marketTargetsFor(saved),
        updatedAt: new Date(fs.statSync(filePath).mtimeMs).toISOString(),
        source: 'saved',
      }
    }
  } catch {
    // Missing or unreadable: fall through to the default rather than break the page.
  }
  return {
    usTargetPct: DEFAULT_US_TARGET_PCT,
    marketTargets: marketTargetsFor(DEFAULT_US_TARGET_PCT),
    updatedAt: null,
    source: 'default',
  }
}

export function saveRebalancePolicy(usTargetPct: number, filePath = config.stockRebalancePolicyPath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify({ version: 1, usTargetPct }, null, 2)}\n`)
  fs.renameSync(temporaryPath, filePath)
}
