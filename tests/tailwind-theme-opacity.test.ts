import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import postcss from 'postcss'
import tailwindcss from 'tailwindcss'

import config from '../tailwind.config'

// Every theme colour is a CSS variable holding a hex value. Tailwind 3 used to
// drop `bg-danger/10` and friends without a word, because it cannot put an
// alpha on `var(...)`; the config now routes them through color-mix. This
// compiles the real config so a change back to a bare `var()` fails here
// instead of in the browser.
async function compile(classes: string): Promise<string> {
  const result = await postcss([
    tailwindcss({ ...config, content: [{ raw: `<div class="${classes}"></div>`, extension: 'html' }] }),
  ]).process('@tailwind utilities;', { from: undefined })
  return result.css
}

test('theme colours accept an opacity modifier', async () => {
  const css = await compile('bg-danger/10 border-info/30 text-ink-3/50 bg-surface/60 focus-visible:ring-info/40')
  for (const [selector, variable, alpha] of [
    ['.bg-danger\\/10', '--accent-danger', '0.1'],
    ['.border-info\\/30', '--accent-info', '0.3'],
    ['.text-ink-3\\/50', '--text-tertiary', '0.5'],
    ['.bg-surface\\/60', '--bg-surface', '0.6'],
    ['.focus-visible\\:ring-info\\/40', '--accent-info', '0.4'],
  ]) {
    const rule = css.slice(css.indexOf(selector))
    assert.ok(css.includes(selector), `${selector} generated no CSS`)
    assert.match(rule.slice(0, rule.indexOf('}')), new RegExp(`var\\(${variable}\\) calc\\(${alpha} \\* 100%\\)`))
  }
})

test('a theme colour without a modifier stays solid', async () => {
  const css = await compile('bg-danger')
  assert.match(css, /\.bg-danger \{[^}]*--tw-bg-opacity: 1;[^}]*var\(--accent-danger\) calc\(var\(--tw-bg-opacity, 1\) \* 100%\)/)
})
