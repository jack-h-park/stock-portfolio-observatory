import { Card, TextLink } from '@/components/ui'
import { readTaxHistory } from '@/lib/adapters/tax-history-store'
import { getAnnualTaxSummary, type AnnualTaxSummaryData } from '@/lib/application/annual-tax-summary'
import { AnnualTaxSummary } from '@/components/AnnualTaxSummary'
import { getPageCopy } from '@/lib/ui-copy'
import type { Language } from '@/lib/i18n'

export function FinanceTaxSummary({ language }: { language: Language }) {
  const copy = getPageCopy('taxHistory', language)
  let summary: AnnualTaxSummaryData | null = null
  try {
    summary = getAnnualTaxSummary(readTaxHistory())
  } catch {
    // A failed read is distinct from an empty history and never becomes zero tax.
  }
  return (
    <Card title={getPageCopy('annualTaxSummary', language).title} className="mb-5">
      <AnnualTaxSummary summary={summary} language={language} />
      <div className="flex flex-wrap gap-4">
        <TextLink href="/taxes">{copy.yearView}</TextLink>
        <TextLink href="/taxes/history">{copy.cashView}</TextLink>
        <TextLink href="/tax-planning">{copy.planning}</TextLink>
      </div>
    </Card>
  )
}
