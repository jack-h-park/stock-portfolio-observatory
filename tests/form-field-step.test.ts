import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// A number input without `step` only accepts values a whole step away from its
// default, so a settings field holding 1061.2 refused 1243.12 and the form's
// submit was cancelled by the browser with nothing sent to the server.

async function render(props: { label: string; name: string; defaultValue: string | number; type?: 'number' | 'text' }) {
  // tsx compiles the component's JSX with the classic runtime, which reads a
  // global React; Next supplies it in the app, so the test does here.
  ;(globalThis as { React?: typeof React }).React = React
  const { Field } = await import('../components/form')
  return renderToStaticMarkup(React.createElement(Field, props))
}

test('a number field accepts any decimal, not only whole steps from its default', async () => {
  const html = await render({ label: 'YTD', name: 'ytd', defaultValue: 1061.2 })
  assert.match(html, /type="number"/)
  assert.match(html, /step="any"/)
})

test('a text field carries no step', async () => {
  const html = await render({ label: 'State', name: 'state', defaultValue: 'CA', type: 'text' })
  assert.doesNotMatch(html, /step=/)
})
