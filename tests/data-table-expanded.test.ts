import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// tsx compiles the component's JSX with the classic runtime, which reads a
// global React; Next supplies it in the app, so the test does here.
;(globalThis as { React?: typeof React }).React = React

const rows = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'c', v: 3 }]
const columns = [{ key: 'id', label: 'Id' }, { key: 'v', label: 'Value' }]

async function render(expandedRowKey?: string) {
  const { DataTable } = await import('../components/DataTable')
  return renderToStaticMarkup(
    React.createElement(DataTable, {
      rows,
      columns,
      getRowKey: (r: any) => r.id,
      expandedRowKey,
      renderExpanded: (r: any) => React.createElement('p', null, `detail of ${r.id}`),
    })
  )
}

test('an expanded row renders once, right after its own row, across every column', async () => {
  const html = await render('b')
  assert.equal(html.split('detail of').length - 1, 1)
  assert.ok(html.indexOf('detail of b') > html.indexOf('>b<'))
  assert.ok(html.indexOf('detail of b') < html.indexOf('>c<'))
  assert.match(html, /colSpan="2"|colspan="2"/)
})

test('nothing expands without a matching key', async () => {
  assert.ok(!(await render()).includes('detail of'))
  assert.ok(!(await render('zzz')).includes('detail of'))
})
