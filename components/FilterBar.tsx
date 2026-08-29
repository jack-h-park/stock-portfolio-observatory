import Link from 'next/link'
import { clsx } from 'clsx'
import { Label } from '@/components/ui'
import { TableSearch } from '@/components/TableSearch'
import { ALL, withParam } from '@/lib/table-filter'

/**
 * The filter chips above a table.
 *
 * Four tables built this each for themselves, with the same four groups —
 * market, broker, account, type — and slightly different option lists. Here the
 * chips are links, so the filtered view is a URL: it can be shared, bookmarked,
 * and undone with the back button, none of which the `useState` versions could
 * do.
 *
 * On a phone the whole block used to occupy more than 1,500px before the table
 * began, so below `sm` it collapses into a summary the reader can open.
 */
export function FilterBar({
  basePath,
  params,
  groups,
  search,
  summary,
}: {
  basePath: string
  params: Record<string, string | string[] | undefined>
  groups: { key: string; label: string; options: { value: string; label: string }[]; selected: string }[]
  /** Adds a debounced text box. Omit for tables with nothing worth searching. */
  search?: { key: string; label: string; placeholder: string; value: string }
  /** e.g. "139 of 139" — rendered beside the chips, not inside the fold. */
  summary?: string
}) {
  const active = groups.filter((group) => group.selected !== ALL).length
  const chips = (
    <div className="flex flex-col gap-2">
      {groups.map((group) => (
        <div key={group.key} className="flex flex-wrap items-center gap-1.5" role="group" aria-label={group.label}>
          <Label as="span" size="micro" className="mr-1 w-16 shrink-0">
            {group.label}
          </Label>
          {group.options.map((option) => {
            const current = option.value === group.selected
            return (
              <Link
                key={option.value}
                href={withParam(basePath, params, group.key, option.value)}
                scroll={false}
                aria-current={current ? 'true' : undefined}
                className={clsx(
                  'inline-flex min-h-8 items-center rounded-sm border px-2.5 text-label font-medium transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-info/40',
                  current
                    ? 'border-ink bg-ink text-card'
                    : 'border-line bg-card text-ink-2 hover:border-ink-3 hover:bg-surface hover:text-ink'
                )}
              >
                {option.label}
              </Link>
            )
          })}
        </div>
      ))}
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      {search ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <TableSearch
            basePath={basePath}
            params={params}
            paramKey={search.key}
            label={search.label}
            placeholder={search.placeholder}
            value={search.value}
          />
          {summary ? <span className="text-caption text-ink-3">{summary}</span> : null}
        </div>
      ) : summary ? (
        <span className="text-caption text-ink-3">{summary}</span>
      ) : null}

      {/* Always open on a wide screen; foldable on a narrow one. Rendered twice
          rather than toggled with a responsive `open`, which does not exist —
          `open` is an attribute, and Tailwind cannot vary it by breakpoint. */}
      <div className="hidden sm:block">{chips}</div>
      <details className="sm:hidden">
        <summary className="flex min-h-6 cursor-pointer list-none items-center text-caption font-medium text-ink-2">
          Filters{active ? ` (${active})` : ''}
        </summary>
        <div className="mt-2">{chips}</div>
      </details>
    </div>
  )
}
