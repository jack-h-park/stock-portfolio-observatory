import { Badge, type Tone } from '@/components/ui'
import { fmtDateTime, fmtDuration } from '@/lib/format'
import type { FreshnessItem, FreshnessStatus } from '@/lib/adapters/portfolio-db'
import { FRESHNESS_DESCRIPTIONS, FRESHNESS_LABELS } from '@/lib/ui-copy'

const STATUS_TONE: Record<FreshnessStatus, Tone> = {
  fresh: 'success',
  stale: 'warning',
  drift: 'warning',
  missing: 'danger',
}

export function FreshnessBadge({ status }: { status: FreshnessStatus }) {
  return (
    <span title={FRESHNESS_DESCRIPTIONS[status]} aria-label={`${FRESHNESS_LABELS[status]}: ${FRESHNESS_DESCRIPTIONS[status]}`}>
      <Badge tone={STATUS_TONE[status]}>{FRESHNESS_LABELS[status]}</Badge>
    </span>
  )
}

export function FreshnessRows({ items }: { items: FreshnessItem[] }) {
  return (
    <ul className="divide-y divide-line-subtle">
      {items.map((item) => (
        <li key={item.key} className="flex flex-col gap-1 py-2.5 lg:flex-row lg:items-center lg:gap-3">
          <FreshnessBadge status={item.status} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{item.label}</span>
          <span className="text-[12px] tabular-nums text-ink-3">{item.observedAt ? fmtDateTime(item.observedAt) : '기록 없음'}</span>
          <span className="text-[12px] tabular-nums text-ink-3">{fmtDuration(item.ageMs)} 경과</span>
          <span className="text-[12px] text-ink-3">{item.detail}</span>
        </li>
      ))}
    </ul>
  )
}

export function FreshnessInline({ item }: { item: FreshnessItem }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
      <FreshnessBadge status={item.status} />
      <span className="tabular-nums">{fmtDuration(item.ageMs)} 경과</span>
      <span>{item.detail}</span>
    </span>
  )
}
