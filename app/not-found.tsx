import { Button } from '@/components/ui'
import { getLanguage } from '@/lib/i18n-server'
import { getUiCopy } from '@/lib/ui-copy'

/**
 * Reached by a mistyped URL, and by `notFound()` from a detail route whose id
 * does not exist. `/tax-planning/plans` has no index page, so the parent of the
 * plan detail route lands here too until P3 adds one.
 */
export default async function NotFound() {
  const copy = getUiCopy(await getLanguage()).error

  return (
    <div className="mx-auto max-w-xl rounded-md border border-line bg-card px-5 py-6 shadow-card">
      <h1 className="text-title font-medium text-ink">{copy.notFoundTitle}</h1>
      <p className="mt-2 text-caption leading-relaxed text-ink-2">{copy.notFoundBody}</p>
      <div className="mt-5">
        <Button href="/">{copy.home}</Button>
      </div>
    </div>
  )
}
