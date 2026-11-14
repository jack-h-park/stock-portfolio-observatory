import { object, text } from '@/lib/domain/assets/account-inventory/validation'

export type RobinhoodSnapshotIdentity = { label: string | null; issue: string | null }

/** Provider-declared number/nickname relationship only; never match by suffix. */
export function readRobinhoodSnapshotIdentities(value: unknown): RobinhoodSnapshotIdentity[] {
  if (!Array.isArray(value)) return [{ label: null, issue: 'robinhood_snapshot_invalid' }]
  const entries = value.map(v => {
    const row = object(v) ? v : {}
    const field = (key: string) => text(row[key]) ? (row[key] as string).trim() : null
    const explicit = field('account'), number = field('accountNumber') ?? field('account_number'), nickname = field('nickname')
    const invalid = !object(v) || ['account','accountNumber','account_number','nickname'].some(k => row[k] != null && typeof row[k] !== 'string') || (field('accountNumber') && field('account_number') && field('accountNumber') !== field('account_number'))
    return { explicit, number, nickname, invalid }
  })
  const candidates = entries.map(entry => {
    const repeatedNumber = entry.number && entries.filter(other => other.number === entry.number).length > 1
    const repeatedLabel = entry.explicit && entries.filter(other => other.explicit === entry.explicit).length > 1
    const ambiguousStrategy = !entry.explicit && entry.nickname && entries.filter(other => other.nickname === entry.nickname).length > 1
    if (entry.invalid || repeatedNumber || repeatedLabel || ambiguousStrategy) return { label: null, issue: 'robinhood_snapshot_identity_ambiguous' }
    if (entry.explicit) return { label: entry.explicit, issue: null }
    if (entry.number && entry.nickname) return { label: `Robinhood ${entry.nickname}`, issue: null }
    // A full identifier without a strategy stays a source-only reference. It is
    // not folded into numbered display labels or persisted as a canonical ID.
    if (entry.number) return { label: `Robinhood accountNumber ${entry.number}`, issue: null }
    return { label: null, issue: 'robinhood_snapshot_identity_unresolved' }
  })
  // An explicit label may collide with a label derived from another supported
  // schema. Check the final names, not just each individual input field.
  return candidates.map(candidate => candidate.label && candidates.filter(other => other.label === candidate.label).length > 1
    ? { label: null, issue: 'robinhood_snapshot_identity_ambiguous' } : candidate)
}
