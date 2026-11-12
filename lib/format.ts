import { formatKrw, formatUsd } from '@/lib/currency'
import type { Language } from '@/lib/i18n'

/** What every formatter and page prints when there is no value. */
export const EMPTY_VALUE = '—'

/** The BCP 47 tag for a dashboard language. The one place a locale is chosen. */
export function localeFor(language: Language): 'ko-KR' | 'en-US' {
  return language === 'ko' ? 'ko-KR' : 'en-US'
}

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
 * cannot come back. `signed` follows fmtSigned: a "+" for a gain only, never
 * for zero. `unit: 'pp'` prints percentage points as "%p".
 */
export function fmtPct(
  value: number | null | undefined,
  {
    digits = 2,
    signed = false,
    unit = '%',
    nullText = EMPTY_VALUE,
  }: { digits?: number; signed?: boolean; unit?: '%' | 'pp'; nullText?: string } = {}
) {
  if (value == null) return nullText
  const n = Number(value)
  const body = signed ? fmtSigned(n, (m) => fmtNumber(m, digits)) : fmtNumber(n, digits)
  return `${body}${unit === 'pp' ? '%p' : '%'}`
}

/** A percentage band, "1.0–2.5%": one percent sign after the upper bound. */
export function fmtPctRange(lower: number, upper: number, digits: number) {
  return `${fmtNumber(lower, digits)}–${fmtNumber(upper, digits)}%`
}

/**
 * A signed figure: "+" and the formatted magnitude for a gain, "-" and the
 * formatted magnitude for a loss, the formatted zero with no sign, and
 * EMPTY_VALUE for a missing value. A value that rounds to zero in `format` is
 * zero here too, so it never reads "+0" or "-0". The one sign rule; `Signed` in
 * components/ui.tsx renders the same text with a tone.
 */
export function fmtSigned(value: number | null | undefined, format: (n: number) => string): string {
  if (value == null || Number.isNaN(Number(value))) return EMPTY_VALUE
  const n = Number(value)
  const body = format(Math.abs(n))
  if (n === 0 || !/[1-9]/.test(body)) return body
  return `${n > 0 ? '+' : '-'}${body}`
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

/**
 * A plain number with grouping, at a fixed precision by default. `minDigits`
 * lets trailing zeros drop (a chart tick reads "12", not "12.0").
 */
export function fmtNumber(value: number | null | undefined, digits = 0, minDigits = digits) {
  const n = Number(value ?? 0)
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: minDigits,
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

export function fmtDateTime(value: string | null | undefined, language: Language) {
  if (!value) return EMPTY_VALUE
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
export function fmtDateShort(value: string | null | undefined, language: Language) {
  if (!value) return EMPTY_VALUE
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
export function fmtDurationDays(days: number | null | undefined, language: Language) {
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
 *
 * The ISO form is the same in both languages, so `language` changes nothing
 * today beyond the empty text, which is EMPTY_VALUE in both. It is required so
 * every date helper has the same signature and a caller switching between them
 * cannot drop it.
 */
export function fmtDate(value: string | null | undefined, language: Language) {
  void language
  if (!value) return EMPTY_VALUE
  // A date-only value is already the answer. Parsed, it becomes UTC midnight,
  // and read back in the server's local time west of UTC it is the day before:
  // /data-ops showed every account's coverage date one day early. Same reason
  // fmtDateShort pins date-only values to UTC.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * A month from its `YYYY-MM` key: "Mar" / "3월", or with the year
 * "Mar 2026" / "2026년 3월". Built from the key's parts in UTC, so the month
 * cannot shift across the server's timezone offset.
 */
export function fmtMonth(yearMonth: string, language: Language, options: { year?: boolean } = {}) {
  const [year, month] = yearMonth.split('-').map(Number)
  if (!year || !month) return yearMonth
  return new Intl.DateTimeFormat(localeFor(language), {
    month: language === 'ko' ? 'long' : 'short',
    ...(options.year ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

/** An elapsed span in the largest unit that keeps it short: minutes, hours, then days. */
export function fmtDuration(ms: number | null | undefined, language: Language) {
  if (ms == null || !Number.isFinite(ms)) return EMPTY_VALUE
  const units = language === 'ko' ? { m: '분', h: '시간', d: '일' } : { m: 'm', h: 'h', d: 'd' }
  const abs = Math.abs(ms)
  const minutes = Math.round(abs / 60_000)
  if (minutes < 60) return `${minutes}${units.m}`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}${units.h}`
  const days = Math.round(hours / 24)
  return `${days}${units.d}`
}

export function shortHash(value: string) {
  return value.slice(0, 10)
}
