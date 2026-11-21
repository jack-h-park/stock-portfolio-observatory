import { CommonLabel } from '@/components/LanguageProvider'
import { LinkChips } from '@/components/LinkChips'
import { TREND_RANGES, type TrendRange } from '@/lib/trend-ranges'

/**
 * The 1M…All period buttons, as links that keep the page's other query parameters (`hrefFor`).
 * The period codes read the same in both languages; `all` shows the shared word for All.
 */
export function TrendRangeLinks({ selected, hrefFor }: { selected: TrendRange; hrefFor: (key: TrendRange['key']) => string }) {
  return (
    <LinkChips
      items={TREND_RANGES.map((range) => ({ key: range.key, href: hrefFor(range.key), label: range.key === 'all' ? <CommonLabel label="all" /> : range.label }))}
      current={selected.key}
    />
  )
}
