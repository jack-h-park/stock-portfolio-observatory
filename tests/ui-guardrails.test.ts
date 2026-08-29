import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { findConflicts } from '../scripts/ui-guardrails.mjs'

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
