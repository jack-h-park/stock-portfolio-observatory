export const DISPLAY_CURRENCIES = ['KRW', 'USD'] as const
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number]

export const DEFAULT_DISPLAY_CURRENCY: DisplayCurrency = 'KRW'
export const DISPLAY_CURRENCY_COOKIE = 'stock-observatory-display-currency'

export type CurrencyPreferences = {
  displayCurrency: DisplayCurrency
  usdKrwRate: number | null
}

export function normalizeDisplayCurrency(value: unknown): DisplayCurrency {
  return value === 'USD' ? 'USD' : DEFAULT_DISPLAY_CURRENCY
}

export const DISPLAY_CURRENCY_LABELS: Record<DisplayCurrency, string> = {
  KRW: '원화',
  USD: '달러',
}

export function formatKrw(value: number | null | undefined) {
  const n = Number(value ?? 0)
  return `₩${Math.round(n).toLocaleString('ko-KR')}`
}

export function formatUsd(value: number | null | undefined) {
  const n = Number(value ?? 0)
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
}

export function convertMoney(value: number, fromCurrency: string, displayCurrency: DisplayCurrency, usdKrwRate: number | null) {
  const from = fromCurrency.toUpperCase()
  if (from === displayCurrency) return { value, currency: displayCurrency }
  if (!usdKrwRate || usdKrwRate <= 0) return { value, currency: from }
  if (from === 'KRW' && displayCurrency === 'USD') return { value: value / usdKrwRate, currency: 'USD' }
  if (from === 'USD' && displayCurrency === 'KRW') return { value: value * usdKrwRate, currency: 'KRW' }
  return { value, currency: from }
}

export function createMoneyFormatter({ displayCurrency, usdKrwRate }: CurrencyPreferences) {
  return (value: number | null | undefined, currency: string | null | undefined = 'KRW') => {
    const n = Number(value ?? 0)
    const code = (currency || 'KRW').toUpperCase()
    const converted = convertMoney(n, code, displayCurrency, usdKrwRate)
    if (converted.currency === 'KRW') return formatKrw(converted.value)
    if (converted.currency === 'USD') return formatUsd(converted.value)
    return `${converted.value.toLocaleString()} ${converted.currency}`
  }
}
