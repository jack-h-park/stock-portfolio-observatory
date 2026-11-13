import type { ReactNode } from 'react'
import Link from 'next/link'

export type ChipVariant = 'info' | 'subtle' | 'ink'

/** Static class tables, so Tailwind sees every literal. */
const CHIP_CLASSES: Record<ChipVariant, { base: string; active: string; inactive: string }> = {
  info: {
    base: 'rounded-sm border px-2 py-1 text-label font-medium',
    active: 'border-info bg-info/10 text-info',
    inactive: 'border-line text-ink-3 hover:border-info hover:text-info',
  },
  subtle: {
    base: 'rounded-sm border px-2 py-1 text-label',
    active: 'border-line bg-surface font-medium text-ink',
    inactive: 'border-transparent text-ink-3 hover:border-line hover:text-ink',
  },
  // FilterBar's recipe, kept here so a later phase can unify the two.
  ink: {
    base: 'inline-flex min-h-8 items-center rounded-sm border px-2.5 text-label font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-info/40',
    active: 'border-ink bg-ink text-card',
    inactive: 'border-line bg-card text-ink-2 hover:border-ink-3 hover:bg-surface hover:text-ink',
  },
}

/** How the active chip announces itself: a selection in a set ('true'), a page in a set ('page'), or a toggle ('none'). */
export type ChipCurrent = 'true' | 'page' | 'none'

/**
 * One link chip. Server component: the href is a precomputed string. A toggle
 * (ariaCurrent="none") carries no aria-current, and never aria-pressed, which an
 * <a> may not carry.
 */
export function LinkChip({
  href,
  active,
  variant = 'info',
  ariaCurrent = 'true',
  title,
  'aria-label': ariaLabel,
  scroll = false,
  children,
}: {
  href: string
  active: boolean
  variant?: ChipVariant
  ariaCurrent?: ChipCurrent
  title?: string
  'aria-label'?: string
  scroll?: boolean
  children: ReactNode
}) {
  const classes = CHIP_CLASSES[variant]
  return (
    <Link
      href={href}
      scroll={scroll}
      title={title}
      aria-label={ariaLabel}
      aria-current={active && ariaCurrent !== 'none' ? ariaCurrent : undefined}
      className={`${classes.base} ${active ? classes.active : classes.inactive}`}
    >
      {children}
    </Link>
  )
}

export type LinkChipItem<K extends string> = { key: K; href: string; label: ReactNode; title?: string }

const WRAPPER = 'flex flex-wrap items-center justify-end gap-1'

/**
 * A set of link chips, one of which is current. `as="fragment"` (default)
 * renders the bare chips for a caller's own wrapper; 'nav' and 'group' add a
 * labelled flex wrapper.
 */
export function LinkChips<K extends string>({
  items,
  current,
  variant = 'info',
  ariaCurrent = 'true',
  as = 'fragment',
  label,
}: {
  items: LinkChipItem<K>[]
  /** The key of the active chip. */
  current: K
  variant?: ChipVariant
  /** The aria-current value the active chip carries. */
  ariaCurrent?: Exclude<ChipCurrent, 'none'>
  as?: 'fragment' | 'nav' | 'group'
  label?: string
}) {
  const chips = items.map((item) => (
    <LinkChip key={item.key} href={item.href} active={item.key === current} variant={variant} ariaCurrent={ariaCurrent} title={item.title}>
      {item.label}
    </LinkChip>
  ))
  if (as === 'nav') return <nav aria-label={label} className={WRAPPER}>{chips}</nav>
  if (as === 'group') return <div role="group" aria-label={label} className={WRAPPER}>{chips}</div>
  return <>{chips}</>
}
