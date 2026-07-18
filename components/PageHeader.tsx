import type { ReactNode } from 'react'
import { AutoRefresh } from '@/components/AutoRefresh'

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  emphasis,
  action,
}: {
  title: string
  subtitle?: ReactNode
  /** Small overline above the title, rendered as mini-gradient brand text. */
  eyebrow?: string
  /** A trailing substring of `title` to highlight with the brand gradient.
   *  e.g. title="Pipeline Overview" emphasis="Overview". */
  emphasis?: string
  action?: ReactNode
}) {
  const head = emphasis && title.endsWith(emphasis) ? title.slice(0, title.length - emphasis.length) : title
  const showEmph = Boolean(emphasis && title.endsWith(emphasis))

  return (
    <header className="ai-page-header mb-5 flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
      <div className="min-w-0">
        {eyebrow && <div className="t-eyebrow mb-1">{eyebrow}</div>}
        <h1 className="text-[20px] font-medium tracking-tight text-ink sm:text-[22px]">
          {head}
          {showEmph && <span className="t-emph-gradient">{emphasis}</span>}
        </h1>
        {subtitle && <p className="mt-0.5 text-[12px] text-ink-3">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {action}
        <AutoRefresh seconds={30} />
      </div>
    </header>
  )
}
