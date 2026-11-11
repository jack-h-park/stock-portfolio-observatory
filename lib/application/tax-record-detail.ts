import { live, type Collection, type HistoryRecord, type TaxHistoryStoreV1 } from '@/lib/domain/taxes/history'
import { reconcileTaxHistory } from '@/lib/domain/taxes/reconcile'

export function getTaxRecordDetail(store: TaxHistoryStoreV1, id: string) {
  const obligation = live(store.obligations).find((row) => row.id === id)
  if (!obligation) return null
  const row = reconcileTaxHistory(store).obligations.find((item) => item.id === id)!
  const versions = [
    ...store.returns
      .filter((item) => item.obligationId === id)
      .map((item) => ({
        kind: 'return' as const,
        id: item.id,
        recordRevision: item.recordRevision,
        status: item.status,
        supersedesId: item.supersedesId,
        date: item.filedDate ?? null,
        statusDate: item.statusDate ?? null,
        liability: item.liability,
        evidenceIds: item.evidenceIds,
        deleted: item.deleted ?? false,
      })),
    ...store.assessments
      .filter((item) => item.obligationId === id)
      .map((item) => ({
        kind: 'assessment' as const,
        id: item.id,
        recordRevision: item.recordRevision,
        status: 'assessed',
        supersedesId: undefined,
        date: item.date,
        statusDate: null,
        liability: item.liability,
        evidenceIds: item.evidenceIds,
        deleted: item.deleted ?? false,
      })),
  ]
  const allocations = live(store.allocations).filter((item) => item.obligationId === id)
  const events = live(store.events).filter((event) => allocations.some((item) => item.eventId === event.id))
  const adjustments = store.adjustments.filter((item) => item.obligationId === id)
  const related = new Map<Collection, Set<string>>()
  const add = (collection: Collection, recordId: string) =>
    related.set(collection, new Set([...(related.get(collection) ?? []), recordId]))
  add('obligations', id)
  add('taxUnits', obligation.taxUnitId)
  for (const collection of ['returns', 'assessments', 'allocations', 'adjustments'] as const)
    for (const record of store[collection])
      if (record.obligationId === id) {
        add(collection, record.id)
        if ('eventId' in record) add('events', record.eventId)
      }
  // Historical allocation moves/tombstones must not erase the earlier relationship.
  for (const change of store.changes)
    for (const entry of change.records)
      for (const snapshot of [entry.before, entry.after]) {
        if (
          snapshot &&
          'obligationId' in snapshot &&
          snapshot.obligationId === id &&
          ['returns', 'assessments', 'allocations', 'adjustments'].includes(entry.collection)
        ) {
          add(entry.collection, entry.id)
          if ('eventId' in snapshot) add('events', snapshot.eventId)
        }
      }
  const evidenceIds = new Set<string>(obligation.effectiveBasis?.evidenceIds ?? [])
  const capture = (record: HistoryRecord) => {
    if ('evidenceIds' in record) for (const evidenceId of record.evidenceIds) evidenceIds.add(evidenceId)
    if ('effectiveBasis' in record && record.effectiveBasis)
      for (const evidenceId of record.effectiveBasis.evidenceIds) evidenceIds.add(evidenceId)
  }
  for (const [collection, ids] of related)
    for (const record of store[collection]) if (ids.has(record.id)) capture(record)
  for (const evidenceId of evidenceIds) add('evidence', evidenceId)
  const auditChanges = store.changes.filter((change) =>
    change.records.some((entry) => related.get(entry.collection)?.has(entry.id)),
  )
  for (const change of auditChanges)
    for (const entry of change.records)
      if (related.get(entry.collection)?.has(entry.id))
        for (const snapshot of [entry.before, entry.after]) if (snapshot) capture(snapshot)
  return { obligation, row, versions, allocations, events, adjustments, evidenceIds: [...evidenceIds], auditChanges }
}
