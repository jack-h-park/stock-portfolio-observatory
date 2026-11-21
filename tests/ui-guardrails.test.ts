import { strict as assert } from 'node:assert'
import fs from 'node:fs'
import { test } from 'node:test'

import {
  CHECKS,
  compareToBaseline,
  findAccentProp,
  findBareFootnote,
  findBrowserLocaleNumber,
  findConflicts,
  findDataLayerSentence,
  findDateFormatWithoutLanguage,
  findDeadOpacity,
  findEnglishInKoreanCopy,
  findEnglishProseLiteral,
  findFormPagePolls,
  findHandWrittenGrid,
  findHangulLiteral,
  findInlineLanguageBranch,
  findInlineSignTone,
  findNullLiteral,
  findRawEnumBadge,
  groupByRoute,
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
  // The shared helper, and a commented-out ternary.
  assert.deepEqual(findInlineSignTone('const c = signTone(value)'), [])
  assert.deepEqual(findInlineSignTone("// ok ? 'text-success' : 'text-danger'"), [])
})

// R2 shipped a status whose ternary had its two tones the wrong way round:
// any pair of tones can be flipped, not just success and danger.
test('G5 catches a ternary between any two tones, in either order', () => {
  assert.equal(findInlineSignTone("const t = x ? 'warning' : 'success'").length, 1)
  assert.equal(findInlineSignTone("const t = x ? 'info' : 'neutral'").length, 1)
  assert.equal(findInlineSignTone("const c = x ? 'text-neutral' : 'text-info'").length, 1)
  // A chained ternary is one hit per ternary whose branches are both tones.
  assert.equal(findInlineSignTone("const t = a ? 'danger' : b ? 'info' : 'neutral'").length, 2)
  const chained = "const t = a\n  ? 'danger'\n  : b\n    ? 'info'\n    : 'neutral'"
  assert.deepEqual(findInlineSignTone(chained).map((h) => h.line), [2, 4])
  // A ternary ending one statement is not chained to the next statement's.
  const twoStatements = "const a = x ? 'danger' : y\nconst b = z ? 'info' : 'neutral'"
  assert.deepEqual(findInlineSignTone(twoStatements).map((h) => h.line), [2])
  // Split over lines, as prettier writes a long one; reported at its first branch.
  const split = findInlineSignTone("const t = isOpen\n  ? 'warning'\n  : 'success'")
  assert.equal(split.length, 1)
  assert.equal(split[0].line, 2)
  // One branch is not a tone, or neither is.
  assert.deepEqual(findInlineSignTone("const c = x ? 'text-warning' : 'text-ink-3'"), [])
  assert.deepEqual(findInlineSignTone('const s = cond ? copy.a : copy.b'), [])
  assert.deepEqual(findInlineSignTone("const t = x ? 'danger' : fallbackTone"), [])
  // A bare tone passed to a function, and a map entry, are not ternaries.
  assert.deepEqual(findInlineSignTone("categoryTone(MAP, v, 'danger')"), [])
  assert.deepEqual(findInlineSignTone("const m = { 'info': 'neutral' }"), [])
})

// A tone hidden in a class string is still a tone ternary: the reviewer found
// four that the exact-literal pattern let through.
test('G5 catches a ternary between two class strings that each carry a tone class', () => {
  assert.equal(findInlineSignTone("const c = ok ? 'px-2 text-success' : 'px-2 text-warning'").length, 1)
  assert.equal(findInlineSignTone("const c = a ? 'bg-warning' : b ? 'bg-info' : 'bg-success'").length, 2)
  // Opacity, a variant prefix, a backtick without interpolation, a border class.
  assert.equal(findInlineSignTone("const c = p ? 'h-1 bg-info motion-safe:animate-pulse' : 'bg-success/70'").length, 1)
  assert.equal(findInlineSignTone('const c = p ? `border-danger` : `hover:border-info`').length, 1)
  // A mixed pair: a bare tone against a tone class.
  assert.equal(findInlineSignTone("const c = p ? 'success' : 'text-danger'").length, 1)
  // One branch has no tone class, the token is not a whole class, or a branch interpolates.
  assert.deepEqual(findInlineSignTone("const c = x ? 'text-success font-medium' : 'text-ink-3'"), [])
  assert.deepEqual(findInlineSignTone("const c = x ? 'text-success-strong' : 'text-danger-strong'"), [])
  assert.deepEqual(findInlineSignTone("const c = x ? 'ring-success' : 'ring-danger'"), [])
  assert.deepEqual(findInlineSignTone('const c = x ? `text-${a}` : `text-danger`'), [])
  assert.deepEqual(findInlineSignTone("const c = x ? 'text-ink' : 'text-ink-3'"), [])
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

test('G8 reports an accent bound to an expression', () => {
  assert.deepEqual(
    (findAccentProp('<Card title={copy.b} accent={n > 0}>') as Hit[]).map((h) => h.line),
    [1],
  )
})

test('G8 reports every bare accent after the first in one page', () => {
  const page = [
    '<Card title={copy.a} accent>',
    '<Card title={copy.b} accent={count > 0}>',
    '<Card',
    '  accent',
    '/>',
  ].join('\n')
  assert.deepEqual(
    (findAccentProp(page) as Hit[]).map((h) => h.line),
    [2, 4],
  )
})

test('G8 leaves a single bare accent and accent classes alone', () => {
  assert.deepEqual(findAccentProp('<Card title={copy.a} accent>'), [])
  assert.deepEqual(findAccentProp('<Card\n  title={copy.a}\n  accent\n>'), [])
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

test('G11 scans components/ but skips components/metric.tsx, which owns Note', () => {
  type Check = { id: string; roots: string[]; exclude: string[]; find: (source: string, file: string) => Hit[] }
  const g11 = (CHECKS as Check[]).find((c) => c.id === 'bare-footnote')!
  const planted = '<p className="text-label text-ink-3">x</p>'
  // The runner's own filter: a file under one of the roots, not in exclude.
  const scan = (file: string) =>
    g11.roots.some((root) => file.startsWith(`${root}/`)) && !g11.exclude.includes(file) ? g11.find(planted, file) : []
  assert.deepEqual(scan('components/Planted.tsx').map((h) => h.file), ['components/Planted.tsx'])
  assert.deepEqual(scan('app/planted/page.tsx').map((h) => h.file), ['app/planted/page.tsx'])
  assert.deepEqual(scan('components/metric.tsx'), [])
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

test('G12 reads an unspaced ternary branch but still skips an object key', () => {
  const module = [
    'export const page = defineCopy({',
    '  ko: {',
    "    pick: (on: boolean) => (on?'Hana Bank':'x'),",
    "    'Hana Bank': '하나은행',",
    "    list: { a: '하나', 'Hana Bank': '하나은행' },",
    '  },',
    '})',
  ].join('\n')
  const hits = findEnglishInKoreanCopy(module) as Hit[]
  // Line 3 is a branch the reader sees; lines 4 and 5 are keys after `{`, `,` or a line start.
  assert.deepEqual(
    hits.map((h) => [h.line, h.snippet.split(':')[0]]),
    [[3, 'Hana, Bank']],
  )
})

test('G12 skips path-shaped tokens and lets MCP, XLSX and SHA stand, but still reads a plain English word', () => {
  const module = [
    'export const page = defineCopy({',
    '  ko: {',
    "    drop: '받은 자료를 us-transactions/에 넣으세요',",
    "    route: '/lots',",
    "    snapshot: 'MCP 스냅샷',",
    "    formats: 'PDF + XLSX',",
    "    inbox: 'inbox에 넣으세요',",
    "    hash: 'SHA-256과 일치합니다',",
    '  },',
    '})',
  ].join('\n')
  const hits = findEnglishInKoreanCopy(module) as Hit[]
  assert.deepEqual(
    hits.map((h) => [h.line, h.snippet.split(':')[0]]),
    [[7, 'inbox']],
  )
})

/** A copy module whose Korean half holds the given property lines, starting on line 3. */
const koModule = (...lines: string[]) =>
  ['export const page = defineCopy({', '  ko: {', ...lines.map((l) => `    ${l}`), '  },', '})'].join('\n')

const g12Lines = (module: string) => (findEnglishInKoreanCopy(module) as Hit[]).map((h) => [h.line, h.snippet.split(':')[0]])

test('G12 skips a className value but still reads the same string as copy', () => {
  const module = koModule(
    'hint: (p: string) => <><code className="font-mono text-caption">{p}</code>를 확인하세요.</>,',
    "style: 'font-mono text-caption',",
  )
  assert.deepEqual(g12Lines(module), [[4, 'font, mono, text, caption']])
})

test('G12 skips a comparison operand but still reads the same word as a value', () => {
  const module = koModule(
    "note: (method: string) => (method === 'contributions' ? '납입액 기준' : '평가금액 기준'),",
    "other: (method: string) => (method !== 'contributions' ? '평가금액 기준' : '납입액 기준'),",
    "method: 'contributions',",
  )
  assert.deepEqual(g12Lines(module), [[5, 'contributions']])
})

test('G12 skips a backticked inline code span but still reads the same command bare', () => {
  const module = koModule("pull: '최신본은 `make pull-prod-db`로 복사합니다.',", "bare: '최신본은 make pull로 복사합니다.',")
  assert.deepEqual(g12Lines(module), [[4, 'make, pull']])
})

test('G12 skips identifier tokens but still reads a hyphenated word and a word before a period', () => {
  const module = koModule(
    "rule: 'manual-mappings.json의 bankInflowRules에 규칙을 추가합니다.',",
    "format: '형식: market:ticker@brokerage::account',",
    "wrapper: '세금 정책의 wrapperTreatment.US에서 정합니다.',",
    "wash: 'wash-sale 검토',",
    "end: 'snapshot.',",
    "glued: 'ingest·freshness_check',",
    "paren: 'override(manual_override)를 확인합니다.',",
  )
  assert.deepEqual(g12Lines(module), [
    [6, 'wash, sale'],
    [7, 'snapshot'],
    [8, 'ingest'],
    [9, 'override'],
  ])
})

test('G12 skips a form number but still reads an English word beside it', () => {
  const module = koModule(
    "da: '이 앱은 1099-DA를 읽지 않습니다.',",
    "es: '1040-ES 예정 납부',",
    "draft: '1099-DA draft 양식',",
    "word: 'DA 양식',",
  )
  assert.deepEqual(g12Lines(module), [
    [5, 'draft'],
    [6, 'DA'],
  ])
})

test('G12 skips an unspaced name=value pair but still reads a spaced one and a word beside it', () => {
  const module = koModule(
    "pair: '수집품(collectible=true)으로 포함합니다.',",
    "row: 'collectible=true 표시 row',",
    "spaced: 'collectible = true 표시',",
  )
  assert.deepEqual(g12Lines(module), [
    [4, 'row'],
    [5, 'collectible, true'],
  ])
})

test('G12 lets the allow-listed acronyms, codes and names stand, but still reads snapshot', () => {
  const module = koModule(
    "niit: 'NIIT 세율',",
    "gold: 'KRX 금현물',",
    "esc: 'Esc 키',",
    "date: 'YYYY-MM-DD 형식',",
    "cite: 'IRS Rev. Proc. 2025-32 요약',",
    "merrill: 'Merrill은 두 가지 형식으로 내보냅니다.',",
    "tsv: '정규화된 거래 TSV',",
    "git: 'git에 올라가지 않음',",
    "basis: 'snapshot 기준',",
  )
  assert.deepEqual(g12Lines(module), [[11, 'snapshot']])
})

test('G13 catches an enum value rendered raw in a Badge', () => {
  assert.deepEqual(
    (findRawEnumBadge('<Badge tone="info">{y.filingScenario}</Badge>') as Hit[]).map((h) => h.line),
    [1],
  )
  // A tag wrapped over lines, a child on its own line, optional chaining and an index.
  assert.deepEqual(
    (findRawEnumBadge('<div>\n  <Badge\n    tone={t}\n  >\n    {row?.status}\n  </Badge>\n</div>') as Hit[]).map((h) => h.line),
    [2],
  )
  assert.equal(findRawEnumBadge('<Badge tone={statusTone(S, p.status)}>{p.status}</Badge>').length, 1)
  assert.equal(findRawEnumBadge('<Badge>{rows[0].action}</Badge>').length, 1)
  // An alias of a data row is not copy.
  assert.equal(findRawEnumBadge('const ac = row.allocation\n<Badge>{ac.status}</Badge>').length, 1)
})

test('G13 leaves copy lookups, market codes, calls and literals alone', () => {
  assert.deepEqual(findRawEnumBadge('<Badge>{copy.filing[y.filingScenario]}</Badge>'), [])
  assert.deepEqual(findRawEnumBadge('<Badge>{copy.filing[y.filingScenario] ?? y.filingScenario}</Badge>'), [])
  assert.deepEqual(findRawEnumBadge('<Badge>{fbarCopy.understated}</Badge>'), [])
  assert.deepEqual(findRawEnumBadge('<Badge>{priorityLabels[r.priority]}</Badge>'), [])
  assert.deepEqual(findRawEnumBadge('<Badge>{r.market}</Badge>'), [])
  assert.deepEqual(findRawEnumBadge('<Badge tone={marketTone(row.market)}>{row.market}</Badge>'), [])
  assert.deepEqual(findRawEnumBadge('<Badge>{fmtNumber(n)}</Badge>'), [])
  assert.deepEqual(findRawEnumBadge('<Badge>{market}</Badge>'), [])
  assert.deepEqual(findRawEnumBadge('<Badge tone="neutral">2%</Badge>'), [])
  assert.deepEqual(findRawEnumBadge('<Badge>{a.status}{b.status}</Badge>'), [])
  // A ticker is an identifier and a `.label` already holds display text: neither is an enum.
  assert.deepEqual(findRawEnumBadge('<Badge tone="neutral">{h.ticker}</Badge>'), [])
  assert.deepEqual(findRawEnumBadge('<Badge tone="success">{plan.label}</Badge>'), [])
  // A local alias of a slice of copy is still copy.
  assert.deepEqual(findRawEnumBadge('const ac = copy.allocation\n<Badge>{ac.statuses[r.status]}</Badge>'), [])
  assert.deepEqual(findRawEnumBadge("const pc = getPageCopy('x', l)\nconst st = pc.statuses\n<Badge>{st.open}</Badge>"), [])
  // In a comment, nothing to report.
  assert.deepEqual(findRawEnumBadge('// <Badge>{y.filingScenario}</Badge>'), [])
})

type RouteFile = { file: string; source: string }
const route = (files: Record<string, string>): RouteFile[] =>
  Object.entries(files).map(([file, source]) => ({ file, source }))

const POLLING_FORM_PAGE = [
  "import { SubmitButton } from '@/components/SubmitButton'",
  'export default function Page() {',
  '  return (',
  '    <>',
  '      <PageHeader title={copy.title} />',
  '      <form action={save}>',
  '        <SubmitButton>{copy.save}</SubmitButton>',
  '      </form>',
  '    </>',
  '  )',
  '}',
].join('\n')

test('G14 catches a route with a submit button whose header still refreshes', () => {
  const hits = findFormPagePolls(route({ 'app/planted/page.tsx': POLLING_FORM_PAGE })) as Hit[]
  assert.equal(hits.length, 1)
  assert.equal(hits[0].file, 'app/planted/page.tsx')
  // Reported where the fix goes: the PageHeader line.
  assert.equal(hits[0].line, 5)

  // ConfirmSubmitButton counts too.
  const confirm = POLLING_FORM_PAGE.replace(/SubmitButton/g, 'ConfirmSubmitButton')
  assert.equal(findFormPagePolls(route({ 'app/planted/page.tsx': confirm })).length, 1)
})

test('G14 reads the route folder as one unit', () => {
  // The submit button lives in a sibling file; the page only renders the header.
  const split = route({
    'app/planted/page.tsx': 'export default function Page() {\n  return <PageHeader title={copy.title} />\n}',
    'app/planted/components.tsx': '<form action={save}>\n  <SubmitButton>{copy.save}</SubmitButton>\n</form>',
  })
  const hits = findFormPagePolls(split) as Hit[]
  assert.deepEqual(hits.map((h) => [h.file, h.line]), [['app/planted/page.tsx', 2]])

  // And autoRefresh={false} in a sibling view file clears it.
  const offInView = route({
    'app/planted/page.tsx': 'export default function Page() {\n  return <View />\n}',
    'app/planted/view.tsx': '<PageHeader\n  title={copy.title}\n  autoRefresh={false}\n/>\n<SubmitButton>{copy.save}</SubmitButton>',
  })
  assert.deepEqual(findFormPagePolls(offInView), [])
})

test('G14 leaves a form page that turned the refresh off, and a GET filter form', () => {
  const off = POLLING_FORM_PAGE.replace('<PageHeader title={copy.title} />', '<PageHeader title={copy.title} autoRefresh={false} />')
  assert.deepEqual(findFormPagePolls(route({ 'app/planted/page.tsx': off })), [])

  const getFilter = [
    'export default function Page() {',
    '  return (',
    '    <>',
    '      <PageHeader title={copy.title} />',
    '      <form method="get">',
    '        <button type="submit">{copy.apply}</button>',
    '      </form>',
    '    </>',
    '  )',
    '}',
  ].join('\n')
  assert.deepEqual(findFormPagePolls(route({ 'app/planted/page.tsx': getFilter })), [])

  // An import or a comment is not a rendered button.
  const importOnly = "import { SubmitButton } from '@/components/SubmitButton'\n// <SubmitButton>x</SubmitButton>\n<PageHeader title={copy.title} />"
  assert.deepEqual(findFormPagePolls(route({ 'app/planted/page.tsx': importOnly })), [])
})

test('G14 groups files by their own folder, so a nested route is its own unit', () => {
  const groups = groupByRoute([
    'app/tax-planning/page.tsx',
    'app/tax-planning/components.tsx',
    'app/tax-planning/plans/[id]/page.tsx',
    'app/page.tsx',
    'app/layout.tsx',
  ]) as Map<string, string[]>
  assert.deepEqual(
    [...groups.entries()],
    [
      ['app', ['app/layout.tsx', 'app/page.tsx']],
      ['app/tax-planning', ['app/tax-planning/components.tsx', 'app/tax-planning/page.tsx']],
      ['app/tax-planning/plans/[id]', ['app/tax-planning/plans/[id]/page.tsx']],
    ],
  )

  // A parent's refresh switch does not cover the nested route, nor the reverse.
  const parentOff = route({ 'app/planted/page.tsx': '<PageHeader title={copy.title} autoRefresh={false} />' })
  const child = route({ 'app/planted/child/page.tsx': POLLING_FORM_PAGE })
  assert.deepEqual(findFormPagePolls(parentOff), [])
  assert.equal(findFormPagePolls(child).length, 1)
})

test('G15 catches a Korean sentence stored as a property value in the data layer', () => {
  const source = [
    'export function retention(kind: string) {',
    "  return { kind, retentionReason: '세금 신고에 쓰는 원본입니다.' }",
    '}',
    'const row = {',
    '  action: "자료를 다시 내려받으세요",',
    '  hint: `${n}개 계좌를 확인하십시오!`,',
    "  question: '계속하시겠습니까?',",
    "  'quoted-key': '원본입니다 그대로',",
    '}',
  ].join('\n')
  const hits = findDataLayerSentence(source, 'lib/planted.ts') as Hit[]
  assert.deepEqual(
    hits.map((h) => h.line),
    [2, 5, 6, 7, 8],
  )
  assert.equal(hits[0].file, 'lib/planted.ts')
  assert.ok(hits[0].snippet.includes('원본입니다.'))
  // The value may sit on the line after its key, as a formatter wraps it.
  assert.deepEqual(
    (findDataLayerSentence("const r = {\n  retentionReason:\n    '세금 신고에 쓰는 원본입니다.',\n}") as Hit[]).map((h) => h.line),
    [3],
  )
})

test('G15 catches a prose literal pushed onto a warnings or notes array', () => {
  const source = [
    'const warnings: string[] = []',
    "warnings.push('KR domestic stock taxable scope is off for this year')",
    'lotWarnings.push(`Lot ${id} has no acquisition date on file`)',
    "notes.push('원가 정보 없음')",
    'this.Notes.push(`${count}건 확인 필요`)',
    'warnings.push(',
    "  'A wrapped sentence still counts as prose here',",
    ')',
  ].join('\n')
  assert.deepEqual(
    (findDataLayerSentence(source) as Hit[]).map((h) => h.line),
    [2, 3, 4, 5, 7],
  )
})

test('G15 leaves data the code matches and text that is not a sentence alone', () => {
  const quiet = [
    // A Korean noun phrase as a property value.
    "const a = { status: '추가 자료 필요 없음', unit: '만' }",
    // A Korean sentence as an argument, a comparison operand, an array element, an assignment.
    "send('알림을 보냈습니다.')",
    "if (memo === '입금되었습니다') skip()",
    "const markers = ['처리되었습니다', '완료되었습니다.']",
    "message = '다시 시도하세요.'",
    "const reply = '확인하십시오'",
    // A ternary branch inside an object value is not the value's key.
    "const b = { text: ok ? '가' : '정상입니다' }",
    // A pushed object, and a pushed English literal of two words or a code.
    "warnings.push({ code: 'scope_off', message: 'Scope is off for this year' })",
    "warnings.push('scope off')",
    "notes.push('KR_DOMESTIC_SCOPE')",
    'notes.push(`${a} ${b} ${c}`)',
    // Another array name.
    "rows.push('A whole English sentence about something')",
    // An English sentence as a property value is out of scope.
    "const c = { reason: 'The file was skipped because it is empty.' }",
  ].join('\n')
  assert.deepEqual(findDataLayerSentence(quiet), [])
})

test('G15 skips a line marked guardrail:allow data-text, and a sentence in a comment', () => {
  assert.deepEqual(
    findDataLayerSentence("const a = { body: '알림을 보냈습니다.' } // guardrail:allow data-text: leaves the machine"),
    [],
  )
  assert.deepEqual(
    findDataLayerSentence("// guardrail:allow data-text: a reminder body\nwarnings.push('This reminder text leaves the machine')"),
    [],
  )
  // The marker covers its own line and the next one, no further.
  assert.deepEqual(
    (findDataLayerSentence("// guardrail:allow data-text\nconst x = 1\nconst a = { body: '알림을 보냈습니다.' }") as Hit[]).map((h) => h.line),
    [3],
  )
  const comments = [
    "// retentionReason: '세금 신고에 쓰는 원본입니다.'",
    "const a = 1 /* warnings.push('KR domestic stock taxable scope is off') */",
    '/**',
    ' * notes.push(`원가 정보를 확인하세요`)',
    ' */',
  ].join('\n')
  assert.deepEqual(findDataLayerSentence(comments), [])
})

// The two leaks this check exists for lived in these files; pin their zero.
test('G15 finds nothing in the files where the original leaks lived', () => {
  for (const file of ['lib/adapters/portfolio-db.ts', 'lib/tax-planning.ts']) {
    assert.deepEqual(findDataLayerSentence(fs.readFileSync(file, 'utf8'), file), [], file)
  }
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
      'G8 accent-per-page',
      'G9 date-format-without-language',
      'G10 browser-locale-number',
      'G11 bare-footnote',
      'G12 english-in-korean-copy',
      'G13 raw-enum-badge',
      'G14 form-page-polls',
      'G15 data-layer-sentence',
    ],
  )
  const byCode = Object.fromEntries(checks.map((c) => [c.code, c]))
  for (const code of ['G1', 'G2', 'G3']) assert.ok(byCode[code].exclude.includes('app/global-error.tsx'))
  for (const code of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G9', 'G10', 'G13']) {
    assert.deepEqual(byCode[code].roots, ['app', 'components'], code)
    assert.equal(byCode[code].include, null, code)
  }
  assert.deepEqual(byCode.G8.roots, ['app'])
  assert.equal((byCode.G8 as Check & { title: string }).title, 'accent bar used as a status, or more than once on a page')
  assert.ok(byCode.G8.include?.test('app/rebalance/settings/page.tsx'))
  assert.ok(!byCode.G8.include?.test('app/tax-planning/components.tsx'))
  assert.deepEqual(byCode.G11.roots, ['app', 'components'])
  assert.deepEqual(byCode.G11.exclude, ['components/metric.tsx'])
  assert.equal(byCode.G11.include, null)
  assert.deepEqual(byCode.G12.roots, ['lib/ui-copy'])
  assert.equal(byCode.G12.include, null)
  assert.deepEqual(byCode.G14.roots, ['app'])
  assert.equal((byCode.G14 as Check & { group?: string }).group, 'route')
  assert.deepEqual(byCode.G15.roots, ['lib'])
  assert.deepEqual(byCode.G15.exclude, [])
  assert.equal(
    (byCode.G15 as Check & { title: string }).title,
    'sentence written in the data layer instead of a copy module',
  )
  for (const read of ['lib/tax-planning.ts', 'lib/adapters/portfolio-db.ts', 'lib/rebalance/engine.ts', 'lib/ui-copyist.ts']) {
    assert.ok(byCode.G15.include?.test(read), read)
  }
  for (const skipped of [
    'lib/ui-copy/common.ts',
    'lib/ui-copy/pages/review.ts',
    'lib/glossary.ts',
    'lib/cli/commands.ts',
    'lib/rebalance/notify.ts',
    'lib/rebalance/proposal-view.ts',
  ]) {
    assert.ok(!byCode.G15.include?.test(skipped), skipped)
  }
  for (const code of Object.keys(byCode).filter((c) => c !== 'G14')) {
    assert.equal((byCode[code] as Check & { group?: string }).group, undefined, code)
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
