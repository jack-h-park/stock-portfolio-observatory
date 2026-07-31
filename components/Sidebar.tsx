'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { clsx } from 'clsx'

const SECTIONS: { label: string; items: { href: string; label: string }[] }[] = [
  {
    label: 'Portfolio',
    items: [
      { href: '/', label: 'Overview' },
      { href: '/daily-briefing', label: 'Daily Briefing' },
      { href: '/review', label: 'Review' },
      { href: '/reconciliation', label: 'Reconciliation' },
      { href: '/rebalance', label: 'Rebalance' },
      { href: '/income', label: 'Income' },
      { href: '/crypto-premium', label: 'Korea Premium' },
    ],
  },
  {
    label: 'Tax',
    items: [
      { href: '/tax-planning', label: 'Tax Planning' },
      { href: '/tax-settings', label: 'Tax Settings' },
      { href: '/lots', label: 'Tax Lots' },
    ],
  },
  {
    label: 'Records',
    items: [
      { href: '/holdings', label: 'Holdings' },
      { href: '/cost-basis', label: 'Cost Basis' },
      { href: '/dividends', label: 'Dividends' },
      { href: '/transactions', label: 'Transactions' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/data-ops', label: 'Data Ops' },
      { href: '/data-map', label: 'Data Map' },
      { href: '/health', label: 'Health' },
    ],
  },
]

export function Sidebar() {
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
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-card px-4 py-2.5 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
          aria-controls="app-sidebar"
          className="-ml-1 rounded-sm p-1.5 text-ink-2 transition-colors hover:bg-surface hover:text-ink"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-ink-3">Stock</span>
          <span
            className="bg-clip-text text-[15px] font-semibold leading-tight tracking-tight text-transparent"
            style={{ backgroundImage: 'var(--gradient-full)' }}
          >
            Portfolio Observatory
          </span>
        </div>
      </header>

      {open && <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}

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
          aria-label="Close navigation"
          className="absolute right-3 top-3 rounded-sm p-1 text-ink-3 transition-colors hover:bg-surface hover:text-ink lg:hidden"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="flex items-center gap-2.5 px-1">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line-subtle bg-surface text-[12px] font-semibold text-ink">
            SO
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium leading-tight text-ink">Stock Portfolio</div>
            <div className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-ink-3">Portfolio</div>
          </div>
        </div>

        <div className="mt-3 px-1">
          <div className="text-[9px] font-medium uppercase tracking-[0.1em] text-ink-3">Stock</div>
          <div
            className="bg-clip-text text-[19px] font-semibold leading-tight tracking-tight text-transparent"
            style={{ backgroundImage: 'var(--gradient-full)' }}
          >
            Portfolio Observatory
          </div>
        </div>

        <div className="mx-1 mt-3 h-px rounded-pill opacity-70" style={{ backgroundImage: 'var(--gradient-mini)' }} />

        <nav className="mt-5 flex flex-col gap-5">
          {SECTIONS.map((section) => (
            <div key={section.label}>
              <div className="px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">
                {section.label}
              </div>
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isActive(item.href) ? 'page' : undefined}
                      className={clsx(
                        'relative block rounded-sm py-2 pl-3 pr-2 text-[13px] transition-colors lg:py-1.5',
                        isActive(item.href)
                          ? 'bg-surface font-medium'
                          : 'text-ink-2 hover:bg-surface hover:text-ink'
                      )}
                    >
                      {isActive(item.href) && (
                        <span
                          aria-hidden
                          className="absolute bottom-1 left-0 top-1 w-[2.5px] rounded-pill"
                          style={{ backgroundImage: 'var(--gradient-mini)' }}
                        />
                      )}
                      <span className={isActive(item.href) ? 't-emph-gradient' : undefined}>{item.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="mt-auto px-2 pt-6 text-[10px] leading-relaxed text-ink-3">
          <div className="text-ink-2">Read-only portfolio view</div>
          <div className="mt-1.5">Generated from local TSV snapshots</div>
          <div className="tabular-nums">Port 3101</div>
        </div>
      </aside>
    </>
  )
}
