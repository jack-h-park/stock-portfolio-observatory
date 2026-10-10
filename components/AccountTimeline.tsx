import type { DateRange } from '@/lib/account-ranges'

/**
 * One account's records on a shared time axis, so a column of them shows at a
 * glance which accounts reach back how far and which stopped early.
 *
 * Plain positioned spans rather than a chart: every row has to share one axis
 * across table cells, and a chart per cell would each pick its own.
 */

export type TimelineAxis = { start: string; end: string }

const DAY = 86_400_000

function toTime(value: string) {
  return Date.parse(`${value}T00:00:00Z`)
}

function percent(axis: TimelineAxis, value: string) {
  const start = toTime(axis.start)
  const span = Math.max(toTime(axis.end) - start, DAY)
  return Math.min(100, Math.max(0, ((toTime(value) - start) / span) * 100))
}

/** From 1 January of the earliest year to the latest date, so ticks land on year starts. */
export function timelineAxis(firstDate: string | null, lastDate: string | null): TimelineAxis | null {
  if (!firstDate || !lastDate) return null
  return { start: `${firstDate.slice(0, 4)}-01-01`, end: lastDate }
}

function years(axis: TimelineAxis) {
  const result: { year: string; left: number }[] = []
  for (let year = Number(axis.start.slice(0, 4)); year <= Number(axis.end.slice(0, 4)); year++) {
    result.push({ year: String(year), left: percent(axis, `${year}-01-01`) })
  }
  return result
}

/** The year scale, for the column header. */
export function TimelineScale({ axis, label }: { axis: TimelineAxis; label: string }) {
  const ticks = years(axis)
  // Every year labelled is unreadable past about eight; every other one keeps
  // the scale legible at the column's width.
  const step = ticks.length > 8 ? 2 : 1
  return (
    <div className="w-44">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="relative h-4">
        {ticks.map((tick, index) =>
          index % step === 0 ? (
            <span key={tick.year} className="absolute top-0 text-micro tabular-nums text-ink-3" style={{ left: `${tick.left}%` }}>
              {`'${tick.year.slice(2)}`}
            </span>
          ) : null
        )}
      </div>
    </div>
  )
}

function Bar({ axis, range, className }: { axis: TimelineAxis; range: DateRange | undefined; className: string }) {
  if (!range?.start || !range.end) return <div className="h-1.5" />
  const left = percent(axis, range.start)
  const width = percent(axis, range.end) - left
  return (
    <div className="relative h-1.5">
      <div className={`absolute inset-y-0 min-w-[3px] rounded-pill ${className}`} style={{ left: `${left}%`, width: `${width}%` }} />
    </div>
  )
}

export function AccountTimeline({
  axis,
  transactions,
  dividends,
  holdings,
  label,
}: {
  axis: TimelineAxis
  transactions: DateRange | undefined
  dividends: DateRange | undefined
  holdings: DateRange | undefined
  label: string
}) {
  const ticks = years(axis)
  return (
    <div role="img" aria-label={label} className="relative w-44 py-1">
      {ticks.map((tick) => (
        <span key={tick.year} aria-hidden className="absolute inset-y-0 w-px bg-line-subtle" style={{ left: `${tick.left}%` }} />
      ))}
      <div className="relative flex flex-col gap-1">
        <Bar axis={axis} range={transactions} className="bg-info" />
        <Bar axis={axis} range={dividends} className="bg-success" />
      </div>
      {holdings?.end ? (
        <span
          aria-hidden
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-pill bg-ink-2"
          style={{ left: `${percent(axis, holdings.end)}%` }}
        />
      ) : null}
    </div>
  )
}

/** What the two bars and the marker mean. */
export function TimelineLegend({ labels }: { labels: { transactions: string; dividends: string; holdings: string } }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-label text-ink-3">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-1.5 w-4 rounded-pill bg-info" />
        {labels.transactions}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-1.5 w-4 rounded-pill bg-success" />
        {labels.dividends}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-0.5 rounded-pill bg-ink-2" />
        {labels.holdings}
      </span>
    </div>
  )
}
