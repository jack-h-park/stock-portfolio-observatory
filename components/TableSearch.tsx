'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Input } from '@/components/form'
import { withParam } from '@/lib/table-filter'

/**
 * The one part of a filtered table that has to be a client component.
 *
 * Chips can be links because a click is a single decision, but typing is not:
 * pushing a URL per keystroke would put a history entry behind every letter and
 * a server round-trip behind every one of them. The value is held locally and
 * written to the URL once typing stops, with `replace` so the back button steps
 * over the search rather than through it.
 */
export function TableSearch({
  basePath,
  params,
  paramKey,
  label,
  placeholder,
  value,
  delay = 300,
}: {
  basePath: string
  params: Record<string, string | string[] | undefined>
  paramKey: string
  label: string
  placeholder: string
  value: string
  delay?: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [draft, setDraft] = useState(value)
  const committed = useRef(value)

  // A filter chip or a sort header navigates without remounting this input, so
  // the URL can change under it; follow that, but not our own writes.
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value
      setDraft(value)
    }
  }, [value])

  useEffect(() => {
    if (draft === committed.current) return
    const timer = setTimeout(() => {
      committed.current = draft
      router.replace(withParam(basePath || pathname, params, paramKey, draft || null), { scroll: false })
    }, delay)
    return () => clearTimeout(timer)
  }, [draft, delay, router, basePath, pathname, params, paramKey])

  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-caption font-medium text-ink-2 sm:max-w-sm">
      {label}
      <Input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        className="min-h-11 font-normal"
      />
    </label>
  )
}
