/**
 * Screenshot every route, in both languages, at two widths.
 *
 * This is the safety net for the GUI refactor: the phases that follow delete
 * and consolidate a lot of markup, and the only cheap way to prove a deletion
 * changed nothing is to compare the pixels before and after. Run it once to
 * record a baseline, run it again after a change, and diff the two directories.
 *
 *   node scripts/snap-ui.mjs --out tests/__screenshots__/baseline
 *   node scripts/snap-ui.mjs --out tests/__screenshots__/after
 *   node scripts/snap-ui.mjs --compare tests/__screenshots__/baseline tests/__screenshots__/after
 *
 * IMPORTANT — restart the dev server before capturing if you have run
 * `next build` in the same worktree since it started. Both write .next/, so a
 * build pulls the ground out from under a running dev server and the capture
 * that follows reports every page as changed. That is not a regression; it is
 * this mistake.
 *
 * IMPORTANT — never point this at a server backed by real holdings. It writes
 * full-page images of every screen, so a run against the private database
 * would put the whole portfolio into image files. Seed a sample database first
 * (`pnpm seed:sample`, which refuses to run while .env.local exists) and serve
 * that. The default base URL is deliberately NOT the usual dev port for the
 * same reason.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const ROUTES = [
  '/',
  '/daily-briefing',
  '/holdings',
  '/review',
  '/rebalance',
  '/income',
  '/tax-planning',
  '/tax-settings',
  '/lots',
  '/cost-basis',
  '/dividends',
  '/transactions',
  '/crypto-premium',
  '/health',
  '/data-ops',
  '/reconciliation',
  '/data-map',
  // The two detail routes. They were missing until the copy work reached them,
  // so a page could be rewritten end to end and the capture would report
  // nothing — which is exactly what happened to position detail.
  '/positions/KR/005930',
  '/tax-planning/plans/none',
]

const LANGUAGES = ['en', 'ko']
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 375, height: 812 },
]

/**
 * The one piece of text that changes between two identical runs.
 *
 * Two kinds of text move on their own. AutoRefresh renders a wall clock
 * ("Last refresh 13:25:24 · 30s interval") that PageHeader puts on every page,
 * and the freshness rows render an age ("31m elapsed", "1m old") that ticks
 * between one capture and the next. Neither can carry a regression signal, and
 * with them in frame a second capture of an unchanged app reported 64 of 68
 * files changed — the baseline was worthless.
 */
const VOLATILE_TEXT =
  /Last refresh|Refreshing|Auto-refresh|Offline|마지막 갱신|갱신 중|오프라인|초마다 자동 갱신|\d+\s*[smhd]\s*(old|elapsed|ago)|\d+\s*[smhd]\s*경과/

const LANGUAGE_COOKIE = 'stock-observatory-language'
const CURRENCY_COOKIE = 'stock-observatory-display-currency'

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag)
  return i === -1 ? fallback : process.argv[i + 1]
}

/**
 * Resolve once the rendered geometry has stopped changing.
 *
 * Fingerprints the things that settle late — SVG path data, element widths set
 * from measured values, and page height — and waits for two consecutive
 * identical readings. Falls through after `timeout` so one stuck page cannot
 * hang the whole run.
 */
async function waitForStableRender(page, { interval = 150, stableReads = 3, timeout = 8000 } = {}) {
  const fingerprint = () =>
    page.evaluate(() => {
      const paths = [...document.querySelectorAll('svg path, svg rect, svg line')]
        .map((el) => el.getAttribute('d') ?? `${el.getAttribute('x')},${el.getAttribute('width')},${el.getAttribute('y')},${el.getAttribute('height')}`)
        .join('|')
      const widths = [...document.querySelectorAll('[style*="width"]')].map((el) => el.style.width).join('|')
      return `${document.body.scrollHeight}::${paths}::${widths}`
    })

  const deadline = Date.now() + timeout
  let previous = await fingerprint()
  let stable = 0
  while (Date.now() < deadline) {
    await sleep(interval)
    const current = await fingerprint()
    if (current === previous) {
      stable += 1
      if (stable >= stableReads) return
    } else {
      stable = 0
      previous = current
    }
  }
}

function slug(route, language, viewport) {
  const name = route === '/' ? 'overview' : route.slice(1).replace(/\//g, '_')
  return `${name}--${language}--${viewport}.png`
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12)
}

/** Compare two capture directories by content hash and report what moved. */
function compare(a, b) {
  const read = (dir) =>
    new Map(
      fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.png'))
        .map((f) => [f, hash(path.join(dir, f))])
    )
  const left = read(a)
  const right = read(b)
  const changed = []
  const added = []
  const removed = []
  for (const [file, h] of left) {
    if (!right.has(file)) removed.push(file)
    else if (right.get(file) !== h) changed.push(file)
  }
  for (const file of right.keys()) if (!left.has(file)) added.push(file)

  for (const f of changed) console.log(`changed  ${f}`)
  for (const f of added) console.log(`added    ${f}`)
  for (const f of removed) console.log(`removed  ${f}`)
  console.log(`\n${left.size} baseline · ${changed.length} changed · ${added.length} added · ${removed.length} removed`)
  return changed.length + added.length + removed.length
}

const compareArgs = process.argv.indexOf('--compare')
if (compareArgs !== -1) {
  const diff = compare(process.argv[compareArgs + 1], process.argv[compareArgs + 2])
  process.exit(diff === 0 ? 0 : 1)
}

const baseUrl = arg('--base', 'http://127.0.0.1:3120')
const outDir = arg('--out', 'tests/__screenshots__/baseline')
const currency = arg('--currency', 'KRW')

const { chromium } = await import('playwright')

fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
let captured = 0
let failed = 0

for (const viewport of VIEWPORTS) {
  for (const language of LANGUAGES) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      // The dashboard animates content in on load (jp-stagger). Without this the
      // capture races the animation and every run differs from the last.
      reducedMotion: 'reduce',
timezoneId: 'Asia/Seoul',
    })
    const { hostname } = new URL(baseUrl)
    await context.addCookies([
      { name: LANGUAGE_COOKIE, value: language, domain: hostname, path: '/' },
      { name: CURRENCY_COOKIE, value: currency, domain: hostname, path: '/' },
    ])
    const page = await context.newPage()

    for (const route of ROUTES) {
      const file = path.join(outDir, slug(route, language, viewport.name))
      try {
        await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle', timeout: 45_000 })
        // Recharts animates its geometry on mount with JS (react-smooth), which
        // Playwright's `animations: 'disabled'` cannot freeze because that only
        // covers CSS. Waiting a fixed delay raced it — two identical runs still
        // differed on the pages that draw charts. Poll a cheap fingerprint of
        // the drawn geometry instead, and shoot once it stops moving.
        await waitForStableRender(page)
        await page.evaluate((pattern) => {
          const re = new RegExp(pattern)
          for (const el of document.querySelectorAll('span')) {
            const text = el.textContent ?? ''
            // AutoRefresh wraps a status dot in a child span, so a leaf-only
            // rule would skip the very element that carries the clock. Bound by
            // length instead, so an ancestor holding half the page is not hidden.
            if (text.length >= 80 || !re.test(text)) continue
            // Emptying it, not just hiding it: the label changes width between
            // renders ("Auto-refresh every 30s" before the effect runs, then
            // "Last refresh 13:33:46 · 30s interval", and the Korean clock grows
            // a digit at 10 seconds), and a hidden element still occupies its
            // box, so the row beside it shifted and the pixels differed anyway.
            el.textContent = ''
            el.style.visibility = 'hidden'
          }
        }, VOLATILE_TEXT.source)
        await page.screenshot({ path: file, fullPage: true, animations: 'disabled' })
        captured += 1
      } catch (error) {
        failed += 1
        console.error(`FAIL ${route} ${language} ${viewport.name}: ${error.message.split('\n')[0]}`)
      }
    }
    await context.close()
  }
}

await browser.close()
console.log(`\n${captured} captured, ${failed} failed → ${outDir}`)
process.exit(failed === 0 ? 0 : 1)
