import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import type { AllocationPolicy } from '../lib/rebalance/allocation-policy'
import { parseLlmJson, validateLlmOutput } from '../lib/rebalance/llm-contract'

const policy = (): AllocationPolicy => {
  const raw = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'allocation-policy.example.json'), 'utf8'))
  for (const key of Object.keys(raw)) if (key.startsWith('_')) delete raw[key]
  return raw as AllocationPolicy
}

const source = { url: 'https://example.com/a', title: 'A note', date: '2026-10-01' }
const outlook = () => ({
  summary: 's',
  drivers: ['d'],
  risks: ['r'],
  whatWouldChangeMyView: ['w'],
  sources: [source],
  confidence: 'medium',
})
const change = (sleeves: Record<string, unknown>) => ({
  outlook: outlook(),
  targetChange: { decision: 'change', sleeves },
  ideas: [],
  questionsForMaintainer: [],
})
// us_equity 45 -> 42, bonds 5 -> 8: sums to 100, shifts of 3.
const validChange = () =>
  change({ us_equity: { to: 42, reason: 'valuation' }, bonds: { to: 8, reason: 'yield' } })

function errorsOf(value: unknown, p = policy()): string[] {
  const result = validateLlmOutput(value, p)
  assert.equal(result.ok, false)
  return result.ok ? [] : result.errors
}

test('parseLlmJson extracts a fenced or prose-wrapped object', () => {
  assert.deepEqual(parseLlmJson('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseLlmJson('```\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseLlmJson('Here you go:\n{"a":{"b":"}"}, "c":"\\"{"}\nThanks!'), { a: { b: '}' }, c: '"{' })
  assert.deepEqual(parseLlmJson('{"a":1}'), { a: 1 })
  assert.equal(parseLlmJson('no json here'), null)
  assert.equal(parseLlmJson('{"a": '), null)
  assert.equal(parseLlmJson(''), null)
})

test('a valid change passes and yields merged targets', () => {
  const p = policy()
  const result = validateLlmOutput(validChange(), p)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.targets.us_equity.target, 42)
  assert.equal(result.targets.bonds.target, 8)
  assert.equal(result.targets.kr_equity.target, p.targets.kr_equity.target)
  assert.equal(result.targets.us_equity.band, p.targets.us_equity.band)
  assert.equal(p.targets.us_equity.target, 45, 'the input policy is not mutated')
  assert.equal(result.output.targetChange.decision, 'change')
})

test('hold ignores listed sleeves', () => {
  const p = policy()
  const value = { ...validChange(), targetChange: { decision: 'hold', sleeves: { us_equity: { to: 1, reason: 'x' } } } }
  const result = validateLlmOutput(value, p)
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.targets, p.targets)
})

test('hold without sources or sleeves passes', () => {
  const value = { ...validChange(), outlook: { ...outlook(), sources: [] }, targetChange: { decision: 'hold', sleeves: {} } }
  assert.equal(validateLlmOutput(value, policy()).ok, true)
})

test('rejects a sum != 100', () => {
  const errors = errorsOf(change({ us_equity: { to: 42, reason: 'valuation' } }))
  assert.ok(errors.some((e) => e.includes('sum')))
})

test('rejects a target outside bounds', () => {
  const p = policy()
  p.bounds.sleeves.bonds = { min: 0, max: 6 }
  const errors = errorsOf(validChange(), p)
  assert.ok(errors.some((e) => e.includes('bonds') && e.includes('bounds')))
})

test('rejects a shift above maxTargetShiftPctPerCycle', () => {
  const errors = errorsOf(change({ us_equity: { to: 35, reason: 'x' }, bonds: { to: 15, reason: 'y' } }))
  assert.ok(errors.some((e) => e.includes('us_equity') && e.includes('limit')))
})

test('rejects a change with no sources or a source without an ISO date', () => {
  const none = { ...validChange(), outlook: { ...outlook(), sources: [] } }
  assert.ok(errorsOf(none).some((e) => e.includes('outlook.sources')))
  for (const date of ['Oct 1 2026', '2026-02-30', '2026-10-1', undefined]) {
    const bad = { ...validChange(), outlook: { ...outlook(), sources: [{ ...source, date }] } }
    assert.ok(errorsOf(bad).some((e) => e.includes('outlook.sources[0].date')), String(date))
  }
})

test('rejects a source URL that is not absolute http(s)', () => {
  for (const url of ['javascript:alert(1)', '/relative', 'ftp://x.com/a', 'example.com']) {
    const bad = { ...validChange(), outlook: { ...outlook(), sources: [{ ...source, url }] } }
    assert.ok(errorsOf(bad).some((e) => e.includes('outlook.sources[0].url')), url)
  }
})

test('rejects a changed sleeve without a reason', () => {
  const errors = errorsOf(change({ us_equity: { to: 42, reason: '' }, bonds: { to: 8, reason: 'yield' } }))
  assert.ok(errors.some((e) => e.includes('targetChange.sleeves.us_equity.reason')))
})

test('rejects unknown sleeve keys', () => {
  const errors = errorsOf(change({ us_equity: { to: 42, reason: 'a' }, bonds: { to: 8, reason: 'b' }, real_estate: { to: 0, reason: 'c' } }))
  assert.ok(errors.some((e) => e.includes('sleeves["real_estate"]')))
})

test('omitted sleeves stay at current targets; string numbers are rejected', () => {
  const ok = validateLlmOutput(validChange(), policy())
  assert.equal(ok.ok && ok.targets.gold.target, 5)
  const errors = errorsOf(change({ us_equity: { to: '42', reason: 'a' }, bonds: { to: 8, reason: 'b' } }))
  assert.ok(errors.some((e) => e.includes('targetChange.sleeves.us_equity.to')))
})

test('rejects confidence outside low|medium|high', () => {
  const errors = errorsOf({ ...validChange(), outlook: { ...outlook(), confidence: 'certain' } })
  assert.ok(errors.some((e) => e.includes('outlook.confidence')))
})

test('rejects a non-object and missing sections', () => {
  assert.ok(errorsOf(null).length > 0)
  assert.ok(errorsOf({}).some((e) => e.includes('outlook')))
})

test('validates ideas', () => {
  const bad = { ...validChange(), ideas: [{ ticker: 'X', sleeve: 'nope', why: 'w' }] }
  assert.ok(errorsOf(bad).some((e) => e.includes('ideas[0].sleeve')))
  const good = { ...validChange(), ideas: [{ ticker: 'X', sleeve: 'gold', why: 'w' }], questionsForMaintainer: ['q'] }
  assert.equal(validateLlmOutput(good, policy()).ok, true)
})

test('caps text fields', () => {
  const long = 'x'.repeat(2001)
  const e1 = errorsOf({ ...validChange(), outlook: { ...outlook(), summary: long } })
  assert.ok(e1.some((e) => e.includes('outlook.summary')))
  assert.ok(e1.every((e) => e.length < 300), 'errors do not echo the long value')
  const e2 = errorsOf({ ...validChange(), outlook: { ...outlook(), drivers: Array(11).fill('d') } })
  assert.ok(e2.some((e) => e.includes('outlook.drivers')))
  const e3 = errorsOf({ ...validChange(), questionsForMaintainer: [long] })
  assert.ok(e3.some((e) => e.includes('questionsForMaintainer[0]')))
  const e4 = errorsOf(change({ us_equity: { to: 42, reason: long }, bonds: { to: 8, reason: 'y' } }))
  assert.ok(e4.some((e) => e.includes('targetChange.sleeves.us_equity.reason')))
})

test('errors never echo more than 80 characters of a value', () => {
  const errors = errorsOf({ ...validChange(), outlook: { ...outlook(), confidence: 'z'.repeat(500) } })
  assert.ok(errors.every((e) => !e.includes('z'.repeat(81))))
})

const deep = (n: number): unknown => {
  let v: unknown = 'leaf'
  for (let i = 0; i < n; i++) v = [v]
  return v
}

test('the validator never throws on deeply nested values', () => {
  const d = deep(200_000)
  for (const bad of [
    { ...validChange(), outlook: { ...outlook(), confidence: d } },
    { ...validChange(), targetChange: { decision: d, sleeves: {} } },
    change({ us_equity: { to: d, reason: 'a' } }),
    { ...validChange(), ideas: [{ ticker: 't', sleeve: d, why: 'w' }] },
  ]) {
    const result = validateLlmOutput(bad, policy())
    assert.equal(result.ok, false)
  }
})

test('parseLlmJson stays fast on pathological braces and caps input size', () => {
  const t = Date.now()
  assert.equal(parseLlmJson('{'.repeat(100_000)), null)
  assert.equal(parseLlmJson('{"a":'.repeat(30_000)), null)
  assert.equal(parseLlmJson(`{"a":"${'x'.repeat(250_000)}"}`), null)
  assert.ok(Date.now() - t < 200, `took ${Date.now() - t}ms`)
})

test('sleeve keys are quoted and capped in errors; __proto__ is just an unknown key', () => {
  const raw = JSON.parse('{"__proto__":{"to":1,"reason":"x"},"us_equity":{"to":45,"reason":"y"}}')
  const errors = errorsOf(change(raw))
  assert.ok(errors.some((e) => e.includes('"__proto__"') && e.includes('unknown sleeve')))
  const long = errorsOf(change({ ['k'.repeat(500)]: { to: 1, reason: 'x' } }))
  assert.ok(long.every((e) => !e.includes('k'.repeat(81))))
})

test('rejects non-finite or negative numbers for to', () => {
  for (const to of [Infinity, NaN, -3]) {
    const errors = errorsOf(change({ us_equity: { to, reason: 'a' }, bonds: { to: 8, reason: 'b' } }))
    assert.ok(errors.some((e) => e.includes('us_equity')), String(to))
  }
})

test('source URLs are trimmed and stored trimmed', () => {
  const value = { ...validChange(), outlook: { ...outlook(), sources: [{ ...source, url: '  https://example.com/a \n' }] } }
  const result = validateLlmOutput(value, policy())
  assert.equal(result.ok && result.output.outlook.sources[0].url, 'https://example.com/a')
})

test('parseLlmJson survives a stray unbalanced brace or quote in prose', () => {
  assert.deepEqual(parseLlmJson('Note {see below. ```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseLlmJson('He said "hi {\n```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseLlmJson('Note {see below. {"a":1}'), { a: 1 })
  assert.deepEqual(parseLlmJson('He said "hi {\n{"a":1}'), { a: 1 })
})
