import { Card, TextLink } from '@/components/ui'
import { readTaxHistory } from '@/lib/adapters/tax-history-store'
import { live } from '@/lib/domain/taxes/history'
import { reconcileTaxHistory } from '@/lib/domain/taxes/reconcile'
import { getPageCopy } from '@/lib/ui-copy'
import type { Language } from '@/lib/i18n'

export function FinanceTaxSummary({ language }: { language: Language }) {
  const copy = getPageCopy('taxHistory', language)
  let summary: string
  try {
    const store = readTaxHistory(),
      projection = reconcileTaxHistory(store)
    summary = projection.obligations.length
      ? `${copy.taxUnit}: ${live(store.taxUnits).length} · ${copy.recordTitle}: ${projection.obligations.length} · ${copy.provisional}: ${projection.obligations.filter((row) => row.status === 'provisional').length}`
      : copy.empty
  } catch {
    summary = copy.none
  }
  return (
    <Card title={copy.title} className="mb-5">
      <p className="mb-3 text-body text-ink-2">{summary}</p>
      <div className="flex flex-wrap gap-4">
        <TextLink href="/taxes">{copy.yearView}</TextLink>
        <TextLink href="/taxes/history">{copy.cashView}</TextLink>
        <TextLink href="/tax-planning">{copy.planning}</TextLink>
      </div>
    </Card>
  )
}
