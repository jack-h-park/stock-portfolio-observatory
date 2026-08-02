'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { clsx } from 'clsx'

/**
 * Polls by re-rendering the server component tree (router.refresh) on an
 * interval — data change cadence is minutes, so 30s polling is plenty
 * (plan §2: SSE/WebSocket would be over-engineering).
 *
 * The label doubles as the page's liveness indicator: the dot pulses while a
 * refresh is in flight, and when the browser goes offline the label degrades
 * to a warning instead of silently showing an ever-staler "Updated" time.
 */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter()
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [online, setOnline] = useState(true)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setLastRefresh(new Date())
    setOnline(navigator.onLine)
    const refresh = () => {
      startTransition(() => router.refresh())
      setLastRefresh(new Date())
    }
    const onOnline = () => {
      setOnline(true)
      refresh()
    }
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    const t = setInterval(() => {
      if (navigator.onLine) refresh()
    }, seconds * 1000)
    return () => {
      clearInterval(t)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [router, seconds])

  const clock = lastRefresh?.toLocaleTimeString('ko-KR', { hour12: false })

  if (!online) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] tabular-nums text-warning">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warning" />
        오프라인{clock ? ` · 마지막 확인 ${clock}` : ''}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] tabular-nums text-ink-3">
      <span
        aria-hidden
        className={clsx('h-1.5 w-1.5 rounded-full', isPending ? 'animate-pulse bg-info' : 'bg-success/70')}
      />
      {isPending
        ? '갱신 중…'
        : clock
          ? `마지막 갱신 ${clock} · ${seconds}초 간격`
          : `${seconds}초마다 자동 갱신`}
    </span>
  )
}
