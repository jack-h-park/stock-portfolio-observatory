import assert from 'node:assert/strict'
import test from 'node:test'
import type { LlmRecord } from '../lib/rebalance/llm-contract'
import { llmStatusLine, safeSourceHref } from '../lib/rebalance/proposal-view'

const rec = (over: Partial<LlmRecord>): LlmRecord => ({ status: 'ok', runner: 'claude', model: 'model-x', attempts: [{ prompt: '', raw: '', errors: [] }], reason: null, ...over })

test('safeSourceHref allows only https', () => {
  assert.equal(safeSourceHref('https://example.com/a?b=1'), 'https://example.com/a?b=1')
  for (const bad of ['javascript:alert(1)', 'http://example.com', 'data:text/html,x', 'ftp://x.test', 'not a url', '', '//example.com', ' javascript:alert(1)']) {
    assert.equal(safeSourceHref(bad), null, bad)
  }
})

test('llmStatusLine for ok, en and ko', () => {
  assert.equal(llmStatusLine(rec({}), 'en'), 'Judged by claude (model-x) in 1 attempt')
  assert.equal(llmStatusLine(rec({ attempts: [{ prompt: '', raw: '', errors: [] }, { prompt: '', raw: '', errors: ['x'] }] }), 'en'), 'Judged by claude (model-x) in 2 attempts')
  assert.equal(llmStatusLine(rec({}), 'ko'), 'claude(model-x)이 1회 시도로 판단')
  assert.equal(llmStatusLine(rec({ model: null }), 'en'), 'Judged by claude in 1 attempt')
})

test('llmStatusLine for failures and skips uses fixed copy', () => {
  assert.equal(llmStatusLine(rec({ status: 'failed', reason: 'invalid_output' }), 'ko'), 'LLM 판단 실패: 출력 형식 오류 — 목표는 유지했습니다')
  assert.match(llmStatusLine(rec({ status: 'failed', reason: 'timeout' }), 'en'), /timed out/)
  assert.match(llmStatusLine(rec({ status: 'failed', reason: 'runner_unavailable' }), 'en'), /not available/)
  assert.match(llmStatusLine(rec({ status: 'failed', reason: 'runner_failed' }), 'ko'), /실행기 오류/)
  assert.match(llmStatusLine(rec({ status: 'skipped', attempts: [] }), 'en'), /skipped/)
  assert.match(llmStatusLine(rec({ status: 'failed', reason: null }), 'en'), /unknown/)
})
