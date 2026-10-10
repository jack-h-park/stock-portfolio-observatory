import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

// Mirae Asset (미래에셋) prints a Korean short code with an `A` in front of it
// and a foreign listing as its bare symbol. `clean_ticker` used to strip every
// leading A, so the Apple shares bought in that account were ledgered as APL
// while the same security everywhere else was AAPL — two positions, two
// realized rows, one company. Same harness as kr-lot-notes: the module imports
// pdfplumber at load time, and nothing here reads a PDF.

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const PY = process.env.STOCK_PYTHON_BIN || 'python3'

const HARNESS = `
import importlib.util, json, sys, types
sys.modules.setdefault("pdfplumber", types.ModuleType("pdfplumber"))
spec = importlib.util.spec_from_file_location("kr_extract", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
print(json.dumps([mod.clean_ticker(v) for v in json.loads(sys.argv[2])], ensure_ascii=False))
`

function cleanTickers(values) {
  const harness = path.join(mkdtempSync(path.join(tmpdir(), 'kr-ticker-')), 'harness.py')
  writeFileSync(harness, HARNESS, 'utf8')
  const out = execFileSync(
    PY,
    [harness, path.join(REPO_ROOT, 'scripts/extract-kr-statements.py'), JSON.stringify(values)],
    { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  )
  return JSON.parse(out)
}

test('the A in front of a Korean short code is dropped', () => {
  assert.deepEqual(cleanTickers(['A005930', 'A0001A0', ' A000660 ']), ['005930', '0001A0', '000660'])
})

test('a foreign symbol that starts with A keeps it', () => {
  assert.deepEqual(cleanTickers(['AAPL', 'AMZN', 'AMD', 'AVGO', 'ARKK']), ['AAPL', 'AMZN', 'AMD', 'AVGO', 'ARKK'])
})

test('symbols without the prefix pass through', () => {
  assert.deepEqual(cleanTickers(['005930', 'TSLA', 'BRK.B', '']), ['005930', 'TSLA', 'BRK.B', ''])
})
