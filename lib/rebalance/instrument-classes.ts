import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/config'
import { SLEEVES, type Sleeve } from './allocation-policy'

/** Maps `${market}:${ticker}` to the sleeve that holds its economic exposure. */
export type InstrumentClasses = Record<string, Sleeve>

export function instrumentKey(market: string, ticker: string): string {
  return `${market}:${ticker}`
}

export function getInstrumentClasses(filePath = config.stockInstrumentClassesPath): InstrumentClasses {
  let text: string
  try {
    text = fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  const raw = JSON.parse(text) as Record<string, unknown>
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${filePath}: top level is not an object`)
  const out: InstrumentClasses = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('_')) continue
    if (typeof value !== 'string' || !(SLEEVES as readonly string[]).includes(value)) {
      throw new Error(`${filePath}: ${key} maps to an unknown sleeve`)
    }
    out[key] = value as Sleeve
  }
  return out
}

export function saveInstrumentClasses(classes: InstrumentClasses, filePath = config.stockInstrumentClassesPath): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(classes, null, 2)}\n`)
  fs.renameSync(temporaryPath, filePath)
}

/** Gold and crypto classify by themselves; any other security needs a mapping. Nothing is guessed. */
export function classify(
  row: { market: string; ticker: string; asset_class?: string | null },
  classes: InstrumentClasses,
): Sleeve | null {
  if (row.asset_class === 'gold') return 'gold'
  if (row.market === 'CRYPTO') return 'crypto'
  return classes[instrumentKey(row.market, row.ticker)] ?? null
}
