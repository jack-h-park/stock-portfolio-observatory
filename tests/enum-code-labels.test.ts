import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { FilterBar } from '@/components/FilterBar'
import { LanguageProvider } from '@/components/LanguageProvider'
import { TrendRangeLinks } from '@/components/TrendRangeLinks'
import { ALL } from '@/lib/table-filter'
import { DEFAULT_TREND_RANGE } from '@/lib/trend-ranges'
import type { Language } from '@/lib/i18n'
import { getPageCopy, getUiCopy } from '@/lib/ui-copy'
import { INCOME_CATEGORIES } from '@/lib/ui-copy/common'
import { labelFor } from '@/lib/ui-copy/label'
import { ACCOUNT_TYPES } from '@/lib/ui-copy/pages/accounts'
import { CASH_KINDS } from '@/lib/ui-copy/pages/netWorth'
import historySchema from '@/schemas/tax-history.v1.schema.json'
import estimateSchema from '@/schemas/annual-tax-estimate-input.v1.schema.json'

// tsx compiles JSX with the classic runtime, which reads a global React.
;(globalThis as { React?: typeof React }).React = React

const HANGUL = /[가-힣]/

function inLanguage(language: Language, element: React.ReactElement) {
  return renderToStaticMarkup(React.createElement(LanguageProvider, { language, children: element }))
}

/**
 * A table added for a code English showed raw: every member has a label in both
 * languages, the English label is the code itself (the English page does not
 * change), and the Korean label is a Korean word.
 */
function assertNewTable(name: string, codes: readonly string[], en: Record<string, string>, ko: Record<string, string>) {
  assert.ok(codes.length > 0, `${name}: no members`)
  for (const code of codes) {
    assert.equal(en[code], code, `${name}.${code} en is the raw code`)
    assert.match(ko[code] ?? '', HANGUL, `${name}.${code} ko`)
  }
  assert.deepEqual(Object.keys(ko).sort(), Object.keys(en).sort(), `${name}: ko and en keys`)
}

test('the All filter chip reads the shared word in each language', () => {
  const element = React.createElement(FilterBar, {
    basePath: '/x',
    params: {},
    groups: [
      { key: 'market', label: 'Market', options: [{ value: ALL, label: ALL }, { value: 'KR', label: 'KR' }], selected: ALL },
      { key: 'term', label: 'Term', options: [{ value: ALL, label: 'Page label' }, { value: 'b', label: 'B' }], selected: ALL },
    ],
  })
  const ko = inLanguage('ko', element)
  assert.match(ko, />전체</)
  assert.doesNotMatch(ko, />All</)
  // A page that passes its own label for All keeps it.
  assert.match(ko, />Page label</)
  // The URL value stays `All`: choosing it drops the param.
  assert.match(ko, /href="\/x"/)
  const en = inLanguage('en', element)
  assert.match(en, />All</)
})

test('the All trend range reads the shared word; the period codes stay', () => {
  const element = React.createElement(TrendRangeLinks, { selected: DEFAULT_TREND_RANGE, hrefFor: (key: string) => `/?trend=${key}` })
  const ko = inLanguage('ko', element)
  assert.match(ko, />전체</)
  assert.doesNotMatch(ko, />All</)
  for (const code of ['1M', '3M', '6M', 'YTD', '1Y', '2Y', '3Y', '5Y']) assert.match(ko, new RegExp(`>${code}<`))
  assert.match(inLanguage('en', element), />All</)
})

test('income categories have a label in both languages', () => {
  assertNewTable('incomeCategories', INCOME_CATEGORIES, getUiCopy('en').incomeCategories, getUiCopy('ko').incomeCategories)
})

test('every cash kind has a label; the two added ones show their code in English', () => {
  const en = getPageCopy('netWorth', 'en').kinds as Record<string, string>
  const ko = getPageCopy('netWorth', 'ko').kinds as Record<string, string>
  assert.deepEqual(Object.keys(en).sort(), [...CASH_KINDS].sort())
  for (const kind of CASH_KINDS) assert.ok(ko[kind]?.trim(), `kinds.${kind} ko`)
  assert.equal(en.cash, 'cash')
  assert.equal(en.fx, 'fx')
  assert.match(ko.cash, HANGUL)
  assert.match(ko.fx, HANGUL)
})

test('account types have a label in both languages', () => {
  assertNewTable('accountTypes', ACCOUNT_TYPES, getPageCopy('accounts', 'en').accountTypes, getPageCopy('accounts', 'ko').accountTypes)
})

test('tax authorities and tax types cover the annual estimate schema', () => {
  const en = getPageCopy('taxHistory', 'en')
  const ko = getPageCopy('taxHistory', 'ko')
  assertNewTable('authorities', estimateSchema.properties.authority.enum, en.authorities, ko.authorities)
  assertNewTable('taxTypes', [estimateSchema.properties.taxType.const], en.taxTypes, ko.taxTypes)
})

test('tax record kinds and settlement kinds cover the tax history schema', () => {
  const en = getPageCopy('taxHistory', 'en')
  const ko = getPageCopy('taxHistory', 'ko')
  assertNewTable('recordKinds', historySchema.$defs.basis.properties.kind.enum, en.recordKinds, ko.recordKinds)
  assertNewTable('eventKinds', historySchema.$defs.events.properties.kind.enum, en.eventKinds, ko.eventKinds)
})

test('every record status, return or assessment, has a filing-state label', () => {
  const en = getPageCopy('annualTaxSummary', 'en').filingStates as Record<string, string>
  const ko = getPageCopy('annualTaxSummary', 'ko').filingStates as Record<string, string>
  for (const status of [...historySchema.$defs.returns.properties.status.enum, 'assessed']) {
    assert.ok(en[status]?.trim(), `filingStates.${status} en`)
    assert.match(ko[status] ?? '', HANGUL, `filingStates.${status} ko`)
  }
  // `assessed` had no English label, so it keeps its code.
  assert.equal(en.assessed, 'assessed')
})

test('a free-text code that names an Object.prototype member falls back to itself', () => {
  const tables: Record<string, string>[] = [
    getUiCopy('ko').incomeCategories,
    getUiCopy('ko').transactionTypes,
    getPageCopy('accounts', 'ko').accountTypes,
    getPageCopy('taxHistory', 'ko').authorities,
    getPageCopy('taxHistory', 'ko').taxTypes,
  ]
  for (const table of tables) {
    for (const code of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) assert.equal(labelFor(table, code), code)
    assert.equal(labelFor(table, 'not-a-code'), 'not-a-code')
  }
  assert.equal(labelFor(getUiCopy('ko').incomeCategories, 'interest'), '이자')
  assert.equal(labelFor(getUiCopy('ko').transactionTypes, null), null)
})

test('the /data-ops tickerless table renders its type through the transaction type labels', () => {
  // The page reads the database, so the column definition is checked in source.
  const source = readFileSync('app/data-ops/page.tsx', 'utf8')
  assert.match(source, /\{ key: 'type', label: copy\.columns\.type, render: \(r\) => labelFor\(transactionTypes, r\.type\) \}/)
  assert.doesNotMatch(source, /\{ key: 'type', label: copy\.columns\.type \}/)
  assert.equal(labelFor(getUiCopy('ko').transactionTypes, 'INTEREST'), '이자')
  assert.equal(labelFor(getUiCopy('en').transactionTypes, 'INTEREST'), 'Interest')
})
