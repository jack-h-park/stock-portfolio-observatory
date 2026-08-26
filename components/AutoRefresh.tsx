'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { clsx } from 'clsx'
import { normalizeLanguage, type Language } from '@/lib/i18n'

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
  const [language, setLanguage] = useState<Language>('en')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setLanguage(normalizeLanguage(document.documentElement.lang))
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

  const clock = lastRefresh?.toLocaleTimeString(language === 'ko' ? 'ko-KR' : 'en-US', { hour12: false })
  const copy = language === 'ko'
    ? {
        offline: '오프라인',
        lastChecked: '마지막 확인',
        refreshing: '갱신 중...',
        lastRefresh: '마지막 갱신',
        interval: `${seconds}초 간격`,
        auto: `${seconds}초마다 자동 갱신`,
      }
    : {
        offline: 'Offline',
        lastChecked: 'last checked',
        refreshing: 'Refreshing...',
        lastRefresh: 'Last refresh',
        interval: `${seconds}s interval`,
        auto: `Auto-refresh every ${seconds}s`,
      }

  if (!online) {
    return (
      <span className="inline-flex items-center gap-1.5 text-label tabular-nums text-warning">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warning" />
        {copy.offline}{clock ? ` · ${copy.lastChecked} ${clock}` : ''}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-label tabular-nums text-ink-3">
      <span
        aria-hidden
        className={clsx('h-1.5 w-1.5 rounded-full', isPending ? 'bg-info motion-safe:animate-pulse' : 'bg-success/70')}
      />
      {isPending
        ? copy.refreshing
        : clock
          ? `${copy.lastRefresh} ${clock} · ${copy.interval}`
          : copy.auto}
    </span>
  )
}
