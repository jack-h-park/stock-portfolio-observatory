import { strictIsoDate } from '@/lib/domain/assets/query-coverage'
import type { InventoryProjectionV1, InventoryRow, Lifecycle, Observation, PrimaryInventory, ProjectionInput, Registration } from './types'
import { assertProjectionInput, providerId, sorted, validateInventoryMap } from './validation'
import { assessReview, inventoryDigest, membership, normalizeScope } from './review'
import { assessSource } from './evidence'
export { inventoryDigest } from './review'
export { validateInventoryMap } from './validation'
export type * from './types'

function lifecycleFor(primary: PrimaryInventory | undefined, registrations: Registration[], asOfDate: string): { lifecycle: Lifecycle; issues: string[] } {
  const value = primary?.lifecycle ?? { state: 'unconfirmed' }
  const issues: string[] = []
  if (value.openedOn && (!strictIsoDate(value.openedOn) || value.openedOn > asOfDate)) issues.push('opened_date_unresolved')
  if ((value.closedOn && (!strictIsoDate(value.closedOn) || value.closedOn > asOfDate || (value.openedOn && value.closedOn < value.openedOn))) || (value.state === 'closed' && !value.basisRef) || (value.state === 'active' && value.closedOn)) issues.push('lifecycle_unresolved')
  if (value.state === 'active' && registrations.some(r => r.legacy.retired === true || r.legacy.retiredOn)) issues.push('lifecycle_conflict')
  return { lifecycle: issues.length ? { state: 'unconfirmed' } : { ...value }, issues }
}
function exactAlias(registration: Registration, observation: Observation, boundProvider: string | null): boolean {
  const provider = registration.providerId ?? boundProvider
  if (!provider || providerId(observation.providerId) !== provider) return false
  if (registration.label === observation.account) return true
  if (registration.section === 'bankAccounts' && registration.legacy.multiCurrency === true) {
    const match = /^(.*) \([A-Z]{3}\)$/.exec(observation.account)
    return Boolean(match && match[1] === registration.label)
  }
  return false
}
/** Standalone read model. No existing app/CLI caller invokes this module. */
export function projectAccountInventory(input: ProjectionInput): InventoryProjectionV1 {
  assertProjectionInput(input)
  const map = validateInventoryMap(input.mapRead)
  const scope = normalizeScope(input.requestedScope)
  const groups = new Map<string, Registration[]>()
  for (const r of map.registrations) {
    const key = r.metadata ? `account:${r.metadata.accountId}` : r.key
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const rows: InventoryRow[] = []
  const registrationsByRow = new Map<string, Registration[]>()
  for (const [key, registrations] of groups) {
    const primaries = registrations.filter(r => r.metadata?.role === 'primary')
    const p = primaries.length === 1 ? primaries[0] : undefined
    const primary = p?.metadata?.role === 'primary' ? p.metadata : undefined
    const issues = registrations.flatMap(r => r.issues)
    if (registrations.some(r => r.metadata) && primaries.length !== 1) issues.push(primaries.length > 1 ? 'duplicate_primary' : 'dangling_binding')
    if (p && registrations.some(r => (r.providerId && r.providerId !== p.providerId) || (typeof r.legacy.owner === 'string' && primary?.owner.state === 'confirmed' && r.legacy.owner !== primary.owner.ownerId))) issues.push('binding_conflict')
    if (primary && registrations.some(r =>
      (typeof r.legacy.wrapper === 'string' && !primary.dimensions.wrappers.includes(r.legacy.wrapper)) ||
      (typeof r.legacy.assetClass === 'string' && !primary.dimensions.assetClasses.includes(r.legacy.assetClass)))) issues.push('dimensions_conflict')
    const { lifecycle, issues: lifecycleIssues } = lifecycleFor(primary, registrations, input.asOfDate)
    const row: InventoryRow = { key, accountId: primary?.accountId ?? null, providerId: p?.providerId ?? registrations[0].providerId, aliases: sorted(registrations.map(r => r.label)), owner: primary?.owner ?? { state: 'unconfirmed' }, wrappers: primary ? sorted(primary.dimensions.wrappers) : sorted(registrations.flatMap(r => r.wrappers)), assetClasses: primary ? sorted(primary.dimensions.assetClasses) : sorted(registrations.flatMap(r => r.assetClasses)), lifecycle, discovery: issues.length ? 'unresolved' : primary ? 'expected' : 'legacy_registered', membership: 'unresolved', issues: sorted([...issues, ...lifecycleIssues]), observationKeys: [], evidenceRefs: [], sources: [], action: 'none' }
    const providers = sorted(registrations.map(r => r.providerId).filter((v): v is string => v !== null))
    if (providers.length > 1) row.providerId = null
    if (row.issues.includes('owner_conflict') || row.issues.includes('binding_conflict')) row.owner = { state: 'unconfirmed' }
    rows.push(row); registrationsByRow.set(key, registrations)
  }
  // Detect ambiguous explicit aliases even before an observation uses them.
  const aliasRows = new Map<string, InventoryRow[]>()
  for (const row of rows) for (const alias of row.aliases) {
    const key = JSON.stringify([row.providerId, alias])
    aliasRows.set(key, [...(aliasRows.get(key) ?? []), row])
  }
  for (const matches of aliasRows.values()) if (matches.length > 1) for (const row of matches) row.issues.push('ambiguous_alias_binding')
  const laterObservations: Observation[] = []
  for (const observation of input.observations) {
    if (strictIsoDate(observation.asOfDate) && observation.asOfDate! > input.asOfDate) { laterObservations.push(JSON.parse(JSON.stringify(observation)) as Observation); continue }
    const matches = rows.filter(r => (registrationsByRow.get(r.key) ?? []).some(registration => exactAlias(registration, observation, r.providerId)))
    let row: InventoryRow
    if (matches.length === 1) row = matches[0]
    else {
      const key = JSON.stringify(['observed', providerId(observation.providerId), observation.account])
      row = rows.find(r => r.key === key) ?? { key, accountId: null, providerId: providerId(observation.providerId), aliases: [observation.account], owner: observation.ownerId ? { state: 'confirmed', ownerId: observation.ownerId } : { state: 'unconfirmed' }, wrappers: sorted(observation.wrappers ?? []), assetClasses: sorted(observation.assetClasses ?? []), lifecycle: { state: 'unconfirmed' }, discovery: matches.length ? 'unresolved' : 'observed_only', membership: 'unresolved', issues: matches.length ? ['ambiguous_observation_binding'] : [], observationKeys: [], evidenceRefs: [], sources: [], action: 'review' }
      if (!rows.includes(row)) rows.push(row)
      for (const match of matches) match.issues.push('ambiguous_observation_binding')
    }
    if (!strictIsoDate(observation.asOfDate)) row.issues.push('undated_observation')
    if (observation.ownerId && row.owner.state === 'confirmed' && row.owner.ownerId !== observation.ownerId) {
      row.issues.push('owner_conflict')
      row.owner = { state: 'unconfirmed' }
    }
    if (!registrationsByRow.has(row.key)) {
      row.wrappers = sorted([...row.wrappers, ...(observation.wrappers ?? [])])
      row.assetClasses = sorted([...row.assetClasses, ...(observation.assetClasses ?? [])])
    }
    row.observationKeys.push(observation.key); row.evidenceRefs.push(...observation.evidenceRefs)
  }
  for (const row of rows) {
    if (!registrationsByRow.has(row.key)) {
      const observations = input.observations.filter(o => row.observationKeys.includes(o.key))
      const owners = sorted(observations.map(o => o.ownerId).filter((v): v is string => Boolean(v)))
      row.owner = owners.length === 1 && observations.every(o => o.ownerId) ? { state: 'confirmed', ownerId: owners[0] } : { state: 'unconfirmed' }
    }
    if (row.issues.includes('dimensions_conflict')) { row.wrappers = []; row.assetClasses = [] }
    row.membership = membership(row, scope)
    if (scope.exclusions.some(e => e.key === row.key)) row.membership = 'excluded'
    row.observationKeys = sorted(row.observationKeys); row.evidenceRefs = sorted(row.evidenceRefs); row.issues = sorted(row.issues)
    const registrations = registrationsByRow.get(row.key) ?? []
    const primary = registrations.find(r => r.metadata?.role === 'primary')?.metadata
    if (primary?.role === 'primary') {
      const unresolved = row.issues.length > 0 || row.owner.state !== 'confirmed' || row.lifecycle.state === 'unconfirmed'
      row.sources = primary.requirements.map(requirement => {
        const signals = input.evidenceSignals.filter(s => row.observationKeys.includes(s.observationKey) && s.kind === requirement.kind)
        const starts = requirement.kind === 'activity' ? registrations.filter(r => r.section === 'bankAccounts' && r.legacy.historyFrom !== undefined).map(r => r.legacy.historyFrom) : []
        return assessSource(requirement, signals, starts, row.lifecycle, input.asOfDate, unresolved)
      }).sort((a, b) => a.kind < b.kind ? -1 : 1)
      if (row.sources.some(s => s.reasons.includes('history_requirement_conflict'))) row.issues.push('history_requirement_conflict')
    }
    if (row.issues.length || row.owner.state !== 'confirmed' || row.discovery !== 'expected' || row.sources.some(s => s.state === 'conflicting' || s.reasons.includes('history_requirement_conflict'))) row.action = 'review'
    else if (row.sources.some(s => s.state === 'missing')) row.action = 'obtain'
    else if (row.sources.some(s => s.state === 'stale' || s.history.state === 'gaps' || s.reasons.includes('missing_disposal') || s.reconciliation === 'issues')) row.action = 'update'
    else if (row.sources.some(s => s.state === 'unconfirmed' || s.state === 'unsupported' || (s.history.state === 'unconfirmed' && s.history.from))) row.action = 'review'
    if (row.lifecycle.state === 'closed' && row.sources.every(s => s.state !== 'conflicting' && s.history.state !== 'gaps' && !s.reasons.includes('missing_disposal') && s.reconciliation !== 'issues')) row.action = row.issues.length || row.sources.some(s => s.history.state === 'unconfirmed' || ['unconfirmed', 'unsupported', 'missing'].includes(s.state)) ? 'review' : 'none'
  }
  rows.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  const digest = map.state === 'available' ? inventoryDigest(map, scope) : null
  const review = assessReview(map, scope, rows, digest, input.asOfDate, input.clock)
  const relevant = rows.filter(r => r.membership !== 'excluded')
  const sources: InventoryProjectionV1['counts']['sources'] = {}
  for (const row of relevant) for (const source of row.sources) sources[source.state] = (sources[source.state] ?? 0) + 1
  const expected = map.state === 'available' ? relevant.filter(r => r.discovery === 'expected').length : null
  return { schemaVersion: 1, adapterVersion: input.adapterVersion, asOfDate: input.asOfDate, mapState: map.state, mapFingerprint: map.fingerprint, scope, review, inventoryDigest: digest, rows, laterObservations: laterObservations.sort((a, b) => a.key < b.key ? -1 : 1), counts: { expected, confirmedExpected: review.state === 'reviewed' ? expected : null, legacyRegistered: relevant.filter(r => r.discovery === 'legacy_registered').length, observedOnly: relevant.filter(r => r.discovery === 'observed_only').length, unresolved: relevant.filter(r => r.discovery === 'unresolved' || r.membership === 'unresolved').length, sources } }
}
