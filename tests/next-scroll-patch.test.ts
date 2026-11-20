import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

/**
 * patches/next@*.patch makes Next's aliased-prefetch navigation keep
 * `scroll={false}`. Without it, a filter chip (a <Link> to the same page with
 * different search params) intermittently jumps the page to the top in
 * production builds: whenever the prefetch cache holds the same pathname under
 * other search params, Next takes the aliased path, which never copied
 * shouldScroll, so it defaulted to true. Dev builds never alias, so only this
 * check notices when a Next upgrade drops the patch.
 */
const require = createRequire(import.meta.url)
const nextRoot = dirname(require.resolve('next/package.json'))

for (const flavour of ['dist/client', 'dist/esm/client']) {
  test(`next ${flavour} navigate reducer keeps shouldScroll on the aliased-prefetch path`, () => {
    const source = readFileSync(join(nextRoot, flavour, 'components/router-reducer/reducers/navigate-reducer.js'), 'utf8')
    const call = source.search(/handleAliasedPrefetchEntry\)?\(navigatedAt/)
    assert.ok(call > 0, 'handleAliasedPrefetchEntry call not found; re-check the patch against this Next version')
    const before = source.slice(Math.max(0, call - 600), call)
    assert.ok(before.includes('mutable.shouldScroll = shouldScroll'), 'the scroll patch is not applied to this Next build')
  })
}
