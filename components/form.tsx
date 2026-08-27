import { clsx } from 'clsx'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { Label } from '@/components/ui'

/**
 * The form controls, in one place.
 *
 * There were 27 raw `<input>` and `<select>` elements across nine files and no
 * Select primitive at all, so selects alone carried three different paddings
 * and two different text sizes for the same job. `app/tax-settings/fields.tsx`
 * was a generic form kit misfiled under one page; it is promoted here.
 *
 * Every control here shows a visible focus ring. That is not a style choice:
 * nine of the controls this replaces set `outline-none` and put nothing in its
 * place, so tabbing through the tax settings form moved an invisible cursor.
 * The ring renders on :focus-visible, so it appears for keyboard users and
 * stays out of the way of the mouse.
 */
const CONTROL_BASE =
  'rounded-md border border-line bg-card text-ink transition-colors placeholder:text-ink-3 ' +
  'focus:outline-none focus-visible:border-info focus-visible:ring-2 focus-visible:ring-info/30 ' +
  'disabled:cursor-not-allowed disabled:opacity-60'

/**
 * Three densities, derived from what the app already used rather than imposed.
 *
 * The sixteen controls this replaces fell into three padding/size clusters: a
 * chip-sized control inside a dense row, a slightly roomier one inside a
 * settings table, and a proper form field. Six recipes collapse onto these,
 * moving one site's font down a pixel, two sites' up, and three sites' vertical
 * padding by two — the rest keep their exact geometry.
 *
 * Font size travels WITH the padding here on purpose. Letting a caller pass its
 * own `text-*` through className would put two font-size classes on one
 * element, and which one wins comes down to the order Tailwind emits them in —
 * the trap that had already made two sizes in this codebase dead letters.
 */
const CONTROL_SIZE = {
  sm: 'px-2 py-1 text-label',
  md: 'px-2 py-1.5 text-caption',
  lg: 'px-3 py-2 text-body',
} as const

export type ControlSize = keyof typeof CONTROL_SIZE

// `size` is ours, not the DOM's: <input size> and <select size> are numbers,
// and leaving both in scope resolves the prop to `never`.

export function Input({
  size = 'lg',
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & { size?: ControlSize }) {
  return <input className={clsx(CONTROL_BASE, CONTROL_SIZE[size], className)} {...rest} />
}

export function Select({
  size = 'lg',
  className,
  children,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { size?: ControlSize }) {
  return (
    <select className={clsx(CONTROL_BASE, CONTROL_SIZE[size], className)} {...rest}>
      {children}
    </select>
  )
}

export function Checkbox({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={clsx(
        'h-4 w-4 shrink-0 accent-[color:var(--accent-info)]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-info/40 focus-visible:ring-offset-1',
        className
      )}
      {...rest}
    />
  )
}

/**
 * A labelled control, with an optional unit and an optional hint beneath.
 *
 * The `suffix` is inside the control's border rather than after it, so "5" and
 * "years" read as one field instead of a number next to a word.
 */
export function Field({
  label,
  name,
  defaultValue,
  suffix,
  type = 'number',
  hint,
  className,
}: {
  label: string
  name: string
  defaultValue: string | number | null
  suffix?: string
  type?: 'number' | 'text'
  hint?: ReactNode
  className?: string
}) {
  return (
    <label className={clsx('block', className)}>
      <Label as="span" className="mb-1 block">
        {label}
      </Label>
      <span className="flex items-center overflow-hidden rounded-md border border-line bg-card focus-within:border-info focus-within:ring-2 focus-within:ring-info/30">
        <input
          name={name}
          type={type}
          defaultValue={defaultValue ?? ''}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-body text-ink outline-none"
        />
        {suffix && <span className="border-l border-line-subtle px-2 text-label text-ink-3">{suffix}</span>}
      </span>
      {hint && <span className="mt-1 block text-label leading-snug text-ink-3">{hint}</span>}
    </label>
  )
}

/** A checkbox with its label, laid out as a settings row. */
export function CheckField({
  label,
  name,
  defaultChecked,
}: {
  label: string
  name: string
  defaultChecked: boolean
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-caption text-ink-2">
      <span>{label}</span>
      <Checkbox name={name} defaultChecked={defaultChecked} />
    </label>
  )
}

/** A checkbox inside a table cell, where the column header carries the label. */
export function CompactCheck({
  name,
  defaultChecked,
  label,
}: {
  name: string
  defaultChecked: boolean
  label: string
}) {
  return (
    <label className="inline-flex items-center justify-center">
      <span className="sr-only">{label}</span>
      <Checkbox name={name} defaultChecked={defaultChecked} />
    </label>
  )
}
