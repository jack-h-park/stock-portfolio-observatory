/**
 * Catch the mistake this codebase keeps making: two Tailwind utilities that set
 * the same property, on the same element.
 *
 *   node scripts/ui-guardrails.mjs
 *
 * Tailwind does not resolve that by the order you wrote them. Both classes land
 * in the stylesheet and the one emitted later wins, which has nothing to do
 * with the one you meant. It is silent — types, lint and the build all pass —
 * and it has cost this refactor real work: DataTable asked for `text-[12px]`
 * and rendered 13px on all thirty-five tables, PlanMetric asked for a 10px
 * label and rendered 11px, and the form kit produced two more of the same on
 * its first attempt. Every one was found by comparing screenshots, which only
 * works if someone happens to look.
 *
 * Static, so it needs no server and can gate a pull request.
 *
 * It reads only literal className strings. A className assembled by clsx from
 * variables is out of reach here — that is what the screenshot net is for.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOTS = ['app', 'components', 'lib']

/** The project's type scale (tailwind.config.ts), plus Tailwind's own steps. */
const FONT_SIZES = [
  'micro', 'label', 'caption', 'body', 'body-lg', 'title', 'metric', 'hero', 'display',
  'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl',
]

/**
 * Each group is one CSS property that two classes could fight over. The regex
 * must match a whole class, so a colour like `text-ink-3` is not mistaken for a
 * font size and `px-2` is not mistaken for `p-2`.
 */
const GROUPS = [
  { name: 'font-size', re: new RegExp(`^(?:text-(?:${FONT_SIZES.join('|')})|text-\\[[^\\]]+px\\])$`) },
  { name: 'padding (all)', re: /^p-(?:\d+(?:\.\d+)?|px|\[[^\]]+\])$/ },
  { name: 'padding-x', re: /^px-(?:\d+(?:\.\d+)?|px|\[[^\]]+\])$/ },
  { name: 'padding-y', re: /^py-(?:\d+(?:\.\d+)?|px|\[[^\]]+\])$/ },
  { name: 'margin (all)', re: /^-?m-(?:\d+(?:\.\d+)?|px|auto|\[[^\]]+\])$/ },
  { name: 'margin-x', re: /^-?mx-(?:\d+(?:\.\d+)?|px|auto|\[[^\]]+\])$/ },
  { name: 'margin-y', re: /^-?my-(?:\d+(?:\.\d+)?|px|auto|\[[^\]]+\])$/ },
  { name: 'margin-top', re: /^-?mt-(?:\d+(?:\.\d+)?|px|auto|\[[^\]]+\])$/ },
  { name: 'margin-bottom', re: /^-?mb-(?:\d+(?:\.\d+)?|px|auto|\[[^\]]+\])$/ },
  { name: 'font-weight', re: /^font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/ },
  { name: 'text-align', re: /^text-(?:left|center|right|justify)$/ },
  { name: 'display', re: /^(?:block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden)$/ },
]

/**
 * A class only conflicts with another at the same breakpoint and state:
 * `text-caption sm:text-body` is the point of responsive type, and
 * `text-ink-3 hover:text-ink` is a hover rule, not a duplicate.
 */
function variantOf(cls) {
  const at = cls.lastIndexOf(':')
  return at === -1 ? '' : cls.slice(0, at + 1)
}

function bareOf(cls) {
  const at = cls.lastIndexOf(':')
  return at === -1 ? cls : cls.slice(at + 1)
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

/**
 * The whole check, over one file's source. Exported so tests/ui-guardrails.test.ts
 * can assert it still catches a planted conflict — a guardrail that has quietly
 * stopped working reads exactly like a clean codebase, and this one did: the
 * first version returned zero findings on the whole app because its regex never
 * matched className="…" at all.
 */
export function findConflicts(source, file = '<source>') {
  const findings = []
  // Every single- or double-quoted literal, which covers className="…" and the
  // string arguments clsx is called with. Template literals are skipped: their
  // interpolations are not knowable here.
  for (const match of source.matchAll(/"([^"\n]*)"|'([^'\n]*)'/g)) {
    const value = match[1] ?? match[2]
    if (!value || !/\s/.test(value)) continue
    const classes = value.split(/\s+/).filter(Boolean)
    if (classes.length < 2) continue

    for (const group of GROUPS) {
      const hits = new Map()
      for (const cls of classes) {
        if (!group.re.test(bareOf(cls))) continue
        const key = variantOf(cls)
        if (!hits.has(key)) hits.set(key, [])
        hits.get(key).push(cls)
      }
      for (const [variant, list] of hits) {
        if (list.length < 2) continue
        const line = source.slice(0, match.index).split('\n').length
        findings.push({ file, line, group: group.name, variant: variant || '(no variant)', classes: list })
      }
    }
  }
  return findings
}

/** Run over the tree only when invoked directly, so importing stays side-effect free. */
function scanTree() {
  const all = []
  for (const root of ROOTS) {
    if (!fs.existsSync(root)) continue
    for (const file of walk(root)) all.push(...findConflicts(fs.readFileSync(file, 'utf8'), file))
  }
  return all
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const findings = scanTree()
  for (const f of findings) {
    console.log(`${f.file}:${f.line}`)
    console.log(`  ${f.group} set twice at ${f.variant}: ${f.classes.join('  ')}`)
    console.log(`  Tailwind picks by emit order, not by the order written — one of these does nothing.`)
  }
  console.log(`\n${findings.length} conflicting utility pair(s)`)
  process.exit(findings.length === 0 ? 0 : 1)
}
