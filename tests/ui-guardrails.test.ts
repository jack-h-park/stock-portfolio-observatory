import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import {
  CHECKS,
  compareToBaseline,
  findAccentProp,
  findBareFootnote,
  findBrowserLocaleNumber,
  findConflicts,
  findDateFormatWithoutLanguage,
  findDeadOpacity,
  findEnglishInKoreanCopy,
  findEnglishProseLiteral,
  findHandWrittenGrid,
  findHangulLiteral,
  findInlineLanguageBranch,
  findInlineSignTone,
  findMetricValueSize,
  findNullLiteral,
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

test('G4 catches grid columns written by hand, outside the layout primitives', () => {
  assert.deepEqual(snippets(findHandWrittenGrid('<div className="grid gap-4 lg:grid-cols-3">', 'app/a/page.tsx')), [
    '"grid gap-4 lg:grid-cols-3"',
  ])
  assert.equal(findHandWrittenGrid("const c = 'grid grid-cols-[7rem_1fr]'", 'app/a/page.tsx').length, 1)
  // Literals inside a template literal's interpolation are read too.
  assert.deepEqual(
    snippets(findHandWrittenGrid("<div className={`grid ${wide ? 'grid-cols-3' : 'grid-cols-2'}`}>", 'app/a/page.tsx')),
    ["'grid-cols-3'", "'grid-cols-2'"],
  )
  // The layout primitives are where columns belong.
  assert.deepEqual(findHandWrittenGrid("const COLUMNS = { 2: 'xl:grid-cols-2' }", 'components/layout.tsx'), [])
  // A marked exception, on the line or the line above.
  assert.deepEqual(findHandWrittenGrid('<div className="grid grid-cols-7"> {/* guardrail:allow grid */}', 'app/a/page.tsx'), [])
  assert.deepEqual(
    findHandWrittenGrid('// guardrail:allow grid: a calendar has seven days\n<div className="grid grid-cols-7">', 'app/a/page.tsx'),
    [],
  )
  // A grid without columns, and other grid utilities.
  assert.deepEqual(findHandWrittenGrid('<div className="grid gap-4 col-span-2 grid-rows-2">', 'app/a/page.tsx'), [])
})

test('G5 catches a gain/loss colour chosen by an inline ternary', () => {
  assert.equal(findInlineSignTone("const c = v >= 0 ? 'text-success' : 'text-danger'").length, 1)
  assert.equal(findInlineSignTone('const t = broken ? "danger" : "warning"').length, 1)
  assert.equal(findInlineSignTone("const t = ok ? 'success' : 'danger'").length, 1)
  // The shared helper, and a ternary between unrelated tones.
  assert.deepEqual(findInlineSignTone('const c = signTone(value)'), [])
  assert.deepEqual(findInlineSignTone("const t = open ? 'info' : 'neutral'"), [])
  assert.deepEqual(findInlineSignTone("// ok ? 'text-success' : 'text-danger'"), [])
})

test('G6 catches a missing value written by hand', () => {
  assert.deepEqual(snippets(findNullLiteral("const v = x ?? 'n/a'")), ["'n/a'"])
  assert.deepEqual(snippets(findNullLiteral('const v = x ?? "N/A"')), ['"N/A"'])
  assert.deepEqual(snippets(findNullLiteral("const v = x ?? '—'")), ["'—'"])
  // Inside a template literal's interpolation, also within a nested call.
  assert.deepEqual(snippets(findNullLiteral("<Metric sub={`Cap ${cap == null ? '—' : fmt(cap)}`} />")), ["'—'"])
  assert.deepEqual(snippets(findNullLiteral('const s = `Rate ${pick(rate, () => "n/a")} today`')), ['"n/a"'])
  // A longer string that contains one, and a formatter call.
  assert.deepEqual(findNullLiteral("const v = 'n/a for this account'"), [])
  assert.deepEqual(findNullLiteral("const v = '— since then'"), [])
  assert.deepEqual(findNullLiteral('const v = fmtNumber(x, language)'), [])
})

test('G7 catches a font size passed to a metric value', () => {
  assert.equal(findMetricValueSize('<Metric label={l} value={v} valueClassName="text-body" />').length, 1)
  assert.equal(findMetricValueSize("<Metric valueClassName={'text-hero'} />").length, 1)
  assert.equal(findMetricValueSize('<Metric valueClassName={` text-title`} />').length, 1)
  // A colour or weight that is not the first class, and no override.
  assert.deepEqual(findMetricValueSize('<Metric valueClassName="font-medium" />'), [])
  assert.deepEqual(findMetricValueSize('<Metric valueClassName={tone} />'), [])
})

test('G8 counts the accent prop, not an accent class', () => {
  const page = [
    '<Card title={copy.a} accent>',
    '<Card title={copy.b} accent={count > 0}>',
    '<Card',
    '  accent',
    '/>',
  ].join('\n')
  assert.deepEqual(
    (findAccentProp(page) as Hit[]).map((h) => h.line),
    [1, 2, 4],
  )
  assert.deepEqual(findAccentProp('<span className="text-accent-danger accent-info">'), [])
  assert.deepEqual(findAccentProp('<div className="border accent-danger">'), [])
  assert.deepEqual(findAccentProp('const accentTone = tone'), [])
})

test('G9 catches a date formatted without the page language', () => {
  assert.deepEqual(snippets(findDateFormatWithoutLanguage('<p>{fmtDateTime(meta.at)}</p>')), ['fmtDateTime(meta.at)'])
  assert.deepEqual(snippets(findDateFormatWithoutLanguage('const d = fmtDateTime(toIso(x))')), ['fmtDateTime(toIso(x))'])
  assert.equal(findDateFormatWithoutLanguage('const d = fmtDateShort(\n  plan.start,\n)').length, 1)
  // Two arguments, including when the first is itself a call with arguments.
  assert.deepEqual(findDateFormatWithoutLanguage('const d = fmtDateShort(plan.start, language)'), [])
  assert.deepEqual(findDateFormatWithoutLanguage('const d = fmtDateTime(row.at(0), language)'), [])
  assert.deepEqual(findDateFormatWithoutLanguage("const d = fmtDateTime(pick(a, 'b,c'), language)"), [])
  assert.deepEqual(findDateFormatWithoutLanguage('const d = fmtDateTime(\n  saved.at,\n  language,\n)'), [])
})

test('G10 catches a number or date formatted in the runtime locale', () => {
  assert.equal(findBrowserLocaleNumber('const s = value.toLocaleString()').length, 1)
  assert.equal(findBrowserLocaleNumber("const s = d.toLocaleDateString('en-US')").length, 1)
  assert.deepEqual(findBrowserLocaleNumber('const s = fmtNumber(value, language)'), [])
  assert.deepEqual(findBrowserLocaleNumber('// value.toLocaleString()'), [])
})

test('G11 catches a footnote written as a bare text-ink-3 paragraph', () => {
  assert.deepEqual(
    (findBareFootnote('<div>\n  <p className="mt-2 text-label text-ink-3">{copy.note}</p>\n</div>') as Hit[]).map((h) => h.line),
    [2],
  )
  // The className may sit on a later line of the tag.
  assert.equal(findBareFootnote('<p\n  key={k}\n  className="text-ink-3"\n>').length, 1)
  // Another element, another colour step, and a paragraph with no class.
  assert.deepEqual(findBareFootnote('<span className="text-label text-ink-3">x</span>'), [])
  assert.deepEqual(findBareFootnote('<p className="text-label text-ink-2">x</p>'), [])
  assert.deepEqual(findBareFootnote('<p className="text-ink-30">x</p>'), [])
  assert.deepEqual(findBareFootnote('<p>{copy.note}</p>'), [])
})

test('G12 catches an English word in the Korean half of a copy module', () => {
  const module = [
    'export const page = defineCopy({',
    '  en: {',
    "    note: 'Every lot is listed',",
    '  },',
    '  ko: {',
    "    note: '모든 lot을 표시합니다',",
    "    run: '먼저 pnpm refresh를 실행하세요',",
    "    plural: (n: number) => `${n}개 ${n === 1 ? 'ticker' : '종목'}`,",
    "    etf: 'ETF 비중',",
    '    held: (count: string) => `${count}개 보유 · ${fmtUsd(total, language)}`,',
    "    slot: '{count}개 보유',",
    "    form: 'Form 8938 대상',",
    '  },',
    '})',
  ].join('\n')
  const hits = findEnglishInKoreanCopy(module) as Hit[]
  // The English half (line 3) is not read; the planted words are.
  assert.deepEqual(
    hits.map((h) => [h.line, h.snippet.split(':')[0]]),
    [
      [6, 'lot'],
      [7, 'pnpm, refresh'],
      [8, 'ticker'],
    ],
  )
  // A file with no `ko:` section has nothing to read.
  assert.deepEqual(findEnglishInKoreanCopy("export const x = { label: 'Sort' }"), [])
})

test('G12 lets SSH and Tailscale stand in a Korean sentence', () => {
  const module = ['export const page = defineCopy({', '  ko: {', "    access: 'Tailscale에서 SSH 없이',", '  },', '})'].join('\n')
  assert.deepEqual(findEnglishInKoreanCopy(module), [])
})

test('G12 skips an object key in the Korean half but still reads the same words as a value', () => {
  const module = [
    'export const page = defineCopy({',
    '  ko: {',
    "    names: { 'Hana Bank': '하나은행' } as Record<string, string>,",
    "    fallback: 'Hana Bank',",
    "    pick: (on: boolean) => (on ? 'Hana Bank' : '하나은행'),",
    '  },',
    '})',
  ].join('\n')
  const hits = findEnglishInKoreanCopy(module) as Hit[]
  // The key on line 3 is a raw database value; lines 4 and 5 render the words.
  assert.deepEqual(
    hits.map((h) => [h.line, h.snippet.split(':')[0]]),
    [
      [4, 'Hana, Bank'],
      [5, 'Hana, Bank'],
    ],
  )
})

test('the counted checks are registered in order with their scopes', () => {
  type Check = { code: string; id: string; roots: string[]; exclude: string[]; include: RegExp | null }
  const checks = CHECKS as Check[]
  assert.deepEqual(
    checks.map((c) => `${c.code} ${c.id}`),
    [
      'G1 inline-language-branch',
      'G2 hangul-literal',
      'G3 english-prose-literal',
      'G4 hand-written-grid',
      'G5 inline-sign-tone',
      'G6 null-literal',
      'G7 metric-value-size',
      'G8 accent-per-page',
      'G9 date-format-without-language',
      'G10 browser-locale-number',
      'G11 bare-footnote',
      'G12 english-in-korean-copy',
    ],
  )
  const byCode = Object.fromEntries(checks.map((c) => [c.code, c]))
  for (const code of ['G1', 'G2', 'G3']) assert.ok(byCode[code].exclude.includes('app/global-error.tsx'))
  for (const code of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G9', 'G10']) {
    assert.deepEqual(byCode[code].roots, ['app', 'components'], code)
    assert.equal(byCode[code].include, null, code)
  }
  assert.deepEqual(byCode.G8.roots, ['app'])
  assert.ok(byCode.G8.include?.test('app/rebalance/settings/page.tsx'))
  assert.ok(!byCode.G8.include?.test('app/tax-planning/components.tsx'))
  assert.deepEqual(byCode.G11.roots, ['app'])
  assert.equal(byCode.G11.include, null)
  assert.deepEqual(byCode.G12.roots, ['lib/ui-copy'])
  assert.equal(byCode.G12.include, null)
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
