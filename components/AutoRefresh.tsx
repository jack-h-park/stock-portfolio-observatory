'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, useTransition } from 'react'
import { clsx } from 'clsx'
import { usePageLanguage } from '@/components/LanguageProvider'
import { getUiCopy } from '@/lib/ui-copy'

/** Where the paused choice lives, so it survives navigating to another page. */
const PAUSE_KEY = 'stock-observatory-autorefresh-paused'

/**
 * Reading the stored choice cannot throw the page down: a private window, or a
 * browser set to block site data, makes the accessor itself throw.
 */
function readPaused() {
  try {
    return window.localStorage.getItem(PAUSE_KEY) === '1'
  } catch {
    return false
  }
}

function writePaused(paused: boolean) {
  try {
    window.localStorage.setItem(PAUSE_KEY, paused ? '1' : '0')
  } catch {
    // A viewer who cannot store the choice still gets it for this page.
  }
}

/**
 * Polls by re-rendering the server component tree (router.refresh) on an
 * interval — data change cadence is minutes, so 30s polling is plenty
 * (plan §2: SSE/WebSocket would be over-engineering).
 *
 * The label doubles as the page's liveness indicator: the dot pulses while a
 * refresh is in flight, and when the browser goes offline the label degrades
 * to a warning instead of silently showing an ever-staler "Updated" time.
 *
 * It is also a control. Every thirty seconds this replaces the whole rendered
 * tree, which is fine while you are watching a number and not fine while you
 * are reading a long table or comparing two rows. The label is a button that
 * stops the polling, and the choice is remembered across pages — pausing that
 * lasted until the next click would not be worth having.
 *
 * The language comes from context. It used to start at 'en' and read
 * document.documentElement.lang in an effect, so every page rendered this in
 * English and swapped after hydration — a flash of English on all twenty
 * screens for a Korean reader. The provider already wraps this component, so
 * the server render knows the language and there is nothing to correct.
 */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter()
  const language = usePageLanguage()
  const copy = getUiCopy(language).autoRefresh
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [online, setOnline] = useState(true)
  const [paused, setPaused] = useState(false)
  const [isPending, startTransition] = useTransition()

  const refresh = useCallback(() => {
    startTransition(() => router.refresh())
    setLastRefresh(new Date())
  }, [router])

  // Split from the polling effect on purpose: the stored choice is read once on
  // mount, while the interval below is torn down and rebuilt whenever `paused`
  // changes. Together they would re-read storage on every toggle.
  useEffect(() => {
    setLastRefresh(new Date())
    setOnline(navigator.onLine)
    setPaused(readPaused())
  }, [])

  useEffect(() => {
    const onOnline = () => {
      setOnline(true)
      if (!paused) refresh()
    }
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    // Paused means paused: no interval at all rather than one that wakes up and
    // decides to do nothing.
    const timer = paused
      ? null
      : setInterval(() => {
          if (navigator.onLine) refresh()
        }, seconds * 1000)
    return () => {
      if (timer) clearInterval(timer)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [paused, refresh, seconds])

  const togglePaused = () => {
    const next = !paused
    setPaused(next)
    writePaused(next)
    // Resuming refreshes straight away: the figures on screen are as old as the
    // pause, and waiting up to another interval to correct them would be worse
    // than not having paused.
    if (!next) refresh()
  }

  const clock = lastRefresh?.toLocaleTimeString(language === 'ko' ? 'ko-KR' : 'en-US', { hour12: false })

  if (!online) {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-label tabular-nums text-warning">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warning" />
        {copy.offline}
        {clock ? ` · ${copy.lastChecked} ${clock}` : ''}
      </span>
    )
  }

  const label = paused
    ? clock
      ? copy.pausedSince(clock)
      : copy.paused
    : isPending
      ? copy.refreshing
      : clock
        ? `${copy.lastRefresh} ${clock} · ${copy.interval(seconds)}`
        : copy.auto(seconds)

  return (
    <span className="inline-flex items-center gap-2">
      {/*
        A bare button, not a styled control. It carries no padding or border of
        its own so it occupies exactly the box the plain label used to, which is
        what lets the screenshot net prove the twenty pages around it did not
        move. What marks it as pressable is the pointer and the hover rule.
      */}
      <button
        type="button"
        onClick={togglePaused}
        aria-pressed={paused}
        // The action first, because that is what a button's name should say,
        // then the status — an aria-label replaces the visible text outright,
        // so naming only the action would take the refresh time away from
        // screen-reader users, who have no other way to read it.
        aria-label={`${paused ? copy.resume : copy.pause} · ${label}`}
        className={clsx(
          'inline-flex min-h-6 cursor-pointer items-center gap-1.5 text-label tabular-nums hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info',
          paused ? 'text-warning' : 'text-ink-3'
        )}
      >
        <span
          aria-hidden
          className={clsx(
            'h-1.5 w-1.5 rounded-full',
            paused ? 'bg-warning' : isPending ? 'bg-info motion-safe:animate-pulse' : 'bg-success/70'
          )}
        />
        {label}
      </button>
      {/*
        Only while paused. Running, the next refresh is at most `seconds` away
        and a second button would be one more thing to read on every page.
      */}
      {paused ? (
        <button
          type="button"
          onClick={refresh}
          className="inline-flex min-h-6 cursor-pointer items-center text-label font-medium text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info"
        >
          {copy.refreshNow}
        </button>
      ) : null}
    </span>
  )
}
