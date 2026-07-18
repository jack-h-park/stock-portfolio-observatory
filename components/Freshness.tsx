import { Badge, type Tone } from '@/components/ui'
import { fmtDateTime, fmtDuration } from '@/lib/format'
import type { FreshnessItem, FreshnessStatus } from '@/lib/adapters/portfolio-db'

const STATUS_TONE: Record<FreshnessStatus, Tone> = {
  fresh: 'success',
  stale: 'warning',
  drift: 'warning',
  missing: 'danger',
}

export function FreshnessBadge({ status }: { status: FreshnessStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{status}</Badge>
}

export function FreshnessRows({ items }: { items: FreshnessItem[] }) {
  return (
    <ul className="divide-y divide-line-subtle">
      {items.map((item) => (
        <li key={item.key} className="flex flex-col gap-1 py-2.5 lg:flex-row lg:items-center lg:gap-3">
          <FreshnessBadge status={item.status} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{item.label}</span>
          <span className="text-[12px] tabular-nums text-ink-3">{item.observedAt ? fmtDateTime(item.observedAt) : 'n/a'}</span>
          <span className="text-[12px] tabular-nums text-ink-3">{fmtDuration(item.ageMs)} old</span>
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
      <span className="tabular-nums">{fmtDuration(item.ageMs)} old</span>
      <span>{item.detail}</span>
    </span>
  )
}
