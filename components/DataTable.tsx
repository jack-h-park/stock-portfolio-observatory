import { clsx } from 'clsx'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { EmptyState, InfoTooltip, Table } from '@/components/ui'
import { CommonLabel } from '@/components/LanguageProvider'
import { nextSort, type SortDirection, type TableSort } from '@/lib/table-sort'

export type DataTableColumn<Row = any> = {
  key: string
  label: ReactNode
  /** `center` is for a column of checkboxes or icons, where a left edge reads
   *  as ragged under a centred header. */
  align?: 'left' | 'right' | 'center'
  render?: (row: Row) => ReactNode
  /** Short, plain-language explanation for a domain term or calculation. */
  description?: ReactNode
  /** Hide lower-priority columns on smaller screens while preserving them in horizontal layouts. */
  priority?: 'primary' | 'secondary' | 'tertiary'
  nowrap?: boolean
  /** Make the header a sort control. Requires the table to be given `sortHref`. */
  sortable?: boolean
  /** The value this column sorts on, when the cell renders something else —
   *  a badge showing "KR", a formatted amount, a linked ticker. Defaults to
   *  `row[key]`. */
  sortValue?: (row: Row) => string | number | null | undefined
  /** Direction a first click on this column should produce. Numbers read best
   *  largest-first, text A-Z. */
  sortFirst?: SortDirection
}

const PRIORITY_CLASS = {
  primary: '',
  secondary: 'hidden md:table-cell',
  tertiary: 'hidden xl:table-cell',
} as const

export function DataTable({
  columns,
  rows,
  caption,
  emptyMessage,
  getRowKey,
  sort,
  sortHref,
}: {
  columns: DataTableColumn[]
  rows: any[]
  caption?: string
  emptyMessage?: ReactNode
  getRowKey?: (row: any, index: number) => string | number
  /** The sort currently applied, so the header can show and reverse it. */
  sort?: TableSort | null
  /** Builds the link a header cell points at. Without it, `sortable` columns
   *  render as plain headers — a sort control that cannot change the URL would
   *  be a lie. */
  sortHref?: (sort: TableSort) => string
}) {
  if (rows.length === 0) return <EmptyState>{emptyMessage ?? <CommonLabel label="noRows" />}</EmptyState>

  return (
    <Table scroll minWidth="48rem" className="border-separate border-spacing-0">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                aria-sort={
                  col.sortable && sortHref
                    ? sort?.key === col.key
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                    : undefined
                }
                className={clsx(
                  'sticky top-0 z-10 border-b border-line bg-card px-3 py-2 text-left font-medium text-ink-3',
                  PRIORITY_CLASS[col.priority ?? 'primary'],
                  col.nowrap && 'whitespace-nowrap'
                )}
              >
                <span
                  className={clsx(
                    'inline-flex items-center',
                    col.align === 'right' && 'w-full justify-end text-right',
                    col.align === 'center' && 'w-full justify-center text-center'
                  )}
                >
                  {col.sortable && sortHref ? (
                    <Link
                      href={sortHref(nextSort(sort ?? null, col.key, col.sortFirst))}
                      scroll={false}
                      className="inline-flex items-center gap-1 rounded-sm hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-info/40"
                    >
                      {col.label}
                      <span aria-hidden className={clsx('text-micro', sort?.key === col.key ? 'text-info' : 'text-ink-3/50')}>
                        {sort?.key === col.key ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </Link>
                  ) : (
                    col.label
                  )}
                  {col.description ? <InfoTooltip>{col.description}</InfoTooltip> : null}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={getRowKey?.(row, i) ?? row.id ?? i} className="border-b border-line-subtle hover:bg-surface/70">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={clsx(
                    'border-b border-line-subtle px-3 py-2.5 align-top text-ink-2',
                    col.align === 'right' && 'text-right tabular-nums',
                    col.align === 'center' && 'text-center',
                    PRIORITY_CLASS[col.priority ?? 'primary'],
                    col.nowrap && 'whitespace-nowrap'
                  )}
                >
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
    </Table>
  )
}
