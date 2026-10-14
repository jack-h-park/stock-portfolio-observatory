import { Badge } from '@/components/ui'
import type { WashSaleReview } from '@/lib/adapters/portfolio-db'
import { fmtMoney } from '@/lib/format'
import type { getPageCopy } from '@/lib/ui-copy'
import type { WashSaleMatchedBuy } from '@/lib/wash-sale'

type WashSaleCopy = ReturnType<typeof getPageCopy<'washSale'>>

function buyDates(buys: WashSaleMatchedBuy[], copy: WashSaleCopy) {
  return buys.map((buy) => `${buy.date} ${buy.account}${buy.reinvested ? ` · ${copy.reinvested}` : ''}`).join(', ')
}

/**
 * Which US tickers must not be bought, in any account, and until when.
 *
 * Danger-toned and placed above everything else on the page on purpose: the
 * mistake it prevents is a buy, and a buy happens in another app. Renders
 * nothing when no window is open, so it never becomes wallpaper.
 */
export function WashSaleBanner({ review, copy }: { review: WashSaleReview; copy: WashSaleCopy }) {
  if (!review.windows.length) return null
  return (
    <section
      role="alert"
      aria-labelledby="wash-sale-title"
      className="mb-5 rounded-md border-2 border-danger bg-danger/[0.06] shadow-card"
    >
      <header className="border-b border-danger px-4 py-3">
        <h2 id="wash-sale-title" className="text-body-lg font-semibold tracking-tight text-danger">
          {copy.title(review.windows.length)}
        </h2>
        <p className="mt-1 text-label text-ink-2">{copy.scope}</p>
      </header>
      <div className="p-4">
        {/* A list, not a table: on a phone a table scrolls sideways, and the
            days left — the one figure that changes daily — was the part cut off. */}
        <ul className="divide-y divide-[color:var(--border-subtle)]">
          {review.windows.map((w) => {
            const accounts = [...new Set(w.sales.flatMap((sale) => sale.accounts))].join(', ')
            const before = w.sales.flatMap((sale) => sale.matchedBuys.filter((buy) => buy.side === 'before'))
            const after = w.sales.flatMap((sale) => sale.matchedBuys.filter((buy) => buy.side === 'after'))
            const replaced = w.sales.some((sale) => sale.replacementQuantity > 0)
            const disallowed = fmtMoney(Math.abs(w.possiblyDisallowed), 'USD')
            return (
              <li key={w.ticker} className="grid gap-x-4 gap-y-1 py-2.5 xl:grid-cols-[5rem_7rem_minmax(0,21rem)_minmax(0,1fr)]">
                <div className="flex items-baseline justify-between gap-3 xl:contents">
                  <span className="font-mono font-semibold text-ink">{w.ticker}</span>
                  <span className="whitespace-nowrap font-mono text-danger xl:text-right" title={copy.columns.loss}>
                    {fmtMoney(w.loss, 'USD')}
                  </span>
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">
                      <span className="text-ink-3">{copy.columns.until} </span>
                      {copy.untilDate(w.blockedThrough)}
                    </span>
                    <Badge tone={w.daysLeft <= 3 ? 'warning' : 'danger'}>{copy.daysLeft(w.daysLeft)}</Badge>
                  </div>
                  <div className="text-label text-ink-3">{copy.clearFrom(w.clearFrom)}</div>
                </div>
                <div className="text-label text-ink-2">
                  <div>{copy.soldIn(accounts)}</div>
                  {after.length > 0 && (
                    <div className="font-medium text-danger">{copy.boughtAfter(buyDates(after, copy), disallowed)}</div>
                  )}
                  {before.length > 0 && after.length === 0 && (
                    <div className="font-medium text-warning">
                      {replaced ? copy.boughtBefore(buyDates(before, copy), disallowed) : copy.boughtBeforeSoldTogether(buyDates(before, copy))}
                    </div>
                  )}
                  {w.stillHeldIn.length > 0 && <div>{copy.stillHeld(w.stillHeldIn.join(', '))}</div>}
                </div>
              </li>
            )
          })}
        </ul>
        <p className="mt-3 text-label text-ink-2">{copy.drip}</p>
        <p className="mt-1 text-label text-ink-3">
          {copy.asOf(review.today, review.transactionsThrough ?? 'n/a')} {copy.estimate}
        </p>
      </div>
    </section>
  )
}
