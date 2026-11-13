import { clsx } from 'clsx'
import Link from 'next/link'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { Tone } from '@/lib/tone'

/**
 * The "Open reconciliation" / "Back to holdings" link that sits beside a card
 * or page heading. Twenty copies of the same class string lived across
 * thirteen files.
 *
 * min-h-6 is the point of collecting them: at 375px every one of these
 * measured about 20px tall, under the 24 that WCAG 2.2 asks of a standalone
 * target. They are not inline links inside a sentence, so the exception for
 * those does not apply — they are controls sitting on their own in a header.
 */
export function TextLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={clsx(
        'inline-flex min-h-6 items-center text-caption font-medium text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/40',
        className
      )}
    >
      {children}
    </Link>
  )
}

export const TONE_STYLES: Record<Tone, string> = {
  neutral: 'bg-surface text-ink-2 border-line',
  info: 'border-info/30 bg-info/10 text-info',
  success:
    'border-success/30 bg-success/10 text-success',
  warning:
    'border-warning/30 bg-warning/10 text-warning',
  danger:
    'border-danger/30 bg-danger/10 text-danger',
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-pill border px-2 py-0.5 text-label font-medium',
        TONE_STYLES[tone]
      )}
    >
      {children}
    </span>
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
  sm: 'px-2.5 py-1 text-label',
  md: 'px-4 py-2 text-body',
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
  info: 'border-info/30 bg-info/10 text-info hover:border-info',
  success:
    'border-success/30 bg-success/10 text-success hover:border-success',
  warning:
    'border-warning/30 bg-warning/10 text-warning hover:border-warning',
  danger:
    'border-danger/30 bg-danger/10 text-danger hover:border-danger',
}

/**
 * A row of mutually exclusive options, one of them current.
 *
 * LanguageSwitcher built this inline twice — once for language, once for
 * currency — with the recipe kept in two module-level string constants because
 * even it could tell it was repeating itself.
 *
 * The table filter chips are a different shape: they are links, because a
 * filter is a URL, and there can be more of them than fit a segmented row. They
 * live in FilterBar.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (value: T) => void
  label: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={clsx(
        'grid rounded-md border border-line-subtle bg-surface p-0.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]',
        className
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={clsx(
              'min-h-8 rounded-[4px] px-2 text-center text-caption font-medium leading-none transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-info/40',
              active ? 'bg-card text-ink shadow-card' : 'text-ink-3 hover:bg-card hover:text-ink'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
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
    'inline-flex items-center justify-center gap-1.5 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-info/40 disabled:cursor-not-allowed disabled:opacity-50',
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
