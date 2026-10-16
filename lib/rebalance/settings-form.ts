import example from '@/data/allocation-policy.example.json'
import {
  SLEEVES,
  validateAllocationPolicy,
  type AccountRule,
  type AllocationPolicy,
  type LotMethod,
  type PreferredInstrument,
  type Sleeve,
} from './allocation-policy'
import type { InstrumentClasses } from './instrument-classes'

const SCALARS = [
  'positionCapPct',
  'maxTargetShiftPctPerCycle',
  'maxTurnoverPctPerProposal',
  'minTradeKrw',
  'staleDataDays',
  'harvestThresholdKrw',
] as const
const LOT_METHODS: readonly LotMethod[] = ['fifo', 'specific', 'average']

/** Where a first save starts: every sleeve at 0 with bounds 0-100 and band 5, and the scalar limits from the example file. */
export function emptyAllocationPolicy(): AllocationPolicy {
  const sleeves = {} as AllocationPolicy['bounds']['sleeves']
  const targets = {} as AllocationPolicy['targets']
  for (const sleeve of SLEEVES) {
    sleeves[sleeve] = { min: 0, max: 100 }
    targets[sleeve] = { target: 0, band: 5 }
  }
  const bounds = example.bounds
  return {
    version: 1,
    bounds: {
      sleeves,
      positionCapPct: bounds.positionCapPct,
      maxTargetShiftPctPerCycle: bounds.maxTargetShiftPctPerCycle,
      maxTurnoverPctPerProposal: bounds.maxTurnoverPctPerProposal,
      minTradeKrw: bounds.minTradeKrw,
      staleDataDays: bounds.staleDataDays,
      harvestThresholdKrw: bounds.harvestThresholdKrw,
    },
    targets,
    preferredInstruments: {},
    accounts: {},
    history: [],
  }
}

function readNumber(form: FormData, name: string, label: string, errors: string[]): number | null {
  const raw = form.get(name)
  const text = typeof raw === 'string' ? raw.trim() : ''
  const value = text === '' ? Number.NaN : Number(text)
  if (!Number.isFinite(value)) {
    errors.push(`${label}: must be a number`)
    return null
  }
  return value
}

const hasAny = (form: FormData, prefix: string) => Array.from(form.keys()).some((key) => key.startsWith(prefix))

/** One `market:ticker@brokerage::account` per line; the brokerage may be empty. */
export function parseBuyList(text: string, label: string, errors: string[]): PreferredInstrument[] {
  const out: PreferredInstrument[] = []
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim()
    if (!line) return
    const colon = line.indexOf(':')
    const at = line.indexOf('@')
    const split = at === -1 ? -1 : line.indexOf('::', at + 1)
    const market = colon > 0 ? line.slice(0, colon).trim() : ''
    const ticker = colon > 0 && at > colon ? line.slice(colon + 1, at).trim() : ''
    const brokerage = split > at ? line.slice(at + 1, split).trim() : ''
    const account = split > at ? line.slice(split + 2).trim() : ''
    if (!market || !ticker || !account) {
      errors.push(`${label} buy list line ${index + 1}: expected market:ticker@brokerage::account`)
      return
    }
    out.push({ market, ticker, brokerage: brokerage || null, account })
  })
  return out
}

/**
 * Applies whichever sections the form carries (bounds and targets, limits, accounts, buy lists) to a copy of the
 * current policy. On any error the unchanged base is returned, so a caller can never save a half-applied edit.
 * History is left alone: recording a target change is the caller's job (applyTargets).
 */
export function policyFromSettingsForm(
  form: FormData,
  current: AllocationPolicy | null,
): { policy: AllocationPolicy; errors: string[] } {
  const base = current ?? emptyAllocationPolicy()
  const next = structuredClone(base)
  const errors: string[] = []

  if (['min_', 'max_', 'target_', 'band_'].some((prefix) => hasAny(form, prefix))) {
    for (const sleeve of SLEEVES) {
      const min = readNumber(form, `min_${sleeve}`, `${sleeve} min`, errors)
      const max = readNumber(form, `max_${sleeve}`, `${sleeve} max`, errors)
      const target = readNumber(form, `target_${sleeve}`, `${sleeve} target`, errors)
      const band = readNumber(form, `band_${sleeve}`, `${sleeve} band`, errors)
      if (min != null && max != null) next.bounds.sleeves[sleeve] = { min, max }
      if (target != null && band != null) next.targets[sleeve] = { target, band }
    }
  }

  if (SCALARS.some((name) => form.has(name))) {
    for (const name of SCALARS) {
      const value = readNumber(form, name, name, errors)
      if (value != null) next.bounds[name] = value
    }
  }

  if (hasAny(form, 'acct_key_')) {
    for (let i = 0; form.has(`acct_key_${i}`); i++) {
      const key = String(form.get(`acct_key_${i}`) ?? '').trim()
      const lot = String(form.get(`acct_lot_${i}`) ?? '').trim()
      if (!key.includes('::')) {
        errors.push(`account ${i + 1}: unrecognized account key`)
        continue
      }
      if (!(LOT_METHODS as readonly string[]).includes(lot)) {
        errors.push(`account ${i + 1}: unknown lot method`)
        continue
      }
      const managedBy = String(form.get(`acct_managedBy_${i}`) ?? '').trim()
      const rule: AccountRule = {
        lotMethod: lot as LotMethod,
        fractional: form.has(`acct_fractional_${i}`),
        managedBy: managedBy || null,
        excludedCash: form.has(`acct_excluded_${i}`),
      }
      next.accounts[key] = rule
    }
  }

  if (hasAny(form, 'buy_')) {
    for (const sleeve of SLEEVES) {
      if (!form.has(`buy_${sleeve}`)) continue
      const entries = parseBuyList(String(form.get(`buy_${sleeve}`) ?? ''), sleeve, errors)
      if (entries.length) next.preferredInstruments[sleeve] = entries
      else delete next.preferredInstruments[sleeve]
    }
  }

  if (!errors.length) errors.push(...validateAllocationPolicy(next))
  return errors.length ? { policy: base, errors } : { policy: next, errors }
}

/** One `class_<market>:<ticker>` field per security; an empty value removes the mapping. Keys not on the form are kept. */
export function classesFromSettingsForm(
  form: FormData,
  current: InstrumentClasses,
): { classes: InstrumentClasses; errors: string[] } {
  const next: InstrumentClasses = { ...current }
  const errors: string[] = []
  for (const [name, raw] of form.entries()) {
    if (!name.startsWith('class_')) continue
    const key = name.slice('class_'.length)
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (value === '') delete next[key]
    else if ((SLEEVES as readonly string[]).includes(value)) next[key] = value as Sleeve
    else errors.push(`${key}: unknown sleeve`) // key is data: summarizeErrors keeps it out of URLs
  }
  return errors.length ? { classes: current, errors } : { classes: next, errors }
}

export const ERROR_CODES = [
  'targets_sum',
  'target_bounds',
  'bounds_invalid',
  'number_invalid',
  'account_invalid',
  'buy_list_line',
  'classes_invalid',
  'write_failed',
  'policy_unreadable',
] as const
export type SettingsErrorCode = (typeof ERROR_CODES)[number]

/**
 * Reduces parser messages to fixed codes (plus the first buy-list line number) so nothing from the form,
 * such as a ticker, reaches a URL. The full messages stay server-side.
 */
export function summarizeErrors(errors: string[]): { codes: SettingsErrorCode[]; line: number | null } {
  const codes = new Set<SettingsErrorCode>()
  let line: number | null = null
  for (const message of errors) {
    const buy = /buy list line (\d+)/.exec(message)
    if (buy) {
      codes.add('buy_list_line')
      line ??= Number(buy[1])
    } else if (/sum to/.test(message)) codes.add('targets_sum')
    else if (/is outside bounds/.test(message)) codes.add('target_bounds')
    else if (/must be a number/.test(message)) codes.add('number_invalid')
    else if (/^account \d+:/.test(message)) codes.add('account_invalid')
    else if (/unknown sleeve/.test(message)) codes.add('classes_invalid')
    else codes.add('bounds_invalid')
  }
  return { codes: Array.from(codes), line }
}

/** A saved policy that cannot be read must never be silently replaced by a form built from the empty base. */
export function policyWriteGuard(state: { error: string | null }): SettingsErrorCode | null {
  return state.error ? 'policy_unreadable' : null
}
