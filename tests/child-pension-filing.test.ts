// A child's 미래에셋 연금저축 거래내역증명서: encrypted with its own password (the
// map entry's `pdfPassword`), identified by its FULL 계좌번호 like every 미래에셋
// document, and filed by its map token outside the `mirae-*` series the stock
// extractor reads. Every number, password and label here is invented.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')
const PY = process.env.STOCK_PYTHON_BIN || 'python3'

const CHILD = '900-0000-0000-1'
const RETIRED = '900-0000-0000-2'
const IRP = '666-000000071'
const CHILD_PASSWORD = 'example-child-pw'

const MAP = {
  pensionAccounts: [
    { token: 'irp', accountNumber: IRP, account: '미래에셋증권(IRP)', wrapper: 'irp', institution: '미래에셋증권' },
    {
      token: 'child-example-pension-savings',
      account: '미래에셋증권(연금저축-예시)',
      accountNumber: CHILD,
      wrapper: 'pension_savings',
      institution: '미래에셋증권',
      owner: 'child:example',
      ownerLabel: '자녀(예시)',
      pdfPassword: CHILD_PASSWORD,
    },
    { account: '미래에셋증권(연금저축-예시-해지)', accountNumber: RETIRED, wrapper: 'pension_savings', institution: '미래에셋증권', owner: 'child:example', retiredOn: '2026-07-08' },
  ],
}

const cover = `미래에셋증권 거래내역 증 명 서\nN O. 2026-001-00001234\n제공내역 2024/01/01 ~ 2026/10/12`
const page2 = (number: string) => `계좌정보 페이지: 01/02\n계좌번호 ${number} 계좌유형 연금저축계좌(신) 고객명 예시고객`

function run(program: string, args: string[], map: object, env: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'child-filing-'))
  const mapPath = path.join(dir, 'map.json')
  writeFileSync(mapPath, JSON.stringify(map))
  const prelude = `
import importlib.util, json, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('filer', 'scripts/file-downloads.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
`
  return execFileSync(PY, ['-c', prelude + program, ...args], {
    cwd: ROOT,
    env: { ...process.env, STOCK_PDF_PASSWORD: '', ...env, STOCK_ACCOUNT_MAP_PATH: mapPath },
    encoding: 'utf8',
  })
}

function detect(pages: string[], map: object = MAP) {
  return JSON.parse(
    run(
      `
pages = json.loads(sys.argv[1])
class Doc:
    path = Path('statement.pdf')
    suffix = '.pdf'
    def page_text(self, i):
        return pages[i] if i < len(pages) else ''
out = m.detect_mirae_transactions(Doc())
print(json.dumps({'plan': out.subdir + '/' + out.name, 'evidence': out.evidence} if isinstance(out, m.Plan) else {'reason': out.reason}))
`,
      [JSON.stringify(pages)],
      map
    )
  )
}

test("a child's 연금저축 certificate files by its token, outside the mirae-* stock series", () => {
  const out = detect([cover, page2(CHILD)])
  assert.equal(out.plan, 'kr-statements/child-example-pension-savings-mirae-transactions-20240101-20261012.pdf')
  assert.ok(!path.basename(out.plan).startsWith('mirae-'))
  assert.ok(out.evidence.some((line: string) => line.includes('owner child:example')))
  assert.ok(!JSON.stringify(out).includes(CHILD), 'the full number is never printed')
})

test("a retired child account is known, and refused as retired rather than unknown", () => {
  const out = detect([cover, page2(RETIRED)])
  assert.match(out.reason, /retired or inactive/)
  assert.ok(!out.reason.includes(RETIRED))
})

test('the filer tries the global password, then each per-account password, and never prints one', () => {
  const output = run(
    `
import types
tried = []
def fake_open(path, password=None):
    tried.append(password)
    if password != sys.argv[1]:
        raise ValueError('wrong password')
    return types.SimpleNamespace(metadata={}, pages=[])
m_pdfplumber = types.ModuleType('pdfplumber'); m_pdfplumber.open = fake_open
sys.modules['pdfplumber'] = m_pdfplumber
doc = m.Document(Path('statement.pdf'))
doc._open_pdf()
print(json.dumps({'tried': ['none' if p is None else ('global' if p == 'global-example' else 'map') for p in tried], 'encrypted': doc.encrypted, 'with': doc.opened_with}))
`,
    [CHILD_PASSWORD],
    MAP,
    { STOCK_PDF_PASSWORD: 'global-example' }
  )
  const result = JSON.parse(output)
  assert.deepEqual(result.tried, ['none', 'global', 'map'])
  assert.equal(result.encrypted, true)
  assert.equal(result.with, 'a per-account password from the account map')
  assert.ok(!output.includes(CHILD_PASSWORD))
})
