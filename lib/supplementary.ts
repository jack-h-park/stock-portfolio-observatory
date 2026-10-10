// Which freshness items describe supplementary inputs (deposits, pensions, gold)
// rather than the stock data. Stock surfaces — the Overview badge, the summary's
// health issues — leave these out; the weekly reminder reports them instead.

const SUPPLEMENTARY_SOURCE_KEYS = new Set(['source:bank_balances', 'source:pension_evidence', 'source:gold_prices'])

/** The bank statements file, the pension evidence, each pension snapshot CSV (`pension:<file>`) and the gold price file. */
export function isSupplementarySource(key: string) {
  return SUPPLEMENTARY_SOURCE_KEYS.has(key) || key.startsWith('source:pension:')
}

/**
 * The last YYYYMMDD in a filed statement's name (`…-20230101-20261010.pdf` → 2026-10-10):
 * how far the statement reaches, even when nothing happened near its end. Null without one.
 */
export function periodEndFromSource(source: string | null | undefined): string | null {
  const dates = String(source ?? '').match(/(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/g)
  if (!dates?.length) return null
  const last = dates[dates.length - 1]
  return `${last.slice(0, 4)}-${last.slice(4, 6)}-${last.slice(6, 8)}`
}
