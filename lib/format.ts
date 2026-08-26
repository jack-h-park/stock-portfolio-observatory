import { formatKrw, formatUsd } from '@/lib/currency'
import type { Language } from '@/lib/i18n'

const localeFor = (language: Language = 'en') => (language === 'ko' ? 'ko-KR' : 'en-US')

export function fmtKrw(value: number | null | undefined) {
  return formatKrw(value)
}

export function fmtMoney(value: number | null | undefined, currency: string | null | undefined) {
  const n = Number(value ?? 0)
  const code = currency || 'KRW'
  if (code === 'KRW') return fmtKrw(n)
  if (code === 'USD') return formatUsd(n)
  return `${n.toLocaleString()} ${code}`
}

/**
 * A percentage.
 *
 * Five pages defined this, three of them byte-identical, and they disagreed on
 * the two things that matter: whether null reads as "n/a" and whether a
 * positive value carries a "+". Both are options here so the disagreement
 * cannot come back.
 */
export function fmtPct(
  value: number | null | undefined,
  { digits = 2, signed = false, nullText = 'n/a' }: { digits?: number; signed?: boolean; nullText?: string } = {}
) {
  if (value == null) return nullText
  const n = Number(value)
  const sign = signed && n > 0 ? '+' : ''
  return `${sign}${fmtNumber(n, digits)}%`
}

/**
 * A dividend year for the trend chart: won in thousands, dollars as they are.
 *
 * Defined identically in the overview and the dividends page — the same two
 * lines, twice.
 */
export function dividendChartAmount(currency: string, amount: number) {
  return currency === 'KRW' ? Number((amount / 1000).toFixed(1)) : Number(amount.toFixed(2))
}

/** Byte size at human scale. Reclaimed from app/data-map, which defined it locally. */
export function fmtBytes(value: number | null | undefined) {
  const n = Number(value ?? 0)
  if (n >= 1024 ** 3) return `${fmtNumber(n / 1024 ** 3, 1)} GB`
  if (n >= 1024 ** 2) return `${fmtNumber(n / 1024 ** 2, 1)} MB`
  if (n >= 1024) return `${fmtNumber(n / 1024, 1)} KB`
  return `${fmtNumber(n)} B`
}

export function fmtNumber(value: number | null | undefined, digits = 0) {
  const n = Number(value ?? 0)
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })
}

/**
 * A position size, at a precision that suits its magnitude.
 *
 * Share counts and coin balances are the same field but not the same number.
 * Every quantity here used to be formatted at a fixed 2–4 decimals, which is
 * right for a whole-share equity position and destroys a small BTC balance —
 * it renders as "0", and a
 * real position reads as an empty one. Below 1 unit the precision opens up to
 * where crypto actually lives; at or above 1 the caller's digits are kept, so
 * equity tables look exactly as they did.
 */
export function fmtQuantity(value: number | null | undefined, digits = 4) {
  const n = Number(value ?? 0)
  const abs = Math.abs(n)
  if (abs === 0) return '0'
  if (abs >= 1) {
    return n.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: digits })
  }
  return n.toLocaleString('ko-KR', { maximumFractionDigits: abs >= 0.001 ? 6 : 8, minimumFractionDigits: 0 })
}

export function fmtDateTime(value: string | null | undefined, language: Language = 'en') {
  if (!value) return 'n/a'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString(localeFor(language), { hour12: false })
}

/**
 * A date written out ("Aug 20, 2026" / "2026년 8월 20일").
 *
 * Two tax pages built this with their own Intl.DateTimeFormat, one of them
 * pinned to en-US even in Korean.
 */
export function fmtDateShort(value: string | null | undefined, language: Language = 'en') {
  if (!value) return 'n/a'
  // A date-only value carries no time, so reading it in local time can move it a
  // day in either direction. Pin those to UTC; a full timestamp keeps local time.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10)) && value.length <= 10
  const d = dateOnly ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat(localeFor(language), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(dateOnly ? { timeZone: 'UTC' } : {}),
  }).format(d)
}

/** A span of days, in the unit that reads best at that magnitude. */
export function fmtDurationDays(days: number | null | undefined, language: Language = 'en') {
  const rounded = Math.round(Number(days ?? 0))
  if (rounded < 31) return language === 'ko' ? `${fmtNumber(rounded)}일` : `${fmtNumber(rounded)} days`
  const months = fmtNumber(rounded / 30.4375, 1)
  return language === 'ko' ? `${months}개월` : `${months} months`
}

/**
 * A calendar date, without a time.
 *
 * This used to be a byte-for-byte copy of fmtDateTime, so every caller that
 * wanted a date got a timestamp too — an account's download cutoff read
 * "6/17/2026, 17:00:00", as if the hour were part of the boundary. The output
 * is the ISO calendar date built from local parts (not toISOString(), which
 * would shift the day across the timezone offset), which also matches how the
 * rest of the dashboard prints market dates.
 */
export function fmtDate(value: string | null | undefined) {
  if (!value) return 'n/a'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function relTime(value: string | null | undefined) {
  if (!value) return 'n/a'
  const d = new Date(value)
  const ms = Date.now() - d.getTime()
  if (Number.isNaN(ms)) return value
  const abs = Math.abs(ms)
  const suffix = ms >= 0 ? 'ago' : 'from now'
  const minutes = Math.round(abs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ${suffix}`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ${suffix}`
  const days = Math.round(hours / 24)
  return `${days}d ${suffix}`
}

export function fmtDuration(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms)) return 'n/a'
  const abs = Math.abs(ms)
  const minutes = Math.round(abs / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days}d`
}

export function shortHash(value: string) {
  return value.slice(0, 10)
}
