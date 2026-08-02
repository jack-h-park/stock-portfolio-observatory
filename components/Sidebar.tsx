'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import type { Language } from '@/lib/i18n'

const COPY = {
  en: {
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    navLabel: 'Main navigation',
    tagline: 'Portfolio monitoring',
    readOnly: 'Read-only portfolio',
    source: 'Generated from local sources',
    sections: [
      {
        label: 'Core Workflows',
        items: [
          { href: '/', label: 'Portfolio Overview' },
          { href: '/daily-briefing', label: "Today's Briefing" },
          { href: '/holdings', label: 'Holdings' },
          { href: '/review', label: 'Portfolio Review' },
          { href: '/rebalance', label: 'Rebalancing' },
          { href: '/income', label: 'Income' },
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
        label: 'Detailed Records',
        collapsible: true,
        items: [
          { href: '/reconciliation', label: 'Reconciliation' },
          { href: '/cost-basis', label: 'Cost Basis' },
          { href: '/dividends', label: 'Dividends' },
          { href: '/transactions', label: 'Transactions' },
          { href: '/crypto-premium', label: 'Korea Premium' },
        ],
      },
      {
        label: 'System & Advanced',
        collapsible: true,
        items: [
          { href: '/data-ops', label: 'Operations' },
          { href: '/data-map', label: 'Data Sources' },
          { href: '/health', label: 'Data Health' },
        ],
      },
    ],
  },
  ko: {
    openMenu: '메뉴 열기',
    closeMenu: '메뉴 닫기',
    navLabel: '주요 메뉴',
    tagline: '자산 모니터링',
    readOnly: '조회 전용 포트폴리오',
    source: '로컬 원본에서 생성됨',
    sections: [
      {
        label: '핵심 업무',
        items: [
          { href: '/', label: '포트폴리오 개요' },
          { href: '/daily-briefing', label: '오늘의 브리핑' },
          { href: '/holdings', label: '보유종목' },
          { href: '/review', label: '포트폴리오 검토' },
          { href: '/rebalance', label: '리밸런싱' },
          { href: '/income', label: '수익 내역' },
        ],
      },
      {
        label: '세금',
        items: [
          { href: '/tax-planning', label: '세금 계획' },
          { href: '/tax-settings', label: '세금 설정' },
          { href: '/lots', label: '세금 계산 단위' },
        ],
      },
      {
        label: '상세 기록',
        collapsible: true,
        items: [
          { href: '/reconciliation', label: '데이터 일치 확인' },
          { href: '/cost-basis', label: '취득원가' },
          { href: '/dividends', label: '배당 내역' },
          { href: '/transactions', label: '거래 내역' },
          { href: '/crypto-premium', label: '코리아 프리미엄' },
        ],
      },
      {
        label: '시스템 · 고급',
        collapsible: true,
        items: [
          { href: '/data-ops', label: '운영 작업' },
          { href: '/data-map', label: '데이터 원본' },
          { href: '/health', label: '데이터 상태' },
        ],
      },
    ],
  },
} as const

export function Sidebar({ language }: { language: Language }) {
  const copy = COPY[language]
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
          <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-ink-3">Stock</span>
          <span
            className="bg-clip-text text-[15px] font-semibold leading-tight tracking-tight text-transparent"
            style={{ backgroundImage: 'var(--gradient-full)' }}
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
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line-subtle bg-surface text-[12px] font-semibold text-ink">
            SO
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium leading-tight text-ink">Stock Portfolio</div>
            <div className="mt-0.5 text-[10px] font-medium tracking-[0.08em] text-ink-3">{copy.tagline}</div>
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

        <div className="mt-4 px-1">
          <LanguageSwitcher language={language} />
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
                        'relative block min-h-10 rounded-sm py-2 pl-3 pr-2 text-[13px] transition-colors lg:min-h-0 lg:py-1.5',
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
                  <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between rounded-sm px-2 text-[11px] font-medium text-ink-2 hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-info">
                    {section.label}
                    <span aria-hidden className="transition-transform group-open:rotate-90">›</span>
                  </summary>
                  {items}
                </details>
              )
            }
            return (
              <div key={section.label}>
                <div className="px-2 text-[11px] font-medium text-ink-3">{section.label}</div>
                {items}
              </div>
            )
          })}
        </nav>

        <div className="mt-auto px-2 pt-6 text-[10px] leading-relaxed text-ink-3">
          <div className="text-ink-2">{copy.readOnly}</div>
          <div className="mt-1.5">{copy.source}</div>
        </div>
      </aside>
    </>
  )
}
