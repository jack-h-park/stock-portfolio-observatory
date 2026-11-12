import * as React from 'react'
import type { Language } from '@/lib/i18n'
import { getUiCopy } from '@/lib/ui-copy'

/** Deployment copy only. The gateway, not this notice, enforces device access. */
export function PrivateAccessNotice({
  language,
  mode,
  notice,
}: {
  language: Language
  mode: string
  notice?: string
}) {
  if (mode !== 'private' || notice !== 'owner-devices') return null

  const { title, description } = getUiCopy(language).common.privateAccess

  return (
    <aside aria-label={title} className="mb-5 rounded-lg border border-line bg-card px-4 py-3 text-sm text-ink-2">
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 leading-relaxed">{description}</p>
    </aside>
  )
}
