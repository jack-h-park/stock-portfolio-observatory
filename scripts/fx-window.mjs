// Where the historical USD/KRW table has to start, and whether a table already
// written starts early enough.
//
// The table used to start on the first dated TRADE. An income row can come
// before it (a new-account bonus deposit four days ahead of the first trade),
// and a row dated before the table has no rate of its own: it converts at
// today's rate and `income_fx_dated` warns, forever, because nothing ever
// moved the start.
const BUFFER_DAYS = 7

function shift(date, days) {
  const moved = new Date(`${date}T00:00:00Z`)
  moved.setUTCDate(moved.getUTCDate() + days)
  return moved.toISOString().slice(0, 10)
}

/**
 * First day to ask for. The first trade, unless an income row is earlier; then a
 * week before it, because the source quotes business days only and a Saturday
 * start would again leave the first row without a rate on or before its date.
 */
export function fxWindowStart(firstTradeDate, firstIncomeDate) {
  if (!firstIncomeDate) return firstTradeDate
  if (firstTradeDate && firstIncomeDate >= firstTradeDate) return firstTradeDate
  return shift(firstIncomeDate, -BUFFER_DAYS)
}

/** True when a table asked for from `existingStartDate` already reaches the first income row. */
export function fxCoversIncome(existingStartDate, firstIncomeDate) {
  if (!firstIncomeDate) return true
  return Boolean(existingStartDate) && existingStartDate <= firstIncomeDate
}
