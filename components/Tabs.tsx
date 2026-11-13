import type { ReactNode } from 'react'
import Link from 'next/link'

const ITEM_BASE = '-mb-px inline-flex min-h-8 items-center border-b-2 px-3 text-caption font-medium'
const ITEM_ACTIVE = 'border-info text-ink'
const ITEM_INACTIVE = 'border-transparent text-ink-3 hover:text-ink'

/**
 * URL-driven underline tabs: links in a labelled nav, the current one marked
 * aria-current="page". Server component; hrefs are precomputed strings.
 * `scroll` defaults to true (a tab switch scrolls to the top).
 */
export function Tabs<K extends string>({
  label,
  items,
  current,
  scroll = true,
}: {
  label: string
  items: { key: K; href: string; label: ReactNode }[]
  current: K
  scroll?: boolean
}) {
  return (
    <nav aria-label={label} className="mb-5 flex flex-wrap gap-1 border-b border-line-subtle">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          scroll={scroll}
          aria-current={item.key === current ? 'page' : undefined}
          className={`${ITEM_BASE} ${item.key === current ? ITEM_ACTIVE : ITEM_INACTIVE}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
