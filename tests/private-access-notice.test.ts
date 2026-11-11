import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PrivateAccessNotice } from '../components/PrivateAccessNotice'

function render(mode: string, notice?: string, language: 'en' | 'ko' = 'en') {
  return renderToStaticMarkup(React.createElement(PrivateAccessNotice, { mode, notice, language }))
}

test('does not claim deployment protection without a private operator opt-in', () => {
  assert.equal(render('sample', 'owner-devices'), '')
  assert.equal(render('private'), '')
  assert.equal(render('private', 'unrecognized'), '')
  assert.equal(render('unrecognized', 'owner-devices'), '')
})

test('explains the intended restriction and ordinary browser access in both languages', () => {
  const english = render('private', 'owner-devices')
  assert.match(english, /Approved owner devices only/)
  assert.match(english, /taxes and evidence/)
  assert.match(english, /New or re-enrolled devices require review/)
  assert.match(english, /No SSH tunnel is needed/)
  const korean = render('private', 'owner-devices', 'ko')
  assert.match(korean, /승인된 본인 기기만 접근 가능/)
  assert.match(korean, /세금·증빙/)
  assert.match(korean, /새 기기나 재등록한 기기/)
  assert.match(korean, /SSH 연결 없이/)
})
