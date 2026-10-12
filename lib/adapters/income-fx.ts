export type DisplayCurrency = 'KRW' | 'USD'

/**
 * A native amount in the display currency, at the USD/KRW rate of the row's own
 * date (`usd_krw_rate`, stamped at ingest). Both /income and /cash-inflow use
 * this one expression so the two pages cannot convert differently.
 */
export function datedAmountSql(display: DisplayCurrency, amount = 'native_amount') {
  // Only KRW and USD are converted. Any other currency yields null, which sum()
  // skips, rather than being taken at the USD rate.
  return display === 'KRW'
    ? `(case currency when 'KRW' then ${amount} when 'USD' then ${amount} * usd_krw_rate else null end)`
    : `(case currency when 'USD' then ${amount} when 'KRW' then ${amount} / usd_krw_rate else null end)`
}

/**
 * A dividend row's cash actually received, in its native currency.
 * - Toss foreign-stock dividends (외화증권배당금입금) are already net of withholding.
 * - Refunds (환급) arrive as-is; subtracting withholding from them would double count.
 * - Everything else is the gross amount minus the withholding.
 */
export const NET_DIVIDEND_SQL = `case when source_system = 'korea_statement' and type = '외화증권배당금입금' then native_amount when type like '%환급%' then native_amount else native_amount - coalesce(native_tax_withheld, 0) end`
