import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import { EmptyState, InfoTooltip, Table } from '@/components/ui'
import { CommonLabel } from '@/components/LanguageProvider'

export type DataTableColumn<Row = any> = {
  key: string
  label: ReactNode
  align?: 'left' | 'right'
  render?: (row: Row) => ReactNode
  /** Short, plain-language explanation for a domain term or calculation. */
  description?: ReactNode
  /** Hide lower-priority columns on smaller screens while preserving them in horizontal layouts. */
  priority?: 'primary' | 'secondary' | 'tertiary'
  nowrap?: boolean
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
}: {
  columns: DataTableColumn[]
  rows: any[]
  caption?: string
  emptyMessage?: ReactNode
  getRowKey?: (row: any, index: number) => string | number
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
                className={clsx(
                  'sticky top-0 z-10 border-b border-line bg-card px-3 py-2 text-left font-medium text-ink-3',
                  PRIORITY_CLASS[col.priority ?? 'primary'],
                  col.nowrap && 'whitespace-nowrap'
                )}
              >
                <span className={clsx('inline-flex items-center', col.align === 'right' && 'w-full justify-end text-right')}>
                  {col.label}
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
