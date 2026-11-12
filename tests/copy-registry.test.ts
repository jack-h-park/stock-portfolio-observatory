import { strict as assert } from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { PAGE_COPY } from '@/lib/ui-copy/pages'

/**
 * Every top-level key of a page's copy should be read somewhere. A key nothing
 * reads is a sentence someone keeps translating for no page, and it hides the
 * keys that matter when you go looking for the one on screen.
 *
 * A key passes when its name appears as a whole word in any source file under
 * app/, components/ or lib/ (lib/ui-copy/ itself does not count: that is where
 * the key is defined). This is a net, not a proof: a common word such as
 * `title` or `note` will always find a match somewhere, used or not. What it
 * does catch is a distinctive key nobody mentions, which is how unused keys
 * usually look.
 */
const CONSUMER_ROOTS = ['app', 'components', 'lib']
const COPY_ROOT = path.join('lib', 'ui-copy')

/**
 * Keys reached only through computed access (`copy[kind]`), which a
 * whole-word search cannot see. Each entry names the module, the key, why it
 * is computed, and where. None today.
 */
const DYNAMIC_KEYS: Record<string, string[]> = {}

/**
 * A flagged key is not always dead. It can be unwired: the page still types
 * the same English inline, and the key holds the only Korean translation.
 * Before deleting one, search the pages for its English text. If the text
 * is there, point the page at the key. If wiring has to wait, list the key
 * here with the reason, and remove it once wired (the last test fails when a
 * listed key starts being read).
 */
// The list is empty today: every key a page should read is wired.
const PENDING_WIRING: Record<string, string[]> = {}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (full === COPY_ROOT || entry.name === 'node_modules') continue
      out.push(...sourceFiles(full))
    } else if (/\.(?:ts|tsx|mjs|js)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** One string per consumer directory, read once. */
const corpus = CONSUMER_ROOTS.map((root) =>
  sourceFiles(root)
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n'),
)

function isRead(key: string) {
  const word = new RegExp(`(?<![\\w$])${key.replace(/[$]/g, '\\$')}(?![\\w$])`)
  return corpus.some((text) => word.test(text))
}

test('every top-level copy key is read outside the copy modules', () => {
  const unused: string[] = []
  for (const [page, copy] of Object.entries(PAGE_COPY)) {
    const allowed = new Set([...(DYNAMIC_KEYS[page] ?? []), ...(PENDING_WIRING[page] ?? [])])
    for (const key of Object.keys(copy.en)) {
      if (!allowed.has(key) && !isRead(key)) unused.push(`${page}.${key}`)
    }
  }
  assert.deepEqual(unused, [], `copy keys nothing reads:\n  ${unused.join('\n  ')}`)
})

test('every allow-list entry names a key that exists', () => {
  for (const [page, keys] of Object.entries({ ...DYNAMIC_KEYS, ...PENDING_WIRING })) {
    const copy = PAGE_COPY[page as keyof typeof PAGE_COPY]
    assert.ok(copy, `no copy module named ${page}`)
    for (const key of keys) assert.ok(key in copy.en, `${page}.${key} is not a key`)
  }
})

test('a PENDING_WIRING key leaves the list once a page reads it', () => {
  const wired = Object.entries(PENDING_WIRING).flatMap(([page, keys]) =>
    keys.filter((key) => isRead(key)).map((key) => `${page}.${key}`),
  )
  assert.deepEqual(wired, [], 'these keys are read now; remove them from PENDING_WIRING')
})
