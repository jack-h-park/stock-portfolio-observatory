import { createHash } from 'node:crypto'
import rawPack from '@/data/tax-rules/2025/annual-foundation.json'
import qualifiedPack from '@/data/tax-rules/2025/qualified-gains.json'

export const ANNUAL_COMPONENTS = ['us.regular.ordinary', 'us.regular.qdcg', 'us.niit', 'kr.global.calculated', 'kr.local.calculated'] as const
export type AnnualComponentId = typeof ANNUAL_COMPONENTS[number]
const PACKS = { 'annual-2025-foundation-v1': rawPack, 'annual-2025-qualified-gains-v2': qualifiedPack } as const
export type AnnualRulePackId = keyof typeof PACKS
// Capture primitive identities once: imported JSON objects can be shared with other modules.
const PINNED_DIGESTS: Record<AnnualRulePackId, string> = { 'annual-2025-foundation-v1': rawPack.contentSha256, 'annual-2025-qualified-gains-v2': qualifiedPack.contentSha256 }
export type AnnualRulePack = typeof rawPack | typeof qualifiedPack

/** Stable hashing for plain JSON values; no private file or network access. */
export function annualJsonDigest(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (Array.isArray(item)) {
      for (let i = 0; i < item.length; i++) if (!Object.hasOwn(item, i)) throw new Error('Non-JSON sparse array')
      return `[${item.map(canonical).join(',')}]`
    }
    if (item !== null && typeof item === 'object') {
      if (Object.getPrototypeOf(item) !== Object.prototype) throw new Error('Non-JSON object')
      return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical((item as Record<string, unknown>)[key])}`).join(',')}}`
    }
    if (item !== null && !['string', 'number', 'boolean'].includes(typeof item)) throw new Error('Non-JSON value')
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Non-JSON number')
    return JSON.stringify(item)
  }
  return createHash('sha256').update(canonical(value)).digest('hex')
}

/** Integrity validates this bundled reference, not a tax calculation or legal opinion. */
export function validateAnnualRulePack(value: unknown): AnnualRulePack {
  if (!value || typeof value !== 'object') throw new Error('Invalid annual rule pack')
  const pack = value as AnnualRulePack
  if (pack.schemaVersion !== 1 || pack.taxYear !== 2025 || !Object.hasOwn(PACKS, pack.id)) throw new Error('Unsupported annual rule year/version')
  const { contentSha256, ...payload } = pack
  if (!/^[a-f0-9]{64}$/.test(contentSha256) || annualJsonDigest(payload) !== contentSha256 || contentSha256 !== PINNED_DIGESTS[pack.id as AnnualRulePackId]) throw new Error('Annual rule pack integrity mismatch')
  return structuredClone(pack)
}

export function getAnnualRulePack(year: number, id: AnnualRulePackId = 'annual-2025-foundation-v1'): AnnualRulePack {
  if (year !== 2025) throw new Error('Unsupported annual tax year; no projection or fallback')
  if (!Object.hasOwn(PACKS, id)) throw new Error('Unsupported annual rule pack; no version fallback')
  return validateAnnualRulePack(PACKS[id])
}

export function getAnnualRuleStatus(year: number, component: AnnualComponentId, id: AnnualRulePackId = 'annual-2025-foundation-v1') {
  const pack = getAnnualRulePack(year, id)
  if (!ANNUAL_COMPONENTS.includes(component)) throw new Error('Unknown annual component')
  const readiness = pack.readiness[component]
  return { ...readiness, calculationAvailable: readiness.status === 'reference-ready' && ['us.regular.ordinary', 'us.regular.qdcg', 'us.niit'].includes(component) }
}
