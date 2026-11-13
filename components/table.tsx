import { clsx } from 'clsx'
import type { ReactNode } from 'react'

// — Table ————————————————————————————————————————————————————————————————
// A thin shell over the raw <table>/<thead>/<tbody> markup that every data page
// re-typed by hand. Sorting lives in the pages that need it; DataTable grows a
// sortable header in P2.
const CELL_ALIGN = { left: '', right: 'text-right', center: 'text-center' } as const

export function Table({
  children,
  minWidth,
  scroll,
  size = 'body',
  className,
}: {
  children: ReactNode
  /** Text size for the whole table. A caller must not put a `text-*` size in
   *  `className`: both would land on the same element and which one won came
   *  down to the order Tailwind happened to emit them in. DataTable asked for
   *  `text-[12px]` that way and got 13px for its trouble, on all 35 tables. */
  size?: 'body' | 'caption'
  /** Min width before the table scrolls horizontally. Defaults to the standard
   *  "48rem" when `scroll` is set — override only when the column set truly
   *  needs more room (keep table breakpoints consistent across pages). */
  minWidth?: string
  /** Wrap in a horizontally-scrollable container that bleeds to the card edges. */
  scroll?: boolean
  className?: string
}) {
  const mw = minWidth ?? (scroll ? '48rem' : undefined)
  const table = (
    <table className={clsx('w-full', size === 'caption' ? 'text-caption' : 'text-body', className)} style={mw ? { minWidth: mw } : undefined}>
      {children}
    </table>
  )
  // tabIndex makes the scroller reachable: a table wider than its card can only
  // be scrolled sideways with a pointer otherwise, so a keyboard user cannot
  // read the right-hand columns at all. axe reports this on six pages.
  // No role="region" — a region has to be named, and the surrounding Card
  // already carries the heading that would name it.
  return scroll ? (
    <div tabIndex={0} className="-mx-4 overflow-x-auto px-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/40">
      {table}
    </div>
  ) : table
}

export function Thead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-line text-left text-label uppercase tracking-[0.06em] text-ink-3">
        {children}
      </tr>
    </thead>
  )
}

export function Th({
  children,
  align = 'left',
  className,
}: {
  children?: ReactNode
  align?: 'left' | 'right' | 'center'
  className?: string
}) {
  return <th className={clsx('pb-2 pr-3 font-medium', CELL_ALIGN[align], className)}>{children}</th>
}

export function Tbody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-[color:var(--border-subtle)]">{children}</tbody>
}

export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={clsx('align-top hover:bg-surface', className)}>{children}</tr>
}

export function Td({
  children,
  align = 'left',
  className,
}: {
  children?: ReactNode
  align?: 'left' | 'right' | 'center'
  className?: string
}) {
  return <td className={clsx('py-2 pr-3', CELL_ALIGN[align], className)}>{children}</td>
}
