import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { ROUTE_HREFS, routeName, type RouteHref } from '@/lib/page-names'
import { getPageCopy } from '@/lib/ui-copy'
import { PAGE_COPY } from '@/lib/ui-copy/pages'

const LANGUAGES = ['en', 'ko'] as const

/** The copy module behind each route, for the routes that have one. */
const COPY_FOR: Partial<Record<RouteHref, keyof typeof PAGE_COPY>> = {
  '/': 'overview',
  '/daily-briefing': 'dailyBriefing',
  '/holdings': 'holdings',
  '/review': 'review',
  '/rebalance': 'rebalance',
  '/income': 'income',
  '/tax-planning': 'taxPlanning',
  '/tax-settings': 'taxSettings',
  '/lots': 'lots',
  '/cost-basis': 'costBasis',
  '/dividends': 'dividends',
  '/transactions': 'transactions',
  '/fx': 'fx',
  '/crypto-premium': 'cryptoPremium',
  '/health': 'health',
  '/data-ops': 'dataOps',
  '/reconciliation': 'reconciliation',
  '/data-map': 'dataMap',
}

function heading(page: keyof typeof PAGE_COPY, language: (typeof LANGUAGES)[number]) {
  const copy = getPageCopy(page, language) as { title?: unknown; emphasis?: unknown }
  return {
    title: typeof copy.title === 'string' ? copy.title : null,
    emphasis: typeof copy.emphasis === 'string' ? copy.emphasis : null,
  }
}

// PageHeader highlights `emphasis` only when it is a trailing substring of
// `title` — otherwise it silently renders the heading with no gradient at all.
// Six headings across four pages were in that state, in one or both languages,
// and nothing reported it: not types, not lint, not the build. Only reading the
// two strings side by side finds it.
test('every emphasis is a trailing substring of its title', () => {
  for (const language of LANGUAGES) {
    for (const page of Object.values(COPY_FOR)) {
      const { title, emphasis } = heading(page, language)
      if (title == null || emphasis == null) continue
      assert.ok(
        title.endsWith(emphasis),
        `${page} (${language}): emphasis "${emphasis}" is not the end of title "${title}", so the gradient never renders`
      )
    }
  }
})

// The name in the sidebar is the name you clicked to get here. When the heading
// says something else, the page you land on appears to be a different one —
// which is what /data-ops ("Action Center" in the sidebar, "Operations" in the
// heading) and five other routes did.
test('the heading matches the sidebar label', () => {
  for (const language of LANGUAGES) {
    for (const href of ROUTE_HREFS) {
      const page = COPY_FOR[href]
      if (!page) continue
      const { title } = heading(page, language)
      if (title == null) continue
      assert.equal(
        title,
        routeName(href, language),
        `${href} (${language}): the sidebar says "${routeName(href, language)}" but the heading says "${title}"`
      )
    }
  }
})
