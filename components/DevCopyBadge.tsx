import { Badge } from '@/components/ui'
import { getMeta } from '@/lib/adapters/portfolio-db'
import { devCopyNotice } from '@/lib/dev-copy'
import { fmtDate } from '@/lib/format'
import type { Language } from '@/lib/i18n'
import { getUiCopy } from '@/lib/ui-copy'

/** Renders nothing in the production build. See lib/dev-copy.ts. */
export function DevCopyBadge({ language }: { language: Language }) {
  if (process.env.NODE_ENV === 'production') return null
  let ingestedAt: string | null = null
  try {
    ingestedAt = getMeta().ingested_at ?? null
  } catch {
    // No database yet (a fresh clone before seed:sample): the label still applies.
  }
  const notice = devCopyNotice(process.env.NODE_ENV, ingestedAt)
  if (!notice) return null
  const copy = getUiCopy(language).devCopy
  const when = notice.ingestedAt
    ? [copy.ingested(fmtDate(notice.ingestedAt)), notice.ageDays == null ? null : copy.age(notice.ageDays)].filter(Boolean).join(' · ')
    : copy.unknown
  return (
    <p className="mb-4 flex flex-wrap items-center gap-2 text-label text-ink-3" title={copy.description}>
      <Badge tone="warning">{copy.label}</Badge>
      <span className="tabular-nums">{when}</span>
    </p>
  )
}
