// 빗썸 statements may share days. A shared day is read once, from the document whose
// period ends later, so a fill that an earlier same-day download missed is not lost
// and nothing is counted twice. Rows are never compared by content: a split fill
// repeats a timestamp, quantity and price.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')
const PY = process.env.STOCK_PYTHON_BIN || 'python3'

type Doc = { name: string; start: string; end: string }
type Row = { source: string; date: string; id: string }

function run(documents: Doc[], rows: Row[]) {
  const code = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'scripts'))})
import crypto_overlap
payload = json.load(sys.stdin)
kept, dropped = crypto_overlap.drop_overlapped_rows(payload["documents"], payload["rows"])
print(json.dumps({"kept": [r["id"] for r in kept], "dropped": dropped}))
`
  const result = spawnSync(PY, ['-c', code], { input: JSON.stringify({ documents, rows }), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout) as { kept: string[]; dropped: Record<string, number> }
}

const H1: Doc = { name: 'h1.pdf', start: '2026-01-01', end: '2026-07-31' }
const NEXT: Doc = { name: 'next.pdf', start: '2026-07-31', end: '2026-10-11' }

test('contiguous statements drop nothing', () => {
  const out = run(
    [H1, { name: 'aug.pdf', start: '2026-08-01', end: '2026-10-11' }],
    [
      { source: 'h1.pdf', date: '2026-07-31', id: 'a' },
      { source: 'aug.pdf', date: '2026-08-01', id: 'b' },
    ]
  )
  assert.deepEqual(out.kept, ['a', 'b'])
  assert.deepEqual(out.dropped, {})
})

test('a shared day is read once, from the later-ending statement', () => {
  const out = run(
    [H1, NEXT],
    [
      { source: 'h1.pdf', date: '2026-07-30', id: 'keep-old' },
      { source: 'h1.pdf', date: '2026-07-31', id: 'old-copy' },
      { source: 'next.pdf', date: '2026-07-31', id: 'new-copy' },
      { source: 'next.pdf', date: '2026-07-31', id: 'new-only-fill' },
      { source: 'next.pdf', date: '2026-10-11', id: 'sale' },
    ]
  )
  assert.deepEqual(out.kept, ['keep-old', 'new-copy', 'new-only-fill', 'sale'])
  assert.deepEqual(out.dropped, { 'h1.pdf': 1 })
})

test('rows repeating every field inside one document are all kept', () => {
  const out = run(
    [NEXT],
    [
      { source: 'next.pdf', date: '2026-08-02', id: 'part-1' },
      { source: 'next.pdf', date: '2026-08-02', id: 'part-2' },
    ]
  )
  assert.deepEqual(out.kept, ['part-1', 'part-2'])
})

test('the same period twice keeps exactly one copy', () => {
  const out = run(
    [
      { name: 'a.pdf', start: '2026-08-01', end: '2026-08-31' },
      { name: 'b.pdf', start: '2026-08-01', end: '2026-08-31' },
    ],
    [
      { source: 'a.pdf', date: '2026-08-05', id: 'from-a' },
      { source: 'b.pdf', date: '2026-08-05', id: 'from-b' },
    ]
  )
  assert.deepEqual(out.kept, ['from-b'])
})

test('a shorter statement inside a longer one is not read for its shared days', () => {
  const out = run(
    [
      { name: 'year.pdf', start: '2025-01-01', end: '2025-12-31' },
      { name: 'q4.pdf', start: '2025-10-01', end: '2025-12-31' },
    ],
    [
      { source: 'year.pdf', date: '2025-11-02', id: 'year' },
      { source: 'q4.pdf', date: '2025-11-02', id: 'q4' },
    ]
  )
  assert.deepEqual(out.kept, ['year'])
})

test('a row from a document with no declared period is kept', () => {
  const out = run([H1], [{ source: 'unknown.pdf', date: '2026-07-31', id: 'x' }])
  assert.deepEqual(out.kept, ['x'])
})
