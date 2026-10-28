import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/config'

export const SLEEVES = ['kr_equity', 'us_equity', 'bonds', 'gold', 'crypto', 'cash'] as const
export type Sleeve = (typeof SLEEVES)[number]
export type SleeveBounds = { min: number; max: number }
export type SleeveTarget = { target: number; band: number }
export type LotMethod = 'fifo' | 'specific' | 'average'
export type AccountRule = { lotMethod: LotMethod; fractional: boolean; managedBy: string | null; excludedCash: boolean }
export type PreferredInstrument = { market: string; ticker: string; brokerage: string | null; account: string }
/** Facts about the maintainer that limit what may be suggested. A US tax person should not hold non-US funds (PFIC). */
export type InvestorProfile = { usTaxPerson: boolean }
/** An ISA is a Korean tax shelter only; to a US tax person it is an ordinary taxable account, so it can join the plan. */
export type RebalanceScope = { includeIsa: boolean }
export type AllocationPolicy = {
  version: 1
  bounds: {
    sleeves: Record<Sleeve, SleeveBounds>
    positionCapPct: number
    maxTargetShiftPctPerCycle: number
    maxTurnoverPctPerProposal: number
    minTradeKrw: number
    staleDataDays: number
    harvestThresholdKrw: number
  }
  targets: Record<Sleeve, SleeveTarget>
  preferredInstruments: Partial<Record<Sleeve, PreferredInstrument[]>>
  accounts: Record<string, AccountRule>
  /** Absent in policies saved before it existed; read as "not a US tax person". */
  investor?: InvestorProfile
  /** Which account wrappers the plan covers beyond taxable ones. Absent: taxable only. */
  scope?: RebalanceScope
  history: { at: string; by: string; changes: Partial<Record<Sleeve, [number, number]>> }[]
}
export type AllocationPolicyState = { policy: AllocationPolicy | null; source: 'saved' | 'missing'; error: string | null }

const SUM_TOLERANCE = 0.05
const SCALAR_BOUNDS = [
  'positionCapPct',
  'maxTargetShiftPctPerCycle',
  'maxTurnoverPctPerProposal',
  'minTradeKrw',
  'staleDataDays',
  'harvestThresholdKrw',
] as const

/** The account wrappers a plan reads: taxable always, ISA when the policy includes it. */
export function rebalanceWrappers(p: Pick<AllocationPolicy, 'scope'> | null | undefined): string[] {
  return p?.scope?.includeIsa ? ['taxable', 'isa'] : ['taxable']
}

/** Accounts are identified by the (brokerage, account) pair exactly as stored. */
export function accountKey(brokerage: string | null, account: string): string {
  return `${brokerage ?? ''}::${account}`
}

export function defaultAccountRule(market: string): AccountRule {
  return { lotMethod: 'fifo', fractional: market === 'CRYPTO', managedBy: null, excludedCash: false }
}

const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export function validateAllocationPolicy(p: AllocationPolicy): string[] {
  const errors: string[] = []
  let sum = 0
  for (const sleeve of SLEEVES) {
    const bounds = p.bounds?.sleeves?.[sleeve]
    const target = p.targets?.[sleeve]
    if (!bounds) errors.push(`${sleeve}: missing from bounds.sleeves`)
    if (!target) errors.push(`${sleeve}: missing from targets`)
    if (bounds) {
      if (!isNum(bounds.min) || !isNum(bounds.max)) {
        errors.push(`${sleeve}: bounds min and max must be numbers`)
      } else {
        if (bounds.min < 0 || bounds.max > 100) errors.push(`${sleeve}: bounds must lie within 0-100`)
        if (bounds.min > bounds.max) errors.push(`${sleeve}: bounds min ${bounds.min} exceeds max ${bounds.max}`)
      }
    }
    if (target) {
      if (!isNum(target.target) || !isNum(target.band)) {
        errors.push(`${sleeve}: target and band must be numbers`)
      } else {
        sum += target.target
        if (target.band <= 0) errors.push(`${sleeve}: band must be greater than 0`)
        if (bounds && isNum(bounds.min) && isNum(bounds.max) && (target.target < bounds.min || target.target > bounds.max)) {
          errors.push(`${sleeve}: target ${target.target} is outside bounds ${bounds.min}-${bounds.max}`)
        }
      }
    }
  }
  for (const key of SCALAR_BOUNDS) {
    const value = p.bounds?.[key]
    if (!isNum(value) || value < 0) errors.push(`${key}: must be a number >= 0`)
  }
  if (p.investor !== undefined && (p.investor === null || typeof p.investor !== 'object' || typeof p.investor.usTaxPerson !== 'boolean')) {
    errors.push('investor.usTaxPerson: must be true or false')
  }
  if (p.scope !== undefined && (p.scope === null || typeof p.scope !== 'object' || typeof p.scope.includeIsa !== 'boolean')) {
    errors.push('scope.includeIsa: must be true or false')
  }
  if (Math.abs(sum - 100) > SUM_TOLERANCE) errors.push(`targets sum to ${Math.round(sum * 100) / 100}, expected 100`)
  return errors
}

/** Checks proposed targets against the sleeve bounds, and optionally against the per-cycle shift limit from the current ones. */
export function checkTargetsAgainstBounds(
  p: AllocationPolicy,
  targets: Record<Sleeve, SleeveTarget>,
  opts: { enforceShift: boolean },
): string[] {
  const errors: string[] = []
  for (const sleeve of SLEEVES) {
    const bounds = p.bounds.sleeves[sleeve]
    const proposed = targets[sleeve].target
    if (proposed < bounds.min || proposed > bounds.max) {
      errors.push(`${sleeve}: target ${proposed} is outside bounds ${bounds.min}-${bounds.max}`)
    }
    if (opts.enforceShift) {
      const shift = Math.abs(proposed - p.targets[sleeve].target)
      if (shift > p.bounds.maxTargetShiftPctPerCycle + 1e-9) {
        errors.push(
          `${sleeve}: target moves ${Math.round(shift * 100) / 100} points, above the ${p.bounds.maxTargetShiftPctPerCycle}-point limit per cycle`,
        )
      }
    }
  }
  return errors
}

export function getAllocationPolicy(filePath = config.stockAllocationPolicyPath): AllocationPolicyState {
  let text: string
  try {
    text = fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { policy: null, source: 'missing', error: null }
    return { policy: null, source: 'saved', error: `could not read ${filePath}: ${(error as Error).message}` }
  }
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('top level is not an object')
    const policy = Object.fromEntries(Object.entries(raw).filter(([key]) => !key.startsWith('_'))) as unknown as AllocationPolicy
    const errors = validateAllocationPolicy(policy)
    if (errors.length) return { policy: null, source: 'saved', error: errors.join('; ') }
    return { policy, source: 'saved', error: null }
  } catch (error) {
    return { policy: null, source: 'saved', error: `invalid allocation policy: ${(error as Error).message}` }
  }
}

export function saveAllocationPolicy(p: AllocationPolicy, filePath = config.stockAllocationPolicyPath): void {
  const errors = validateAllocationPolicy(p)
  if (errors.length) throw new Error(errors.join('; '))
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(p, null, 2)}\n`)
  fs.renameSync(temporaryPath, filePath)
}

export function applyTargets(
  p: AllocationPolicy,
  targets: Record<Sleeve, SleeveTarget>,
  by: string,
  at: string,
): AllocationPolicy {
  const changes: Partial<Record<Sleeve, [number, number]>> = {}
  for (const sleeve of SLEEVES) {
    if (p.targets[sleeve].target !== targets[sleeve].target) changes[sleeve] = [p.targets[sleeve].target, targets[sleeve].target]
  }
  const next = structuredClone(p)
  next.targets = structuredClone(targets)
  if (Object.keys(changes).length) next.history = [...p.history, { at, by, changes }]
  return next
}

export function deriveUsTargetPct(p: AllocationPolicy): number | null {
  const kr = p.targets.kr_equity.target
  const us = p.targets.us_equity.target
  if (kr + us === 0) return null
  return Math.round((us / (kr + us)) * 1000) / 10
}
