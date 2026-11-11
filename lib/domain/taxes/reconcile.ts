import { COMPONENTS, live, type TaxHistoryStoreV1, type Money, type Settlement } from './history'

export type TaxHistoryProjection = ReturnType<typeof reconcileTaxHistory>
export function reconcileTaxHistory(store: TaxHistoryStoreV1) {
  const hasEvidence = (ids: string[]) => ids.length > 0 && ids.every(id => live(store.evidence).some(row => row.id === id))
  const obligations = live(store.obligations).map(obligation => {
    const issues: string[] = []
    const candidates = [
      ...live(store.returns).filter(row => row.obligationId === obligation.id).map(row => ({ kind: 'return' as const, id: row.id, recordRevision: row.recordRevision, liability: row.liability, usable: row.status === 'accepted', evidenceIds: row.evidenceIds })),
      ...live(store.assessments).filter(row => row.obligationId === obligation.id).map(row => ({ kind: 'assessment' as const, id: row.id, recordRevision: row.recordRevision, liability: row.liability, usable: true, evidenceIds: row.evidenceIds })),
    ]
    const basis = obligation.effectiveBasis
    const selected = basis && candidates.find(row => row.kind === basis.kind && row.id === basis.id && row.recordRevision === basis.recordRevision)
    if (!selected || !selected.usable || !hasEvidence(selected.evidenceIds) || !basis || !hasEvidence(basis.evidenceIds)) issues.push('A current, evidenced effective liability basis needs review')
    if (!obligation.coverageConfirmed) issues.push('Settlement coverage is unconfirmed')
    const allocations = live(store.allocations).filter(row => row.obligationId === obligation.id)
    const events = allocations.map(row => store.events.find(event => event.id === row.eventId)!)
    if (events.some(event => event.review !== 'authority-confirmed' || !hasEvidence(event.evidenceIds))) issues.push('Settlement authority confirmation/evidence is incomplete')
    if (allocations.some(row => !hasEvidence(row.evidenceIds))) issues.push('Allocation evidence is incomplete')
    const adjustments = live(store.adjustments).filter(row => row.obligationId === obligation.id)
    if (adjustments.some(row => !hasEvidence(row.evidenceIds))) issues.push('Adjustment evidence is incomplete')
    const sums = Object.fromEntries(COMPONENTS.map(field => [field, allocations.reduce((n, row) => n + BigInt(row[field]), 0n).toString()])) as Record<typeof COMPONENTS[number], string>
    const credits = adjustments.reduce((n, row) => n + BigInt(row.amount.minor), 0n)
    return {
      id: obligation.id, taxUnitId: obligation.taxUnitId, taxYear: obligation.taxYear,
      authority: obligation.authority, currency: obligation.currency,
      status: issues.length ? 'provisional' as const : 'confirmed' as const,
      liabilityMinor: selected?.liability.minor ?? null,
      principalSettledMinor: sums.principal, interestSettledMinor: sums.interest, penaltySettledMinor: sums.penalty,
      adjustmentMinor: credits.toString(),
      outstandingMinor: issues.length || !selected ? null : (BigInt(selected.liability.minor) - BigInt(sums.principal) - credits).toString(),
      candidates, issues,
    }
  })
  const unallocated = live(store.events).filter(event => event.kind !== 'credit-transfer').map(event => {
    const sums = Object.fromEntries(COMPONENTS.map(field => [field,
      (BigInt(event[field]) - live(store.allocations).filter(row => row.eventId === event.id).reduce((n, row) => n + BigInt(row[field]), 0n)).toString(),
    ])) as Record<typeof COMPONENTS[number], string>
    return { eventId: event.id, currency: event.currency, ...sums }
  }).filter(row => COMPONENTS.some(field => row[field] !== '0'))
  return { obligations, cashEvents: live(store.events).filter((event: Settlement) => event.kind !== 'credit-transfer'), unallocated,
    issues: obligations.flatMap(row => row.issues.map(message => ({ obligationId: row.id, message }))), stateRevision: store.revision }
}

export function formatMoney(money: Money) {
  const amount = BigInt(money.minor), negative = amount < 0n, absolute = negative ? -amount : amount
  const unit = money.currency === 'USD' ? `${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}` : absolute.toString()
  return `${money.currency} ${negative ? '-' : ''}${unit}`
}
