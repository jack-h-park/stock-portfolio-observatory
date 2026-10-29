import Link from 'next/link'
import { TREND_RANGES, type TrendRange } from '@/lib/trend-ranges'

const linkClass = (active: boolean) =>
  `rounded-sm border px-2 py-1 text-label font-medium ${active ? 'border-info bg-info/10 text-info' : 'border-line text-ink-3 hover:border-info hover:text-info'}`

/** The 1M…All period buttons, as links that keep the page's other query parameters (`hrefFor`). */
export function TrendRangeLinks({ selected, hrefFor }: { selected: TrendRange; hrefFor: (key: TrendRange['key']) => string }) {
  return (
    <>
      {TREND_RANGES.map((range) => (
        <Link
          key={range.key}
          href={hrefFor(range.key)}
          scroll={false}
          aria-current={selected.key === range.key ? 'true' : undefined}
          className={linkClass(selected.key === range.key)}
        >
          {range.label}
        </Link>
      ))}
    </>
  )
}
