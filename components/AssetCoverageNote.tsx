import type { NetWorth } from '@/lib/net-worth'
import type { Language } from '@/lib/i18n'
import { getPageCopy } from '@/lib/ui-copy'

export function AssetCoverageNote({ summary, language }: { summary: NetWorth; language: Language }) {
  const count = summary.coverage?.omittedAssetCount ?? 0
  return <p className="mt-3 text-body text-ink-2">{getPageCopy('netWorth', language).coverageNote(count)}</p>
}
