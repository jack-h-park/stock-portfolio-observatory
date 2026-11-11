import {
  readTaxHistory,
  commitTaxHistory,
  TaxHistoryConflictError,
  TaxHistoryReadOnlyError,
} from '@/lib/adapters/tax-history-store'
import { resolveTaxEvidence, type EvidenceRoots } from '@/lib/application/evidence-index'
import { live } from '@/lib/domain/taxes/history'

type EditBase = { id: string; expectedRevision: number; reason: string }
export type TaxHistoryEdit = EditBase &
  (
    | { kind: 'review-event'; review: 'unreviewed' | 'evidenced' }
    | { kind: 'select-basis'; basisKind: 'return' | 'assessment'; basisId: string }
    | { kind: 'relink-evidence'; relativePath: string }
  )
export function applyTaxHistoryEdit(
  filePath: string,
  edit: TaxHistoryEdit,
  context: { stateWritable: boolean; roots: EvidenceRoots },
) {
  if (!context.stateWritable) throw new TaxHistoryReadOnlyError()
  const next = readTaxHistory(filePath)
  if (edit.expectedRevision !== next.revision) throw new TaxHistoryConflictError()
  if (edit.kind === 'review-event') {
    const event = live(next.events).find((row) => row.id === edit.id)
    if (!event || !['unreviewed', 'evidenced'].includes(edit.review))
      throw new Error('Invalid settlement review; authority confirmation requires a reviewed import')
    if (edit.review === 'evidenced' && !event.evidenceIds.length) throw new Error('Settlement evidence is required')
    event.review = edit.review
  } else if (edit.kind === 'select-basis') {
    const obligation = live(next.obligations).find((row) => row.id === edit.id)
    const candidates = edit.basisKind === 'return' ? live(next.returns) : live(next.assessments)
    const candidate = candidates.find((row) => row.id === edit.basisId && row.obligationId === edit.id)
    if (!obligation || !candidate || !candidate.evidenceIds.length)
      throw new Error('An evidenced liability record is required')
    obligation.effectiveBasis = {
      kind: edit.basisKind,
      id: candidate.id,
      recordRevision: candidate.recordRevision,
      reviewedAt: new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
      evidenceIds: [...candidate.evidenceIds],
    }
  } else if (edit.kind === 'relink-evidence') {
    const evidence = live(next.evidence).find((row) => row.id === edit.id)
    if (!evidence) throw new Error('Unknown evidence')
    resolveTaxEvidence({ ...evidence, relativePath: edit.relativePath }, context.roots)
    evidence.relativePath = edit.relativePath
  } else throw new Error('Invalid tax-history edit')
  return commitTaxHistory(filePath, {
    expectedRevision: edit.expectedRevision,
    next,
    actor: 'local-user',
    reason: edit.reason,
    stateWritable: context.stateWritable,
  })
}
