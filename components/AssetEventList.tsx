import { DataTable, type DataTableColumn } from '@/components/DataTable'
import type { EventMarker } from '@/lib/asset-events'
import { fmtDate } from '@/lib/format'
import { signClass } from '@/lib/tone'
import type { getPageCopy } from '@/lib/ui-copy'

type Copy = ReturnType<typeof getPageCopy<'assetEvents'>>

/**
 * The large asset events in date order, numbered like their chart markers. An
 * inflow shows its amount; a holding period its peak invested cost, the gain
 * before tax (realized + unrealized at today's price + dividends), the tax
 * planner's estimate for the open lots, and the gain after it.
 */
export function AssetEventList({ markers, copy, money }: { markers: EventMarker[]; copy: Copy; money: (krw: number) => string }) {
  const signed = (krw: number) => <span className={`tabular-nums ${krw ? signClass(krw) : ''}`}>{money(krw)}</span>
  const columns: DataTableColumn<EventMarker>[] = [
    { key: 'n', label: copy.columns.n, render: (m) => <span className="tabular-nums text-ink-3">{m.n}</span> },
    {
      key: 'period',
      label: copy.columns.period,
      nowrap: true,
      render: ({ event }) => {
        const end = event.kind === 'inflow' ? (event.end !== event.start ? fmtDate(event.end) : null) : event.end ? fmtDate(event.end) : copy.held
        return end ? `${fmtDate(event.start)} – ${end}` : fmtDate(event.start)
      },
    },
    {
      key: 'event',
      label: copy.columns.event,
      render: ({ event }) =>
        event.kind === 'inflow' ? (
          <div>
            <div className="font-medium text-ink">{event.label ?? copy.unlabeled(event.arrivals)}</div>
            {event.category && event.category in copy.categories ? (
              <div className="text-label text-ink-3">{copy.categories[event.category as keyof typeof copy.categories]}</div>
            ) : null}
          </div>
        ) : (
          <div>
            <div className="font-medium text-ink">
              {event.name} <span className="text-ink-3">({event.ticker})</span>
            </div>
            <div className="text-label text-ink-3">{copy.breakdown(money(event.realizedKrw), money(event.unrealizedKrw), money(event.dividendsKrw))}</div>
            {event.unpricedLots ? <div className="text-label text-danger">{copy.unpriced(event.unpricedLots)}</div> : null}
          </div>
        ),
    },
    {
      key: 'invested',
      label: copy.columns.invested,
      align: 'right',
      priority: 'secondary',
      render: ({ event }) => (event.kind === 'investment' ? <span className="tabular-nums">{money(event.peakCostKrw)}</span> : copy.none),
    },
    { key: 'gain', label: copy.columns.gain, align: 'right', render: ({ event }) => signed(event.kind === 'inflow' ? event.amountKrw : event.gainKrw) },
    {
      key: 'tax',
      label: copy.columns.tax,
      align: 'right',
      priority: 'secondary',
      render: ({ event }) =>
        event.kind === 'investment' && event.estimatedTaxKrw != null ? <span className="tabular-nums">{money(event.estimatedTaxKrw)}</span> : copy.none,
    },
    {
      key: 'afterTax',
      label: copy.columns.afterTax,
      align: 'right',
      render: ({ event }) => (event.kind === 'investment' ? signed(event.gainKrw - (event.estimatedTaxKrw ?? 0)) : copy.none),
    },
  ]
  return (
    <div>
      <div className="mb-2 text-label leading-relaxed text-ink-3">{copy.method}</div>
      <DataTable caption={copy.title} rows={markers} getRowKey={(m: EventMarker) => String(m.n)} emptyMessage={copy.empty} columns={columns} />
    </div>
  )
}
