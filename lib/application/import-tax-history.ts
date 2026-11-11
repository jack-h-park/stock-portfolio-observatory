import { createHash } from 'node:crypto'
import {
  canonical,
  commitTaxHistory,
  readTaxHistory,
  TaxHistoryConflictError,
  TaxHistoryReadOnlyError,
} from '@/lib/adapters/tax-history-store'
import { config } from '@/config'
import {
  COLLECTIONS,
  validateTaxHistory,
  type Collection,
  type HistoryRecord,
  type TaxHistoryStoreV1,
} from '@/lib/domain/taxes/history'

export type ReviewedRecordChange = {
  collection: Collection
  id: string
  expectedRecordRevision: number
  incomingDigest: string
}
export type ReviewedMatchDecision = {
  incomingEventId: string
  existingEventId: string
  action?: 'merge' | 'keep-separate'
}
const content = (row: HistoryRecord) =>
  canonical(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'recordRevision')))
const digest = (row: HistoryRecord) => createHash('sha256').update(content(row)).digest('hex')

function prepareIncoming(current: TaxHistoryStoreV1, input: TaxHistoryStoreV1) {
  const incoming = validateTaxHistory(input)
  const basisInvalidations: { obligationId: string; reason: string }[] = []
  const obligations = new Map(current.obligations.map((row) => [row.id, row]))
  for (const row of incoming.obligations) obligations.set(row.id, row)
  for (const obligation of obligations.values()) {
    const basis = obligation.effectiveBasis
    if (!basis || obligation.deleted) continue
    const collection = basis.kind === 'return' ? 'returns' : 'assessments'
    const source = incoming[collection].find((row) => row.id === basis.id)
    const before = current[collection].find((row) => row.id === basis.id)
    const importedObligation = incoming.obligations.find((row) => row.id === obligation.id)
    let acceptedRevision: number | undefined
    if (
      source &&
      !source.deleted &&
      source.obligationId === obligation.id &&
      importedObligation &&
      basis.recordRevision === source.recordRevision
    ) {
      if (!before) acceptedRevision = 1
      else if (content(before) === content(source)) acceptedRevision = before.recordRevision
      else if (source.recordRevision === before.recordRevision + 1) acceptedRevision = before.recordRevision + 1
    } else if (
      before &&
      !before.deleted &&
      before.obligationId === obligation.id &&
      basis.recordRevision === before.recordRevision &&
      (!source || content(before) === content(source))
    ) {
      acceptedRevision = before.recordRevision
    }
    if (acceptedRevision == null)
      basisInvalidations.push({
        obligationId: obligation.id,
        reason: 'Reviewed basis does not identify the accepted content revision',
      })
    else if (importedObligation) importedObligation.effectiveBasis!.recordRevision = acceptedRevision
  }
  return { incoming, basisInvalidations }
}
const samePayment = (a: TaxHistoryStoreV1['events'][number], b: TaxHistoryStoreV1['events'][number]) =>
  !a.deleted &&
  !b.deleted &&
  a.currency === b.currency &&
  a.kind === b.kind &&
  a.date === b.date &&
  a.principal === b.principal &&
  a.interest === b.interest &&
  a.penalty === b.penalty

export function previewTaxHistoryImport(currentInput: TaxHistoryStoreV1, incomingInput: TaxHistoryStoreV1) {
  const current = validateTaxHistory(currentInput),
    { incoming, basisInvalidations } = prepareIncoming(current, incomingInput)
  const additions: { collection: Collection; id: string }[] = [],
    changes: ReviewedRecordChange[] = [],
    unchanged: { collection: Collection; id: string }[] = []
  for (const collection of COLLECTIONS)
    for (const row of incoming[collection]) {
      const before = current[collection].find((item) => item.id === row.id)
      if (!before) additions.push({ collection, id: row.id })
      else if (content(before) === content(row)) unchanged.push({ collection, id: row.id })
      else
        changes.push({
          collection,
          id: row.id,
          expectedRecordRevision: before.recordRevision,
          incomingDigest: digest(row),
        })
    }
  const pool = current.events.map((row) => incoming.events.find((item) => item.id === row.id) ?? row)
  const possibleDuplicates: { incomingEventId: string; existingEventId: string }[] = []
  for (const row of incoming.events
    .filter((item) => !current.events.some((old) => old.id === item.id))
    .sort((a, b) => a.id.localeCompare(b.id))) {
    for (const candidate of pool)
      if (samePayment(row, candidate))
        possibleDuplicates.push({ incomingEventId: row.id, existingEventId: candidate.id })
    pool.push(row)
  }
  return { additions, changes, unchanged, possibleDuplicates, basisInvalidations, stateRevision: current.revision }
}

export function applyTaxHistoryImport(
  filePath: string,
  options: {
    expectedRevision: number
    incoming: TaxHistoryStoreV1
    reviewedMatchDecisions: ReviewedMatchDecision[]
    reviewedRecordChanges: ReviewedRecordChange[]
    reviewedProvisionalBases?: string[]
    reason: string
    stateWritable?: boolean
  },
) {
  if (!(options.stateWritable ?? config.finance.stateWritable)) throw new TaxHistoryReadOnlyError()
  const current = readTaxHistory(filePath)
  if (current.revision !== options.expectedRevision) throw new TaxHistoryConflictError()
  const preview = previewTaxHistoryImport(current, options.incoming),
    { incoming } = prepareIncoming(current, options.incoming)
  for (const change of preview.changes)
    if (!options.reviewedRecordChanges.some((decision) => canonical(decision) === canonical(change)))
      throw new Error('Changed import record requires reviewed revision and digest')
  for (const issue of preview.basisInvalidations)
    if (!options.reviewedProvisionalBases?.includes(issue.obligationId))
      throw new Error('Import invalidates a reviewed basis; review the provisional obligation explicitly')
  const matches = new Map<string, string>(),
    reviewed = new Set<string>()
  for (const decision of options.reviewedMatchDecisions) {
    if (
      !['merge', 'keep-separate'].includes(decision.action ?? 'merge') ||
      !preview.possibleDuplicates.some(
        (candidate) =>
          candidate.incomingEventId === decision.incomingEventId &&
          candidate.existingEventId === decision.existingEventId,
      )
    )
      throw new Error('Invalid reviewed duplicate match')
    if (reviewed.has(decision.incomingEventId)) throw new Error('Duplicate match decision')
    reviewed.add(decision.incomingEventId)
    if (decision.action !== 'keep-separate') matches.set(decision.incomingEventId, decision.existingEventId)
  }
  if (preview.possibleDuplicates.some((candidate) => !reviewed.has(candidate.incomingEventId)))
    throw new Error('Possible duplicate settlement requires a reviewed merge or keep-separate decision')
  const next = structuredClone(current)
  for (const collection of COLLECTIONS)
    for (const original of incoming[collection]) {
      const row = structuredClone(original),
        rows = next[collection] as HistoryRecord[],
        index = rows.findIndex((before) => before.id === row.id)
      row.recordRevision = index < 0 ? 1 : rows[index].recordRevision
      if (index < 0) rows.push(row)
      else rows[index] = row
    }
  const targetOf = (id: string) => {
    const visited = new Set<string>()
    while (matches.has(id)) {
      if (visited.has(id)) throw new Error('Cyclic match decisions')
      visited.add(id)
      id = matches.get(id)!
    }
    return id
  }
  for (const [sourceId] of matches) {
    const source = next.events.find((row) => row.id === sourceId)!,
      target = next.events.find((row) => row.id === targetOf(sourceId))!
    target.evidenceIds = [...new Set([...target.evidenceIds, ...source.evidenceIds])]
  }
  next.events = next.events.filter((row) => !matches.has(row.id))
  for (const source of incoming.allocations) {
    if (!matches.has(source.eventId) || source.deleted) continue
    const allocation = next.allocations.find((row) => row.id === source.id)!
    allocation.eventId = targetOf(source.eventId)
    const equivalent = next.allocations.find(
      (row) =>
        !row.deleted &&
        row.id !== allocation.id &&
        row.eventId === allocation.eventId &&
        row.obligationId === allocation.obligationId &&
        row.principal === allocation.principal &&
        row.interest === allocation.interest &&
        row.penalty === allocation.penalty &&
        row.effectiveDate === allocation.effectiveDate,
    )
    if (equivalent) {
      equivalent.evidenceIds = [...new Set([...equivalent.evidenceIds, ...allocation.evidenceIds])]
      if (current.allocations.some((row) => row.id === allocation.id)) allocation.deleted = true
      else next.allocations = next.allocations.filter((row) => row.id !== allocation.id)
    }
  }
  return commitTaxHistory(filePath, {
    expectedRevision: options.expectedRevision,
    next,
    actor: 'import',
    reason: options.reason,
    stateWritable: options.stateWritable,
  })
}
