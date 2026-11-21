import type { ReactNode } from 'react'
import { ShareBar } from '@/components/bars'
import { fmtPct } from '@/lib/format'

export type ShareItem = { key: string; label: ReactNode; pct: number; color: string; detail?: ReactNode }

/**
 * One split of the portfolio as a summary: a bar, then each share as a line
 * with its percent and an optional detail. The bar carries no text, so the
 * lines are its accessible reading. The full breakdown lives on the page the
 * `action` link points to.
 */
export function ShareSummary({ title, items, action, children }: { title: ReactNode; items: ShareItem[]; action?: ReactNode; children?: ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-caption font-medium text-ink-2">{title}</h3>
        {action}
      </div>
      <ShareBar
        ariaHidden
        segments={items.map((item, index) => ({
          key: item.key,
          // A present share keeps a sliver even when it rounds to nothing.
          pct: item.pct > 0 ? Math.max(1, item.pct) : 0,
          style: { backgroundColor: item.color, borderLeft: index === 0 ? undefined : '1px solid var(--bg-card)' },
        }))}
      />
      <ul className="mt-3 flex flex-col gap-1.5 text-caption">
        {items.map((item) => (
          <li key={item.key} className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5 text-ink-3">
              <span className="h-2 w-2 shrink-0 rounded-pill" style={{ backgroundColor: item.color }} aria-hidden="true" />
              <span className="truncate">{item.label}</span>
            </span>
            <span className="shrink-0 tabular-nums text-ink">
              {fmtPct(item.pct, { digits: 1 })}
              {item.detail != null ? <span className="ml-2 text-ink-3">{item.detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {children}
    </section>
  )
}
