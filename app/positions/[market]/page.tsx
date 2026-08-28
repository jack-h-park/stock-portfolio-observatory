import { redirect } from 'next/navigation'

/**
 * `/positions/KR` — one segment up from a position. Holdings filters by market
 * from the URL, so the market the reader had in hand survives the trip.
 *
 * An unrecognised market is passed through rather than dropped: holdings renders
 * "0 / 5" with the filter bar intact, which says what was asked for and offers
 * the way out. Guessing a correction would be worse.
 */
export default async function MarketIndex({ params }: { params: Promise<{ market: string }> }): Promise<never> {
  const { market } = await params
  redirect(`/holdings?market=${encodeURIComponent(decodeURIComponent(market).toUpperCase())}`)
}
