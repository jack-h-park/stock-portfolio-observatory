'use client'

import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import { useEffect, useId, useRef, useState } from 'react'

export function HelpPopover({
  children,
  label = '설명 보기',
  align = 'center',
  className,
}: {
  children: ReactNode
  label?: string
  align?: 'center' | 'left' | 'right'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const tooltipId = useId()
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  return (
    <span ref={rootRef} className={clsx('group relative inline-flex items-center align-middle', className)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onClick={() => setOpen((current) => !current)}
        className="relative ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line text-[11px] font-semibold leading-none text-ink-2 transition-colors after:absolute after:-inset-[10px] after:content-[''] hover:border-info hover:text-info focus:outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2"
      >
        i
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        aria-hidden={!open}
        className={clsx(
          'absolute top-full z-50 mt-1.5 w-72 rounded-md border border-line bg-card p-3 text-left text-[12px] font-normal normal-case leading-relaxed tracking-normal text-ink-2 shadow-elevated transition-opacity duration-100',
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0 group-hover:opacity-100',
          align === 'center' && 'left-1/2 -translate-x-1/2',
          align === 'left' && 'left-0',
          align === 'right' && 'right-0'
        )}
      >
        {children}
        <span className="mt-2 block text-[11px] text-ink-3">Esc 키를 누르면 닫힙니다.</span>
      </span>
    </span>
  )
}
