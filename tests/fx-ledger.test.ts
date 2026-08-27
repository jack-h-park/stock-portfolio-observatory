import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')

function runPython(program: string, env: Record<string, string> = {}) {
  return JSON.parse(
    execFileSync('python3', ['-c', program], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      encoding: 'utf8',
    })
  )
}

test('Hana PDF/XLS overlap is deduplicated and the XLS actual rate wins', () => {
  const result = runPython(`
import importlib.util, json
spec=importlib.util.spec_from_file_location('fx', 'scripts/extract-fx-ledger.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
pdf={'date':'2025-10-29','time':None,'kind':'원화대가','memo':'FX마켓 살래요','branch':'','deposit':100.0,'withdrawal':0.0,'balance':0.0,'applied_rate':None,'source':'annual.pdf','source_path':'annual.pdf','page':5}
xls={**pdf,'time':'15:54:36','balance':None,'applied_rate':1432.3,'source':'recent.xls','source_path':'recent.xls','page':None}
merged=m.merge_hana_rows([pdf],[xls])
events=m.hana_events(merged, {'2025-10-29':{'base':1434.3,'ttSend':1448.3,'cashBuy':1459.4}})
print(json.dumps({'rows':len(merged),'event':events[0]}))
`)
  assert.equal(result.rows, 1)
  assert.equal(result.event.rate_status, 'actual')
  assert.equal(result.event.applied_rate, 1432.3)
  assert.equal(result.event.reference_base_rate, 1430.9)
  assert.equal(result.event.reference_customer_rate, 1444.9)
})

test('Hana historical FX Market rate applies 90% preference and remains estimated', () => {
  const result = runPython(`
import importlib.util, json
spec=importlib.util.spec_from_file_location('fx', 'scripts/extract-fx-ledger.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
row={'date':'2024-04-15','time':None,'kind':'원화대가','memo':'FX마켓 살래요','branch':'','deposit':1000.0,'withdrawal':0.0,'balance':1000.0,'applied_rate':None,'source':'annual.pdf','source_path':'annual.pdf','page':1}
event=m.hana_events([row], {'2024-04-15':{'base':1400.0,'ttSend':1414.0,'cashBuy':1424.5}})[0]
print(json.dumps(event))
`)
  assert.equal(result.applied_rate, 1401.4)
  assert.equal(result.rate_status, 'estimated')
  assert.equal(result.preference_rate, 0.9)
  assert.ok(Math.abs(result.spread_cost_krw - 1400) < 1e-6)
  assert.ok(Math.abs(result.spread_savings_krw - 12600) < 1e-6)
  assert.equal(result.realized_fx_gl_krw, null)
})

test('Toss exact statement legs become one exchange and a cancellation stays separate', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'fx-ledger-'))
  const statements = path.join(temp, 'kr')
  mkdirSync(statements)
  const headers = ['Date', 'Account', 'Raw Type', 'FX Rate', 'Native Amount', 'Source', 'Page']
  const rows = [
    ['2025-01-02', 'Toss', '환전원화출금', '1400', '14000', 'toss.pdf', '1'],
    ['2025-01-02', 'Toss', '환전외화입금', '1400', '14000', 'toss.pdf', '2'],
    ['2025-01-03', 'Toss', '환전원화입금', '1400', '14000', 'toss.pdf', '1'],
    ['2025-01-03', 'Toss', '환전외화입금취소', '1400', '14000', 'toss.pdf', '2'],
  ]
  writeFileSync(path.join(statements, 'transactions.tsv'), [headers, ...rows].map((row) => row.join('\t')).join('\n'))
  const result = runPython(`
import importlib.util, json
spec=importlib.util.spec_from_file_location('fx', 'scripts/extract-fx-ledger.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
events,sources,findings=m.toss_events()
print(json.dumps({'events':events,'findings':findings}))
`, { STOCK_KR_STATEMENTS_DIR: statements })
  assert.equal(result.findings.length, 0)
  assert.deepEqual(result.events.map((event: any) => event.event_type), ['EXCHANGE', 'EXCHANGE_CANCEL'])
  assert.deepEqual(result.events.map((event: any) => event.usd_amount), [10, 10])
})
