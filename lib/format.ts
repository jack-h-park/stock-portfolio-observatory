export function fmtKrw(value: number | null | undefined) {
  const n = Number(value ?? 0)
  return `₩${Math.round(n).toLocaleString('ko-KR')}`
}

export function fmtMoney(value: number | null | undefined, currency: string | null | undefined) {
  const n = Number(value ?? 0)
  const code = currency || 'KRW'
  if (code === 'KRW') return fmtKrw(n)
  if (code === 'USD') return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
  return `${n.toLocaleString()} ${code}`
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
 * right for 306 shares and destroys 0.00010778 BTC — it renders as "0", and a
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

export function fmtDateTime(value: string | null | undefined) {
  if (!value) return 'n/a'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-US', { hour12: false })
}

export function fmtDate(value: string | null | undefined) {
  if (!value) return 'n/a'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-US', { hour12: false })
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
