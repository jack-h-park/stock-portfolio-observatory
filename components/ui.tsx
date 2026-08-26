import { clsx } from 'clsx'
import Link from 'next/link'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { HelpPopover } from '@/components/HelpPopover'

// InfoTooltip — a small "i" affordance that reveals an explanation on hover or
// keyboard focus, as an absolutely-positioned overlay (no layout cost). Used
// consistently across the dashboard to explain domain jargon (gates, stages,
// depth, drift, freshness, etc.) without cluttering the surface.
export const InfoTooltip = HelpPopover

export function Card({
  children,
  className,
  title,
  info,
  action,
  fill,
  accent,
  hover,
}: {
  children: ReactNode
  className?: string
  title?: ReactNode
  info?: ReactNode
  action?: ReactNode
  /** Make the body a flex column that fills the card's height. Pair with a height
   *  on `className` (e.g. `xl:h-[42rem]`) so a `flex-1` child list scrolls to fill
   *  it — lets two side-by-side cards stay exactly equal-height regardless of content. */
  fill?: boolean
  /** Brand gradient accent bar across the card's top edge. Use sparingly — once
   *  per surface for the hero/primary card (gradient guideline §3.2). */
  accent?: boolean
  /** Subtle elevation lift on hover (motion tokens). For clickable cards. */
  hover?: boolean
}) {
  return (
    <section
      className={clsx(
        'relative rounded-md border border-line bg-card shadow-card',
        hover && 'jp-card-hover',
        fill && 'flex flex-col',
        className
      )}
      style={{ borderRadius: 'var(--radius-md)' }}
    >
      {accent && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[3px]"
          style={{ backgroundImage: 'var(--gradient-full)', borderRadius: 'var(--radius-md) var(--radius-md) 0 0' }}
        />
      )}
      {(title || action) && (
        <header className="flex items-center justify-between border-b border-line-subtle px-4 py-2.5">
          <div className="flex items-center">
            <h2 className="text-[14px] font-medium tracking-tight text-ink">{title}</h2>
            {info ? <InfoTooltip>{info}</InfoTooltip> : null}
          </div>
          {action}
        </header>
      )}
      <div className={clsx('p-4', fill && 'flex min-h-0 flex-1 flex-col')}>{children}</div>
    </section>
  )
}

const TONE_STYLES = {
  neutral: 'bg-surface text-ink-2 border-line',
  info: 'border-[color:var(--accent-info)]/30 bg-[color:var(--accent-info)]/10 text-[color:var(--accent-info)]',
  success:
    'border-[color:var(--accent-success)]/30 bg-[color:var(--accent-success)]/10 text-[color:var(--accent-success)]',
  warning:
    'border-[color:var(--accent-warning)]/30 bg-[color:var(--accent-warning)]/10 text-[color:var(--accent-warning)]',
  danger:
    'border-[color:var(--accent-danger)]/30 bg-[color:var(--accent-danger)]/10 text-[color:var(--accent-danger)]',
} as const

export type Tone = keyof typeof TONE_STYLES

// marketTone now lives in lib/tone.ts with the rest of the meaning→tone rules.
// Re-exported here because eleven files import it from this module.
export { marketTone } from '@/lib/tone'

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-pill border px-2 py-0.5 text-[11px] font-medium',
        TONE_STYLES[tone]
      )}
    >
      {children}
    </span>
  )
}

export function MetricField({
  label,
  value,
  hint,
  info,
  tone = 'neutral',
  labelClassName,
  valueClassName,
}: {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  info?: ReactNode
  tone?: Tone
  labelClassName?: string
  valueClassName?: string
}) {
  return (
    <div className="min-w-0">
      <div className={clsx('flex items-center text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3', labelClassName)}>
        {label}
        {info ? <InfoTooltip>{info}</InfoTooltip> : null}
      </div>
      <div
        className={clsx(
          'mt-1 font-medium leading-tight tabular-nums',
          {
            'text-ink': tone === 'neutral',
            'text-info': tone === 'info',
            'text-success': tone === 'success',
            'text-warning': tone === 'warning',
            'text-danger': tone === 'danger',
          },
          valueClassName
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-[12px] text-ink-3">{hint}</div> : null}
    </div>
  )
}

export function MetricHeroCard({
  title,
  info,
  eyebrow,
  value,
  hint,
  children,
  className,
}: {
  title: ReactNode
  info?: ReactNode
  eyebrow: ReactNode
  value: ReactNode
  hint?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <Card title={title} info={info} accent className={className}>
      <div className="flex min-h-[16rem] flex-col justify-between gap-6">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-3">{eyebrow}</div>
          <div className="mt-2 text-[42px] font-medium leading-none tracking-normal text-ink sm:text-[52px]">{value}</div>
          {hint ? <div className="mt-2 text-[13px] text-ink-3">{hint}</div> : null}
        </div>
        {children}
      </div>
    </Card>
  )
}

export function EmptyState({
  children,
  hint,
  ok,
}: {
  children: ReactNode
  /** A muted secondary line — use for the technical reason (env var, path) so it
   *  doesn't clutter the primary message. */
  hint?: ReactNode
  /** Append a ✓ — the "all clear, nothing pending" case (vs. a true empty result). */
  ok?: boolean
}) {
  return (
    <div className="py-6 text-center text-[13px] text-ink-3">
      <div>
        {children}
        {ok && ' ✓'}
      </div>
      {hint && <div className="mt-1 text-[11px] text-ink-3/80">{hint}</div>}
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
 * and greens — so `format` is given the magnitude and the sign is always
 * printed in front of it.
 */
export function Signed({
  value,
  format,
  nullText = 'n/a',
  className,
}: {
  value: number | null | undefined
  /** Renders the magnitude. Receives a non-negative number. */
  format: (magnitude: number) => string
  nullText?: ReactNode
  className?: string
}) {
  if (value == null) return <span className={clsx('text-ink-3', className)}>{nullText}</span>
  const n = Number(value)
  const body = format(Math.abs(n))
  // A value that rounds away to zero is not a loss, so it gets no minus.
  const negative = n < 0 && /[1-9]/.test(body)
  return (
    <span className={clsx(negative ? 'text-danger' : 'text-success', 'tabular-nums', className)}>
      {negative ? '-' : '+'}
      {body}
    </span>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-3">{children}</div>
  )
}

// — Button ——————————————————————————————————————————————————————————————————
// The single button primitive. Before this, every action/control component
// hand-rolled its own <button> className (divergent radius, padding, tone,
// disabled, focus). Variants:
//   solid   — filled ink, for the primary commit in a surface (e.g. Save)
//   outline — bordered; tone colors the border/text (gate decisions, triggers)
//   ghost   — chromeless, for icon/secondary controls
//   link    — inline text affordance (no padding); tone ignored, always info
type ButtonVariant = 'solid' | 'outline' | 'ghost' | 'link'

const BTN_SIZE: Record<'sm' | 'md', string> = {
  sm: 'px-2.5 py-1 text-[11px]',
  md: 'px-4 py-2 text-[13px]',
}

// Link-variant text color. Defaults (neutral) to the info blue, the app's
// standard inline-affordance color; pass tone="danger" for destructive links.
const BTN_LINK_TONE: Record<Tone, string> = {
  neutral: 'text-info',
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
}

const BTN_OUTLINE_TONE: Record<Tone, string> = {
  neutral: 'border-line bg-card text-ink hover:border-ink-3 hover:bg-surface',
  info: 'border-[color:var(--accent-info)]/30 bg-[color:var(--accent-info)]/10 text-[color:var(--accent-info)] hover:border-[color:var(--accent-info)]',
  success:
    'border-[color:var(--accent-success)]/30 bg-[color:var(--accent-success)]/10 text-[color:var(--accent-success)] hover:border-[color:var(--accent-success)]',
  warning:
    'border-[color:var(--accent-warning)]/30 bg-[color:var(--accent-warning)]/10 text-[color:var(--accent-warning)] hover:border-[color:var(--accent-warning)]',
  danger:
    'border-[color:var(--accent-danger)]/30 bg-[color:var(--accent-danger)]/10 text-[color:var(--accent-danger)] hover:border-[color:var(--accent-danger)]',
}

export function Button({
  children,
  variant = 'outline',
  tone = 'neutral',
  size = 'sm',
  loading = false,
  href,
  className,
  disabled,
  type = 'button',
  ...rest
}: {
  children: ReactNode
  variant?: ButtonVariant
  tone?: Tone
  size?: 'sm' | 'md'
  /** Show a busy state: disables the control and dims it (caller supplies the label text). */
  loading?: boolean
  /** Render as a Next.js <Link> instead of a <button>. */
  href?: string
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const isDisabled = disabled || loading
  const cls = clsx(
    'inline-flex items-center justify-center gap-1.5 font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-info disabled:cursor-not-allowed disabled:opacity-50',
    variant === 'link'
      ? clsx('hover:underline', BTN_LINK_TONE[tone])
      : clsx('rounded-sm border', BTN_SIZE[size]),
    variant === 'solid' && 'border-ink bg-ink text-card hover:brightness-110',
    variant === 'outline' && BTN_OUTLINE_TONE[tone],
    variant === 'ghost' && 'border-transparent text-ink-2 hover:bg-surface hover:text-ink',
    loading && 'opacity-60',
    className
  )

  if (href && !isDisabled) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    )
  }
  return (
    <button type={type} disabled={isDisabled} className={cls} {...rest}>
      {children}
    </button>
  )
}

// — Table ————————————————————————————————————————————————————————————————
// A thin shell over the raw <table>/<thead>/<tbody> markup that every data page
// re-typed by hand. Sorting lives in the pages that need it; DataTable grows a
// sortable header in P2.
const CELL_ALIGN = { left: '', right: 'text-right', center: 'text-center' } as const

export function Table({
  children,
  minWidth,
  scroll,
  className,
}: {
  children: ReactNode
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
    <table className={clsx('w-full text-[13px]', className)} style={mw ? { minWidth: mw } : undefined}>
      {children}
    </table>
  )
  return scroll ? <div className="-mx-4 overflow-x-auto px-4">{table}</div> : table
}

export function Thead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.06em] text-ink-3">
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

// — MetaRow / MetaItem ————————————————————————————————————————————————————
// A wrapping row of "label value" pairs — the metadata strips in run detail,
// the sensing expander, and the gate-0 expander all rebuilt this by hand.
export function MetaRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[11px]', className)}>{children}</div>
}

export function MetaItem({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <span>
      <span className="text-ink-3">{label} </span>
      {children}
    </span>
  )
}

// — Input / TextArea ——————————————————————————————————————————————————————
// Text inputs with the shared border/focus treatment, so config editors stop
// re-typing `rounded-sm border border-line bg-card …`.
export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        'rounded-sm border border-line bg-card px-2 py-1 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-ink-3',
        className
      )}
      {...rest}
    />
  )
}
