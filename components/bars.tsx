import { clsx } from 'clsx'
import type { CSSProperties } from 'react'

/**
 * The two bar shapes pages drew by hand: a track split into shares, and a track
 * filled to one percentage. Fixed tables, so Tailwind sees every literal.
 */

const HEIGHT = { sm: 'h-1.5', md: 'h-2', lg: 'h-3' } as const
const TRACK = { surface: 'bg-surface', subtle: 'bg-line-subtle' } as const

const SHARE_SPACING = { 'mt-5': 'mt-5' } as const

export type ShareSegment = {
  /** The caller's key for the segment, never its rendered text. */
  key: string
  /** Width in percent. Any minimum width a page wants is applied by the caller. */
  pct: number
  className?: string
  /** Merged after the width: gradients and separators stay at the call site. */
  style?: CSSProperties
  title?: string
}

/** A track divided into segments side by side, one per share. */
export function ShareBar({
  segments,
  height = 'lg',
  track = 'surface',
  spacing,
  ariaHidden,
}: {
  segments: ShareSegment[]
  height?: keyof typeof HEIGHT
  track?: keyof typeof TRACK
  spacing?: keyof typeof SHARE_SPACING
  /** For a bar whose shares are repeated as text next to it. */
  ariaHidden?: boolean
}) {
  return (
    <div
      className={clsx(spacing && SHARE_SPACING[spacing], 'flex overflow-hidden rounded-pill', HEIGHT[height], TRACK[track])}
      aria-hidden={ariaHidden ? 'true' : undefined}
    >
      {segments.map((segment) => (
        <div
          key={segment.key}
          className={clsx('h-full', segment.className)}
          style={{ width: `${segment.pct}%`, ...segment.style }}
          title={segment.title}
        />
      ))}
    </div>
  )
}

const PROGRESS_TONE = { success: 'bg-success', warning: 'bg-warning', info: 'bg-info' } as const
const PROGRESS_HEIGHT = { sm: HEIGHT.sm, md: HEIGHT.md } as const
const PROGRESS_SPACING = { 'mt-1': 'mt-1', 'mt-1.5': 'mt-1.5', 'mt-4': 'mt-4' } as const

/** A track filled to one percentage, clamped to [0, 100]. */
export function ProgressBar({
  pct,
  tone = 'success',
  height = 'md',
  track = 'subtle',
  roundedFill,
  spacing,
}: {
  pct: number
  tone?: keyof typeof PROGRESS_TONE
  height?: keyof typeof PROGRESS_HEIGHT
  track?: keyof typeof TRACK
  /** Round the fill's end as well as the track's. */
  roundedFill?: boolean
  spacing?: keyof typeof PROGRESS_SPACING
}) {
  const width = Math.min(Math.max(pct, 0), 100)
  return (
    <div className={clsx(spacing && PROGRESS_SPACING[spacing], 'overflow-hidden rounded-pill', PROGRESS_HEIGHT[height], TRACK[track])}>
      <div className={clsx('h-full', roundedFill && 'rounded-pill', PROGRESS_TONE[tone])} style={{ width: `${width}%` }} />
    </div>
  )
}
