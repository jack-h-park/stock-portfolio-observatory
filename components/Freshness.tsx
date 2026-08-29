import { Badge, type Tone } from '@/components/ui'
import { fmtDateTime, fmtDuration } from '@/lib/format'
import type { FreshnessItem, FreshnessStatus } from '@/lib/adapters/portfolio-db'
import type { Language } from '@/lib/i18n'
import { getUiCopy } from '@/lib/ui-copy'

const STATUS_TONE: Record<FreshnessStatus, Tone> = {
  fresh: 'success',
  stale: 'warning',
  drift: 'warning',
  missing: 'danger',
}

export function FreshnessBadge({ status, language = 'en' }: { status: FreshnessStatus; language?: Language }) {
  const copy = getUiCopy(language).freshness
  return (
    <span title={copy.descriptions[status]} aria-label={`${copy.labels[status]}: ${copy.descriptions[status]}`}>
      <Badge tone={STATUS_TONE[status]}>{copy.labels[status]}</Badge>
    </span>
  )
}

/**
 * `language` is required rather than defaulting to English. It used to default,
 * and /health's freshness-issues card simply omitted it — so that one card sat
 * in English on an otherwise Korean page and nothing complained. A default that
 * silently picks a language turns a missing prop into a rendering bug; this way
 * it is a compile error.
 */
export function FreshnessRows({ items, language }: { items: FreshnessItem[]; language: Language }) {
  const copy = getUiCopy(language).common
  return (
    <ul className="divide-y divide-line-subtle">
      {items.map((item) => (
        <li key={item.key} className="flex flex-col gap-1 py-2.5 lg:flex-row lg:items-center lg:gap-3">
          <FreshnessBadge status={item.status} language={language} />
          <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">{item.label}</span>
          <span className="text-caption tabular-nums text-ink-3">{item.observedAt ? fmtDateTime(item.observedAt) : copy.notRecorded}</span>
          <span className="text-caption tabular-nums text-ink-3">{fmtDuration(item.ageMs)} {copy.elapsed}</span>
          <span className="text-caption text-ink-3">{item.detail}</span>
        </li>
      ))}
    </ul>
  )
}

export function FreshnessInline({ item, language = 'en' }: { item: FreshnessItem; language?: Language }) {
  const copy = getUiCopy(language).common
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-label text-ink-3">
      <FreshnessBadge status={item.status} language={language} />
      <span className="tabular-nums">{fmtDuration(item.ageMs)} {copy.elapsed}</span>
      <span>{item.detail}</span>
    </span>
  )
}
