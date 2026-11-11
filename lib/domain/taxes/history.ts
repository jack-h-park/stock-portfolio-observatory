import schema from '@/schemas/tax-history.v1.schema.json'

export type Currency = 'USD' | 'KRW'
export type Money = { currency: Currency; minor: string }
export type Versioned = { id: string; recordRevision: number; deleted?: boolean }
export type TaxUnit = Versioned & { year: number; kind: 'individual' | 'joint'; ownerIds: string[] }
export type EffectiveBasis = { kind: 'return' | 'assessment'; id: string; recordRevision: number; reviewedAt: string; evidenceIds: string[] }
export type TaxObligation = Versioned & { taxUnitId: string; taxYear: number; authority: string; taxType: string; currency: Currency; coverageConfirmed: boolean; effectiveBasis?: EffectiveBasis }
export type TaxReturn = Versioned & { obligationId: string; status: 'draft' | 'submitted' | 'accepted' | 'rejected'; liability: Money; supersedesId?: string; evidenceIds: string[] }
export type TaxAssessment = Versioned & { obligationId: string; liability: Money; date: string; evidenceIds: string[] }
export type Components = { principal: string; interest: string; penalty: string }
export type Settlement = Versioned & Components & { kind: 'withholding' | 'estimated-payment' | 'filing-payment' | 'additional-payment' | 'refund' | 'reversal' | 'credit-transfer'; date: string | null; postingDate?: string; currency: Currency; review: 'unreviewed' | 'evidenced' | 'authority-confirmed'; evidenceIds: string[] }
export type Allocation = Versioned & Components & { eventId: string; obligationId: string; effectiveDate: string; evidenceIds: string[] }
export type Adjustment = Versioned & { obligationId: string; amount: Money; effectiveDate: string; evidenceIds: string[] }
export type Evidence = Versioned & { root: 'records' | 'tax'; relativePath: string; sha256: string; locator?: string }
export const COLLECTIONS = ['taxUnits', 'obligations', 'returns', 'assessments', 'events', 'allocations', 'adjustments', 'evidence'] as const
export type Collection = typeof COLLECTIONS[number]
export type HistoryRecord = TaxUnit | TaxObligation | TaxReturn | TaxAssessment | Settlement | Allocation | Adjustment | Evidence
export type Change = { id: string; storeRevision: number; changedAt: string; actor: 'local-user' | 'import'; reason: string; records: { collection: Collection; id: string; before: HistoryRecord | null; after: HistoryRecord | null }[] }
export type TaxHistoryStoreV1 = { schemaVersion: 1; revision: number; taxUnits: TaxUnit[]; obligations: TaxObligation[]; returns: TaxReturn[]; assessments: TaxAssessment[]; events: Settlement[]; allocations: Allocation[]; adjustments: Adjustment[]; evidence: Evidence[]; changes: Change[] }
export const COMPONENTS = ['principal', 'interest', 'penalty'] as const
export const live = <T extends Versioned>(rows: T[]) => rows.filter(row => !row.deleted)
export const emptyTaxHistory = (): TaxHistoryStoreV1 => ({ schemaVersion: 1, revision: 0, taxUnits: [], obligations: [], returns: [], assessments: [], events: [], allocations: [], adjustments: [], evidence: [], changes: [] })
export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

// Validate the fixed, repository-owned schema subset. This is not a general
// JSON Schema engine: the contract uses only the keywords handled below.
type Shape = { $ref?: string; type?: string | string[]; properties?: Record<string, Shape>; required?: string[]; additionalProperties?: boolean; items?: Shape; enum?: unknown[]; const?: unknown; pattern?: string; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; minItems?: number; format?: string }
function checkShape(shape: Shape, value: unknown, at: string): void {
  if (shape.$ref) {
    const name = shape.$ref.split('/').pop()!
    return checkShape((schema.$defs as unknown as Record<string, Shape>)[name], value, at)
  }
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value
  if (shape.type && !(Array.isArray(shape.type) ? shape.type : [shape.type]).includes(type)) throw new Error(`Invalid ${at} type`)
  if (shape.const !== undefined && value !== shape.const) throw new Error(`Invalid ${at} version`)
  if (shape.enum && !shape.enum.includes(value)) throw new Error(`Invalid ${at} value`)
  if (typeof value === 'string') {
    if (shape.pattern && !new RegExp(shape.pattern).test(value)) throw new Error(`Invalid ${at} pattern`)
    if (value.length < (shape.minLength ?? 0) || value.length > (shape.maxLength ?? Infinity)) throw new Error(`Invalid ${at} length`)
    if (shape.format === 'date' && !isIsoDate(value)) throw new Error(`Invalid ${at} date`)
    if (shape.format === 'date-time' && !/^\d{4}-\d{2}-\d{2}T/.test(value)) throw new Error(`Invalid ${at} timestamp`)
    if (shape.format === 'date-time' && !Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${at} timestamp`)
  }
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < (shape.minimum ?? -Infinity) || value > (shape.maximum ?? Infinity))) throw new Error(`Invalid ${at} range`)
  if (Array.isArray(value)) {
    if (value.length < (shape.minItems ?? 0)) throw new Error(`Invalid ${at} empty list`)
    if (shape.items) value.forEach((item, i) => checkShape(shape.items!, item, `${at}[${i}]`))
  } else if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    for (const key of shape.required ?? []) if (!(key in obj)) throw new Error(`Missing ${at}.${key}`)
    if (shape.additionalProperties === false) for (const key of Object.keys(obj)) if (!shape.properties?.[key]) throw new Error(`Unknown ${at} field`)
    for (const [key, child] of Object.entries(shape.properties ?? {})) if (key in obj) checkShape(child, obj[key], `${at}.${key}`)
  }
}

export function validateTaxHistory(input: unknown): TaxHistoryStoreV1 {
  checkShape(schema as Shape, input, 'tax history')
  const store = structuredClone(input) as TaxHistoryStoreV1
  for (const collection of COLLECTIONS) {
    const ids = new Set<string>()
    for (const row of store[collection]) {
      if (ids.has(row.id)) throw new Error(`Duplicate ${collection} ID`)
      ids.add(row.id)
    }
  }
  const get = <C extends Collection>(collection: C, id: string): TaxHistoryStoreV1[C][number] => {
    const record = store[collection].find(row => row.id === id)
    if (!record) throw new Error(`Missing ${collection} reference`)
    return record as TaxHistoryStoreV1[C][number]
  }
  const evidence = (ids: string[]) => { for (const id of ids) get('evidence', id) }
  for (const row of store.obligations) {
    if (get('taxUnits', row.taxUnitId).year !== row.taxYear) throw new Error('Tax unit year mismatch')
    if (row.effectiveBasis) evidence(row.effectiveBasis.evidenceIds)
  }
  for (const row of [...store.returns, ...store.assessments]) {
    if (row.liability.currency !== get('obligations', row.obligationId).currency) throw new Error('Liability currency mismatch')
    if (BigInt(row.liability.minor) < 0n) throw new Error('Negative tax liability')
    evidence(row.evidenceIds)
  }
  for (const row of store.returns) if (row.supersedesId) {
    const previous = get('returns', row.supersedesId)
    if (previous.obligationId !== row.obligationId || previous.id === row.id) throw new Error('Invalid superseded return')
    const visited = new Set([row.id]); let cursor: TaxReturn | undefined = previous
    while (cursor) {
      if (visited.has(cursor.id)) throw new Error('Cyclic superseded returns')
      visited.add(cursor.id); cursor = cursor.supersedesId ? get('returns', cursor.supersedesId) : undefined
    }
  }
  for (const row of store.events) {
    evidence(row.evidenceIds)
    for (const field of COMPONENTS) {
      const amount = BigInt(row[field])
      if (row.kind === 'credit-transfer' && amount !== 0n) throw new Error('Credit transfer event must be zero; use linked opposite allocations')
      if (['refund', 'reversal'].includes(row.kind) ? amount > 0n : row.kind !== 'credit-transfer' && amount < 0n) throw new Error('Invalid settlement sign')
    }
  }
  for (const row of store.allocations) {
    const event = get('events', row.eventId), obligation = get('obligations', row.obligationId)
    if (event.currency !== obligation.currency) throw new Error('Cross-currency allocation requires an unsupported explicit conversion record')
    evidence(row.evidenceIds)
    if (row.deleted) continue
    if (event.deleted || obligation.deleted) throw new Error('Live allocation references deleted event/obligation')
    for (const field of COMPONENTS) if (event.kind !== 'credit-transfer' &&
      (BigInt(row[field]) * BigInt(event[field]) < 0n || (BigInt(event[field]) === 0n && BigInt(row[field]) !== 0n))) throw new Error('Allocation sign/zero mismatch')
  }
  for (const event of live(store.events)) for (const field of COMPONENTS) {
    const total = live(store.allocations).filter(row => row.eventId === event.id).reduce((n, row) => n + BigInt(row[field]), 0n)
    const amount = BigInt(event[field])
    if (event.kind === 'credit-transfer' ? total !== 0n : amount >= 0n ? total < 0n || total > amount : total > 0n || total < amount) throw new Error('Allocation total exceeds event or unbalanced credit transfer')
  }
  for (const row of store.adjustments) {
    if (row.amount.currency !== get('obligations', row.obligationId).currency) throw new Error('Adjustment currency mismatch')
    evidence(row.evidenceIds)
  }
  let revision = 0
  const changes = new Set<string>()
  for (const change of store.changes) {
    if (changes.has(change.id) || change.storeRevision <= revision || change.storeRevision > store.revision) throw new Error('Invalid change history revision')
    changes.add(change.id); revision = change.storeRevision
    for (const record of change.records) {
      if (!record.before && !record.after) throw new Error('Empty change record')
      for (const snapshot of [record.before, record.after]) if (snapshot && snapshot.id !== record.id) throw new Error('Change snapshot identity mismatch')
    }
  }
  return store
}
