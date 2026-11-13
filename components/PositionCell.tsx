import Link from 'next/link'
import { Badge, marketTone } from '@/components/ui'
import { positionHref } from '@/lib/position-url'

const TICKER_LINK = 'font-mono text-caption font-medium text-info hover:underline'

/**
 * A position in a table row: the market badge and the ticker linking to the
 * position page, with the name under them (`stacked`), or the ticker link alone
 * for a table that shows the market in its own column (`ticker`).
 */
export function PositionCell({
  market,
  ticker,
  name,
  showMarket = true,
  layout = 'stacked',
}: {
  market: string
  ticker: string
  name?: string | null
  showMarket?: boolean
  layout?: 'stacked' | 'ticker'
}) {
  const link = (
    <Link href={positionHref(market, ticker)} className={TICKER_LINK}>
      {ticker}
    </Link>
  )
  if (layout === 'ticker') return link
  return (
    <div className="min-w-[14rem]">
      <div className="flex items-center gap-2">
        {showMarket ? <Badge tone={marketTone(market)}>{market}</Badge> : null}
        {link}
      </div>
      <div className="mt-1 max-w-[20rem] truncate text-caption font-medium text-ink">{name}</div>
    </div>
  )
}
