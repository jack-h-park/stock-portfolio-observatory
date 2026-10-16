import { checkTargetsAgainstBounds, SLEEVES, type AllocationPolicy, type Sleeve, type SleeveTarget } from '@/lib/rebalance/allocation-policy'

export type LlmSource = { url: string; title: string; date: string }
export type LlmOutlook = {
  summary: string
  drivers: string[]
  risks: string[]
  whatWouldChangeMyView: string[]
  sources: LlmSource[]
  confidence: 'low' | 'medium' | 'high'
}
export type LlmTargetChange = { decision: 'change' | 'hold'; sleeves: Partial<Record<Sleeve, { to: number; reason: string }>> }
export type LlmIdea = { ticker: string; sleeve: Sleeve; why: string }
export type LlmOutput = {
  outlook: LlmOutlook
  targetChange: LlmTargetChange
  ideas: LlmIdea[]
  questionsForMaintainer: string[]
}
export type LlmFailureReason = 'runner_unavailable' | 'runner_failed' | 'timeout' | 'invalid_output'
export type LlmRecord = {
  status: 'ok' | 'failed' | 'skipped'
  /** null only when the step was skipped (`--no-llm`). */
  runner: string | null
  model: string | null
  attempts: { prompt: string; raw: string; errors: string[] }[]
  reason: LlmFailureReason | null
}

export const MAX_TEXT = 2000
export const MAX_ITEMS = 10
const MAX_ECHO = 80
const MAX_RAW = 200_000
const MAX_ATTEMPTS = 50
const MAX_SCAN = 2_000_000
const SUM_TOLERANCE = 0.05
const CONFIDENCE = ['low', 'medium', 'high'] as const

/**
 * Finds the answer object in `raw`. Candidates are, in order: the objects in fenced blocks (```json, then plain ```),
 * then the balanced `{...}` objects in the raw text. The first candidate with a top-level `outlook` key wins, so an
 * echoed prompt's input JSON cannot be taken for the answer; when none has it, the first parseable candidate is used.
 * Work is bounded by an input cap, a candidate-start cap and a total-characters-scanned budget.
 */
export function parseLlmJson(raw: string): unknown | null {
  if (raw.length > MAX_RAW) return null
  const budget = { chars: MAX_SCAN }
  let first: unknown = undefined
  const consider = (found: unknown): boolean => {
    if (first === undefined) first = found
    return isObject(found) && Object.prototype.hasOwnProperty.call(found, 'outlook')
  }
  for (const fence of [/```json[ \t]*\r?\n([\s\S]*?)```/gi, /```[ \t]*\r?\n([\s\S]*?)```/g]) {
    for (const match of raw.matchAll(fence)) {
      for (const found of objectsIn(match[1], budget)) if (consider(found)) return found
    }
  }
  for (const found of objectsIn(raw, budget)) if (consider(found)) return found
  return first === undefined ? null : first
}

/** Each top-level balanced `{...}` in `text` that parses, in order; a parsed object is skipped over whole. */
function* objectsIn(text: string, budget: { chars: number }): Generator<unknown> {
  let from = 0
  let attempts = 0
  while (from < text.length && attempts++ < MAX_ATTEMPTS && budget.chars > 0) {
    const start = text.indexOf('{', from)
    if (start < 0) return
    const end = balancedEnd(text, start, budget)
    if (end >= 0) {
      let parsed: unknown
      let ok = false
      try {
        parsed = JSON.parse(text.slice(start, end + 1))
        ok = true
      } catch {
        // not valid JSON from this brace; try the next one
      }
      if (ok) {
        yield parsed
        from = end + 1
        continue
      }
    }
    from = start + 1
  }
}

function balancedEnd(text: string, start: number, budget: { chars: number }): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    if (--budget.chars < 0) return -1
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i
  }
  return -1
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
/** Quotes and caps a value for an error string. Only primitives are stringified; containers echo a type tag. */
const echo = (v: unknown): string => {
  let s: string
  if (typeof v === 'string') s = v
  else if (Array.isArray(v)) return 'array'
  else if (v === null) return 'null'
  else if (typeof v === 'object') return 'object'
  else s = String(v)
  return JSON.stringify(s.length > MAX_ECHO ? `${s.slice(0, MAX_ECHO)}...` : s)
}

function isIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

type ValidationResult =
  | { ok: true; output: LlmOutput; targets: Record<Sleeve, SleeveTarget> }
  | { ok: false; errors: string[] }

export function validateLlmOutput(value: unknown, policy: AllocationPolicy): ValidationResult {
  try {
    return validate(value, policy)
  } catch {
    return { ok: false, errors: ['internal: validator failed'] }
  }
}

function validate(value: unknown, policy: AllocationPolicy): ValidationResult {
  const errors: string[] = []

  const text = (v: unknown, field: string, opts: { required?: boolean } = {}): string => {
    if (typeof v !== 'string') {
      errors.push(`${field}: must be a string, got ${echo(v)}`)
      return ''
    }
    if (v.length > MAX_TEXT) errors.push(`${field}: longer than ${MAX_TEXT} characters (${v.length})`)
    else if (opts.required && v.trim() === '') errors.push(`${field}: must not be empty`)
    return v
  }
  const list = (v: unknown, field: string): unknown[] => {
    if (!Array.isArray(v)) {
      errors.push(`${field}: must be an array, got ${echo(v)}`)
      return []
    }
    if (v.length > MAX_ITEMS) errors.push(`${field}: more than ${MAX_ITEMS} items (${v.length})`)
    return v.slice(0, MAX_ITEMS)
  }
  const strings = (v: unknown, field: string): string[] => list(v, field).map((item, i) => text(item, `${field}[${i}]`))

  if (!isObject(value)) return { ok: false, errors: ['output: must be a JSON object'] }

  // outlook
  const o = isObject(value.outlook) ? value.outlook : null
  if (!o) errors.push('outlook: must be an object')
  const outlook: LlmOutlook = {
    summary: text(o?.summary, 'outlook.summary', { required: true }),
    drivers: strings(o?.drivers, 'outlook.drivers'),
    risks: strings(o?.risks, 'outlook.risks'),
    whatWouldChangeMyView: strings(o?.whatWouldChangeMyView, 'outlook.whatWouldChangeMyView'),
    sources: [],
    confidence: 'low',
  }
  if (!CONFIDENCE.includes(o?.confidence as never)) {
    errors.push(`outlook.confidence: must be one of low, medium, high, got ${echo(o?.confidence)}`)
  } else outlook.confidence = o?.confidence as LlmOutlook['confidence']
  list(o?.sources, 'outlook.sources').forEach((item, i) => {
    const f = `outlook.sources[${i}]`
    if (!isObject(item)) return void errors.push(`${f}: must be an object`)
    const url = text(typeof item.url === 'string' ? item.url.trim() : item.url, `${f}.url`, { required: true })
    if (typeof item.url === 'string' && !isHttpUrl(url)) errors.push(`${f}.url: must be an absolute http(s) URL, got ${echo(url)}`)
    const title = text(item.title, `${f}.title`, { required: true })
    const date = text(item.date, `${f}.date`, { required: true })
    if (typeof item.date === 'string' && item.date !== '' && !isIsoDate(item.date)) {
      errors.push(`${f}.date: must be a real ISO date YYYY-MM-DD, got ${echo(date)}`)
    }
    outlook.sources.push({ url, title, date })
  })

  // targetChange
  const tc = isObject(value.targetChange) ? value.targetChange : null
  if (!tc) errors.push('targetChange: must be an object')
  const decision = tc?.decision
  if (decision !== 'change' && decision !== 'hold') {
    errors.push(`targetChange.decision: must be "change" or "hold", got ${echo(decision)}`)
  }
  const changed: Partial<Record<Sleeve, { to: number; reason: string }>> = {}
  if (decision === 'change') {
    if (!isObject(tc?.sleeves)) errors.push('targetChange.sleeves: must be an object')
    else {
      for (const [key, entry] of Object.entries(tc.sleeves)) {
        const known = (SLEEVES as readonly string[]).includes(key)
        const f = known ? `targetChange.sleeves.${key}` : `targetChange.sleeves[${echo(key)}]`
        if (!(SLEEVES as readonly string[]).includes(key)) {
          errors.push(`${f}: unknown sleeve, expected one of ${SLEEVES.join(', ')}`)
          continue
        }
        if (!isObject(entry)) {
          errors.push(`${f}: must be an object`)
          continue
        }
        const reason = text(entry.reason, `${f}.reason`, { required: true })
        if (typeof entry.to !== 'number' || !Number.isFinite(entry.to)) {
          errors.push(`${f}.to: must be a number, got ${echo(entry.to)}`)
          continue
        }
        changed[key as Sleeve] = { to: entry.to, reason }
      }
    }
    if (outlook.sources.length === 0) errors.push('outlook.sources: a change needs at least one source')
  } else if (decision === 'hold' && tc?.sleeves !== undefined && !isObject(tc.sleeves)) {
    errors.push('targetChange.sleeves: must be an object')
  }

  // ideas
  const ideas: LlmIdea[] = []
  list(value.ideas, 'ideas').forEach((item, i) => {
    const f = `ideas[${i}]`
    if (!isObject(item)) return void errors.push(`${f}: must be an object`)
    const ticker = text(item.ticker, `${f}.ticker`, { required: true })
    const why = text(item.why, `${f}.why`, { required: true })
    if (!(SLEEVES as readonly string[]).includes(item.sleeve as string)) {
      errors.push(`${f}.sleeve: must be one of ${SLEEVES.join(', ')}, got ${echo(item.sleeve)}`)
      return
    }
    ideas.push({ ticker, sleeve: item.sleeve as Sleeve, why })
  })
  const questionsForMaintainer = strings(value.questionsForMaintainer, 'questionsForMaintainer')

  // merge and check numbers
  const targets = structuredClone(policy.targets)
  if (decision === 'change') {
    for (const sleeve of SLEEVES) {
      const c = changed[sleeve]
      if (c) targets[sleeve] = { ...targets[sleeve], target: c.to }
    }
    if (!errors.some((e) => e.startsWith('targetChange.sleeves'))) {
      const sum = SLEEVES.reduce((acc, s) => acc + targets[s].target, 0)
      if (Math.abs(sum - 100) > SUM_TOLERANCE) {
        errors.push(`targetChange.sleeves: targets sum to ${Math.round(sum * 100) / 100}, expected 100 (omitted sleeves keep their current target)`)
      }
      for (const message of checkTargetsAgainstBounds(policy, targets, { enforceShift: true })) {
        const sleeve = message.slice(0, message.indexOf(':'))
        errors.push(`targetChange.sleeves.${sleeve}.to: ${message.slice(message.indexOf(':') + 2)}`)
      }
    }
  }

  if (errors.length) return { ok: false, errors }
  const finalTargets = decision === 'change' ? targets : policy.targets
  return {
    ok: true,
    output: {
      outlook,
      targetChange: { decision: decision as 'change' | 'hold', sleeves: decision === 'change' ? changed : {} },
      ideas,
      questionsForMaintainer,
    },
    targets: finalTargets,
  }
}
