export function positionHref(market: string, ticker: string) {
  return `/positions/${encodeURIComponent(market)}/${encodeURIComponent(ticker)}`
}
