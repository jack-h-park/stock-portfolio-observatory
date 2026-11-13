import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

test('explicitly filed savings CSV keeps its first transaction and derives all daily balances from a zero anchor', () => {
  const program = `
import importlib.util, json
spec = importlib.util.spec_from_file_location('bank', 'scripts/extract-bank-statements.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
rows = m.parse_amex_savings('2026-01-03,"Transfer, initial",100\\n2026-01-05,Interest,1\\n2026-01-05,Withdrawal,-20\\n')
print(json.dumps({'rows': rows, 'balances': m.walk_from_anchor(rows, '2026-01-02', 0)}))
`
  const out = JSON.parse(execFileSync('python3', ['-c', program], { encoding: 'utf8' }))
  assert.equal(out.rows.length, 3)
  assert.equal(out.rows[0].amount, 100)
  assert.equal(out.balances.at(-1).balance, 81)
})


test('malformed explicitly filed savings rows fail instead of dropping money silently', () => {
  const program = `
import importlib.util, json
spec = importlib.util.spec_from_file_location('bank', 'scripts/extract-bank-statements.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
rejected = []
for text in ['2026-01-01,Transfer,not-a-number', '2026-02-30,Transfer,10', 'Date,Description,Amount']:
    try:
        m.parse_amex_savings(text)
        rejected.append(False)
    except ValueError:
        rejected.append(True)
print(json.dumps(rejected))
`
  assert.deepEqual(JSON.parse(execFileSync('python3', ['-c', program], { encoding: 'utf8' })), [true, true, true])
})
