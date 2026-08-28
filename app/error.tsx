'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui'
import { usePageLanguage } from '@/components/LanguageProvider'
import { getUiCopy } from '@/lib/ui-copy'

/**
 * The boundary every route segment falls back to.
 *
 * Until this existed, one page's query throwing took the whole dashboard down:
 * `/fx` read a table the sample database did not have, and the answer was a
 * blank 500 for the entire app rather than a broken card on one screen. Next
 * renders this in place of the page's content, so the sidebar, the language
 * switch, and every other route stay usable.
 *
 * It sits inside LanguageProvider (the layout wraps `children`), so it can
 * answer in Korean like everything else.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const copy = getUiCopy(usePageLanguage()).error

  useEffect(() => {
    // The digest is all the browser gets in production — the message is stripped
    // server-side. Logging the whole error keeps the local console useful.
    console.error(error)
  }, [error])

  return (
    <div className="mx-auto max-w-xl rounded-md border border-line bg-card px-5 py-6 shadow-card">
      <h1 className="text-title font-medium text-ink">{copy.title}</h1>
      <p className="mt-2 text-caption leading-relaxed text-ink-2">{copy.body}</p>
      {error.digest ? (
        <p className="mt-3 text-label text-ink-3">
          {copy.reference} <code className="font-mono">{error.digest}</code>
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={reset} variant="solid" tone="info">
          {copy.retry}
        </Button>
        <Button href="/">{copy.home}</Button>
      </div>
    </div>
  )
}
