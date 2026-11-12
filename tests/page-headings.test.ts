import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { PageHeader } from '@/components/PageHeader'
import { positionHeading, proposalHeading, savedPlanHeading, taxRecordHeading, type Heading } from '@/lib/page-headings'
import { ROUTE_HREFS, routeName, type RouteHref } from '@/lib/page-names'
import { getPageCopy } from '@/lib/ui-copy'
import { PAGE_COPY } from '@/lib/ui-copy/pages'

// tsx compiles the component's JSX with the classic runtime, which reads a
// global React; Next supplies it in the app, so the test does here.
;(globalThis as { React?: typeof React }).React = React

const LANGUAGES = ['en', 'ko'] as const
type Lang = (typeof LANGUAGES)[number]
type PageKey = keyof typeof PAGE_COPY

/**
 * The copy module behind each sidebar route. A `Record`, not a `Partial`, so a
 * route added to ROUTE_HREFS without an entry here is a compile error. The
 * object form names the key when the heading is not the module's `title`
 * (/taxes and /taxes/history share one module and one screen).
 */
const COPY_FOR: Record<RouteHref, PageKey | { page: PageKey; title: string }> = {
  '/': 'overview',
  '/net-worth': 'netWorth',
  '/daily-briefing': 'dailyBriefing',
  '/holdings': 'holdings',
  '/review': 'review',
  '/rebalance': 'rebalance',
  '/income': 'income',
  '/cash-inflow': 'cashInflow',
  '/tax-planning': 'taxPlanning',
  '/taxes': 'taxHistory',
  '/taxes/history': { page: 'taxHistory', title: 'historyTitle' },
  '/tax-settings': 'taxSettings',
  '/lots': 'lots',
  '/realized': 'realized',
  '/pension': 'pension',
  '/cost-basis': 'costBasis',
  '/dividends': 'dividends',
  '/transactions': 'transactions',
  '/fx': 'fx',
  '/crypto-premium': 'cryptoPremium',
  '/accounts': 'accounts',
  '/health': 'health',
  '/data-ops': 'dataOps',
  '/reconciliation': 'reconciliation',
  '/data-map': 'dataMap',
}

type Loose = Record<string, unknown> & { page?: Record<string, unknown> }

/** A string field read from the module's top level, or failing that from its `page` block. */
function field(copy: Loose, key: string): string | null {
  if (typeof copy[key] === 'string') return copy[key] as string
  if (copy.page && typeof copy.page[key] === 'string') return copy.page[key] as string
  return null
}

function heading(href: RouteHref, language: Lang) {
  const entry = COPY_FOR[href]
  const page = typeof entry === 'string' ? entry : entry.page
  const titleKey = typeof entry === 'string' ? 'title' : entry.title
  const copy = getPageCopy(page, language) as unknown as Loose
  return { page, title: field(copy, titleKey), emphasis: field(copy, 'emphasis') }
}

// The first version of these tests skipped any route whose module had no string
// `title` at the top level, which silently skipped /tax-planning and
// /tax-settings (their title sits under `page`), /holdings (its title was built
// inline in the page), and /taxes and /taxes/history (added after the map was
// written). A route the test cannot read is now a failure that names it.
test('every sidebar route has a heading the test can read', () => {
  for (const language of LANGUAGES) {
    for (const href of ROUTE_HREFS) {
      const { page, title } = heading(href, language)
      assert.ok(title != null, `${href} (${language}): copy module "${page}" has no string title, so its heading is unchecked`)
    }
  }
})

// PageHeader highlights `emphasis` only when it is a trailing substring of
// `title` — otherwise it silently renders the heading with no gradient at all.
// Six headings across four pages were in that state, in one or both languages,
// and nothing reported it: not types, not lint, not the build. Only reading the
// two strings side by side finds it.
test('every emphasis is a trailing substring of its title', () => {
  for (const language of LANGUAGES) {
    for (const href of ROUTE_HREFS) {
      const { page, title, emphasis } = heading(href, language)
      assert.ok(title != null, `${href} (${language}): copy module "${page}" has no string title`)
      // A heading without an emphasis is legitimate; only a present one has to match.
      if (emphasis == null) continue
      assert.ok(
        title.endsWith(emphasis),
        `${href} (${language}): emphasis "${emphasis}" is not the end of title "${title}", so the gradient never renders`
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
      const { page, title } = heading(href, language)
      assert.ok(title != null, `${href} (${language}): copy module "${page}" has no string title`)
      assert.equal(
        title,
        routeName(href, language),
        `${href} (${language}): the sidebar says "${routeName(href, language)}" but the heading says "${title}"`
      )
    }
  }
})

/** The routes outside the sidebar, each giving the heading its page renders. Inputs are invented. */
const NESTED: Record<string, (language: Lang) => Heading> = {
  '/rebalance/settings': (language) => {
    const copy = getPageCopy('rebalanceSettings', language)
    return { title: copy.title, emphasis: copy.emphasis }
  },
  '/rebalance/proposals/[id]': (language) => proposalHeading(getPageCopy('rebalanceProposal', language), 'rp-0001-test'),
  '/positions/[market]/[ticker]': () => positionHeading('Example Holdings Corp'),
  '/tax-planning/plans/[id]': () => savedPlanHeading('Sample sale plan'),
  '/taxes/records/[id]': (language) => taxRecordHeading(getPageCopy('taxHistory', language)),
}

// The headings built from data never reached the tests above, and two of them
// were dead: the proposal page appended the id after the emphasis, and the
// position page used the ticker as the emphasis of the instrument's name.
// Neither ever rendered a gradient, in either language.
test('every heading outside the sidebar has a live emphasis or none', () => {
  for (const language of LANGUAGES) {
    for (const [route, build] of Object.entries(NESTED)) {
      const { title, emphasis } = build(language)
      assert.ok(title.trim().length > 0, `${route} (${language}): empty title`)
      if (emphasis === undefined) continue
      assert.ok(
        title.endsWith(emphasis),
        `${route} (${language}): emphasis "${emphasis}" is not the end of title "${title}", so the gradient never renders`
      )
    }
  }
})

// Which nested headings carry no emphasis is a decision, not an accident: the
// position page waits on the header redesign, and the saved plan and tax record
// pages never had one. Pinning it makes adding one a deliberate change here.
test('the position, saved plan and tax record headings have no emphasis', () => {
  for (const language of LANGUAGES) {
    for (const route of ['/positions/[market]/[ticker]', '/tax-planning/plans/[id]', '/taxes/records/[id]']) {
      assert.equal(NESTED[route](language).emphasis, undefined, `${route} (${language}) gained an emphasis`)
    }
  }
})

// The proposal heading keeps its title and moves the id into the emphasis, so
// the gradient covers "proposal <id>" rather than nothing. A regression to the
// old `emphasis = copy.emphasis` would still pass the trailing check only if the
// id were dropped from the title, so pin both strings.
test('the proposal heading puts the id inside the emphasis', () => {
  for (const language of LANGUAGES) {
    const copy = getPageCopy('rebalanceProposal', language)
    const { title, emphasis } = proposalHeading(copy, 'rp-0001-test')
    assert.equal(title, `${copy.title} rp-0001-test`)
    assert.equal(emphasis, `${copy.emphasis} rp-0001-test`)
  }
})

function renderHeader(title: string, emphasis?: string) {
  return renderToStaticMarkup(React.createElement(PageHeader, { title, emphasis, autoRefresh: false }))
}

// The tests above only see headings they know about. A title built from data
// elsewhere could still carry a dead emphasis, so outside production PageHeader
// refuses to render one instead of quietly dropping the gradient.
test('PageHeader throws on an emphasis that is not the end of the title', () => {
  assert.throws(
    () => renderHeader('Example Holdings Corp', 'EXMP'),
    /emphasis "EXMP" is not a trailing substring of title "Example Holdings Corp"/
  )
  assert.match(renderHeader('Rebalance proposal', 'proposal'), /t-emph-gradient">proposal</)
  assert.doesNotMatch(renderHeader('Tax Record'), /t-emph-gradient/)
})
