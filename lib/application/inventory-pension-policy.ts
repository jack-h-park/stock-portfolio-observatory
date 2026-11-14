import { strictIsoDate } from '@/lib/domain/assets/query-coverage'
import type { MapRead } from '@/lib/domain/assets/account-inventory'
import { text, validateInventoryMap } from '@/lib/domain/assets/account-inventory/validation'

export type InventoryPensionPolicy = {
  key: string
  state: 'active' | 'closed_declared' | 'not_loaded' | 'review_required'
  basis: 'legacy_registration'
  declaredClosedOn?: string
}

/** Presentation of existing eligibility, never owner/closure/balance proof. */
export function inventoryPensionPolicies(read: MapRead, asOfDate: string): InventoryPensionPolicy[] {
  const registrations = validateInventoryMap(read).registrations.filter(r => r.section === 'pensionAccounts')
  const policies = registrations.map(r => {
    const key = r.metadata ? `account:${r.metadata.accountId}` : r.key
    const base = { key, basis: 'legacy_registration' as const }
    if (r.issues.some(issue => issue !== 'missing_pension_token')) return { ...base, state: 'review_required' as const }
    const retired = r.legacy.retiredOn
    if (retired !== undefined) {
      const date = strictIsoDate(retired)
      if (!date || date > asOfDate || r.metadata) return { ...base, state: 'review_required' as const }
      return { ...base, state: 'closed_declared' as const, declaredClosedOn: date }
    }
    if (r.legacy.retired === true) return { ...base, state: 'review_required' as const }
    if (text(r.legacy.token)) return { ...base, state: 'active' as const }
    if (r.metadata) return { ...base, state: 'review_required' as const }
    return { ...base, state: 'not_loaded' as const }
  })
  const byKey = new Map<string, InventoryPensionPolicy[]>()
  for (const p of policies) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p])
  return [...byKey].map(([key, group]) => new Set(group.map(p => JSON.stringify([p.state,p.declaredClosedOn]))).size > 1
    ? { key, state: 'review_required' as const, basis: 'legacy_registration' as const } : group[0])
    .sort((a,b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
}
