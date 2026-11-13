import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { MiniStat, MiniStatGrid, Stat, StatStrip, Total, TotalsStrip } from '@/components/layout'
import { Callout, HeroAside, MetricField, Note, Panel, SectionHeading } from '@/components/ui'
import { LinkChip, LinkChips } from '@/components/LinkChips'
import { Tabs } from '@/components/Tabs'

// tsx compiles the component's JSX with the classic runtime, which reads a
// global React; Next supplies it in the app, so the test does here.
;(globalThis as { React?: typeof React }).React = React

const h = React.createElement

/** The class attribute of the element whose text is exactly `text`. */
function classOfText(html: string, text: string): string | undefined {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = html.match(new RegExp(`<div class="([^"]*)">${escaped}</div>`))
  return match?.[1]
}

const BASE = 'mt-1 font-medium leading-tight tabular-nums'

test('MetricField value defaults to the title size and neutral ink', () => {
  const html = renderToStaticMarkup(h(MetricField, { label: 'L', value: 'V' }))
  assert.equal(classOfText(html, 'V'), `${BASE} text-title text-ink`)
})

test('MetricField size="metric" emits text-metric', () => {
  const html = renderToStaticMarkup(h(MetricField, { label: 'L', value: 'V', size: 'metric' }))
  assert.equal(classOfText(html, 'V'), `${BASE} text-metric text-ink`)
})

test('MetricField size="caption" emits text-caption', () => {
  const html = renderToStaticMarkup(h(MetricField, { label: 'L', value: 'V', size: 'caption' }))
  assert.equal(classOfText(html, 'V'), `${BASE} text-caption text-ink`)
})

test('MetricField truncate adds truncate before the tone class', () => {
  const html = renderToStaticMarkup(h(MetricField, { label: 'L', value: 'V', truncate: true }))
  assert.equal(classOfText(html, 'V'), `${BASE} text-title truncate text-ink`)
})

test('MetricField tone="success" ends in text-success', () => {
  const html = renderToStaticMarkup(h(MetricField, { label: 'L', value: 'V', tone: 'success' }))
  assert.equal(classOfText(html, 'V'), `${BASE} text-title text-success`)
})

test('HeroAside joins two children with one divider and ends with the note', () => {
  const html = renderToStaticMarkup(
    h(HeroAside, {
      title: 'T',
      note: 'N',
      children: [
        h(MetricField, { key: 'a', label: 'A', value: 'VA', size: 'metric' }),
        h(MetricField, { key: 'b', label: 'B', value: 'VB' }),
      ],
    })
  )
  const outer = '<div class="flex min-h-[16rem] flex-col justify-between gap-4"><div class="space-y-4">'
  assert.ok(html.includes(outer), html)
  const dividers = html.match(/<div class="h-px bg-line-subtle"><\/div>/g) ?? []
  assert.equal(dividers.length, 1)
  const a = html.indexOf('>VA<')
  const divider = html.indexOf('<div class="h-px bg-line-subtle">')
  const b = html.indexOf('>VB<')
  assert.ok(a < divider && divider < b, 'divider sits between the two children')
  assert.ok(
    html.includes(
      '</div><div class="rounded-md bg-surface px-3 py-2 text-label leading-relaxed text-ink-3">N</div></div>'
    ),
    html
  )
})

/** The class attribute of the outermost element. */
function outerClass(html: string): string | undefined {
  return html.match(/^<[a-z]+ class="([^"]*)"/)?.[1]
}

const STAT_STRIP = 'grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line-subtle bg-line-subtle'

test('StatStrip columns="md-4" adds md:grid-cols-4', () => {
  const html = renderToStaticMarkup(h(StatStrip, { columns: 'md-4' , children: 'x' }))
  assert.equal(outerClass(html), `${STAT_STRIP} md:grid-cols-4`)
})

test('StatStrip columns="lg-4" adds lg:grid-cols-4', () => {
  const html = renderToStaticMarkup(h(StatStrip, { columns: 'lg-4' , children: 'x' }))
  assert.equal(outerClass(html), `${STAT_STRIP} lg:grid-cols-4`)
})

test('StatStrip columns="sm-5" adds sm:grid-cols-5', () => {
  const html = renderToStaticMarkup(h(StatStrip, { columns: 'sm-5' , children: 'x' }))
  assert.equal(outerClass(html), `${STAT_STRIP} sm:grid-cols-5`)
})

const MICRO_LABEL = 'font-medium uppercase text-ink-3 text-micro tracking-[0.08em]'

test('Stat defaults to py-3, the title size and neutral ink, with no sub', () => {
  const html = renderToStaticMarkup(h(Stat, { label: 'L', value: 'V' }))
  assert.equal(
    html,
    `<div class="bg-card px-3 py-3"><div class="${MICRO_LABEL}">L</div><div class="mt-1 font-medium tabular-nums text-title text-ink">V</div></div>`
  )
})

test('Stat sub renders the small line under the value', () => {
  const html = renderToStaticMarkup(h(Stat, { label: 'L', value: 'V', sub: 'S' }))
  assert.equal(classOfText(html, 'S'), 'mt-0.5 text-label tabular-nums text-ink-3')
})

test('Stat tone="warning" ends the value in text-warning', () => {
  const html = renderToStaticMarkup(h(Stat, { label: 'L', value: 'V', tone: 'warning' }))
  assert.equal(classOfText(html, 'V'), 'mt-1 font-medium tabular-nums text-title text-warning')
})

test('Stat dense size="body-lg" uses py-2.5 and text-body-lg', () => {
  const html = renderToStaticMarkup(h(Stat, { label: 'L', value: 'V', dense: true, size: 'body-lg', tone: 'success' }))
  assert.equal(outerClass(html), 'bg-card px-3 py-2.5')
  assert.equal(classOfText(html, 'V'), 'mt-1 font-medium tabular-nums text-body-lg text-success')
})

test('MiniStatGrid columns={3} spacing="mt-3"', () => {
  const html = renderToStaticMarkup(h(MiniStatGrid, { columns: 3, spacing: 'mt-3' , children: 'x' }))
  assert.equal(outerClass(html), 'mt-3 grid gap-3 text-caption grid-cols-3')
})

test('MiniStatGrid columns={2}', () => {
  const html = renderToStaticMarkup(h(MiniStatGrid, { columns: 2 , children: 'x' }))
  assert.equal(outerClass(html), 'grid gap-3 text-caption grid-cols-2')
})

test('MiniStatGrid columns="sm-4"', () => {
  const html = renderToStaticMarkup(h(MiniStatGrid, { columns: 'sm-4' , children: 'x' }))
  assert.equal(outerClass(html), 'grid gap-3 text-caption sm:grid-cols-4')
})

test('MiniStat is a bare div with a caption label and an unsized value', () => {
  const html = renderToStaticMarkup(h(MiniStat, { label: 'L', value: 'V', tone: 'danger' }))
  assert.equal(
    html,
    '<div><div class="text-caption text-ink-3">L</div><div class="font-medium tabular-nums text-danger">V</div></div>'
  )
})

test('MiniStat defaults to neutral ink', () => {
  const html = renderToStaticMarkup(h(MiniStat, { label: 'L', value: 'V' }))
  assert.equal(classOfText(html, 'V'), 'font-medium tabular-nums text-ink')
})

const TOTALS = 'grid gap-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-caption'

test('TotalsStrip columns={3}', () => {
  const html = renderToStaticMarkup(h(TotalsStrip, { columns: 3 , children: 'x' }))
  assert.equal(outerClass(html), `${TOTALS} sm:grid-cols-3`)
})

test('TotalsStrip columns={4}', () => {
  const html = renderToStaticMarkup(h(TotalsStrip, { columns: 4 , children: 'x' }))
  assert.equal(outerClass(html), `${TOTALS} sm:grid-cols-4`)
})

test('TotalsStrip columns={5}', () => {
  const html = renderToStaticMarkup(h(TotalsStrip, { columns: 5 , children: 'x' }))
  assert.equal(outerClass(html), `${TOTALS} sm:grid-cols-5`)
})

test('Total is a bare div with the default Label and a neutral value', () => {
  const html = renderToStaticMarkup(h(Total, { label: 'L', value: 'V' }))
  assert.equal(
    html,
    '<div><div class="font-medium uppercase text-ink-3 text-label tracking-[0.08em]">L</div><div class="font-medium tabular-nums text-ink">V</div></div>'
  )
})

test('Total tone="danger" ends the value in text-danger', () => {
  const html = renderToStaticMarkup(h(Total, { label: 'L', value: 'V', tone: 'danger' }))
  assert.equal(classOfText(html, 'V'), 'font-medium tabular-nums text-danger')
})

// --- LinkChip / LinkChips / Tabs ---

/** The opening tag of the first <a> in the markup. */
function anchorTag(html: string): string {
  return html.match(/<a [^>]*>/)?.[0] ?? ''
}
function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
}

const CHIP_INFO = 'rounded-sm border px-2 py-1 text-label font-medium'
const CHIP_SUBTLE = 'rounded-sm border px-2 py-1 text-label'
const CHIP_INK = 'inline-flex min-h-8 items-center rounded-sm border px-2.5 text-label font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-info/40'

const chipCases: [string, 'info' | 'subtle' | 'ink' | undefined, boolean, string][] = [
  ['info (default) active', undefined, true, `${CHIP_INFO} border-info bg-info/10 text-info`],
  ['info inactive', 'info', false, `${CHIP_INFO} border-line text-ink-3 hover:border-info hover:text-info`],
  ['subtle active', 'subtle', true, `${CHIP_SUBTLE} border-line bg-surface font-medium text-ink`],
  ['subtle inactive', 'subtle', false, `${CHIP_SUBTLE} border-transparent text-ink-3 hover:border-line hover:text-ink`],
  ['ink active', 'ink', true, `${CHIP_INK} border-ink bg-ink text-card`],
  ['ink inactive', 'ink', false, `${CHIP_INK} border-line bg-card text-ink-2 hover:border-ink-3 hover:bg-surface hover:text-ink`],
]
for (const [name, variant, active, expected] of chipCases) {
  test(`LinkChip ${name}`, () => {
    const html = renderToStaticMarkup(h(LinkChip, { href: '/x', active, ...(variant ? { variant } : {}), children: 'C' }))
    assert.equal(attr(anchorTag(html), 'class'), expected)
  })
}

test('LinkChip current defaults to "true": aria-current only when active', () => {
  const on = anchorTag(renderToStaticMarkup(h(LinkChip, { href: '/x', active: true, children: 'C' })))
  const off = anchorTag(renderToStaticMarkup(h(LinkChip, { href: '/x', active: false, children: 'C' })))
  assert.equal(attr(on, 'aria-current'), 'true')
  assert.equal(attr(off, 'aria-current'), undefined)
})

test('LinkChip current="page" emits aria-current="page" when active', () => {
  const on = anchorTag(renderToStaticMarkup(h(LinkChip, { href: '/x', active: true, current: 'page', children: 'C' })))
  const off = anchorTag(renderToStaticMarkup(h(LinkChip, { href: '/x', active: false, current: 'page', children: 'C' })))
  assert.equal(attr(on, 'aria-current'), 'page')
  assert.equal(attr(off, 'aria-current'), undefined)
})

test('LinkChip current="none" emits no aria-current and no aria-pressed, and forwards aria-label and title', () => {
  const tag = anchorTag(renderToStaticMarkup(h(LinkChip, { href: '/x', active: true, current: 'none', title: 'T', 'aria-label': 'A', children: 'C' })))
  assert.equal(attr(tag, 'aria-current'), undefined)
  assert.equal(attr(tag, 'aria-pressed'), undefined)
  assert.equal(attr(tag, 'aria-label'), 'A')
  assert.equal(attr(tag, 'title'), 'T')
  assert.equal(attr(tag, 'href'), '/x')
})

const ITEMS = [
  { key: 'a', href: '/?k=a', label: 'A' },
  { key: 'b', href: '/?k=b', label: 'B', title: 'Bee' },
] as const

test('LinkChips as="fragment" (default) renders bare chips, keyed by the caller', () => {
  const html = renderToStaticMarkup(h(LinkChips, { items: [...ITEMS], current: 'b' }))
  assert.ok(html.startsWith('<a '))
  assert.equal((html.match(/<a /g) ?? []).length, 2)
  assert.ok(html.includes('aria-current="true"'))
  assert.ok(html.includes('title="Bee"'))
})

test('LinkChips as="nav" wraps in a labelled nav', () => {
  const html = renderToStaticMarkup(h(LinkChips, { items: [...ITEMS], current: 'a', as: 'nav', label: 'Years' }))
  assert.ok(html.startsWith('<nav aria-label="Years" class="flex flex-wrap items-center justify-end gap-1">'), html)
})

test('LinkChips as="group" wraps in a labelled role=group div', () => {
  const html = renderToStaticMarkup(h(LinkChips, { items: [...ITEMS], current: 'a', as: 'group', label: 'G' }))
  assert.ok(html.startsWith('<div role="group" aria-label="G" class="flex flex-wrap items-center justify-end gap-1">'), html)
})

const TAB_BASE = '-mb-px inline-flex min-h-8 items-center border-b-2 px-3 text-caption font-medium'

test('Tabs nav and items', () => {
  const html = renderToStaticMarkup(h(Tabs, { label: 'P', items: [{ key: 's', href: '/p?tab=s', label: 'S' }, { key: 't', href: '/p?tab=t', label: 'T' }], current: 's' }))
  assert.ok(html.startsWith('<nav aria-label="P" class="mb-5 flex flex-wrap gap-1 border-b border-line-subtle">'), html)
  const tags = html.match(/<a [^>]*>/g) ?? []
  assert.equal(tags.length, 2)
  assert.equal(attr(tags[0], 'class'), `${TAB_BASE} border-info text-ink`)
  assert.equal(attr(tags[0], 'aria-current'), 'page')
  assert.equal(attr(tags[1], 'class'), `${TAB_BASE} border-transparent text-ink-3 hover:text-ink`)
  assert.equal(attr(tags[1], 'aria-current'), undefined)
})

/** The outer element's tag and attributes, as rendered. */
function outer(html: string): { tag: string; attrs: string; className: string | undefined } {
  const match = html.match(/^<(\w+)([^>]*)>/)
  assert.ok(match, `no element in ${html}`)
  const className = match[2].match(/ class="([^"]*)"/)?.[1]
  return { tag: match[1], attrs: match[2], className }
}

const PANEL = 'rounded-md border border-line-subtle bg-surface'

test('Panel defaults to a bordered div with px-3 py-2 and no text classes', () => {
  const el = outer(renderToStaticMarkup(h(Panel, { children: 'x' })))
  assert.equal(el.tag, 'div')
  assert.equal(el.className, `${PANEL} px-3 py-2`)
})

test('Panel spacing="mt-4" leads the class string', () => {
  assert.equal(outer(renderToStaticMarkup(h(Panel, { spacing: 'mt-4', children: 'x' }))).className, `mt-4 ${PANEL} px-3 py-2`)
})

test('Panel text values', () => {
  const cls = (text: 'caption' | 'caption-2' | 'caption-3' | 'caption-note' | 'label-note') =>
    outer(renderToStaticMarkup(h(Panel, { text, children: 'x' }))).className
  assert.equal(cls('caption'), `${PANEL} px-3 py-2 text-caption`)
  assert.equal(cls('caption-2'), `${PANEL} px-3 py-2 text-caption text-ink-2`)
  assert.equal(cls('caption-3'), `${PANEL} px-3 py-2 text-caption text-ink-3`)
  assert.equal(cls('caption-note'), `${PANEL} px-3 py-2 text-caption leading-relaxed text-ink-3`)
  assert.equal(cls('label-note'), `${PANEL} px-3 py-2 text-label leading-relaxed text-ink-3`)
})

test('Panel caption-2 note forwards role and id, with spacing="mb-4"', () => {
  const el = outer(renderToStaticMarkup(h(Panel, { text: 'caption-2', spacing: 'mb-4', role: 'note', id: 'n', children: 'x' })))
  assert.equal(el.className, `mb-4 ${PANEL} px-3 py-2 text-caption text-ink-2`)
  assert.match(el.attrs, / role="note"/)
  assert.match(el.attrs, / id="n"/)
})

test('Panel caption-note with spacing="mb-3"', () => {
  const el = outer(renderToStaticMarkup(h(Panel, { text: 'caption-note', spacing: 'mb-3', children: 'x' })))
  assert.equal(el.className, `mb-3 ${PANEL} px-3 py-2 text-caption leading-relaxed text-ink-3`)
})

test('Panel pad values', () => {
  assert.equal(outer(renderToStaticMarkup(h(Panel, { pad: 'md', children: 'x' }))).className, `${PANEL} p-3`)
  assert.equal(outer(renderToStaticMarkup(h(Panel, { pad: 'tall', children: 'x' }))).className, `${PANEL} px-3 py-3`)
})

test('Panel layout values', () => {
  assert.equal(outer(renderToStaticMarkup(h(Panel, { layout: 'stack-2', children: 'x' }))).className, `${PANEL} px-3 py-2 space-y-2`)
  assert.equal(
    outer(renderToStaticMarkup(h(Panel, { pad: 'tall', layout: 'tall', children: 'x' }))).className,
    `${PANEL} px-3 py-3 flex min-h-[15rem] flex-col`
  )
  assert.equal(
    outer(renderToStaticMarkup(h(Panel, { text: 'label-note', layout: 'span-2', children: 'x' }))).className,
    `${PANEL} px-3 py-2 text-label leading-relaxed text-ink-3 sm:col-span-2`
  )
})

test('Panel as="a" adds the hover border and forwards href, target and rel', () => {
  const el = outer(
    renderToStaticMarkup(h(Panel, { as: 'a', href: 'https://example.com/', target: '_blank', rel: 'noreferrer', children: 'x' }))
  )
  assert.equal(el.tag, 'a')
  assert.equal(el.className, `${PANEL} px-3 py-2 hover:border-info`)
  assert.match(el.attrs, / href="https:\/\/example.com\/"/)
  assert.match(el.attrs, / target="_blank"/)
  assert.match(el.attrs, / rel="noreferrer"/)
})

test('Panel as="form" pad="md" forwards action', () => {
  const el = outer(renderToStaticMarkup(h(Panel, { as: 'form', pad: 'md', action: '/save', children: 'x' })))
  assert.equal(el.tag, 'form')
  assert.equal(el.className, `${PANEL} p-3`)
  assert.match(el.attrs, / action="\/save"/)
})

test('Panel bordered={false} text="label-note" is the borderless soft note', () => {
  const soft = 'rounded-md bg-surface px-3 py-2 text-label leading-relaxed text-ink-3'
  const cls = (spacing?: 'mt-3' | 'mb-3') =>
    outer(renderToStaticMarkup(h(Panel, { bordered: false, text: 'label-note', spacing, children: 'x' }))).className
  assert.equal(cls(), soft)
  assert.equal(cls('mt-3'), `mt-3 ${soft}`)
  assert.equal(cls('mb-3'), `mb-3 ${soft}`)
  const p = outer(renderToStaticMarkup(h(Panel, { as: 'p', bordered: false, text: 'label-note', spacing: 'mb-5', children: 'x' })))
  assert.equal(p.tag, 'p')
  assert.equal(p.className, `mb-5 ${soft}`)
})

test('Callout strong caption is the proposal banner, toned by the Badge triplet', () => {
  const props = { emphasis: 'strong', size: 'caption', role: 'status', spacing: 'mb-4' } as const
  const success = outer(renderToStaticMarkup(h(Callout, { ...props, tone: 'success', children: 'x' })))
  assert.equal(success.tag, 'div')
  assert.equal(success.className, 'mb-4 rounded-md border px-3 py-2 text-caption border-success/30 bg-success/10 text-success')
  assert.match(success.attrs, / role="status"/)
  const warning = outer(renderToStaticMarkup(h(Callout, { ...props, tone: 'warning', children: 'x' })))
  assert.equal(warning.className, 'mb-4 rounded-md border px-3 py-2 text-caption border-warning/30 bg-warning/10 text-warning')
})

test('Callout strong label, as a div and as a p', () => {
  const div = outer(renderToStaticMarkup(h(Callout, { tone: 'warning', size: 'label', spacing: 'mb-4', children: 'x' })))
  assert.equal(div.tag, 'div')
  assert.equal(div.className, 'mb-4 rounded-md border px-3 py-2 text-label border-warning/30 bg-warning/10 text-warning')
  assert.doesNotMatch(div.attrs, / role=/)
  const p = outer(
    renderToStaticMarkup(h(Callout, { tone: 'warning', emphasis: 'strong', size: 'label', as: 'p', spacing: 'mb-3', children: 'x' }))
  )
  assert.equal(p.tag, 'p')
  assert.equal(p.className, 'mb-3 rounded-md border px-3 py-2 text-label border-warning/30 bg-warning/10 text-warning')
})

test('Callout soft warning, label relaxed and caption relaxed with role="status"', () => {
  assert.equal(
    outer(renderToStaticMarkup(h(Callout, { tone: 'warning', emphasis: 'soft', size: 'label', relaxed: true, children: 'x' }))).className,
    'rounded-md border px-3 py-2 text-label leading-relaxed border-warning/30 bg-warning/5 text-ink-2'
  )
  const status = outer(
    renderToStaticMarkup(
      h(Callout, { tone: 'warning', emphasis: 'soft', size: 'caption', relaxed: true, role: 'status', spacing: 'mt-3', children: 'x' })
    )
  )
  assert.equal(status.className, 'mt-3 rounded-md border px-3 py-2 text-caption leading-relaxed border-warning/30 bg-warning/5 text-ink-2')
  assert.match(status.attrs, / role="status"/)
})

test('Callout soft success layout="aside" has no size and the aside width', () => {
  assert.equal(
    outer(renderToStaticMarkup(h(Callout, { tone: 'success', emphasis: 'soft', layout: 'aside', children: 'x' }))).className,
    'rounded-md border px-3 py-2 border-success/30 bg-success/5 text-ink-2 shrink-0 lg:max-w-[19rem]'
  )
})

test('Callout rule is a left rule in the tone colour', () => {
  for (const tone of ['info', 'success', 'warning'] as const) {
    assert.equal(
      outer(renderToStaticMarkup(h(Callout, { tone, emphasis: 'rule', children: 'x' }))).className,
      `border-l-2 border-${tone} px-3 py-1`
    )
  }
})

// — Note ——————————————————————————————————————————————————————————————————————
// One assertion per class combination the footnote inventory recorded.

const NOTE_CASES: [string, Record<string, unknown>, string][] = [
  ['label, no spacing', {}, 'text-label text-ink-3'],
  ['label above-2', { spacing: 'above-2' }, 'mt-2 text-label text-ink-3'],
  ['label above-3', { spacing: 'above-3' }, 'mt-3 text-label text-ink-3'],
  ['label above-1', { spacing: 'above-1' }, 'mt-1 text-label text-ink-3'],
  ['label above-0.5', { spacing: 'above-0.5' }, 'mt-0.5 text-label text-ink-3'],
  ['label below-3', { spacing: 'below-3' }, 'mb-3 text-label text-ink-3'],
  ['label below-5', { spacing: 'below-5' }, 'mb-5 text-label text-ink-3'],
  ['label relaxed', { relaxed: true }, 'text-label leading-relaxed text-ink-3'],
  ['label relaxed above-3', { relaxed: true, spacing: 'above-3' }, 'mt-3 text-label leading-relaxed text-ink-3'],
  ['label relaxed above-2', { relaxed: true, spacing: 'above-2' }, 'mt-2 text-label leading-relaxed text-ink-3'],
  ['label relaxed above-1', { relaxed: true, spacing: 'above-1' }, 'mt-1 text-label leading-relaxed text-ink-3'],
  ['label relaxed below-3', { relaxed: true, spacing: 'below-3' }, 'mb-3 text-label leading-relaxed text-ink-3'],
  ['caption, no spacing', { size: 'caption' }, 'text-caption text-ink-3'],
  ['caption below-3', { size: 'caption', spacing: 'below-3' }, 'mb-3 text-caption text-ink-3'],
  ['caption below-4', { size: 'caption', spacing: 'below-4' }, 'mb-4 text-caption text-ink-3'],
  ['caption below-3 warning', { size: 'caption', spacing: 'below-3', tone: 'warning' }, 'mb-3 text-caption text-warning'],
  ['body', { size: 'body' }, 'text-body text-ink-3'],
  ['micro medium above-2', { size: 'micro', weight: 'medium', spacing: 'above-2' }, 'mt-2 text-micro font-medium text-ink-3'],
  ['inherit', { size: 'inherit' }, 'text-ink-3'],
  ['row above-3', { row: true, spacing: 'above-3' }, 'mt-3 flex flex-wrap items-center gap-2 text-label text-ink-3'],
  ['row below-4', { row: true, spacing: 'below-4' }, 'mb-4 flex flex-wrap items-center gap-2 text-label text-ink-3'],
  ['band top relaxed', { band: 'top', relaxed: true }, 'border-t border-line-subtle px-4 py-3 text-label leading-relaxed text-ink-3'],
  [
    'band bottom relaxed',
    { band: 'bottom', relaxed: true },
    'border-b border-line-subtle bg-surface px-4 py-3 text-label leading-relaxed text-ink-3',
  ],
]

for (const [name, props, expected] of NOTE_CASES) {
  test(`Note ${name}`, () => {
    const el = outer(renderToStaticMarkup(h(Note, { ...props, children: 'x' } as never)))
    assert.equal(el.tag, 'p')
    assert.equal(el.className, expected)
  })
}

test('Note forwards title and keeps a Badge child inside the paragraph', () => {
  const html = renderToStaticMarkup(h(Note, { row: true, spacing: 'below-4', title: 'why', children: h('span', null, 'b') }))
  assert.match(html, /^<p class="[^"]*" title="why"><span>b<\/span><\/p>$/)
})

// — SectionHeading ————————————————————————————————————————————————————————————

test('SectionHeading pension: page size with mb-1, bare h2', () => {
  const html = renderToStaticMarkup(h(SectionHeading, { size: 'page', spacing: 'mb-1', children: 'T' }))
  assert.equal(html, '<h2 class="mb-1 text-title font-medium text-ink">T</h2>')
})

test('SectionHeading band: the briefing band row with an inline subtitle', () => {
  const html = renderToStaticMarkup(h(SectionHeading, { size: 'section', tracking: true, layout: 'band', subtitle: 'S', children: 'T' }))
  assert.equal(
    html,
    '<div class="mb-3 mt-7 flex flex-wrap items-baseline gap-2.5 first:mt-0">' +
      '<h2 class="text-body-lg font-medium tracking-tight text-ink">T</h2>' +
      '<span class="text-label text-ink-3">S</span></div>'
  )
})

test('SectionHeading eyebrow: micro label above a tight page heading with mt-1', () => {
  const html = renderToStaticMarkup(h(SectionHeading, { size: 'page', tight: true, eyebrow: 'E', children: 'T' }))
  assert.equal(
    html,
    '<div><div class="font-medium uppercase text-ink-3 text-micro tracking-[0.08em]">E</div>' +
      '<h2 class="mt-1 text-title font-medium leading-tight text-ink">T</h2></div>'
  )
})

test('SectionHeading tight tracking page heading (opportunity analysis)', () => {
  const html = renderToStaticMarkup(h(SectionHeading, { size: 'page', tight: true, tracking: true, children: 'T' }))
  assert.equal(html, '<h2 class="text-title font-medium leading-tight tracking-tight text-ink">T</h2>')
})

test('SectionHeading action: h3 and the action in a flex row (timeline month)', () => {
  const html = renderToStaticMarkup(h(SectionHeading, { level: 3, size: 'page', action: h('span', null, 'B'), children: 'T' }))
  assert.equal(html, '<div class="flex items-center gap-2"><h3 class="text-title font-medium text-ink">T</h3><span>B</span></div>')
})

test('SectionHeading stacked subtitle (card header)', () => {
  const html = renderToStaticMarkup(h(SectionHeading, { size: 'section', subtitle: 'S', children: 'T' }))
  assert.equal(html, '<div><h2 class="text-body-lg font-medium text-ink">T</h2><p class="mt-0.5 text-label text-ink-3">S</p></div>')
})

test('SectionHeading minor h3 (proposal sub-headings)', () => {
  const html = renderToStaticMarkup(h(SectionHeading, { level: 3, size: 'minor', children: 'T' }))
  assert.equal(html, '<h3 class="text-label font-medium text-ink">T</h3>')
})

test('SectionHeading muted sub h3 with mb-2 (FBAR sub-section)', () => {
  const html = renderToStaticMarkup(h(SectionHeading, { level: 3, size: 'sub', tone: 'muted', spacing: 'mb-2', children: 'T' }))
  assert.equal(html, '<h3 class="mb-2 text-body font-medium text-ink-2">T</h3>')
})

test('SectionHeading forwards id to the heading', () => {
  const html = renderToStaticMarkup(h(SectionHeading, { id: 'x', children: 'T' }))
  assert.equal(html, '<h2 id="x" class="text-body-lg font-medium text-ink">T</h2>')
})
