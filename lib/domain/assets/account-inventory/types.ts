export type Selector = 'all' | string[]
export type Scope = {
  owners: Selector; providers: Selector; wrappers: Selector; assetClasses: Selector
  exclusions: { key: string; reason: string; basisRef: string }[]
}
export type Owner = { state: 'confirmed'; ownerId: string } | { state: 'unconfirmed' }
export type Lifecycle = { state: 'active' | 'closed' | 'unconfirmed'; openedOn?: string; closedOn?: string; basisRef?: string }
export type SourceKind = 'positions' | 'activity' | 'balance' | 'pension_snapshot'
export type Requirement = { kind: SourceKind; freshnessPolicyId: string; historyFrom?: string }
export type PrimaryInventory = {
  role: 'primary'; accountId: string; providerId: string; owner: Owner
  dimensions: { wrappers: string[]; assetClasses: string[] }
  lifecycle: Lifecycle; requirements: Requirement[]
}
export type InventoryBinding = { role: 'binding'; accountId: string }
export type MapRead = { state: 'available'; value: unknown; fingerprint?: string } | { state: 'missing' | 'invalid' | 'read_error' }
export type Registration = {
  key: string; section: string; providerId: string | null; label: string
  metadata: PrimaryInventory | InventoryBinding | null
  owner: Owner; wrappers: string[]; assetClasses: string[]; issues: string[]
  legacy: Record<string, unknown>
}
export type InventoryMapResult = {
  state: 'available' | 'unavailable'; reasons: string[]; registrations: Registration[]
  receipts: unknown[]; fingerprint: string | null
}
export type Observation = {
  key: string; providerId: string | null; account: string; asOfDate?: string | null
  ownerId?: string | null; wrappers?: string[]; assetClasses?: string[]; evidenceRefs: string[]
}
export type EvidenceSignal = {
  observationKey: string; kind: SourceKind; state: 'present' | 'conflicting' | 'unconfirmed'
  throughDate?: string | null; refs: string[]; periods?: { from: string; to: string }[]
  historyGap?: { from: string; to: string }; missingDisposal?: boolean; empty?: boolean
  reconciliation?: 'pass' | 'issues' | 'unconfirmed'
}
export type ProjectionInput = {
  mapRead: MapRead; observations: Observation[]; evidenceSignals: EvidenceSignal[]
  requestedScope: Scope; asOfDate: string; clock: string; adapterVersion: 'inventory-v1'
}
export type SourceState = 'not_required' | 'unsupported' | 'conflicting' | 'missing' | 'unconfirmed' | 'stale' | 'due_soon' | 'current'
export type History = { state: 'not_requested' | 'unsupported' | 'unconfirmed' | 'gaps' | 'covered'; from?: string; to?: string; gaps?: { from: string; to: string }[] }
export type SourceAssessment = {
  kind: SourceKind; state: SourceState; reasons: string[]; evidenceRefs: string[]
  throughDate: string | null; history: History; reconciliation: 'pass' | 'issues' | 'unconfirmed'
}
export type InventoryRow = {
  key: string; accountId: string | null; providerId: string | null; aliases: string[]
  owner: Owner; wrappers: string[]; assetClasses: string[]; lifecycle: Lifecycle
  discovery: 'expected' | 'legacy_registered' | 'observed_only' | 'unresolved'
  membership: 'included' | 'excluded' | 'unresolved'; issues: string[]
  observationKeys: string[]; evidenceRefs: string[]; sources: SourceAssessment[]
  action: 'review' | 'obtain' | 'update' | 'none'
}
export type Review = {
  state: 'unavailable' | 'unreviewed' | 'outdated' | 'conflicted' | 'reviewed'
  reasons: string[]; reviewId?: string; asOfDate?: string
}
export type ReviewReceipt = {
  reviewId: string; reviewedAt: string; asOfDate: string; reviewerId: string; basis: 'owner-attested'
  scope: Scope; includedAccountIds: string[]; digestVersion: 1; inventoryDigest: string
}
export type InventoryProjectionV1 = {
  schemaVersion: 1; adapterVersion: 'inventory-v1'; asOfDate: string
  mapState: InventoryMapResult['state']; mapFingerprint: string | null
  scope: Scope; review: Review; inventoryDigest: string | null
  rows: InventoryRow[]; laterObservations: Observation[]
  counts: { expected: number | null; confirmedExpected: number | null; legacyRegistered: number; observedOnly: number; unresolved: number; sources: Partial<Record<SourceState, number>> }
}
