import { bankAccountName, brokerageAccountLabel } from '@/lib/bank-accounts'
import { strictIsoDate } from '@/lib/domain/assets/query-coverage'
import type { InventoryBinding, InventoryMapResult, MapRead, PrimaryInventory, ProjectionInput, Registration, Scope, SourceKind } from './types'

export const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v))
export const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
export const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(text) && new Set(v).size === v.length
export const sourceKinds: SourceKind[] = ['positions', 'activity', 'balance', 'pension_snapshot']
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(v)
export const sorted = (v: string[]) => [...new Set(v)].sort()
export const instant = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(v) && Boolean(strictIsoDate(v.slice(0, 10))) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 19) === v.slice(0, 19)

// Explicit aliases only: no suffix, label or owner inference. Unknown providers stay null.
const providers: Record<string, string> = {
  chase: 'chase', Chase: 'chase', fidelity: 'fidelity', Fidelity: 'fidelity', Merrill: 'merrill', merrill: 'merrill',
  Robinhood: 'robinhood', robinhood: 'robinhood', 'robinhood-bank': 'robinhood-bank', Bithumb: 'bithumb', bithumb: 'bithumb',
  mirae: 'mirae', '미래에셋증권': 'mirae', samsung: 'samsung', '삼성증권': 'samsung', toss: 'toss', '토스증권': 'toss',
  tossbank: 'tossbank', amex: 'amex', boa: 'boa', hana: 'hana', mg: 'mg', kb: 'kb', shinhan: 'shinhan', woori: 'woori', nh: 'nh',
}
export const providerId = (v: unknown) => typeof v === 'string' && Object.hasOwn(providers, v) ? providers[v] : null
export function validScope(v: unknown): v is Scope {
  if (!object(v)) return false
  if (!['owners', 'providers', 'wrappers', 'assetClasses'].every(k => v[k] === 'all' || (strings(v[k]) && (v[k] as string[]).length > 0))) return false
  return Array.isArray(v.exclusions) && v.exclusions.every(e => object(e) && text(e.key) && text(e.reason) && text(e.basisRef)) && new Set(v.exclusions.map(e => (e as { key: string }).key)).size === v.exclusions.length
}
function metadata(v: unknown): PrimaryInventory | InventoryBinding | null {
  if (!object(v) || !id(v.accountId)) return null
  if (v.role === 'binding' && Object.keys(v).every(k => ['role', 'accountId'].includes(k))) return { role: 'binding', accountId: v.accountId }
  if (v.role !== 'primary' || !text(v.providerId) || !object(v.owner) || !object(v.dimensions) || !object(v.lifecycle) || !Array.isArray(v.requirements)) return null
  if (!(v.owner.state === 'unconfirmed' || (v.owner.state === 'confirmed' && text(v.owner.ownerId)))) return null
  if (!strings(v.dimensions.wrappers) || !strings(v.dimensions.assetClasses)) return null
  if (typeof v.lifecycle.state !== 'string' || !['active', 'closed', 'unconfirmed'].includes(v.lifecycle.state)) return null
  if (!['openedOn', 'closedOn', 'basisRef'].every(k => v.lifecycle && (!Object.hasOwn(v.lifecycle, k) || text((v.lifecycle as Record<string, unknown>)[k])))) return null
  if (!v.requirements.every(r => object(r) && sourceKinds.includes(r.kind as SourceKind) && text(r.freshnessPolicyId) && (r.historyFrom === undefined || text(r.historyFrom)))) return null
  if (new Set(v.requirements.map(r => (r as { kind: string }).kind)).size !== v.requirements.length) return null
  return JSON.parse(JSON.stringify(v)) as PrimaryInventory
}

/** Read-result boundary only. No filesystem reads, defaults, mutation or production loader changes. */
export function validateInventoryMap(read: MapRead): InventoryMapResult {
  const unavailable = (reason: string): InventoryMapResult => ({ state: 'unavailable', reasons: [reason], registrations: [], receipts: [], fingerprint: null })
  if (!object(read) || (typeof read.state !== 'string' || !['available', 'missing', 'invalid', 'read_error'].includes(read.state))) return unavailable('invalid_read_result')
  if (read.state !== 'available') return unavailable(`map_${read.state}`)
  const raw = read.value
  if (!object(raw) || (raw.accounts !== undefined && !object(raw.accounts)) || ['bankAccounts', 'brokerageAccounts', 'pensionAccounts'].some(k => raw[k] !== undefined && (!Array.isArray(raw[k]) || !(raw[k] as unknown[]).every(object)))) return unavailable('invalid_map_shape')
  const review = raw.inventoryReview
  if (review !== undefined && (!object(review) || review.schemaVersion !== 1 || !Array.isArray(review.receipts))) return unavailable('unsupported_review_metadata')
  const registrations: Registration[] = []
  const sections: [string, string | null, Record<string, unknown>][] = []
  for (const [label, value] of Object.entries((raw.accounts ?? {}) as Record<string, unknown>)) {
    if (!object(value)) return unavailable('invalid_account_entry')
    sections.push(['accounts', label, value])
  }
  for (const section of ['bankAccounts', 'brokerageAccounts', 'pensionAccounts']) {
    for (const value of (raw[section] ?? []) as Record<string, unknown>[]) sections.push([section, null, value])
  }
  for (const [section, named, value] of sections) {
    const meta = value.inventory === undefined ? null : metadata(value.inventory)
    const label = named ?? (section === 'bankAccounts' ? bankAccountName(value) : section === 'brokerageAccounts' ? brokerageAccountLabel(value) : text(value.account) ? value.account : null)
    const provider = providerId(value.institution) ?? (meta?.role === 'primary' ? providerId(meta.providerId) : null)
    const issues = value.inventory !== undefined && !meta ? ['invalid_inventory_metadata'] : []
    if (!label) issues.push('label_unresolved')
    if (meta?.role === 'primary' && (!providerId(meta.providerId) || (providerId(value.institution) && providerId(value.institution) !== meta.providerId))) issues.push('provider_unresolved')
    if (section === 'pensionAccounts' && !text(value.token)) issues.push('missing_pension_token')
    const legacy: Record<string, unknown> = {}
    for (const k of ['institution', 'account', 'alias', 'label', 'token', 'owner', 'wrapper', 'assetClass', 'multiCurrency', 'openedOn', 'retired', 'retiredOn', 'historyFrom']) if (value[k] !== undefined) legacy[k] = value[k]
    if (meta?.role === 'primary' && ((text(value.wrapper) && !meta.dimensions.wrappers.includes(value.wrapper)) || (text(value.assetClass) && !meta.dimensions.assetClasses.includes(value.assetClass)))) issues.push('dimensions_conflict')
    const legacyOwner = text(value.owner) ? value.owner : null
    if (meta?.role === 'primary' && meta.owner.state === 'confirmed' && legacyOwner && legacyOwner !== meta.owner.ownerId) issues.push('owner_conflict')
    registrations.push({ key: JSON.stringify([section, provider, label ?? '']), section, providerId: provider, label: label ?? '', metadata: meta, owner: meta?.role === 'primary' ? meta.owner : { state: 'unconfirmed' }, wrappers: meta?.role === 'primary' ? sorted(meta.dimensions.wrappers) : text(value.wrapper) ? [value.wrapper] : [], assetClasses: meta?.role === 'primary' ? sorted(meta.dimensions.assetClasses) : text(value.assetClass) ? [value.assetClass] : [], legacy: JSON.parse(JSON.stringify(legacy)) as Record<string, unknown>, issues })
  }
  const duplicateKeys = registrations.filter((r, i) => registrations.findIndex(x => x.key === r.key) !== i).map(r => r.key)
  for (const r of registrations) if (duplicateKeys.includes(r.key)) r.issues.push('duplicate_selector')
  return { state: 'available', reasons: [], registrations: registrations.sort((a, b) => a.key.localeCompare(b.key, 'en')), receipts: review && object(review) ? JSON.parse(JSON.stringify(review.receipts)) as unknown[] : [], fingerprint: read.fingerprint ?? null }
}

export function assertProjectionInput(value: ProjectionInput): void {
  if (!object(value) || !strictIsoDate(value.asOfDate) || !instant(value.clock) || value.asOfDate > value.clock.slice(0, 10) || value.adapterVersion !== 'inventory-v1' || !validScope(value.requestedScope) || !Array.isArray(value.observations) || !Array.isArray(value.evidenceSignals)) throw new Error('Invalid inventory projection input')
  const observations: unknown[] = value.observations
  if (!observations.every(o => object(o) && text(o.key) && text(o.account) && (o.providerId === null || text(o.providerId)) && (o.ownerId == null || text(o.ownerId)) && (o.asOfDate == null || typeof o.asOfDate === 'string') && (o.wrappers === undefined || strings(o.wrappers)) && (o.assetClasses === undefined || strings(o.assetClasses)) && strings(o.evidenceRefs)) || new Set(value.observations.map(o => o.key)).size !== value.observations.length) throw new Error('Invalid inventory observations')
  const signals: unknown[] = value.evidenceSignals
  if (!signals.every(s => object(s) && text(s.observationKey) && value.observations.some(o => o.key === s.observationKey) && sourceKinds.includes(s.kind as SourceKind) && typeof s.state === 'string' && ['present', 'unconfirmed', 'conflicting'].includes(s.state) && strings(s.refs) && (s.throughDate == null || typeof s.throughDate === 'string') && (s.periods === undefined || (Array.isArray(s.periods) && s.periods.every(p => object(p) && typeof p.from === 'string' && typeof p.to === 'string'))) && (s.historyGap === undefined || (object(s.historyGap) && typeof s.historyGap.from === 'string' && typeof s.historyGap.to === 'string')) && ['missingDisposal', 'empty'].every(k => s[k] === undefined || typeof s[k] === 'boolean') && (s.reconciliation === undefined || (typeof s.reconciliation === 'string' && ['pass', 'issues', 'unconfirmed'].includes(s.reconciliation))))) throw new Error('Invalid inventory evidence signals')
}
