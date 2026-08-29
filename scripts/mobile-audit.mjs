/**
 * Report what breaks at phone width: pages that scroll sideways, and standalone
 * controls smaller than a fingertip.
 *
 *   node scripts/mobile-audit.mjs --base http://127.0.0.1:3143
 *
 * Two things it deliberately does not flag. Links inside table rows and sort
 * headers are inline targets, which WCAG 2.2 SC 2.5.8 exempts, and giving them
 * a 24px box would change the row height of every dense table in the app. And
 * content inside an `overflow-x-auto` container is meant to be wider than the
 * screen — that is a table you scroll, not a page that leaks.
 *
 * Point it at a sample-data server, never at real holdings.
 */
const ROUTES = [
  '/', '/daily-briefing', '/holdings', '/review', '/rebalance', '/income',
  '/tax-planning', '/tax-settings', '/lots', '/cost-basis', '/dividends',
  '/transactions', '/fx', '/crypto-premium', '/health', '/data-ops',
  '/reconciliation', '/data-map', '/positions/KR/005930',
]
const MIN_TARGET = 24

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag)
  return i === -1 ? fallback : process.argv[i + 1]
}

const baseUrl = arg('--base', 'http://127.0.0.1:3120')
const { chromium } = await import('playwright')
const browser = await chromium.launch()
// Not `isMobile`: that context reports window.scrollX as 0 even on a page that
// really does scroll sideways, which hides exactly what this looks for.
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' })
const page = await context.newPage()
let problems = 0

for (const route of ROUTES) {
  try {
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle', timeout: 45_000 })
    await page.waitForTimeout(500)
    const found = await page.evaluate((min) => {
      const de = document.documentElement
      const inline = (el) => el.closest('td, th, p, li')
      const small = []
      for (const el of document.querySelectorAll('a, button, select, summary')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0 || inline(el)) continue
        if (r.width < min || r.height < min) {
          small.push(`${el.tagName.toLowerCase()} ${Math.round(r.width)}×${Math.round(r.height)} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 28)}"`)
        }
      }
      return { overflow: de.scrollWidth - de.clientWidth, small: [...new Set(small)] }
    }, MIN_TARGET)

    if (found.overflow > 0 || found.small.length) {
      problems += 1
      console.log(`\n${route}`)
      if (found.overflow > 0) console.log(`  scrolls sideways by ${found.overflow}px`)
      for (const s of found.small.slice(0, 6)) console.log(`  target under ${MIN_TARGET}px · ${s}`)
      if (found.small.length > 6) console.log(`  … and ${found.small.length - 6} more`)
    }
  } catch (error) {
    problems += 1
    console.error(`FAIL ${route}: ${error.message.split('\n')[0]}`)
  }
}

await browser.close()
console.log(`\n${problems} of ${ROUTES.length} routes with findings at 375px`)
process.exit(problems === 0 ? 0 : 1)
