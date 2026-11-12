import type { FreshnessDetail, FreshnessItem } from '@/lib/adapters/portfolio-db'
import type { Language } from '@/lib/i18n'
import { getUiCopy } from '@/lib/ui-copy'

/**
 * A freshness row's name. A snapshot row carries its key and its name is copy;
 * a source-drift row carries the file name, which is data and is returned as is.
 */
export function freshnessLabel(item: FreshnessItem, language: Language): string {
  const labels: Record<string, string> = getUiCopy(language).freshness.snapshotLabels
  return item.category === 'source' ? item.label : (labels[item.label] ?? item.label)
}

/** The sentence for a freshness row's detail code, in the reader's language. */
export function freshnessDetailText(detail: FreshnessDetail, language: Language): string {
  const sentences = getUiCopy(language).freshness.detail
  switch (detail.code) {
    case 'PRICE_SNAPSHOT':
      return sentences.PRICE_SNAPSHOT(detail)
    case 'CRYPTO_SNAPSHOT':
      return sentences.CRYPTO_SNAPSHOT(detail)
    case 'FX_RATE':
      return sentences.FX_RATE(detail)
    case 'SOURCE_CHANGED':
      return sentences.SOURCE_CHANGED(detail)
    default:
      return sentences[detail.code]?.() ?? detail.code
  }
}
