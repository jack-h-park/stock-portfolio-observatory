import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import { Label, type Tone } from '@/components/ui'

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

// The value colour every strip below shares: a tone, with neutral as plain ink.
const VALUE_TONE: Record<Tone, string> = {
  neutral: 'text-ink',
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
}

const STAT_STRIP_COLUMNS = {
  'md-4': 'md:grid-cols-4',
  'lg-4': 'lg:grid-cols-4',
  'sm-5': 'sm:grid-cols-5',
} as const

/**
 * A boxed strip of figures, two across on a phone and wider from a breakpoint,
 * with one-pixel rules between the cells drawn by the gap over the line colour.
 */
export function StatStrip({ columns, children }: { columns: keyof typeof STAT_STRIP_COLUMNS; children: ReactNode }) {
  return (
    <div
      className={clsx(
        'grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line-subtle bg-line-subtle',
        STAT_STRIP_COLUMNS[columns]
      )}
    >
      {children}
    </div>
  )
}

const STAT_SIZE = { title: 'text-title', 'body-lg': 'text-body-lg' } as const

/** One cell of a StatStrip: a micro label, the value and an optional line under it. */
export function Stat({
  label,
  value,
  sub,
  tone = 'neutral',
  size = 'title',
  dense,
}: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  tone?: Tone
  size?: keyof typeof STAT_SIZE
  /** Tighter vertical padding, for a strip inside an already dense panel. */
  dense?: boolean
}) {
  return (
    <div className={clsx('bg-card px-3', dense ? 'py-2.5' : 'py-3')}>
      <Label size="micro">{label}</Label>
      <div className={clsx('mt-1 font-medium tabular-nums', STAT_SIZE[size], VALUE_TONE[tone])}>{value}</div>
      {sub != null && <div className="mt-0.5 text-label tabular-nums text-ink-3">{sub}</div>}
    </div>
  )
}

const MINI_STAT_COLUMNS = { 3: 'grid-cols-3', 2: 'grid-cols-2', 'sm-4': 'sm:grid-cols-4' } as const
const MINI_STAT_SPACING = { 'mt-3': 'mt-3' } as const

/** Small unboxed counts in a caption-sized grid, read at a glance inside a card. */
export function MiniStatGrid({
  columns,
  spacing,
  children,
}: {
  columns: keyof typeof MINI_STAT_COLUMNS
  spacing?: keyof typeof MINI_STAT_SPACING
  children: ReactNode
}) {
  return (
    <div className={clsx(spacing && MINI_STAT_SPACING[spacing], 'grid gap-3 text-caption', MINI_STAT_COLUMNS[columns])}>
      {children}
    </div>
  )
}

/** A plain-case caption label over a value that inherits the grid's caption size. */
export function MiniStat({ label, value, tone = 'neutral' }: { label: ReactNode; value: ReactNode; tone?: Tone }) {
  return (
    <div>
      <div className="text-caption text-ink-3">{label}</div>
      <div className={clsx('font-medium tabular-nums', VALUE_TONE[tone])}>{value}</div>
    </div>
  )
}

const TOTALS_COLUMNS = { 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4', 5: 'sm:grid-cols-5' } as const

/**
 * The totals above a list table. A sibling of the table, not a table footer:
 * the table renders an empty state when a filter matches nothing, and the
 * totals still have to show `0 / N` then.
 */
export function TotalsStrip({ columns, children }: { columns: keyof typeof TOTALS_COLUMNS; children: ReactNode }) {
  return (
    <div
      className={clsx(
        'grid gap-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-caption',
        TOTALS_COLUMNS[columns]
      )}
    >
      {children}
    </div>
  )
}

/** One total: the standard label over a caption-sized value. */
export function Total({ label, value, tone = 'neutral' }: { label: ReactNode; value: ReactNode; tone?: Tone }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className={clsx('font-medium tabular-nums', VALUE_TONE[tone])}>{value}</div>
    </div>
  )
}
