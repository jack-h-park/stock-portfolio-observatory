import { createHash } from 'node:crypto'
import { canonical, commitTaxHistory, readTaxHistory, TaxHistoryConflictError, TaxHistoryReadOnlyError } from '@/lib/adapters/tax-history-store'
import { config } from '@/config'
import { COLLECTIONS, validateTaxHistory, type Collection, type HistoryRecord, type TaxHistoryStoreV1 } from '@/lib/domain/taxes/history'

export type ReviewedRecordChange = { collection: Collection; id: string; expectedRecordRevision: number; incomingDigest: string }
export type ReviewedMatchDecision = { incomingEventId: string; existingEventId: string }
const content = (row: HistoryRecord) => { const { recordRevision: _revision, ...rest } = row; return canonical(rest) }
const digest = (row: HistoryRecord) => createHash('sha256').update(content(row)).digest('hex')
export function previewTaxHistoryImport(currentInput: TaxHistoryStoreV1, incomingInput: TaxHistoryStoreV1) {
  const current = validateTaxHistory(currentInput), incoming = validateTaxHistory(incomingInput)
  const additions: { collection: Collection; id: string }[] = [], changes: ReviewedRecordChange[] = [], unchanged: { collection: Collection; id: string }[] = []
  for (const collection of COLLECTIONS) for (const row of incoming[collection]) {
    const old = current[collection].find(item => item.id === row.id)
    if (!old) additions.push({ collection, id: row.id })
    else if (content(old) === content(row)) unchanged.push({ collection, id: row.id })
    else changes.push({ collection, id: row.id, expectedRecordRevision: old.recordRevision, incomingDigest: digest(row) })
  }
  const possibleDuplicates = incoming.events.filter(row => !current.events.some(old => old.id === row.id)).flatMap(row =>
    current.events.filter(old => !old.deleted && !row.deleted && old.currency === row.currency && old.kind === row.kind && old.date === row.date && old.principal === row.principal && old.interest === row.interest && old.penalty === row.penalty)
      .map(old => ({ incomingEventId: row.id, existingEventId: old.id })))
  return { additions, changes, unchanged, possibleDuplicates, stateRevision: current.revision }
}
export function applyTaxHistoryImport(filePath: string, options: {
  expectedRevision: number; incoming: TaxHistoryStoreV1; reviewedMatchDecisions: ReviewedMatchDecision[];
  reviewedRecordChanges: ReviewedRecordChange[]; reason: string; stateWritable?: boolean;
}) {
  if (!(options.stateWritable ?? config.finance.stateWritable)) throw new TaxHistoryReadOnlyError()
  const current = readTaxHistory(filePath)
  if (current.revision !== options.expectedRevision) throw new TaxHistoryConflictError()
  const incoming = validateTaxHistory(options.incoming), preview = previewTaxHistoryImport(current, incoming)
  const next = structuredClone(current)
  for (const change of preview.changes) if (!options.reviewedRecordChanges.some(decision => canonical(decision) === canonical(change))) throw new Error('Changed import record requires reviewed revision and digest')
  const matches = new Map<string, string>()
  for (const decision of options.reviewedMatchDecisions) {
    if (!preview.possibleDuplicates.some(candidate => canonical(candidate) === canonical(decision))) throw new Error('Invalid reviewed duplicate match')
    if (matches.has(decision.incomingEventId)) throw new Error('Duplicate match decision')
    matches.set(decision.incomingEventId, decision.existingEventId)
  }
  if (preview.possibleDuplicates.some(candidate => !matches.has(candidate.incomingEventId))) throw new Error('Possible duplicate settlement requires reviewed match decision')
  for (const collection of COLLECTIONS) for (const original of incoming[collection]) {
    if (collection === 'events' && matches.has(original.id)) {
      const existing = next.events.find(row => row.id === matches.get(original.id))!
      const source = incoming.events.find(row => row.id === original.id)!
      existing.evidenceIds = [...new Set([...existing.evidenceIds, ...source.evidenceIds])]
      continue
    }
    const row = structuredClone(original)
    if (collection === 'allocations') {
      const allocation = row as TaxHistoryStoreV1['allocations'][number]
      const match = matches.get(allocation.eventId)
      if (match) {
        allocation.eventId = match
        if (next.allocations.some(existing => existing.eventId === match && existing.obligationId === allocation.obligationId && existing.principal === allocation.principal && existing.interest === allocation.interest && existing.penalty === allocation.penalty && existing.effectiveDate === allocation.effectiveDate)) continue
      }
    }
    const rows = next[collection] as HistoryRecord[], index = rows.findIndex(old => old.id === row.id)
    row.recordRevision = index < 0 ? 1 : rows[index].recordRevision
    if (index < 0) rows.push(row); else rows[index] = row
  }
  return commitTaxHistory(filePath, { expectedRevision: options.expectedRevision, next, actor: 'import', reason: options.reason, stateWritable: options.stateWritable })
}
