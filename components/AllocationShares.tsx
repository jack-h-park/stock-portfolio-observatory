import type { AllocationShare } from '@/lib/asset-allocation'
import { fmtPct } from '@/lib/format'

/**
 * One way of splitting the net worth: a single bar with a segment per share,
 * then the same shares as rows with their value and percent. The bar carries no
 * text of its own, so the rows are the accessible reading of it.
 */
export function AllocationShares<K extends string>({
  title,
  shares,
  labels,
  colors,
  money,
  columns,
  note,
}: {
  title: string
  shares: AllocationShare<K>[]
  labels: Record<K, string>
  colors: Record<K, string>
  money: (krw: number) => string
  columns: { name: string; value: string; pct: string }
  note?: string
}) {
  return (
    <section className="flex flex-col gap-3 p-4">
      <h3 className="text-label font-semibold text-ink-2">{title}</h3>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface" aria-hidden="true">
        {shares.map((share) => (
          <div key={share.key} style={{ width: `${Math.max(share.pct, 0)}%`, background: colors[share.key] }} />
        ))}
      </div>
      <table className="w-full text-body">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr className="text-label text-ink-3">
            <th scope="col" className="py-1 text-left font-normal">{columns.name}</th>
            <th scope="col" className="py-1 text-right font-normal">{columns.value}</th>
            <th scope="col" className="py-1 text-right font-normal">{columns.pct}</th>
          </tr>
        </thead>
        <tbody>
          {shares.map((share) => (
            <tr key={share.key} className="border-t border-line-subtle">
              <th scope="row" className="py-2 text-left font-medium text-ink">
                <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: colors[share.key] }} aria-hidden="true" />
                {labels[share.key]}
              </th>
              <td className="py-2 text-right tabular-nums">{money(share.valueKrw)}</td>
              <td className="py-2 text-right font-medium tabular-nums text-ink">{fmtPct(share.pct, { digits: 1 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {note ? <p className="text-label leading-relaxed text-ink-3">{note}</p> : null}
    </section>
  )
}
