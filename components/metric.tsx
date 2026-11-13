import { clsx } from 'clsx'
import { createElement, type ReactNode } from 'react'
import { HelpPopover } from '@/components/HelpPopover'
import { EMPTY_VALUE, fmtSigned } from '@/lib/format'
import type { Tone } from '@/lib/tone'

const NOTE_SIZE = { label: 'text-label', caption: 'text-caption', body: 'text-body', micro: 'text-micro', inherit: '' } as const

const NOTE_SPACING = {
  none: '',
  'above-0.5': 'mt-0.5',
  'above-1': 'mt-1',
  'above-2': 'mt-2',
  'above-3': 'mt-3',
  'below-3': 'mb-3',
  'below-4': 'mb-4',
  'below-5': 'mb-5',
} as const

/**
 * The muted footnote under a table, chart or form: a `text-ink-3` paragraph.
 * Fifty-four sites wrote it by hand with eight margins and four sizes; every
 * margin is a `spacing` value here, so there is no `className`. `row` lays
 * out text next to a Badge; `band` is the full-bleed strip at the top or
 * bottom of a card body. The children must be phrasing content (it is a `<p>`).
 */
export function Note({
  size = 'label',
  relaxed = false,
  weight,
  spacing = 'none',
  tone = 'muted',
  row = false,
  band,
  title,
  children,
}: {
  size?: keyof typeof NOTE_SIZE
  relaxed?: boolean
  weight?: 'medium'
  spacing?: keyof typeof NOTE_SPACING
  tone?: 'muted' | 'warning'
  row?: boolean
  band?: 'top' | 'bottom'
  title?: string
  children: ReactNode
}) {
  return (
    <p
      className={clsx(
        NOTE_SPACING[spacing],
        row && 'flex flex-wrap items-center gap-2',
        band === 'top' && 'border-t border-line-subtle px-4 py-3',
        band === 'bottom' && 'border-b border-line-subtle bg-surface px-4 py-3',
        NOTE_SIZE[size],
        weight === 'medium' && 'font-medium',
        relaxed && 'leading-relaxed',
        tone === 'warning' ? 'text-warning' : 'text-ink-3'
      )}
      title={title}
    >
      {children}
    </p>
  )
}

const HEADING_SIZE = { page: 'text-title', section: 'text-body-lg', sub: 'text-body', minor: 'text-label' } as const

/**
 * A heading inside a page or a card body, outside `Card title`. `eyebrow`
 * puts a micro label above it, `subtitle` a muted line below it (or beside
 * it, in the `band` layout), `action` a Badge after it in a row.
 * `band` is the page-level section row of the daily briefing; it ignores
 * `eyebrow`.
 */
export function SectionHeading({
  level = 2,
  size = 'section',
  tight = false,
  tracking = false,
  tone = 'default',
  eyebrow,
  subtitle,
  action,
  layout = 'stack',
  spacing,
  id,
  children,
}: {
  level?: 2 | 3
  size?: keyof typeof HEADING_SIZE
  tight?: boolean
  tracking?: boolean
  tone?: 'default' | 'muted'
  eyebrow?: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  layout?: 'stack' | 'band'
  spacing?: 'mb-1' | 'mb-2' | 'mt-1'
  id?: string
  children: ReactNode
}) {
  const heading = createElement(
    level === 3 ? 'h3' : 'h2',
    {
      id,
      className: clsx(
        spacing ?? (eyebrow != null && 'mt-1'),
        HEADING_SIZE[size],
        'font-medium',
        tight && 'leading-tight',
        tracking && 'tracking-tight',
        tone === 'muted' ? 'text-ink-2' : 'text-ink'
      ),
    },
    children
  )
  const titled = action != null ? (
    <div className="flex items-center gap-2">
      {heading}
      {action}
    </div>
  ) : (
    heading
  )
  if (layout === 'band') {
    return (
      <div className="mb-3 mt-7 flex flex-wrap items-baseline gap-2.5 first:mt-0">
        {heading}
        {action}
        {subtitle != null ? <span className="text-label text-ink-3">{subtitle}</span> : null}
      </div>
    )
  }
  if (eyebrow == null && subtitle == null) return titled
  return (
    <div>
      {eyebrow != null ? <Label size="micro">{eyebrow}</Label> : null}
      {titled}
      {subtitle != null ? <p className="mt-0.5 text-label text-ink-3">{subtitle}</p> : null}
    </div>
  )
}

const METRIC_VALUE_SIZE = {
  title: 'text-title',
  metric: 'text-metric',
  caption: 'text-caption',
} as const

const METRIC_VALUE_TONE: Record<Tone, string> = {
  neutral: 'text-ink',
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
}

export function MetricField({
  label,
  value,
  hint,
  info,
  tone = 'neutral',
  size = 'title',
  truncate,
  labelClassName,
}: {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  info?: ReactNode
  tone?: Tone
  /** Type size of the value: `title` (default), `metric` for the lead figure, `caption` inside a dense breakdown. */
  size?: keyof typeof METRIC_VALUE_SIZE
  /** Clip a long value to one line with an ellipsis. */
  truncate?: boolean
  labelClassName?: string
}) {
  return (
    <div className="min-w-0">
      <Label className={clsx('flex items-center', labelClassName)}>
        {label}
        {info ? <HelpPopover>{info}</HelpPopover> : null}
      </Label>
      <div
        className={clsx(
          'mt-1 font-medium leading-tight tabular-nums',
          METRIC_VALUE_SIZE[size],
          truncate && 'truncate',
          METRIC_VALUE_TONE[tone]
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-caption text-ink-3">{hint}</div> : null}
    </div>
  )
}

/**
 * A gain or a loss, with the direction said out loud.
 *
 * Replaces four page-local components and nine inline
 * `value >= 0 ? 'text-success' : 'text-danger'` ternaries, which between them
 * disagreed about whether a positive value carries a "+" and whether null
 * renders as a dash or as nothing at all.
 *
 * The sign is not decoration. Colour was the only thing separating +0.4% from
 * −0.4% in these tables, which fails anyone who cannot separate the two reds
 * and greens — so `format` is given the magnitude and the sign is printed in
 * front of it by `fmtSigned`: "+" for a gain, "-" for a loss, none for zero.
 */
export function Signed({
  value,
  format,
  nullText = EMPTY_VALUE,
  className,
}: {
  value: number | null | undefined
  /** Renders the magnitude. Receives a non-negative number. */
  format: (magnitude: number) => string
  nullText?: ReactNode
  className?: string
}) {
  if (value == null || Number.isNaN(Number(value))) return <span className={clsx('text-ink-3', className)}>{nullText}</span>
  const text = fmtSigned(Number(value), format)
  // fmtSigned prints "-" only for a loss that survives rounding, so a value that
  // rounds away to zero keeps the gain tone.
  const negative = text.startsWith('-')
  return (
    <span className={clsx(negative ? 'text-danger' : 'text-success', 'tabular-nums', className)}>
      {text}
    </span>
  )
}

/**
 * The small uppercase label above a value, a column or a section.
 *
 * This recipe was retyped roughly 57 times and had drifted into every
 * combination of two sizes, two weights and four letter-spacings — including
 * twenty sites with no tracking at all — for what is visually one thing. Two
 * roles survive, because they are genuinely different:
 *
 *   default  a field or column label, tucked under the value it names
 *   eyebrow  the overline above a hero value, given more air on purpose
 *
 * `size` exists for density, not for decoration: a card label reads at 11px
 * and a label inside a dense table row at 10px.
 */
export function Label({
  children,
  size = 'label',
  variant = 'default',
  as: Tag = 'div',
  className,
}: {
  children: ReactNode
  size?: 'micro' | 'label'
  variant?: 'default' | 'eyebrow'
  /** Inline uses need a span; a div would break the line it sits on. */
  as?: 'div' | 'span'
  className?: string
}) {
  return (
    <Tag
      className={clsx(
        'font-medium uppercase text-ink-3',
        size === 'micro' ? 'text-micro' : 'text-label',
        variant === 'eyebrow' ? 'tracking-[0.1em]' : 'tracking-[0.08em]',
        className
      )}
    >
      {children}
    </Tag>
  )
}

// — MetaRow / MetaItem ————————————————————————————————————————————————————
// A wrapping row of "label value" pairs — the metadata strips in run detail,
// the sensing expander, and the gate-0 expander all rebuilt this by hand.
export function MetaRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('flex flex-wrap items-baseline gap-x-6 gap-y-1 text-label', className)}>{children}</div>
}

export function MetaItem({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <span>
      <span className="text-ink-3">{label} </span>
      {children}
    </span>
  )
}
