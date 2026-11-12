import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import {
  CHECKS,
  compareToBaseline,
  findConflicts,
  findDeadOpacity,
  findEnglishProseLiteral,
  findHangulLiteral,
  findInlineLanguageBranch,
  stripComments,
} from '../scripts/ui-guardrails.mjs'

type Conflict = { group: string; variant: string; classes: string[] }

const find = (source: string): Conflict[] => findConflicts(source) as Conflict[]

// The guardrail reports zero findings on this codebase, which is the answer we
// want — and is indistinguishable from a guardrail that has stopped working.
// The first version of it did exactly that: its regex never matched
// className="…", so it passed the entire app without reading a single class.
// These are the cases that make the zero mean something.
test('two utilities for the same property are caught', () => {
  const cases: Array<[string, string]> = [
    ['<div className="text-caption font-medium text-body">', 'font-size'],
    ['<div className="px-2 py-1 px-3">', 'padding-x'],
    ['<div className="mt-1 mt-2">', 'margin-top'],
    ['<div className="text-[12px] text-[13px]">', 'font-size'],
    ['<div className="flex items-center grid">', 'display'],
    ['<div className="font-medium font-bold">', 'font-weight'],
  ]
  for (const [source, group] of cases) {
    const groups = find(source).map((f) => f.group)
    assert.ok(groups.includes(group), `${group} not reported for: ${source}`)
  }
})

// The exact case that made DataTable render 13px where it asked for 12: a size
// on the element and another size arriving in the same class list.
test('a breakpoint or state variant is not a conflict', () => {
  const legitimate = [
    '<div className="text-caption sm:text-body">',
    '<div className="text-ink-3 hover:text-ink">',
    '<div className="px-2 sm:px-4 lg:px-8">',
    '<div className="mb-5 mt-2">',
  ]
  for (const source of legitimate) {
    assert.deepEqual(find(source), [], `false positive on: ${source}`)
  }
})

// Colours share the `text-` prefix with sizes, and `px-` is not `p-`.
test('colours and different axes are not mistaken for each other', () => {
  assert.deepEqual(find('<div className="text-ink-3 text-info">'), [])
  assert.deepEqual(find('<div className="p-4 px-2">'), [])
})

// Tailwind 3 cannot split `var(...)` into channels, so these generate no CSS at
// all; the Badge tones did exactly this and rendered with no fill and the
// default gray border.
test('an opacity modifier on a var() colour is caught', () => {
  const dead = (source: string) => (findDeadOpacity(source) as Array<{ cls: string }>).map((f) => f.cls)
  assert.deepEqual(dead('<span className="border-[color:var(--accent-danger)]/30 text-danger">'), [
    'border-[color:var(--accent-danger)]/30',
  ])
  assert.deepEqual(dead("'hover:bg-[color:var(--bg-surface)]/[0.6]'"), ['hover:bg-[color:var(--bg-surface)]/[0.6]'])
  assert.deepEqual(dead('<span className="bg-danger/10 text-[color:var(--accent-info)]">'), [])
})

type Hit = { file: string; line: number; snippet: string }
const snippets = (hits: unknown) => (hits as Hit[]).map((h) => h.snippet)

test('the comment strip keeps line numbers and leaves strings alone', () => {
  const source = "const a = 'https://example.test' // trailing\n/* one\n two */ const b = 1"
  const stripped = stripComments(source)
  assert.equal(stripped.split('\n').length, 3)
  assert.ok(stripped.includes("'https://example.test'"))
  assert.ok(!stripped.includes('trailing'))
  assert.ok(!stripped.includes('two'))
  assert.ok(stripped.includes('const b = 1'))
})

test('G1 catches copy chosen inline by language', () => {
  const hits = findInlineLanguageBranch(
    "const a = language === 'ko' ? 'x' : 'y'\nconst b = language !== \"en\"\n",
    'f.tsx',
  ) as Hit[]
  assert.deepEqual(
    hits.map((h) => h.line),
    [1, 2],
  )
  assert.equal(hits[0].file, 'f.tsx')
  // The loose comparisons count too.
  assert.equal(findInlineLanguageBranch("const a = language == 'ko'\nconst b = language != 'en'").length, 2)
  // A copy module lookup, a comparison in a comment and another variable are fine.
  assert.deepEqual(findInlineLanguageBranch('const copy = pageCopy[language]'), [])
  assert.deepEqual(findInlineLanguageBranch("// language === 'ko' was here"), [])
  assert.deepEqual(findInlineLanguageBranch("const x = locale === 'ko'"), [])
})

test('G2 catches Korean in a literal and in JSX text', () => {
  assert.deepEqual(snippets(findHangulLiteral("const t = '계좌 없음'")), ["'계좌 없음'"])
  assert.deepEqual(snippets(findHangulLiteral('const t = `${n}일 전`')), ['`${n}일 전`'])
  assert.deepEqual(snippets(findHangulLiteral('<p>자료 없음</p>')), ['자료 없음'])
  // A Korean comment, and English literals, are not counted.
  assert.deepEqual(findHangulLiteral('// 설명\nconst t = copy.title /* 제목 */'), [])
  assert.deepEqual(findHangulLiteral("<p className=\"text-ink-3\">{copy.empty}</p>"), [])
})

test('G3 catches English prose in JSX text and reader-facing props', () => {
  const positives = [
    '<span>Not held here</span>',
    '<Card title="Account data updates">',
    "<Field placeholder={'Type a ticker'} />",
    "const row = { label: 'Cash on hand', kind: 'Tax lot' }",
    '<button aria-label="Close the panel">',
    // An HTML entity is text; its `;` is not a statement end.
    '<p>Don&apos;t do this twice</p>',
  ]
  for (const source of positives) {
    assert.ok(findEnglishProseLiteral(source).length > 0, `missed: ${source}`)
  }
  assert.equal(findEnglishProseLiteral("const row = { label: 'Cash on hand', kind: 'Tax lot' }").length, 2)

  const negatives = [
    // A class list, even under a key G3 reads.
    '<div className="flex items-center gap-2 text-ink-3">',
    "const tone = { info: 'border-info/30 bg-info/10 text-info' }",
    // A path, an id and a template literal.
    '<Link href="/tax planning/overview">',
    '<a id="main content">',
    '<Card title={`Total ${name}`} />',
    // Text with an expression in it, and a comparison between `>` and `<`.
    '<p>Last updated {date} by job</p>',
    'const ok = count > limit && total < max',
    // One word, or a comment.
    '<Card title="Holdings">',
    '// <p>Some old prose here</p>',
  ]
  for (const source of negatives) {
    assert.deepEqual(findEnglishProseLiteral(source), [], `false positive on: ${source}`)
  }
})

// Paragraphs are usually wrapped over several lines, which the one-line
// `>…<` run cannot see.
test('G3 counts each line of a paragraph wrapped inside a JSX element', () => {
  const paragraph = [
    '      <p className="text-label text-ink-3">',
    '        Figures are taken from the snapshot and do',
    '        not update after the briefing date, so a later',
    '        correction appears only in the next one.',
    '      </p>',
  ].join('\n')
  assert.deepEqual(
    (findEnglishProseLiteral(paragraph) as Hit[]).map((h) => h.line),
    [2, 3, 4],
  )

  const comment = [
    '      <span>',
    '        {/*',
    '          A bare button, not a styled control. It carries no',
    '          padding of its own so it occupies the same box.',
    '        */}',
    '        {label}',
    '      </span>',
  ].join('\n')
  assert.deepEqual(findEnglishProseLiteral(comment), [])

  // A ternary chain wrapped over lines is code, not text.
  const ternary = ['  const label = paused', '    ? copy.pausedSince(clock)', '    : copy.paused', '  return <span>x</span>'].join('\n')
  assert.deepEqual(findEnglishProseLiteral(ternary), [])
})

test('every counted check scans app and components and skips the bilingual error page', () => {
  assert.deepEqual(
    CHECKS.map((c: { code: string; id: string }) => `${c.code} ${c.id}`),
    ['G1 inline-language-branch', 'G2 hangul-literal', 'G3 english-prose-literal'],
  )
  for (const check of CHECKS as Array<{ roots: string[]; exclude: string[] }>) {
    assert.deepEqual(check.roots, ['app', 'components'])
    assert.ok(check.exclude.includes('app/global-error.tsx'))
  }
})

// The baseline is what lets a check with existing hits still gate a pull
// request: a file may keep what it had, never gain one.
test('the baseline fails a file that got worse and passes one that got better', () => {
  const baseline = { 'hangul-literal': { 'app/a.tsx': 2, 'app/b.tsx': 3 } }

  const equal = compareToBaseline({ 'hangul-literal': { 'app/a.tsx': 2, 'app/b.tsx': 3 } }, baseline)
  assert.equal(equal.ok, true)
  assert.deepEqual([equal.over, equal.under], [[], []])

  const over = compareToBaseline({ 'hangul-literal': { 'app/a.tsx': 3, 'app/b.tsx': 3 } }, baseline)
  assert.equal(over.ok, false)
  assert.deepEqual(over.over, [{ id: 'hangul-literal', file: 'app/a.tsx', current: 3, baseline: 2 }])

  // Fixed entirely: the file is gone from current, which is under, not an error.
  const under = compareToBaseline({ 'hangul-literal': { 'app/a.tsx': 2 } }, baseline)
  assert.equal(under.ok, true)
  assert.deepEqual(under.under, [{ id: 'hangul-literal', file: 'app/b.tsx', current: 0, baseline: 3 }])

  const absentFile = compareToBaseline({ 'hangul-literal': { 'app/a.tsx': 2, 'app/b.tsx': 3, 'app/c.tsx': 1 } }, baseline)
  assert.equal(absentFile.ok, false)
  assert.deepEqual(absentFile.over, [{ id: 'hangul-literal', file: 'app/c.tsx', current: 1, baseline: 0 }])

  const absentCheck = compareToBaseline({ 'english-prose-literal': { 'app/a.tsx': 1 } }, {})
  assert.equal(absentCheck.ok, false)
})
