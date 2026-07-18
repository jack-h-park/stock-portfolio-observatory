import type { ReactNode } from 'react'

export function DataTable({
  columns,
  rows,
}: {
  columns: { key: string; label: string; align?: 'left' | 'right'; render?: (row: any) => ReactNode }[]
  rows: any[]
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-separate border-spacing-0 text-[12px]">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className="sticky top-0 border-b border-line bg-card px-3 py-2 text-left font-medium text-ink-3"
              >
                <span className={col.align === 'right' ? 'block text-right' : undefined}>{col.label}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? i} className="border-b border-line-subtle">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`border-b border-line-subtle px-3 py-2 align-top text-ink-2 ${
                    col.align === 'right' ? 'text-right tabular-nums' : ''
                  }`}
                >
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
