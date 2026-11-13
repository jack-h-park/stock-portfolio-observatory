import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { MiniStat, MiniStatGrid, Stat, StatStrip, Total, TotalsStrip } from '@/components/layout'
import { HeroAside, MetricField } from '@/components/ui'

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
