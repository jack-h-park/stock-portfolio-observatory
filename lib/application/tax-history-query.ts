import { COMPONENTS, isIsoDate, live, type TaxHistoryStoreV1 } from '@/lib/domain/taxes/history'
import { reconcileTaxHistory } from '@/lib/domain/taxes/reconcile'

export type TaxHistoryFilter = {
  taxUnitId: string
  taxYear?: number
  authority?: string
  view: 'tax-year' | 'cash-date'
  cashDateFrom?: string
  cashDateTo?: string
}
export function getTaxHistoryView(store: TaxHistoryStoreV1, filter: TaxHistoryFilter) {
  const allUnits = filter.taxUnitId === '__all__'
  if (!allUnits && !live(store.taxUnits).some((row) => row.id === filter.taxUnitId)) throw new Error('Unknown tax unit')
  if (filter.view !== 'tax-year' && filter.view !== 'cash-date') throw new Error('Invalid tax-history view')
  if (filter.view === 'tax-year' && filter.taxYear == null) throw new Error('Tax year is required')
  if (filter.taxYear != null && (!Number.isInteger(filter.taxYear) || filter.taxYear < 1900 || filter.taxYear > 2200))
    throw new Error('Invalid tax year')
  for (const date of [filter.cashDateFrom, filter.cashDateTo])
    if (date !== undefined && !isIsoDate(date)) throw new Error('Invalid cash date')
  if (filter.cashDateFrom && filter.cashDateTo && filter.cashDateFrom > filter.cashDateTo)
    throw new Error('Invalid cash date range')
  const projection = reconcileTaxHistory(store)
  const obligations = projection.obligations.filter(
    (row) =>
      (allUnits || row.taxUnitId === filter.taxUnitId) &&
      (filter.taxYear == null || row.taxYear === filter.taxYear) &&
      (!filter.authority || row.authority === filter.authority),
  )
  const ids = new Set(obligations.map((row) => row.id))
  const allocations = live(store.allocations).filter((row) => ids.has(row.obligationId))
  const missingOccurrenceDates: string[] = []
  const cashEvents = projection.cashEvents
    .filter((event) => allocations.some((row) => row.eventId === event.id))
    .filter((event) => {
      if (!event.date) {
        missingOccurrenceDates.push(event.id)
        return !filter.cashDateFrom && !filter.cashDateTo
      }
      return (
        (!filter.cashDateFrom || event.date >= filter.cashDateFrom) &&
        (!filter.cashDateTo || event.date <= filter.cashDateTo)
      )
    })
    .map((event) => ({
      ...event,
      taxUnitIds: [...new Set(allocations.filter(row => row.eventId === event.id).map(row => store.obligations.find(obligation => obligation.id === row.obligationId)!.taxUnitId))].sort(),
      wholeEvent: { principal: event.principal, interest: event.interest, penalty: event.penalty },
      ...Object.fromEntries(
        COMPONENTS.map((field) => [
          field,
          allocations
            .filter((row) => row.eventId === event.id)
            .reduce((n, row) => n + BigInt(row[field]), 0n)
            .toString(),
        ]),
      ),
    }))
  return {
    ...projection,
    obligations,
    cashEvents,
    issues: projection.issues.filter((row) => ids.has(row.obligationId)),
    missingOccurrenceDates,
    coverage: { confirmed: obligations.filter((row) => row.status === 'confirmed').length, total: obligations.length },
  }
}

type EstimateScope = { taxUnitId: string; taxYear: number; authority: string; currency: string; scope: string }
export function canCompareTaxEstimate(estimate: EstimateScope, reported: EstimateScope) {
  return (
    estimate.scope === 'annual-total' &&
    reported.scope === 'annual-total' &&
    (['taxUnitId', 'taxYear', 'authority', 'currency'] as const).every((key) => estimate[key] === reported[key])
  )
}
