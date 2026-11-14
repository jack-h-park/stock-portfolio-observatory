import { strictIsoDate } from '@/lib/domain/assets/query-coverage'
import type { EvidenceSignal, Lifecycle, Requirement, SourceAssessment } from './types'
import { sorted } from './validation'

const days: Readonly<Record<string, number>> = Object.freeze({ 'us-14': 14, 'kr-35': 35, 'samsung-120': 120, 'bithumb-14': 14, 'robinhood-snapshot-7': 7, 'robinhood-csv-14': 14, 'bank-30': 30, 'pension-180': 180, 'gold-90': 90 })
const policyKinds: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'us-14': ['positions', 'activity', 'balance'], 'kr-35': ['positions', 'activity'],
  'samsung-120': ['activity'], 'bithumb-14': ['positions', 'activity'],
  'robinhood-snapshot-7': ['positions'], 'robinhood-csv-14': ['activity'],
  'bank-30': ['activity', 'balance'], 'pension-180': ['pension_snapshot'], 'gold-90': ['activity', 'positions'],
})
const shift = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const age = (date: string, today: string) => Math.floor((Date.parse(today) - Date.parse(date)) / 86400000)
export function assessSource(requirement: Requirement, signals: EvidenceSignal[], legacyStarts: unknown[], lifecycle: Lifecycle, asOfDate: string, unresolved: boolean): SourceAssessment {
  const end = lifecycle.state === 'closed' ? lifecycle.closedOn ?? null : asOfDate
  const reasons: string[] = []
  const refs = sorted(signals.flatMap(s => s.refs))
  const result: SourceAssessment = { kind: requirement.kind, state: 'missing', reasons, evidenceRefs: refs, throughDate: null, history: { state: 'not_requested' }, reconciliation: signals.some(s => s.reconciliation === 'issues') ? 'issues' : signals.length && signals.every(s => s.reconciliation === 'pass') ? 'pass' : 'unconfirmed' }
  const starts = [...legacyStarts, ...(requirement.historyFrom === undefined ? [] : [requirement.historyFrom])]
  const conflict = starts.some(s => !strictIsoDate(s)) || new Set(starts).size > 1
  const start = !conflict && starts.length ? String(starts[0]) : null
  if (conflict) { reasons.push('history_requirement_conflict'); result.history = { state: 'unconfirmed' } }
  else if (start) {
    result.history = { state: 'unconfirmed', from: start, ...(end ? { to: end } : {}) }
    if (!end || start > end) reasons.push('invalid_history_interval')
  }
  const maxAge = Object.hasOwn(days, requirement.freshnessPolicyId) && policyKinds[requirement.freshnessPolicyId].includes(requirement.kind) ? days[requirement.freshnessPolicyId] : undefined
  if (unresolved) { result.state = 'unconfirmed'; reasons.push('identity_owner_or_lifecycle_unresolved'); return result }
  if (maxAge === undefined) { result.state = 'unsupported'; reasons.push('unsupported_freshness_policy'); if (start) result.history.state = 'unsupported'; return result }
  if (signals.some(s => s.state === 'conflicting')) { result.state = 'conflicting'; reasons.push('evidence_conflict'); return result }
  if (!signals.length) { reasons.push('required_source_absent'); return result }
  if (!refs.length || signals.some(s => s.state === 'unconfirmed' || !strictIsoDate(s.throughDate) || s.throughDate! > asOfDate)) {
    result.state = 'unconfirmed'; reasons.push('period_or_date_unconfirmed'); return result
  }
  const dates = signals.map(s => s.throughDate!).sort()
  // Distinct artifacts are independent unless the supplying adapter has already
  // consolidated them into one identity-bound signal. Never choose the freshest.
  result.throughDate = dates[0]
  const lag = end ? Math.max(0, age(result.throughDate, end)) : null
  result.state = lag === null ? 'unconfirmed' : lag > maxAge ? 'stale' : lag >= Math.max(1, maxAge - 4) ? 'due_soon' : 'current'
  if (signals.some(s => s.missingDisposal)) reasons.push('missing_disposal')
  if (result.reconciliation === 'issues') reasons.push('reconciliation_issues')
  if (start && end && start <= end && !conflict) {
    const periods = signals.flatMap(s => s.periods ?? [])
    if (periods.length && periods.every(p => strictIsoDate(p.from) && strictIsoDate(p.to) && p.from <= p.to && p.to <= asOfDate)) {
      let cursor = start
      const gaps: { from: string; to: string }[] = []
      for (const p of [...periods].sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : 0)) {
        if (p.to < cursor || p.from > end) continue
        if (p.from > cursor) gaps.push({ from: cursor, to: shift(p.from, -1) })
        if (p.to >= cursor) cursor = shift(p.to, 1)
      }
      if (cursor <= end) gaps.push({ from: cursor, to: end })
      result.history = { state: gaps.length ? 'gaps' : 'covered', from: start, to: end, gaps }
    } else reasons.push('historical_periods_unconfirmed')
    // #314 is an explicit partial gap signal, never proof that no other gap exists.
    for (const s of signals) if (s.historyGap) {
      const g = s.historyGap
      if (strictIsoDate(g.from) && strictIsoDate(g.to) && g.from <= g.to && g.from >= start && g.to <= end) result.history = { state: 'gaps', from: start, to: end, gaps: [...(result.history.gaps ?? []), { ...g }] }
      else { result.history = { state: 'unconfirmed', from: start, to: end }; reasons.push('invalid_history_gap') }
    }
  }
  return result
}
