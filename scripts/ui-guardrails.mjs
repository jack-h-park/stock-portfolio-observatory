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
 *
 * Those two checks allow no findings at all. The counted checks further down
 * (CHECKS) cover mistakes the tree already contains: their per-file counts are
 * recorded in scripts/ui-guardrails.baseline.json, and a run fails only when a
 * file has more hits than its recorded count.
 *
 *   node scripts/ui-guardrails.mjs --update-baseline
 *
 * rewrites that file from the current tree.
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

/**
 * An opacity modifier on an arbitrary colour held in a CSS variable, such as
 * `bg-[color:var(--accent-danger)]/10`. Tailwind 3 cannot split `var(...)` into
 * channels, so the class generates no CSS at all and the element silently
 * falls back to a transparent background and the default gray border. The
 * named tokens in tailwind.config.ts (`bg-danger/10`) apply the alpha with
 * color-mix and do work.
 */
export function findDeadOpacity(source, file = '<source>') {
  const findings = []
  for (const match of source.matchAll(/[\w:-]*\[color:var\(--[\w-]+\)\]\/(?:\d+|\[[^\]]+\])/g)) {
    const line = source.slice(0, match.index).split('\n').length
    findings.push({ file, line, cls: match[0] })
  }
  return findings
}

/**
 * Blank out comments so the counted checks below do not report prose in a
 * comment as a violation. Every character of a comment becomes a space and
 * every newline is kept, so line numbers still match the file.
 *
 * Rough by design. It tracks single-, double- and backtick-quoted strings so
 * `'https://…'` is not cut at the `//`, but:
 * - a single or double quote is assumed to close by the end of its line, so an
 *   apostrophe in JSX text (`<p>Don't</p>`) cannot swallow the rest of the file;
 * - `${…}` inside a template literal is treated as part of the string;
 * - a regex literal is read as code, so a quote or `//` inside one can confuse it;
 * - `//` in JSX text (a bare URL between tags) is taken for a comment.
 * The baseline absorbs what this gets wrong.
 */
export function stripComments(source) {
  let out = ''
  let state = 'code' // code | single | double | template | block | line
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    const next = source[i + 1]
    if (ch === '\n') {
      out += ch
      if (state === 'line' || state === 'single' || state === 'double') state = 'code'
      continue
    }
    switch (state) {
      case 'code':
        if (ch === '/' && next === '/') {
          state = 'line'
          out += ' '
        } else if (ch === '/' && next === '*') {
          state = 'block'
          out += '  '
          i++
        } else {
          if (ch === "'") state = 'single'
          else if (ch === '"') state = 'double'
          else if (ch === '`') state = 'template'
          out += ch
        }
        break
      case 'line':
        out += ' '
        break
      case 'block':
        if (ch === '*' && next === '/') {
          state = 'code'
          out += '  '
          i++
        } else out += ' '
        break
      default:
        // Inside a string: keep everything, honour backslash escapes.
        out += ch
        if (ch === '\\' && next !== undefined && next !== '\n') {
          out += next
          i++
        } else if (
          (state === 'single' && ch === "'") ||
          (state === 'double' && ch === '"') ||
          (state === 'template' && ch === '`')
        ) {
          state = 'code'
        }
    }
  }
  return out
}

function hit(file, line, snippet) {
  return { file, line, snippet: snippet.trim().slice(0, 120) }
}

/** Run `fn(lineText, lineNumber)` over each line of the comment-stripped source. */
function eachLine(source, fn) {
  stripComments(source)
    .split('\n')
    .forEach((text, index) => fn(text, index + 1))
}

/** Single-, double- or backtick-quoted literals that open and close on one line. */
const STRING_LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\\n]|\\.)*`/g

/**
 * Text between a closing `>` and an opening `<` on one line. The `>` must not
 * be the end of `=>` and the `<` must start a tag (`</…`, `<A…`, `<>`), which
 * keeps most comparisons and generics out.
 */
const JSX_TEXT = /(?<![=-])>([^<>]+)<(?=[/A-Za-z>])/g

/** Two or more Latin words of two or more letters each: prose, not a token. */
function hasLatinProse(text) {
  return (text.match(/\b[A-Za-z]{2,}\b/g) ?? []).length >= 2
}

/**
 * A tone map such as `info: 'border-info/30 bg-info/10 text-info'` shares a
 * key with the props G3 reads. Utility classes are lowercase tokens, and most
 * of them carry a `-`, `:`, `/` or `[`; prose is mostly plain words.
 */
function looksLikeClassList(value) {
  const tokens = value.split(/\s+/).filter(Boolean)
  if (!tokens.every((t) => /^[a-z0-9!:\-\/\[\]\.%#()_]+$/.test(t))) return false
  return tokens.filter((t) => /[-:/[]/.test(t)).length * 2 >= tokens.length
}

const HANGUL = /[가-힣]/

/**
 * G1. A component that picks its copy with `language === 'ko'` writes the same
 * sentence twice, inline, and nothing keeps the two in step or tells anyone
 * the English one was never updated. Copy belongs in a copy module keyed by
 * language. Silent because both branches type-check.
 */
export function findInlineLanguageBranch(source, file = '<source>') {
  const hits = []
  eachLine(source, (text, line) => {
    for (const match of text.matchAll(/\blanguage\s*(?:===?|!==?)\s*['"](?:ko|en)['"]/g)) {
      hits.push(hit(file, line, match[0]))
    }
  })
  return hits
}

/**
 * G2. Korean written straight into a component. An English-only review cannot
 * read it and the language toggle cannot switch it, so the English page
 * quietly shows Korean. Nothing else flags it: it is a valid string.
 */
export function findHangulLiteral(source, file = '<source>') {
  const hits = []
  eachLine(source, (text, line) => {
    const literalSpans = []
    for (const match of text.matchAll(STRING_LITERAL)) {
      literalSpans.push([match.index, match.index + match[0].length])
      if (HANGUL.test(match[0])) hits.push(hit(file, line, match[0]))
    }
    for (const match of text.matchAll(JSX_TEXT)) {
      const start = match.index
      const end = start + match[0].length
      // A run that overlaps a literal already read is the same text.
      if (literalSpans.some(([a, b]) => start < b && a < end)) continue
      if (HANGUL.test(match[1])) hits.push(hit(file, line, match[1]))
    }
  })
  return hits
}

/** Props and object keys whose string value is shown to the reader. */
const PROSE_KEYS = [
  'title', 'subtitle', 'placeholder', 'aria-label', 'hint', 'label', 'info',
  'description', 'emptyMessage', 'caption', 'detail', 'kind', 'name',
]

/**
 * `prop="…"`, `prop='…'`, `prop={'…'}`, `prop={"…"}` and `key: '…'`. The
 * lookbehind keeps `className` from matching `name` and `data-title` from
 * matching `title`.
 */
const PROSE_PROP = new RegExp(
  `(?<![\\w-])(?:${PROSE_KEYS.join('|')})\\s*(?:=\\s*(?:\\{\\s*)?|:\\s*)("[^"\\n]*"|'[^'\\n]*')`,
  'g',
)

/**
 * G3. English sentences typed into a component. They never reach the Korean
 * page, and a reviewer reading only the English UI cannot tell. Only
 * reader-facing places are read (JSX text, and the props listed above), so
 * class lists, paths and ids are left alone.
 *
 * JSX text is read two ways. A run between `>` and `<` on one line counts
 * once. A paragraph wrapped over several lines counts once per line: a line of
 * bare text (no `<`, `>`, `{`, `}`, `=`, `;` or quote once HTML entities are
 * removed, and not starting like a continued expression, `?`, `:`, `|`, `&`,
 * `.`) is a run when its block of bare lines sits below a line that opens a
 * tag (ends with `>` but not `=>`, or closes one inline with `</`) and above a
 * line that starts a tag or closes one (`<…`, or contains `</`). Comments are
 * already blanked by the strip, so a JSX block comment is never a run.
 */
const HTML_ENTITY = /&(?:\w+|#\d+);/g

function isBareTextLine(text) {
  const t = text.replace(HTML_ENTITY, ' ').trim()
  return t !== '' && !/[<>{}=;'"`]/.test(t) && !/^[?:|&.,)\]]/.test(t)
}

function opensJsxText(text) {
  const t = (text ?? '').trim()
  return (t.endsWith('>') && !t.endsWith('=>')) || t.includes('</')
}

function closesJsxText(text) {
  const t = (text ?? '').trim()
  return t.startsWith('<') || t.includes('</')
}

export function findEnglishProseLiteral(source, file = '<source>') {
  const hits = []
  const lines = stripComments(source).split('\n')
  lines.forEach((text, index) => {
    const line = index + 1
    for (const match of text.matchAll(JSX_TEXT)) {
      const body = match[1]
      // A brace means the run is inside or beside an expression, not plain text.
      if (/[{}]/.test(body)) continue
      // Code between a comparison's `>` and `<`, not text between tags. An
      // entity such as `&apos;` is text, so its `;` must not count as code.
      if (/&&|\|\||=>|===?|;/.test(body.replace(HTML_ENTITY, ' '))) continue
      if (hasLatinProse(body)) hits.push(hit(file, line, body))
    }
    for (const match of text.matchAll(PROSE_PROP)) {
      const value = match[1].slice(1, -1)
      if (/\s/.test(value) && hasLatinProse(value) && !looksLikeClassList(value)) {
        hits.push(hit(file, line, match[0]))
      }
    }
  })
  // Paragraphs wrapped over several lines.
  for (let i = 0; i < lines.length; i++) {
    if (!isBareTextLine(lines[i])) continue
    let j = i
    while (j + 1 < lines.length && isBareTextLine(lines[j + 1])) j++
    if (opensJsxText(lines[i - 1]) && closesJsxText(lines[j + 1])) {
      for (let k = i; k <= j; k++) {
        if (hasLatinProse(lines[k])) hits.push(hit(file, k + 1, lines[k]))
      }
    }
    i = j
  }
  return hits.sort((a, b) => a.line - b.line)
}

/**
 * Every literal on a line, including the quoted literals inside a template
 * literal's `${…}` interpolations. Matching STRING_LITERAL alone returns the
 * template as one string, so `` `${x == null ? '—' : fmt(x)}` `` would hide
 * its `'—'`. Interpolation bodies are read recursively. G2 does not need this:
 * the outer template already contains whatever Korean its parts hold.
 */
function literalsIn(text) {
  const out = []
  for (const match of text.matchAll(STRING_LITERAL)) {
    out.push(match[0])
    if (match[0][0] !== '`') continue
    const body = match[0].slice(1, -1)
    for (let i = body.indexOf('${'); i !== -1; i = body.indexOf('${', i + 1)) {
      const inner = callArguments(body, i + 1)
      if (inner === null) break
      out.push(...literalsIn(inner))
      i += inner.length + 2
    }
  }
  return out
}

/** The one file whose job is to write grid columns, so pages need not. */
const GRID_OWNER = 'components/layout.tsx'

const GRID_ALLOW = 'guardrail:allow grid'

/**
 * G4. A page that writes its own `grid-cols-*` makes a layout the shared
 * primitives in components/layout.tsx do not know about, so the next change to
 * the column rhythm misses it and pages drift apart one breakpoint at a time.
 * Nothing flags it: it is a valid class. One hit per string literal holding
 * such a class (under any variant, `grid-cols-[…]` included). A deliberate one
 * is marked with the comment `guardrail:allow grid` on its line or the line
 * above; the marker is read from the raw source, since the strip blanks it.
 */
export function findHandWrittenGrid(source, file = '<source>') {
  if (file === GRID_OWNER) return []
  const hits = []
  const raw = source.split('\n')
  eachLine(source, (text, line) => {
    if (raw[line - 1]?.includes(GRID_ALLOW) || raw[line - 2]?.includes(GRID_ALLOW)) return
    for (const literal of literalsIn(text)) {
      const classes = literal.slice(1, -1).split(/\s+/)
      if (classes.some((cls) => bareOf(cls).startsWith('grid-cols-'))) hits.push(hit(file, line, literal))
    }
  })
  return hits
}

/**
 * G5. A colour picked by a ternary between two tones
 * (`x > 0 ? 'text-success' : 'text-danger'`, `ok ? 'success' : 'warning'`,
 * `ok ? 'px-2 text-success' : 'px-2 text-warning'`) instead of `signTone` or a
 * severity table or named map in lib/tone.ts. A ternary decides zero, null and
 * the threshold its own way, so the same number can read green on one page and
 * grey on another; and either branch can be flipped without anything
 * objecting. R2 shipped exactly that: a status whose two tones were the wrong
 * way round, which type-checked and looked deliberate.
 *
 * So a ternary is a hit when both branches are string literals (quoted, or a
 * backtick with no interpolation) and each one is toned: either a bare tone
 * name, or a class string holding a `text-`, `bg-` or `border-` tone class as
 * a whole token (under any variant, with an opacity, e.g. `bg-success/70`).
 * Either order, over line breaks, and once per link of a chained ternary whose
 * two branches are both toned. A ternary with one untoned branch
 * (`'text-success' : 'text-ink-3'`), a bare tone passed to a function and a
 * map value are not hits. Reported at the line of the first branch.
 */
const TONE_NAME = '(?:neutral|info|success|warning|danger)'

/** A string literal on one line: quoted, or a backtick with no interpolation. */
const BRANCH_LITERAL = "(?:'(?:[^'\\\\\\n]|\\\\.)*'|\"(?:[^\"\\\\\\n]|\\\\.)*\"|`[^`$\\\\]*`)"

/** `? <literal> :`, the `?` being a ternary operator (not `?.` or `??`). */
const LITERAL_THEN = new RegExp(`(?<!\\?)\\?(?![.?])\\s*(${BRANCH_LITERAL})\\s*:\\s*`, 'g')

/**
 * The else branch: a literal, or `cond ? <literal>` opening the next link of a
 * chain. The condition stays on one line (the next `?` may start the line
 * after it, as prettier writes a chain), so a statement that merely ends in a
 * ternary is not joined to the next one.
 */
const LITERAL_ELSE = [
  new RegExp(BRANCH_LITERAL, 'y'),
  new RegExp(`(?:[^?:;,{}\\n]|\\?\\.|\\?\\?)+?\\s*(?<!\\?)\\?(?![.?])\\s*(${BRANCH_LITERAL})`, 'y'),
]

const BARE_TONE = new RegExp(`^${TONE_NAME}$`)
const TONE_CLASS = new RegExp(`^(?:[^\\s:]+:)*(?:text|bg|border)-${TONE_NAME}(?:/\\d+)?$`)

/** A bare tone name, or a class string with a tone class among its tokens. */
function isToned(literal) {
  const body = literal.slice(1, -1).trim()
  return BARE_TONE.test(body) || body.split(/\s+/).some((token) => TONE_CLASS.test(token))
}

export function findInlineSignTone(source, file = '<source>') {
  const code = stripComments(source)
  const hits = []
  for (const match of code.matchAll(LITERAL_THEN)) {
    if (!isToned(match[1])) continue
    const after = match.index + match[0].length
    let elseEnd = -1
    for (const re of LITERAL_ELSE) {
      re.lastIndex = after
      const m = re.exec(code)
      if (!m) continue
      if (isToned(m[1] ?? m[0])) elseEnd = after + m[0].length
      break
    }
    if (elseEnd === -1) continue
    const branch = match.index + match[0].indexOf(match[1])
    const line = code.slice(0, branch).split('\n').length
    const snippet = code.slice(match.index, elseEnd).replace(/\s+/g, ' ')
    hits.push(hit(file, line, snippet))
  }
  return hits
}

const NULL_LITERALS = new Set(['n/a', 'N/A', '—'])

/**
 * G6. A missing value written by hand as `'n/a'`, `'N/A'` or `'—'`. The
 * formatters in lib/format.ts already render a null one way; a hand-written
 * placeholder renders it another, in one language only, and to anything that
 * checks for null it is a real value. A valid string, so nothing objects.
 */
export function findNullLiteral(source, file = '<source>') {
  const hits = []
  eachLine(source, (text, line) => {
    for (const literal of literalsIn(text)) {
      if (NULL_LITERALS.has(literal.slice(1, -1))) hits.push(hit(file, line, literal))
    }
  })
  return hits
}

// G7 (metric-value-size) is gone: R2 deleted `valueClassName`, so the check had nothing left to find.

/**
 * G8. The `accent` prop marks the one figure a page wants read first. Two
 * misuses: binding it to a condition, which turns the bar into a status light
 * (a card that lists problems shows a count with `issues` instead), and a
 * second bare `accent` on one page, after which none of them stands out. So
 * report every `accent={...}`, and every bare `accent` after the first in the
 * file. Only the bare prop counts, not a class token such as `accent-danger`.
 * Read over the whole source rather than line by line, so a bare `accent`
 * alone on a line of a wrapped tag still has its newline to match.
 */
const ACCENT_PROP = /(?<=\s)accent(?=[\s=>}])/g

export function findAccentProp(source, file = '<source>') {
  const text = stripComments(source)
  const lines = text.split('\n')
  const hits = []
  let bare = 0
  for (const match of text.matchAll(ACCENT_PROP)) {
    const bound = /^\s*=/.test(text.slice(match.index + match[0].length))
    if (!bound && bare++ === 0) continue
    const line = text.slice(0, match.index).split('\n').length
    hits.push(hit(file, line, lines[line - 1]))
  }
  return hits
}

/**
 * Walk `text` from `start`, calling `visit(ch, index, depth)` for every
 * character outside a quoted string, with `depth` the bracket nesting after
 * that character. Quotes are skipped so a comma or bracket inside a string is
 * not read as structure. Stops when `visit` returns true; returns that index.
 */
function scanStructure(text, start, visit) {
  let depth = 0
  let quote = null
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    if (visit(ch, i, depth)) return i
  }
  return -1
}

/** The text between the `(` at `open` and its matching `)`, or null if it never closes. */
function callArguments(text, open) {
  const close = scanStructure(text, open, (ch, _, depth) => depth === 0)
  return close === -1 ? null : text.slice(open + 1, close)
}

/** A top-level comma followed by more than whitespace (a trailing comma is not a second argument). */
function hasSecondArgument(args) {
  return scanStructure(args, 0, (ch, i, depth) => ch === ',' && depth === 0 && args.slice(i + 1).trim() !== '') !== -1
}

/**
 * G9. `fmtDateTime` and `fmtDateShort` take the language as their second
 * argument and default it to English. A call with one argument prints an
 * English date on the Korean page, and since the argument is optional the type
 * checker has nothing to say. A call may wrap over lines, so the argument list
 * is read from the whole stripped source with a small parenthesis matcher.
 */
export function findDateFormatWithoutLanguage(source, file = '<source>') {
  const hits = []
  const text = stripComments(source)
  for (const match of text.matchAll(/\b(?:fmtDateTime|fmtDateShort)\(/g)) {
    const args = callArguments(text, match.index + match[0].length - 1)
    if (args === null || hasSecondArgument(args)) continue
    const line = text.slice(0, match.index).split('\n').length
    hits.push(hit(file, line, `${match[0]}${args})`.replace(/\s+/g, ' ')))
  }
  return hits
}

/**
 * G10. `toLocaleString()` and `toLocaleDateString()` format in whatever locale
 * the runtime has: the server's during render and the browser's after
 * hydration, so the same figure can change shape on load and differ between
 * readers. The formatters in lib/format.ts pin the locale to the page language.
 */
export function findBrowserLocaleNumber(source, file = '<source>') {
  const hits = []
  eachLine(source, (text, line) => {
    for (const _ of text.matchAll(/toLocale(?:Date)?String\(/g)) hits.push(hit(file, line, text))
  })
  return hits
}

/**
 * G11. A footnote written as a bare `<p className="… text-ink-3">`. Each one
 * picks its own size, spacing and colour step, so footnotes on two pages never
 * look alike, and a change to how notes read has no single place to land. The
 * tag is read from `<p ` to its closing `>`, which may be lines later; the hit
 * is reported on the line of `<p `.
 */
const CLASS_NAME_LITERAL = /\bclassName=(?:\{\s*)?("[^"]*"|'[^']*'|`[^`]*`)/

export function findBareFootnote(source, file = '<source>') {
  const hits = []
  const text = stripComments(source)
  for (const match of text.matchAll(/<p\s/g)) {
    const rest = text.slice(match.index)
    const end = rest.search(/(?<!=)>/)
    const tag = end === -1 ? rest : rest.slice(0, end + 1)
    const cls = tag.match(CLASS_NAME_LITERAL)
    if (!cls || !/text-ink-3(?![\w-])/.test(cls[1])) continue
    const line = text.slice(0, match.index).split('\n').length
    hits.push(hit(file, line, tag.replace(/\s+/g, ' ')))
  }
  return hits
}

/**
 * Latin words a Korean sentence may carry as they are: codes, units and
 * acronyms a Korean reader sees in English anyway. Case-sensitive.
 */
const KO_LATIN_ALLOW = new Set([
  'FX', 'API', 'ISA', 'IRP', 'ETF', 'CSV', 'PDF', 'DB', 'URL', 'USD', 'KRW', 'US', 'KR', 'ID', 'PFIC',
  'FBAR', 'IRS', 'CMA', 'RP', 'LLM', 'JSON', 'Form', 'W', 'EUR', 'JPY', 'CLI', 'OK',
  'SSH', 'Tailscale', 'MCP', 'XLSX', 'SHA',
  // US tax acronyms.
  'NIIT', 'FTC', 'MFJ', 'FTB', 'IRA',
  // Exchange and ticker codes.
  'KRX', 'IAU', 'IAUM', 'SGOL',
  // File format.
  'TSV',
  // Key and tool names.
  'Esc', 'git',
  // Date pattern letters.
  'YYYY', 'MM', 'DD',
  // Citation designators, as `Form` already is.
  'Rev', 'Proc', 'Topic', 'Schedule',
  // Institution and product names: a service stays as it is named.
  'Robinhood', 'Merrill', 'Chase', 'Fidelity', 'Agentic',
])

/**
 * A literal directly followed by `:` is an object key only when nothing but
 * `{`, `,` or the start of the line comes before it; `on?'A':'B'` is a branch.
 */
function isObjectKey(text, match) {
  if (text[match.index + match[0].length] !== ':') return false
  const before = text.slice(0, match.index).trimEnd()
  return before === '' || before.endsWith('{') || before.endsWith(',')
}

/** A whitespace-delimited token holding `/` is a path or a route, not a word. */
function withoutPathTokens(body) {
  return body
    .split(/\s+/)
    .filter((token) => !token.includes('/'))
    .join(' ')
}

/**
 * A literal that is the value of a `className=` attribute (a JSX copy value
 * can hold `<code className="font-mono text-caption">`) is markup, not copy.
 */
function isClassNameValue(text, match) {
  return /\bclassName=\{?\s*$/.test(text.slice(0, match.index))
}

/**
 * A literal on either side of `===` or `!==` (`method === 'contributions'`)
 * is a code value the copy branches on; the reader never sees it.
 */
function isComparisonOperand(text, match) {
  const before = text.slice(0, match.index).trimEnd()
  const after = text.slice(match.index + match[0].length).trimStart()
  return /[!=]==$/.test(before) || /^[!=]==/.test(after)
}

/**
 * Text between a pair of backticks inside a literal's body (`` `make pull-prod-db` ``
 * in a single-quoted string) is a command or identifier shown as typed, and the
 * English half writes it the same way. A template literal's own delimiters are
 * already sliced off before this runs.
 */
function withoutInlineCode(body) {
  return body.replace(/`[^`]*`/g, ' ')
}

/**
 * An identifier is not a word: a run of identifier characters (word
 * characters, `.`, `@`, `:`, `-`) that holds `@`, `::`, a `.` or `_` between
 * two word characters, or a lower-case letter right before an upper-case one:
 * `manual-mappings.json의`, `wrapperTreatment.US에서`, `bankInflowRules에`,
 * `market:ticker@brokerage::account`. Only that run is removed, so an English
 * word glued to it by other punctuation (`ingest·freshness_check`,
 * `override(manual_override)`) is still read. A hyphen alone (`wash-sale`) or a
 * sentence-final period (`snapshot.`) does not make an identifier.
 */
function withoutIdentifierTokens(body) {
  return body.replace(/[\w.@:-]*(?:@|::|\w[._]\w|[a-z][A-Z])[\w.@:-]*/g, ' ')
}

/**
 * A form number (`1099-DA`, `1099-B`, `1040-ES`) is a code, not a word: three
 * or four digits, a hyphen and up to three capitals. The capitals alone
 * (`DA 양식`) are still read.
 */
function withoutFormNumbers(body) {
  return body.replace(/\b\d{3,4}-[A-Z]{1,3}\b/g, ' ')
}

/**
 * A `name=value` pair copied from a file (`collectible=true`) is a field shown
 * as typed: word characters on both sides of one `=`, with no space. A spaced
 * `collectible = true` is read as words.
 */
function withoutFieldValuePairs(body) {
  return body.replace(/\b\w+=\w+\b/g, ' ')
}

/** `{placeholder}` and `${…}` are filled in at run time, so their names are not copy. */
function withoutInterpolations(body) {
  let out = ''
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '$' && body[i + 1] === '{') {
      const inner = callArguments(body, i + 1)
      if (inner === null) break
      i += inner.length + 2
      out += ' '
    } else out += body[i]
  }
  return out.replace(/\{[\w.]+\}/g, ' ')
}

/**
 * G12. An English word left in the Korean half of a copy module: a term the
 * translator kept (`lot`, `ticker`, `snapshot`) or a command pasted into a
 * sentence. The Korean page then reads half in English, and since `ko` only
 * has to match the shape of `en`, the type checker is satisfied. The Korean
 * section is everything from the first `ko: {` line to the end of the file;
 * one hit per string literal there holding a Latin word of two or more letters
 * outside KO_LATIN_ALLOW, with the offending words first in the snippet. A
 * literal inside a `${…}` is read on its own (it is shown too), while the
 * interpolation's code is not. A literal followed directly by `:` after `{`,
 * `,` or the start of the line is an object key (`'Hana Bank': '하나은행'`), a
 * raw value the map translates, so it is skipped; a ternary branch is still
 * read, spaced or not. A token containing `/` (`data/manual-mappings.json`,
 * `/lots`) is a path or route and is not read.
 *
 * Six more things are not words and are not read: a `className=` value
 * (markup), an operand of `===` or `!==` (a code value), a backticked span
 * inside a literal (a command or identifier shown as typed), an identifier
 * token (one holding `@`, `::`, an inner `.` or `_`, or a camelCase hump), a
 * form number (`1099-DA`), and an unspaced `name=value` pair copied from a
 * file (`collectible=true`). A
 * command in a Korean sentence is reworded (`갱신을 실행하세요`), not allowed.
 */
export function findEnglishInKoreanCopy(source, file = '<source>') {
  const hits = []
  let inKorean = false
  eachLine(source, (text, line) => {
    if (!inKorean && /^\s*ko:\s*\{/.test(text)) inKorean = true
    if (!inKorean) return
    const literals = [...text.matchAll(STRING_LITERAL)]
      .filter((match) => !isObjectKey(text, match) && !isClassNameValue(text, match) && !isComparisonOperand(text, match))
      .flatMap((match) => literalsIn(match[0]))
    for (const literal of literals) {
      const body = withoutPathTokens(
        withoutFieldValuePairs(withoutFormNumbers(withoutIdentifierTokens(withoutInlineCode(withoutInterpolations(literal.slice(1, -1))))))
      )
      const words = (body.match(/\b[A-Za-z]{2,}\b/g) ?? []).filter((word) => !KO_LATIN_ALLOW.has(word))
      if (words.length > 0) hits.push(hit(file, line, `${[...new Set(words)].join(', ')}: ${literal}`))
    }
  })
  return hits
}

/**
 * The root of a copy lookup: `copy`, a `…Copy` object such as `fbarCopy`, or a
 * `labels` / `…Labels` table such as `priorityLabels`.
 */
const COPY_ROOT = /^(?:copy|[a-z]\w*Copy|labels|[a-z]\w*Labels)$/

/**
 * Properties that hold something other than an enum code. A market code (KR,
 * US, CRYPTO) is shown raw by design; a ticker is an identifier, not a member
 * of a closed set; a `label` already holds display text.
 */
const RAW_BY_DESIGN = new Set(['market', 'ticker', 'label'])

/**
 * Local names for a slice of copy declared in the file, such as
 * `const ac = copy.allocation` or `const proposalCopy = getPageCopy(…)`, read
 * in order so an alias of an alias also counts.
 */
function copyAliases(text) {
  const aliases = new Set()
  for (const match of text.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*[.([]/g)) {
    const [, name, root] = match
    if (COPY_ROOT.test(root) || aliases.has(root) || root === 'getPageCopy' || root === 'getUiCopy') aliases.add(name)
  }
  return aliases
}

/** `a.b`, `a?.b`, `a[0].b`, `a.b[c]`: an identifier followed by one or more accesses. */
const MEMBER_EXPRESSION = /^([A-Za-z_$][\w$]*)(?:\??\.[A-Za-z_$][\w$]*|\[[^\]]*\])+$/

/**
 * G13. An enum value rendered raw in a badge: `<Badge>{row.status}</Badge>`.
 * The reader sees the code the data uses (`US_AND_KR`, `tickerless_categorized`)
 * in both languages, where a word belongs. Every such value reads a copy map,
 * `labels[value] ?? value`, so an unknown value still shows instead of a blank.
 *
 * A hit is a `<Badge …>` whose only child is one `{expression}` that is a plain
 * member expression, not rooted in a copy object (COPY_ROOT, or a local alias
 * of one) and not ending in a RAW_BY_DESIGN property. The tag may wrap over
 * lines; the hit is reported on the line of `<Badge`. Heuristic: it cannot see
 * a badge child built in a variable first (`const text = row.status` …
 * `<Badge>{text}</Badge>`), a value passed through a helper that returns it
 * unchanged, or a badge rendered by another component from a raw prop.
 */
export function findRawEnumBadge(source, file = '<source>') {
  const hits = []
  const text = stripComments(source)
  const aliases = copyAliases(text)
  for (const match of text.matchAll(/<Badge\b/g)) {
    const tagEnd = scanStructure(text, match.index + match[0].length, (ch, i, depth) => ch === '>' && depth === 0 && text[i - 1] !== '=')
    if (tagEnd === -1 || text[tagEnd - 1] === '/') continue
    const open = text.slice(tagEnd + 1).match(/^\s*\{/)
    if (!open) continue
    const braceAt = tagEnd + open[0].length
    const braceClose = scanStructure(text, braceAt, (ch, _, depth) => depth === 0)
    if (braceClose === -1 || !/^\s*<\/Badge>/.test(text.slice(braceClose + 1))) continue
    const expression = text.slice(braceAt + 1, braceClose).trim()
    const member = expression.match(MEMBER_EXPRESSION)
    if (!member || COPY_ROOT.test(member[1]) || aliases.has(member[1])) continue
    const last = expression.match(/\.([A-Za-z_$][\w$]*)$/)
    if (last && RAW_BY_DESIGN.has(last[1])) continue
    const line = text.slice(0, match.index).split('\n').length
    hits.push(hit(file, line, `<Badge>{${expression}}</Badge>`))
  }
  return hits
}

/**
 * G14: a form page that reloads itself. PageHeader renders AutoRefresh, which
 * calls router.refresh() every 30 seconds; on a page with a server-action form
 * that re-renders the form mid-entry. Such a page passes `autoRefresh={false}`.
 *
 * This check reads a route folder, not a file: `files` is every file in one
 * folder under app/ (see groupByRoute), so a page whose form lives in a sibling
 * such as `components.tsx`, or whose header lives in `view.tsx`, is judged as
 * one unit. A hit is a folder where some file renders `<SubmitButton` or
 * `<ConfirmSubmitButton` and no file passes `autoRefresh={false}`. It is
 * reported once, on the `<PageHeader` line of page.tsx (or of whichever file
 * renders the header), since that is where the fix goes.
 *
 * A GET filter form (`method="get"`, as on /realized) uses a plain button, not
 * SubmitButton, and is not a hit: it does not hold typed state across a refresh.
 *
 * Blind spots: a submit button rendered by a shared component in components/
 * (outside the route folder) is not seen, and neither is a header rendered by
 * one; a route that gets its form only that way is not reported. A nested route
 * folder is a separate unit, so its parent's switch does not cover it.
 */
const SUBMIT_TAG = /<(?:Confirm)?SubmitButton\b/
const AUTO_REFRESH_OFF = /\bautoRefresh=\{\s*false\s*\}/

export function findFormPagePolls(files) {
  const stripped = files.map(({ file, source }) => ({ file, text: stripComments(source) }))
  const submitting = stripped.filter(({ text }) => SUBMIT_TAG.test(text))
  if (submitting.length === 0) return []
  if (stripped.some(({ text }) => AUTO_REFRESH_OFF.test(text))) return []
  const lineOf = (text, re) => {
    const index = text.search(re)
    return index === -1 ? -1 : text.slice(0, index).split('\n').length
  }
  const withHeader = stripped.filter(({ text }) => /<PageHeader\b/.test(text))
  const target =
    withHeader.find(({ file }) => file.endsWith('/page.tsx')) ?? withHeader[0] ?? submitting[0]
  const headerLine = lineOf(target.text, /<PageHeader\b/)
  const line = headerLine !== -1 ? headerLine : lineOf(target.text, SUBMIT_TAG)
  return [hit(target.file, line, target.text.split('\n')[line - 1])]
}

/**
 * Group repo-relative paths by the folder they sit in. Each folder is one route
 * unit: `app/tax-planning/plans/[id]/` is its own route, not part of
 * `app/tax-planning/`. Keys and members are sorted.
 */
export function groupByRoute(paths) {
  const groups = new Map()
  for (const rel of [...paths].sort()) {
    const dir = rel.slice(0, rel.lastIndexOf('/'))
    if (!groups.has(dir)) groups.set(dir, [])
    groups.get(dir).push(rel)
  }
  return new Map([...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/**
 * G15. A sentence written in the data layer: a module under lib/ stores reader
 * text in a field, and a page prints the field as it is. The page then shows
 * one language whatever the toggle says (`retentionReason: '… 원본입니다.'` put
 * Korean on the English /data-map), and the copy module never hears of it.
 * The data layer returns a code with its parameters; the page renders the
 * sentence from lib/ui-copy. Two shapes, one hit per literal, read from the
 * comment-stripped source as a whole so a value wrapped onto the line after its
 * key or its `push(` still counts; the hit is reported on the literal's line:
 *
 * - a Korean sentence as an object property value: `key: '…'` (or a quoted
 *   key), the key directly after `{` or `,`, the literal holding Hangul and a
 *   sentence ending (니다, 세요, 시오, 습니까, optionally followed by `.`, `!`
 *   or `?`) at its end or before whitespace. A noun phrase, and a Korean
 *   literal used as an argument, a comparison operand, an array element, a
 *   ternary branch or the right side of `=`, are not hits: those are data the
 *   code matches or text that leaves the machine, and a lexical check cannot
 *   tell them from page text;
 * - a prose literal pushed onto an array whose name ends in `warnings` or
 *   `notes` (`warnings`, `lotWarnings`, `Notes`): it holds Hangul, or, once
 *   `${…}` interpolations are removed, whitespace and three or more Latin
 *   words of two or more letters. A pushed object is not a hit.
 *
 * A deliberate one is marked with the comment `guardrail:allow data-text` on
 * its line or the line above, read from the raw source as G4 reads its marker.
 *
 * Blind spots: an English sentence stored as a property value (too many of
 * those are machine-facing reasons and CLI text to tell apart), a sentence
 * built in a helper and returned, a sentence in a template literal that spans
 * lines, and a field typed `string` that a page prints. The net for those is
 * the types: the fields the pages render are typed as code unions
 * (`RetentionReasonCode`, `TaxPlanWarning`, `MasterPlanReasonCode`), and each
 * has a coverage test that every code has a label in both languages.
 */
const DATA_TEXT_ALLOW = 'guardrail:allow data-text'

const KOREAN_SENTENCE_END = /(?:니다|세요|시오|습니까)[.!?]?(?=\s|$)/

/** The text just before a property value: `{` or `,`, then a key and `:`. */
const KEY_BEFORE_VALUE = /[{,]\s*([A-Za-z_$][\w$]*|'[^'\n]*'|"[^"\n]*")\s*:\s*$/

const PUSH_ONTO_NOTES = /(?<![\w$])[\w$]*(?:[wW]arnings|[nN]otes)\s*\??\.\s*push\(\s*/g

const LITERAL_AT = new RegExp(STRING_LITERAL.source, 'y')

function isPushedProse(literal) {
  const body = withoutInterpolations(literal.slice(1, -1))
  if (HANGUL.test(body)) return true
  return /\s/.test(body.trim()) && (body.match(/\b[A-Za-z]{2,}\b/g) ?? []).length >= 3
}

export function findDataLayerSentence(source, file = '<source>') {
  const text = stripComments(source)
  const raw = source.split('\n')
  const lineAt = (index) => text.slice(0, index).split('\n').length
  const allowed = (line) => raw[line - 1]?.includes(DATA_TEXT_ALLOW) || raw[line - 2]?.includes(DATA_TEXT_ALLOW)
  const found = []
  for (const match of text.matchAll(STRING_LITERAL)) {
    const literal = match[0]
    const body = literal.slice(1, -1)
    if (!HANGUL.test(body) || !KOREAN_SENTENCE_END.test(body)) continue
    const key = text.slice(Math.max(0, match.index - 200), match.index).match(KEY_BEFORE_VALUE)
    if (!key) continue
    found.push({ index: match.index, snippet: `${key[1]}: ${literal}` })
  }
  for (const match of text.matchAll(PUSH_ONTO_NOTES)) {
    LITERAL_AT.lastIndex = match.index + match[0].length
    const literal = LITERAL_AT.exec(text)?.[0]
    if (!literal || !isPushedProse(literal)) continue
    found.push({ index: LITERAL_AT.lastIndex - literal.length, snippet: `${match[0].trim()}${literal}` })
  }
  return found
    .sort((a, b) => a.index - b.index)
    .map(({ index, snippet }) => ({ line: lineAt(index), snippet }))
    .filter(({ line }) => !allowed(line))
    .map(({ line, snippet }) => hit(file, line, snippet))
}

/**
 * Files under lib/ whose job is to write text, so G15 does not read them. A
 * trailing `/` covers a whole folder; any other entry is one exact file.
 */
const DATA_LAYER_TEXT_OWNERS = [
  // The copy catalog itself.
  'lib/ui-copy/',
  // A catalog by another name: term definitions in both languages.
  'lib/glossary.ts',
  // Terminal output, which never reaches a page.
  'lib/cli/',
  // Reminder messages that leave the machine.
  'lib/rebalance/notify.ts',
  // Returns both languages, for the page and for the notifier.
  'lib/rebalance/proposal-view.ts',
]

/** An `include` pattern that matches every path except those `owners` names. */
function outside(owners) {
  const alternatives = owners.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (p.endsWith('/') ? '' : '$'))
  return new RegExp(`^(?!(?:${alternatives.join('|')}))`)
}

const BILINGUAL_BY_DESIGN = ['app/global-error.tsx']

/**
 * The counted checks. A counted check may have hits; the baseline records how
 * many each file had when the check arrived, and a run fails only when a file
 * gets worse. `roots` defaults to app and components; `exclude` lists exact
 * paths relative to the repo root; `include`, when set, is a pattern a path must
 * match to be read at all. Add a check by appending to this list.
 *
 * `group: 'route'` changes what `find` receives: instead of one file's source,
 * it gets `[{ file, source }]` for every file in one folder (groupByRoute), and
 * is called once per folder. Without `group`, a check reads one file at a time.
 */
export const CHECKS = [
  {
    code: 'G1',
    id: 'inline-language-branch',
    title: 'copy chosen inline by language instead of from a copy module',
    exclude: BILINGUAL_BY_DESIGN,
    find: findInlineLanguageBranch,
  },
  {
    code: 'G2',
    id: 'hangul-literal',
    title: 'Korean text written into a component',
    exclude: BILINGUAL_BY_DESIGN,
    find: findHangulLiteral,
  },
  {
    code: 'G3',
    id: 'english-prose-literal',
    title: 'English prose written into a component',
    exclude: BILINGUAL_BY_DESIGN,
    find: findEnglishProseLiteral,
  },
  {
    code: 'G4',
    id: 'hand-written-grid',
    title: 'grid columns written by hand instead of with the layout primitives',
    find: findHandWrittenGrid,
  },
  {
    code: 'G5',
    id: 'inline-sign-tone',
    title: 'tone chosen by a ternary instead of from lib/tone',
    find: findInlineSignTone,
  },
  {
    code: 'G6',
    id: 'null-literal',
    title: 'missing value written as n/a or a dash instead of by a formatter',
    find: findNullLiteral,
  },
  // G7 metric-value-size was retired: R2 deleted `valueClassName`, so it had nothing left to find.
  {
    code: 'G8',
    id: 'accent-per-page',
    title: 'accent bar used as a status, or more than once on a page',
    roots: ['app'],
    include: /(?:^|\/)page\.tsx$/,
    find: findAccentProp,
  },
  {
    code: 'G9',
    id: 'date-format-without-language',
    title: 'date formatted without the page language',
    find: findDateFormatWithoutLanguage,
  },
  {
    code: 'G10',
    id: 'browser-locale-number',
    title: 'number or date formatted in the runtime locale',
    find: findBrowserLocaleNumber,
  },
  {
    code: 'G11',
    id: 'bare-footnote',
    title: 'footnote written as a bare text-ink-3 paragraph',
    roots: ['app', 'components'],
    // components/metric.tsx owns Note's own <p>, the one place the recipe belongs.
    exclude: ['components/metric.tsx'],
    find: findBareFootnote,
  },
  {
    code: 'G12',
    id: 'english-in-korean-copy',
    title: 'English word left in the Korean half of a copy module',
    roots: ['lib/ui-copy'],
    find: findEnglishInKoreanCopy,
  },
  {
    code: 'G13',
    id: 'raw-enum-badge',
    title: 'enum value shown raw in a badge instead of through a copy label',
    find: findRawEnumBadge,
  },
  {
    code: 'G14',
    id: 'form-page-polls',
    title: 'form page that still refreshes itself every 30 seconds',
    roots: ['app'],
    group: 'route',
    find: findFormPagePolls,
  },
  {
    code: 'G15',
    id: 'data-layer-sentence',
    title: 'sentence written in the data layer instead of a copy module',
    roots: ['lib'],
    include: outside(DATA_LAYER_TEXT_OWNERS),
    find: findDataLayerSentence,
  },
].map((check) => ({ roots: ['app', 'components'], exclude: [], include: null, ...check }))

/**
 * Compare per-file counts against the baseline. Both arguments map a check id
 * to `{ file: count }`; a file absent from the baseline has baseline 0.
 * Returns the files over baseline (these fail the run) and the files under it
 * (these pass, with a hint that the baseline can come down).
 */
export function compareToBaseline(current, baseline) {
  const over = []
  const under = []
  const ids = [...new Set([...Object.keys(current), ...Object.keys(baseline)])].sort()
  for (const id of ids) {
    const now = current[id] ?? {}
    const was = baseline[id] ?? {}
    const files = [...new Set([...Object.keys(now), ...Object.keys(was)])].sort()
    for (const file of files) {
      const count = now[file] ?? 0
      const allowed = was[file] ?? 0
      if (count > allowed) over.push({ id, file, current: count, baseline: allowed })
      else if (count < allowed) under.push({ id, file, current: count, baseline: allowed })
    }
  }
  return { ok: over.length === 0, over, under }
}

const BASELINE_PATH = 'scripts/ui-guardrails.baseline.json'

function countByFile(hits) {
  const counts = {}
  for (const h of hits) counts[h.file] = (counts[h.file] ?? 0) + 1
  return counts
}

/** Keys sorted at both levels, so the same tree always writes the same bytes. */
function serializeBaseline(counts) {
  const sorted = {}
  for (const id of Object.keys(counts).sort()) {
    sorted[id] = {}
    for (const file of Object.keys(counts[id]).sort()) sorted[id][file] = counts[id][file]
  }
  return `${JSON.stringify(sorted, null, 2)}\n`
}

/** Run over the tree only when invoked directly, so importing stays side-effect free. */
function scanTree() {
  const conflicts = []
  const deadOpacity = []
  for (const root of ROOTS) {
    if (!fs.existsSync(root)) continue
    for (const file of walk(root)) {
      const source = fs.readFileSync(file, 'utf8')
      conflicts.push(...findConflicts(source, file))
      deadOpacity.push(...findDeadOpacity(source, file))
    }
  }
  return { conflicts, deadOpacity }
}

/** Every counted check over its own roots. Test files are never read. */
function scanCounted() {
  const results = {}
  for (const check of CHECKS) {
    const files = []
    for (const root of check.roots) {
      if (!fs.existsSync(root)) continue
      for (const file of walk(root).sort()) {
        const rel = file.split(path.sep).join('/')
        if (/\.test\.tsx?$/.test(rel) || check.exclude.includes(rel)) continue
        if (check.include && !check.include.test(rel)) continue
        files.push(rel)
      }
    }
    const read = (rel) => fs.readFileSync(rel, 'utf8')
    const hits = []
    if (check.group === 'route') {
      for (const members of groupByRoute(files).values()) {
        hits.push(...check.find(members.map((rel) => ({ file: rel, source: read(rel) }))))
      }
    } else {
      for (const rel of files) hits.push(...check.find(read(rel), rel))
    }
    results[check.id] = hits
  }
  return results
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const counted = scanCounted()
  const current = {}
  for (const check of CHECKS) {
    const counts = countByFile(counted[check.id])
    if (Object.keys(counts).length > 0) current[check.id] = counts
  }

  if (process.argv.includes('--update-baseline')) {
    fs.writeFileSync(BASELINE_PATH, serializeBaseline(current))
    console.log(`wrote ${BASELINE_PATH}`)
  }

  const baseline = fs.existsSync(BASELINE_PATH) ? JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) : {}
  const comparison = compareToBaseline(current, baseline)

  const { conflicts: findings, deadOpacity } = scanTree()
  for (const f of findings) {
    console.log(`${f.file}:${f.line}`)
    console.log(`  ${f.group} set twice at ${f.variant}: ${f.classes.join('  ')}`)
    console.log(`  Tailwind picks by emit order, not by the order written — one of these does nothing.`)
  }
  for (const f of deadOpacity) {
    console.log(`${f.file}:${f.line}`)
    console.log(`  ${f.cls} generates no CSS — use the named token (e.g. bg-danger/10) instead.`)
  }

  const byId = Object.fromEntries(CHECKS.map((check) => [check.id, check]))
  for (const o of comparison.over) {
    const check = byId[o.id]
    const label = check ? `${check.code} ${o.id}` : o.id
    console.log(`${o.file}: ${label} ${o.current} hit(s), baseline ${o.baseline}${check ? ` — ${check.title}` : ''}`)
    for (const h of (counted[o.id] ?? []).filter((x) => x.file === o.file)) {
      console.log(`  ${h.file}:${h.line}  ${h.snippet}`)
    }
  }
  for (const u of comparison.under) {
    console.log(`hint: ${u.file} has ${u.current} ${u.id} hit(s), baseline ${u.baseline} — run with --update-baseline to lower it`)
  }

  console.log(`\n${findings.length} conflicting utility pair(s)`)
  console.log(`${deadOpacity.length} opacity modifier(s) on a var() colour`)
  for (const check of CHECKS) {
    const counts = current[check.id] ?? {}
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    const allowed = Object.values(baseline[check.id] ?? {}).reduce((a, b) => a + b, 0)
    console.log(`${check.code} ${check.id}: ${total} hit(s) in ${Object.keys(counts).length} file(s), baseline ${allowed}`)
  }
  process.exit(findings.length + deadOpacity.length === 0 && comparison.ok ? 0 : 1)
}
