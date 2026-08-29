import { clsx } from 'clsx'
import type { ReactNode } from 'react'

/**
 * The two grids every page builds by hand.
 *
 * There was no PageShell to write: PageHeader already covers the header on all
 * twenty pages, and the root layout supplies the padding, so each page is
 * already just a fragment. What was actually duplicated is one level in — the
 * class string that lays cards out below the header, spelled out sixteen times
 * for the two-column row, eleven for the hero row, six for the three-column
 * row, and eleven more for the metric strip inside a hero card.
 *
 * A magic class string repeated sixteen times is how this refactor's recurring
 * bug happens: two width or spacing utilities land on one element and which one
 * wins is Tailwind's emit order, not the order they were written. Naming the
 * arrangements makes an inconsistent one impossible to write by accident.
 */

const COLUMNS = {
  /** One card per row — a stack that never splits. */
  1: '',
  /** Two equal cards. */
  2: 'xl:grid-cols-2',
  /** Three equal cards. */
  3: 'xl:grid-cols-3',
  /** A wide lead card and a narrower companion that will not collapse below 22rem. */
  hero: 'xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.9fr)]',
} as const

// Rows carry their own separation from the next block. Most sit below the
// header and push the following row away; a few close a page and pull away from
// what came before instead.
const SPACING = { below: 'mb-5', above: 'mt-5', none: '' } as const

export function CardRow({
  columns = 2,
  spacing = 'below',
  className,
  children,
}: {
  columns?: keyof typeof COLUMNS
  spacing?: keyof typeof SPACING
  className?: string
  children: ReactNode
}) {
  return <div className={clsx(SPACING[spacing], 'grid grid-cols-1 gap-5', COLUMNS[columns], className)}>{children}</div>
}

/**
 * The strip of MetricFields under a hero card's headline value, divided from it
 * by a rule. Fixed at three across: every one of the eleven call sites uses
 * three, and a band that can be any width is a band that drifts.
 */
export function KpiBand({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('grid gap-4 border-t border-line-subtle pt-4 sm:grid-cols-3', className)}>{children}</div>
}
