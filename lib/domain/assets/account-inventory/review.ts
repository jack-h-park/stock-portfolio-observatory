import { createHash } from 'node:crypto'
import type { InventoryMapResult, InventoryRow, Owner, Registration, Review, ReviewReceipt, Scope, Selector } from './types'
import { instant, object, sorted, strings, text, validScope } from './validation'
import { strictIsoDate } from '@/lib/domain/assets/query-coverage'

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (object(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  return JSON.stringify(value)
}
export function normalizeScope(scope: Scope): Scope {
  const selector = (s: Selector) => s === 'all' ? s : sorted(s)
  return { owners: selector(scope.owners), providers: selector(scope.providers), wrappers: selector(scope.wrappers), assetClasses: selector(scope.assetClasses), exclusions: [...scope.exclusions].map(e => ({ ...e })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) }
}
type Facts = { providerId: string | null; owner: Owner; wrappers: string[]; assetClasses: string[] }
/** A known contradiction excludes; unknown facts never become a negative match. */
export function membership(f: Facts, scope: Scope): 'included' | 'excluded' | 'unresolved' {
  const axes: [Selector, string[]][] = [[scope.owners, f.owner.state === 'confirmed' ? [f.owner.ownerId] : []], [scope.providers, f.providerId ? [f.providerId] : []], [scope.wrappers, f.wrappers], [scope.assetClasses, f.assetClasses]]
  if (axes.some(([s, values]) => s !== 'all' && values.length > 0 && !values.some(v => s.includes(v)))) return 'excluded'
  if (axes.some(([s, values]) => s !== 'all' && !values.length)) return 'unresolved'
  return 'included'
}
export function registrationFacts(r: Registration, map: InventoryMapResult): Facts {
  const id = r.metadata?.accountId
  const primary = id ? map.registrations.filter(p => p.metadata?.role === 'primary' && p.metadata.accountId === id) : []
  const p = primary.length === 1 ? primary[0] : r
  const ownerConflict = r.issues.includes('owner_conflict') || (p.owner.state === 'confirmed' && typeof r.legacy.owner === 'string' && r.legacy.owner !== p.owner.ownerId)
  const dimensionsConflict = p.metadata?.role === 'primary' && ((typeof r.legacy.wrapper === 'string' && !p.metadata.dimensions.wrappers.includes(r.legacy.wrapper)) || (typeof r.legacy.assetClass === 'string' && !p.metadata.dimensions.assetClasses.includes(r.legacy.assetClass)))
  const providers = sorted(primary.map(entry => entry.providerId).filter((v): v is string => v !== null))
  return { providerId: providers.length > 1 ? null : r.providerId ?? p.providerId, owner: ownerConflict ? { state: 'unconfirmed' } : p.owner, wrappers: r.issues.includes('dimensions_conflict') || dimensionsConflict ? [] : p.wrappers, assetClasses: r.issues.includes('dimensions_conflict') || dimensionsConflict ? [] : p.assetClasses }
}
export function inventoryDigest(map: InventoryMapResult, requested: Scope): string {
  if (!validScope(requested) || map.state !== 'available') throw new Error('Inventory digest requires available map and valid scope')
  const scope = normalizeScope(requested)
  const selected = map.registrations.filter(r => membership(registrationFacts(r, map), scope) !== 'excluded' || scope.exclusions.some(e => e.key === r.key || e.key === `account:${r.metadata?.accountId}`))
  const registrations = selected.map(r => {
    const meta = r.metadata
    const normalized = meta?.role === 'primary' ? { role: meta.role, accountId: meta.accountId, providerId: meta.providerId, owner: meta.owner, dimensions: { wrappers: sorted(meta.dimensions.wrappers), assetClasses: sorted(meta.dimensions.assetClasses) }, lifecycle: meta.lifecycle, requirements: [...meta.requirements].sort((a, b) => canonical(a) < canonical(b) ? -1 : 1) } : meta
    return { key: r.key, section: r.section, providerId: r.providerId, label: r.label, metadata: normalized, legacy: r.legacy, issues: sorted(r.issues) }
  }).sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0)
  return createHash('sha256').update(canonical({ digestVersion: 1, scope, registrations })).digest('hex')
}
function receipt(v: unknown): v is ReviewReceipt {
  return object(v) && text(v.reviewId) && text(v.reviewerId) && instant(v.reviewedAt) && Boolean(strictIsoDate(v.asOfDate)) && v.basis === 'owner-attested' && validScope(v.scope) && strings(v.includedAccountIds) && v.digestVersion === 1 && typeof v.inventoryDigest === 'string' && /^[a-f0-9]{64}$/.test(v.inventoryDigest)
}
export function assessReview(map: InventoryMapResult, scope: Scope, rows: InventoryRow[], digest: string | null, asOfDate: string, clock: string): Review {
  if (map.state !== 'available') return { state: 'unavailable', reasons: map.reasons }
  const relevant = rows.filter(r => r.membership !== 'excluded')
  if (relevant.some(r => r.issues.length || r.discovery !== 'expected' || r.membership === 'unresolved' || r.owner.state !== 'confirmed')) return { state: 'conflicted', reasons: ['unresolved_scope_members'] }
  const matching = map.receipts.filter(receipt).filter(r => canonical(normalizeScope(r.scope)) === canonical(scope) && Date.parse(r.reviewedAt) <= Date.parse(clock) && r.asOfDate <= r.reviewedAt.slice(0, 10))
  const sameDate = matching.filter(r => r.asOfDate === asOfDate)
  if (!sameDate.length) {
    const historical = matching.filter(r => r.asOfDate < asOfDate).sort((a, b) => Date.parse(b.reviewedAt) - Date.parse(a.reviewedAt))
    if (historical.length && historical[0].inventoryDigest !== digest) return { state: 'outdated', reasons: ['historical_inventory_digest_changed'], reviewId: historical[0].reviewId, asOfDate: historical[0].asOfDate }
    return { state: 'unreviewed', reasons: historical.length ? ['historical_receipt_only'] : ['no_usable_receipt'] }
  }
  const latest = Math.max(...sameDate.map(r => Date.parse(r.reviewedAt)))
  const latestReceipts = sameDate.filter(r => Date.parse(r.reviewedAt) === latest)
  if (new Set(latestReceipts.map(r => canonical(r))).size > 1) return { state: 'conflicted', reasons: ['same_time_receipt_conflict'] }
  const r = latestReceipts[0]
  if (r.inventoryDigest !== digest) return { state: 'outdated', reasons: ['inventory_digest_changed'], reviewId: r.reviewId, asOfDate: r.asOfDate }
  const included = relevant.filter(row => row.discovery === 'expected').map(row => row.accountId!).sort()
  const exclusionKeys = new Set(scope.exclusions.map(e => e.key))
  if (canonical(sorted(r.includedAccountIds)) !== canonical(included) || scope.exclusions.some(e => !rows.some(row => row.key === e.key)) || included.some(id => exclusionKeys.has(`account:${id}`))) return { state: 'conflicted', reasons: ['receipt_partition_mismatch'] }
  return { state: 'reviewed', reasons: [], reviewId: r.reviewId, asOfDate: r.asOfDate }
}
