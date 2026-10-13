'use client'

import { useEffect } from 'react'

/**
 * Scrolls its parent into view when the URL's hash names `id`.
 *
 * A client navigation to `?…#id` does not scroll when the target only appears
 * once the server has rendered the new page, which is how a chart click opens a
 * drill-down far below the chart. Mounting with the new content, this does it.
 */
export function ScrollOnHash({ id }: { id: string }) {
  useEffect(() => {
    if (window.location.hash !== `#${id}`) return
    const el = document.getElementById(id)
    if (!el) return
    // Vertical only: scrollIntoView would also slide a sideways-scrolling table.
    const top = el.getBoundingClientRect().top + window.scrollY - 96
    window.scrollTo({ top, behavior: 'smooth' })
  }, [id])
  return null
}
