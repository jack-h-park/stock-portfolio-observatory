import { inventoryPensionPolicies } from '@/lib/application/inventory-pension-policy'
import { projectAccountInventory, type EvidenceSignal, type MapRead, type Observation, type SourceKind } from '@/lib/domain/assets/account-inventory'
import { providerId, sorted } from '@/lib/domain/assets/account-inventory/validation'
import { strictIsoDate } from '@/lib/domain/assets/query-coverage'

export type RecordedAccountFact = {
  provider: string; account: string; kind: SourceKind; date: string | null
  refs: string[]; state: 'present' | 'unconfirmed' | 'conflicting'
  basis: 'database_observation' | 'declared_period' | 'owner_confirmation' | 'snapshot'
  periods?: { from: string; to: string }[]; empty?: boolean; missingDisposal?: boolean
}
export type AccountInventorySnapshot = { mapRead: MapRead; facts: RecordedAccountFact[]; readIssues: string[] }
export type AccountInventoryReviewModel = ReturnType<typeof buildAccountInventoryReview>

/** Recorded source facts only. Never infer ownership from a generated DB default. */
export function buildAccountInventoryReview(snapshot: AccountInventorySnapshot, clock: string) {
  const observations: Observation[] = [], evidenceSignals: EvidenceSignal[] = []
  // Group within kind as well as account: transaction dates must not displace a
  // snapshot date, and a declared activity period cannot certify positions.
  const groups = new Map<string, RecordedAccountFact[]>()
  for (const fact of snapshot.facts) {
    const key = JSON.stringify([providerId(fact.provider) ?? fact.provider, fact.account, fact.kind, strictIsoDate(fact.date) && fact.date! > clock.slice(0, 10) ? 'later' : 'eligible'])
    groups.set(key, [...(groups.get(key) ?? []), fact])
  }
  for (const key of [...groups.keys()].sort()) {
    const facts = groups.get(key)!
    const dates = facts.map(f => strictIsoDate(f.date)).filter((v): v is string => v !== null).sort()
    const refs = sorted(facts.flatMap(f => f.refs))
    observations.push({ key, providerId: providerId(facts[0].provider), account: facts[0].account, asOfDate: dates.at(-1) ?? null, evidenceRefs: refs })
    const recorded = facts.filter(f => f.basis !== 'database_observation')
    const usable = recorded.filter(f => f.state === 'present' && strictIsoDate(f.date))
    const conflict = recorded.some(f => f.state === 'conflicting')
    const unresolved = recorded.some(f => f.state === 'unconfirmed' || !strictIsoDate(f.date))
    const periods = usable.flatMap(f => f.periods ?? []).map(p => ({ ...p }))
    const uniquePeriods = [...new Map(periods.map(p => [JSON.stringify(p), p])).values()].sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : 1)
    evidenceSignals.push({ observationKey: key, kind: facts[0].kind,
      state: conflict ? 'conflicting' : unresolved ? 'unconfirmed' : usable.length ? 'present' : 'unconfirmed',
      throughDate: usable.map(f => f.date!).sort().at(-1) ?? null,
      refs: sorted((recorded.length ? recorded : facts).flatMap(f => f.refs)),
      ...(uniquePeriods.length ? { periods: uniquePeriods } : {}),
      ...(usable.some(f => f.empty) ? { empty: true } : {}),
      ...(facts.some(f => f.missingDisposal) ? { missingDisposal: true } : {}),
    })
  }
  const projection = projectAccountInventory({ mapRead: snapshot.mapRead, observations, evidenceSignals,
    requestedScope: { owners: ['self'], providers: 'all', wrappers: 'all', assetClasses: 'all', exclusions: [] },
    asOfDate: clock.slice(0, 10), clock, adapterVersion: 'inventory-v1' })
  const readIssues = sorted(snapshot.readIssues)
  if (readIssues.length) {
    projection.review = { state: 'unavailable', reasons: ['recorded_inputs_incomplete', ...readIssues] }
    projection.counts.confirmedExpected = null
  }
  return { projection, readIssues, pensionPolicies: inventoryPensionPolicies(snapshot.mapRead, clock.slice(0, 10)), recordedSources: evidenceSignals.map(s => ({ ...s })),
    // These are intentional read boundaries, not claims that acquisition failed.
    limitations: ['recorded_provenance_only', 'explicit_owner_review_required', 'unbound_aliases_not_guessed'] }
}
