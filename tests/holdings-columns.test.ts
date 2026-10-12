import { strict as assert } from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

const root = path.resolve(__dirname, '..')

/**
 * A DataTable column reads `row[key]` for both display and sorting, and a key
 * the query never selects renders as "n/a" in every row without any error. The
 * Return column did exactly that until it was renamed to the selected field.
 */
test('every sortable holdings column is a field getHoldings selects', () => {
  const page = fs.readFileSync(path.join(root, 'app/holdings/page.tsx'), 'utf8')
  const adapter = fs.readFileSync(path.join(root, 'lib/adapters/portfolio-db.ts'), 'utf8')

  const select = adapter.match(/export function getHoldings[\s\S]*?select([\s\S]*?)from holdings/)
  assert.ok(select, 'getHoldings select list not found')
  const selected = new Set(select[1].split(',').map((s) => s.trim()).filter(Boolean))

  const columnKeys = [...page.matchAll(/\{ key: '([a-z_]+)',\s*label: copy\./g)].map((m) => m[1])
  assert.ok(columnKeys.length > 5, 'holdings columns not found')
  assert.deepEqual(
    columnKeys.filter((key) => !selected.has(key)),
    []
  )
})
