import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { ROUTE_HREFS, routeName } from '@/lib/page-names'
import { getPageCopy } from '@/lib/ui-copy'

const LANGUAGES = ['en', 'ko'] as const

// routeName falls back to the href rather than throwing, so a route whose label
// went missing would ship a tab reading "/data-map" instead of failing a build.
// This is the check that makes that fallback unreachable.
test('every route has a sidebar label in both languages', () => {
  for (const language of LANGUAGES) {
    for (const href of ROUTE_HREFS) {
      const name = routeName(href, language)
      assert.notEqual(name, href, `${href} has no ${language} sidebar label`)
      assert.ok(name.trim().length > 0, `${href} has an empty ${language} label`)
    }
  }
})

// The other direction: a route added to the sidebar but never given a tab title
// would be invisible here, since routeName only reads what ROUTE_HREFS asks for.
test('every sidebar entry is covered by ROUTE_HREFS', () => {
  for (const language of LANGUAGES) {
    const linked = getPageCopy('sidebar', language).sections.flatMap((section) => section.items.map((item) => item.href))
    for (const href of linked) {
      assert.ok(
        (ROUTE_HREFS as readonly string[]).includes(href),
        `${href} is in the ${language} sidebar but has no entry in ROUTE_HREFS, so its tab is unnamed`
      )
    }
  }
})

// Two routes sharing a name puts the reader back where they started: a row of
// tabs they cannot tell apart.
test('route names are distinct within a language', () => {
  for (const language of LANGUAGES) {
    const seen = new Map<string, string>()
    for (const href of ROUTE_HREFS) {
      const name = routeName(href, language)
      const previous = seen.get(name)
      assert.equal(previous, undefined, `${href} and ${previous} share the ${language} name "${name}"`)
      seen.set(name, href)
    }
  }
})
