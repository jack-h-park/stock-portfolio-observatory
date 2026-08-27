'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { CurrencySwitcher, LanguageSwitcher } from '@/components/LanguageSwitcher'
import type { DisplayCurrency } from '@/lib/currency'
import type { Language } from '@/lib/i18n'
import { Label } from '@/components/ui'
import { getPageCopy } from '@/lib/ui-copy'


export function Sidebar({ language, displayCurrency }: { language: Language; displayCurrency: DisplayCurrency }) {
  const copy = getPageCopy('sidebar', language)
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/')

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-card px-4 py-2.5 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={copy.openMenu}
          aria-expanded={open}
          aria-controls="app-sidebar"
          className="-ml-2 inline-flex h-11 w-11 items-center justify-center rounded-sm text-ink-2 transition-colors hover:bg-surface hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-info"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="flex min-w-0 items-baseline gap-1.5">
          <Label as="span" size="micro" variant="eyebrow">Stock</Label>
          <span
            className="bg-clip-text text-body-lg font-semibold leading-tight tracking-tight text-transparent"
            style={{ backgroundImage: 'var(--gradient-text)' }}
          >
            Portfolio Observatory
          </span>
        </div>
      </header>

      {open ? <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setOpen(false)} aria-hidden /> : null}

      <aside
        id="app-sidebar"
        className={clsx(
          'fixed inset-y-0 left-0 z-50 flex h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-line bg-card px-3 py-5 transition-transform duration-200 ease-out',
          'lg:sticky lg:top-0 lg:z-auto lg:w-56 lg:translate-x-0 lg:transition-none',
          open ? 'translate-x-0 shadow-elevated' : '-translate-x-full'
        )}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={copy.closeMenu}
          className="absolute right-1.5 top-1.5 inline-flex h-11 w-11 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-surface hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-info lg:hidden"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="flex items-center gap-2.5 px-1">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line-subtle bg-surface text-caption font-semibold text-ink">
            SO
          </div>
          <div className="min-w-0">
            <div className="truncate text-body font-medium leading-tight text-ink">Stock Portfolio</div>
            <div className="mt-0.5 text-micro font-medium tracking-[0.08em] text-ink-3">{copy.tagline}</div>
          </div>
        </div>

        <div className="mt-3 px-1">
          <Label size="micro" variant="eyebrow">Stock</Label>
          <div
            className="bg-clip-text text-title font-semibold leading-tight tracking-tight text-transparent"
            style={{ backgroundImage: 'var(--gradient-text)' }}
          >
            Portfolio Observatory
          </div>
        </div>

        <div className="mx-1 mt-3 h-px rounded-pill opacity-70" style={{ backgroundImage: 'var(--gradient-mini)' }} />

        <div className="mt-4 grid gap-2 px-1">
          <div>
            <div className="mb-1.5 px-0.5 text-micro font-medium text-ink-3">{copy.language}</div>
            <LanguageSwitcher language={language} />
          </div>
          <div>
            <div className="mb-1.5 px-0.5 text-micro font-medium text-ink-3">{copy.currency}</div>
            <CurrencySwitcher displayCurrency={displayCurrency} />
          </div>
        </div>

        <nav className="mt-5 flex flex-col gap-4" aria-label={copy.navLabel}>
          {copy.sections.map((section) => {
            const sectionActive = section.items.some((item) => isActive(item.href))
            const items = (
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isActive(item.href) ? 'page' : undefined}
                      className={clsx(
                        'relative block min-h-10 rounded-sm py-2 pl-3 pr-2 text-body transition-colors lg:min-h-0 lg:py-1.5',
                        isActive(item.href)
                          ? 'bg-surface font-medium'
                          : 'text-ink-2 hover:bg-surface hover:text-ink'
                      )}
                    >
                      {isActive(item.href) ? (
                        <span
                          aria-hidden
                          className="absolute bottom-1 left-0 top-1 w-[2.5px] rounded-pill"
                          style={{ backgroundImage: 'var(--gradient-mini)' }}
                        />
                      ) : null}
                      <span className={isActive(item.href) ? 't-emph-gradient' : undefined}>{item.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )
            if ('collapsible' in section && section.collapsible) {
              return (
                <details key={`${section.label}:${pathname}`} open={sectionActive} className="group">
                  <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between rounded-sm px-2 text-label font-medium text-ink-2 hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-info">
                    {section.label}
                    <span aria-hidden className="transition-transform group-open:rotate-90">›</span>
                  </summary>
                  {items}
                </details>
              )
            }
            return (
              <div key={section.label}>
                <div className="px-2 text-label font-medium text-ink-3">{section.label}</div>
                {items}
              </div>
            )
          })}
        </nav>

        <div className="mt-auto px-2 pt-6 text-micro leading-relaxed text-ink-3">
          <div className="text-ink-2">{copy.readOnly}</div>
          <div className="mt-1.5">{copy.source}</div>
        </div>
      </aside>
    </>
  )
}
