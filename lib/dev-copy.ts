/**
 * Whether to label the database as a local development copy, and how old it is.
 *
 * Only the production build (`next start`) runs on the refresh host; the laptop
 * runs `next dev`. Its database is refreshed by nothing — only by hand, with
 * `make pull-prod-db` — so the dev server says so on every page. Keyed on
 * NODE_ENV rather than a per-host setting because a setting that has to be
 * remembered on the host fails by labelling production, or by labelling nothing.
 */
export type DevCopyNotice = { ingestedAt: string | null; ageDays: number | null }

const DAY_MS = 24 * 60 * 60 * 1000

export function devCopyNotice(
  nodeEnv: string | undefined,
  ingestedAt: string | null | undefined,
  now: number = Date.now()
): DevCopyNotice | null {
  if (nodeEnv === 'production') return null
  const at = ingestedAt ?? null
  const parsed = at ? Date.parse(at) : Number.NaN
  return { ingestedAt: at, ageDays: Number.isFinite(parsed) ? Math.floor((now - parsed) / DAY_MS) : null }
}
