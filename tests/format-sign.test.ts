import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMPTY_VALUE, fmtPct, fmtPctRange, fmtSigned } from '../lib/format'
import { getUiCopy } from '../lib/ui-copy'

test('fmtSigned puts + on a gain, - on a loss and no sign on zero', () => {
  assert.equal(fmtSigned(5, String), '+5')
  assert.equal(fmtSigned(-5, String), '-5')
  assert.equal(fmtSigned(0, String), '0')
  assert.equal(fmtSigned(null, String), EMPTY_VALUE)
  assert.equal(fmtSigned(undefined, String), EMPTY_VALUE)
})

test('fmtSigned treats a value that rounds to zero as zero', () => {
  assert.equal(fmtSigned(0.001, (n) => n.toFixed(0)), '0')
  assert.equal(fmtSigned(-0.001, (n) => n.toFixed(0)), '0')
})

test('fmtPct keeps its digits and never signs zero', () => {
  assert.equal(fmtPct(12.345, { digits: 1 }), '12.3%')
  assert.equal(fmtPct(0, { signed: true }), '0.00%')
  assert.equal(fmtPct(1.5, { signed: true, digits: 1 }), '+1.5%')
  assert.equal(fmtPct(-1.5, { signed: true, digits: 1 }), '-1.5%')
})

test('fmtPct prints percentage points as %p', () => {
  assert.equal(fmtPct(1.5, { unit: 'pp', digits: 1 }), '1.5%p')
  assert.equal(fmtPct(1.5, { unit: 'pp', digits: 1, signed: true }), '+1.5%p')
})

test('fmtPctRange joins two bounds with one percent sign', () => {
  assert.equal(fmtPctRange(1, 2.5, 1), '1.0–2.5%')
})

test('a missing percentage is the one empty value', () => {
  assert.equal(fmtPct(null), EMPTY_VALUE)
  assert.equal(fmtPct(undefined), EMPTY_VALUE)
})

test('common.noValue is the one empty value in both languages', () => {
  assert.equal(getUiCopy('en').common.noValue, EMPTY_VALUE)
  assert.equal(getUiCopy('ko').common.noValue, EMPTY_VALUE)
})
