import { COMPONENTS, live, type Components, type TaxHistoryStoreV1 } from '@/lib/domain/taxes/history'
import { reconcileTaxHistory } from '@/lib/domain/taxes/reconcile'

/** A read-only view of recorded obligations, never a new annual tax calculation. */
export function getAnnualTaxSummary(store: TaxHistoryStoreV1) {
  const projection = reconcileTaxHistory(store)
  const evidence = new Set(live(store.evidence).map(row => row.id))
  const linked = (ids: string[]) => ids.length > 0 && ids.every(id => evidence.has(id))
  const events = new Map(live(store.events).map(row => [row.id, row]))
  const obligations = new Map(live(store.obligations).map(row => [row.id, row]))
  const units = new Set(live(store.taxUnits).map(row => row.id))
  const rows = projection.obligations.filter(row => units.has(row.taxUnitId)).map(row => {
    const obligation = obligations.get(row.id)!, basis = obligation.effectiveBasis
    const selected = basis && row.candidates.find(candidate => candidate.kind === basis.kind && candidate.id === basis.id && candidate.recordRevision === basis.recordRevision)
    const liabilityMinor = selected?.usable && linked(selected.evidenceIds) && basis && linked(basis.evidenceIds) ? row.liabilityMinor : null
    const buckets: Record<'payments' | 'withholding' | 'refunds' | 'reversals', Components | null> = { payments: null, withholding: null, refunds: null, reversals: null }
    let excludedAllocations = 0, undatedAllocations = 0, recordedAllocations = 0
    let interest = 0n, penalty = 0n
    for (const allocation of live(store.allocations).filter(item => item.obligationId === row.id)) {
      const event = events.get(allocation.eventId)
      if (event?.kind === 'credit-transfer') continue // Not cash, never a payment or refund.
      if (!event || event.review === 'unreviewed' || !linked(event.evidenceIds) || !linked(allocation.evidenceIds)) {
        excludedAllocations++
        continue
      }
      const key = event.kind === 'withholding' ? 'withholding' : event.kind === 'refund' ? 'refunds' : event.kind === 'reversal' ? 'reversals' : 'payments'
      const bucket = buckets[key] ?? { principal: '0', interest: '0', penalty: '0' }
      for (const field of COMPONENTS) {
        const value = BigInt(allocation[field])
        bucket[field] = (BigInt(bucket[field]) + (value < 0n ? -value : value)).toString()
      }
      buckets[key] = bucket
      interest += BigInt(allocation.interest)
      penalty += BigInt(allocation.penalty)
      recordedAllocations++
      if (!event.date) undatedAllocations++
    }
    const adjustments = live(store.adjustments).filter(item => item.obligationId === row.id)
    const excludedAdjustments = adjustments.filter(item => !linked(item.evidenceIds)).length
    return {
      id: row.id, taxUnitId: row.taxUnitId, taxYear: row.taxYear, authority: row.authority,
      taxType: obligation.taxType, currency: row.currency, status: row.status, liabilityMinor,
      outstandingMinor: row.outstandingMinor, ...buckets,
      adjustmentMinor: adjustments.length && !excludedAdjustments ? row.adjustmentMinor : null,
      excludedAdjustments,
      interestMinor: recordedAllocations ? interest.toString() : null,
      penaltyMinor: recordedAllocations ? penalty.toString() : null,
      excludedAllocations, undatedAllocations,
    }
  }).sort((a, b) => b.taxYear - a.taxYear || a.taxUnitId.localeCompare(b.taxUnitId) || a.authority.localeCompare(b.authority) || a.currency.localeCompare(b.currency) || a.id.localeCompare(b.id))
  return {
    stateRevision: projection.stateRevision,
    years: [...new Set(rows.map(row => row.taxYear))].map(year => ({ year, rows: rows.filter(row => row.taxYear === year) })),
    unallocatedEventCount: new Set(projection.unallocated.map(row => row.eventId)).size,
  }
}
export type AnnualTaxSummaryData = ReturnType<typeof getAnnualTaxSummary>
