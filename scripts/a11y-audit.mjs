/**
 * Run axe-core over every route, in both languages, and report what fails.
 *
 *   node scripts/a11y-audit.mjs --base http://127.0.0.1:3143
 *
 * Exits non-zero if anything is found, so it can gate a branch.
 *
 * This exists because the accessibility work in P4 started from a hand-written
 * survey that was wrong in both directions: it flagged seven selects that turned
 * out to be wrapped in <label> elements, and it missed the two real failures
 * that axe found in a minute. Guessing at a11y from grep does not work.
 *
 * Point it at a sample-data server, never at real holdings — it visits every
 * page, same as scripts/snap-ui.mjs.
 */
import fs from 'node:fs'

const ROUTES = [
  '/', '/daily-briefing', '/holdings', '/review', '/rebalance', '/income',
  '/tax-planning', '/tax-settings', '/lots', '/cost-basis', '/dividends',
  '/transactions', '/fx', '/crypto-premium', '/health', '/data-ops',
  '/reconciliation', '/data-map', '/positions/KR/005930',
]
const LANGUAGES = ['en', 'ko']
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const LANGUAGE_COOKIE = 'stock-observatory-language'

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag)
  return i === -1 ? fallback : process.argv[i + 1]
}

const baseUrl = arg('--base', 'http://127.0.0.1:3120')
const axeSource = fs.readFileSync('node_modules/axe-core/axe.min.js', 'utf8')
const { chromium } = await import('playwright')
const browser = await chromium.launch()
const found = new Map()

for (const language of LANGUAGES) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  await context.addCookies([{ name: LANGUAGE_COOKIE, value: language, domain: new URL(baseUrl).hostname, path: '/' }])
  const page = await context.newPage()
  for (const route of ROUTES) {
    try {
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle', timeout: 45_000 })
      await page.waitForTimeout(600)
      await page.addScriptTag({ content: axeSource })
      const result = await page.evaluate(
        async (tags) => await window.axe.run(document, { runOnly: { type: 'tag', values: tags } }),
        TAGS
      )
      for (const violation of result.violations) {
        if (!found.has(violation.id)) {
          found.set(violation.id, { impact: violation.impact, help: violation.help, where: new Set(), nodes: new Set() })
        }
        const entry = found.get(violation.id)
        entry.where.add(`${route} (${language})`)
        for (const node of violation.nodes.slice(0, 3)) entry.nodes.add(node.html.slice(0, 120))
      }
    } catch (error) {
      console.error(`FAIL ${route} ${language}: ${error.message.split('\n')[0]}`)
    }
  }
  await context.close()
}
await browser.close()

const violations = [...found.entries()].sort((a, b) => b[1].where.size - a[1].where.size)
for (const [id, v] of violations) {
  console.log(`\n${id}  [${v.impact}]  ${v.where.size} route-languages`)
  console.log(`  ${v.help}`)
  console.log(`  ${[...v.where].slice(0, 5).join(', ')}${v.where.size > 5 ? ' …' : ''}`)
  for (const node of [...v.nodes].slice(0, 2)) console.log(`  · ${node}`)
}
console.log(`\n${violations.length} distinct violation(s) across ${ROUTES.length * LANGUAGES.length} route-languages`)
process.exit(violations.length === 0 ? 0 : 1)
