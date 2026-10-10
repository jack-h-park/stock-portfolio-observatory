// The filer's account-number detectors read the numbers from the account map, never
// from the source: the repository is public. Every number below is invented.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')

const MAP = {
  bankAccounts: [{ institution: 'hana', kind: 'fx', currency: 'USD', accountNumber: '000-000000-00042', alias: 'Hana USD' }],
  brokerageAccounts: [
    { institution: 'mirae', accountNumber: '000000000011', kind: 'isa' },
    { institution: 'mirae', accountNumber: '000000000022', kind: 'general' },
  ],
}

const MIRAE_TRANSACTIONS = [
  '미래에셋증권 거래내역 증 명 서\n제공내역 2024/01/01 ~ 2024/12/31',
  '계좌번호 0000-0000-0011 예시',
]
const MIRAE_BALANCE = ['잔 고 증 명 서\n기준일자 발급일시 2024-12-31\n계좌번호 계좌명 부기명 실명확인번호 000000000022\n발급번호: 2025-001-00001234']
const HANA_PDF = ['외화 FX마켓 USD 계좌 000-000000-00042 조회기간 2025-01-01 ~ 2025-06-30']

/** Run one detector over a fake document under `map` (an object, a raw string, or absent). */
function detect(detector: string, pages: string[], map?: object | string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'account-map-'))
  const mapPath = path.join(dir, map === undefined ? 'no-map.json' : 'map.json')
  if (map !== undefined) writeFileSync(mapPath, typeof map === 'string' ? map : JSON.stringify(map))
  const program = `
import importlib.util, json, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('filer', 'scripts/file-downloads.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
pages = json.loads(sys.argv[1])
class Doc:
    path = Path('statement.pdf')
    suffix = '.pdf'
    def page_text(self, i):
        return pages[i] if i < len(pages) else ''
out = getattr(m, sys.argv[2])(Doc())
if isinstance(out, m.Plan):
    print(json.dumps({'plan': out.subdir + '/' + out.name, 'evidence': out.evidence}))
else:
    print(json.dumps({'reason': out.reason, 'remedy': out.remedy}))
`
  return JSON.parse(
    execFileSync('python3', ['-c', program, JSON.stringify(pages), detector], {
      cwd: ROOT,
      env: { ...process.env, STOCK_ACCOUNT_MAP_PATH: mapPath },
      encoding: 'utf8',
    })
  )
}

test('a 미래에셋 certificate takes its account type from the map entry for its 계좌번호', () => {
  assert.equal(detect('detect_mirae_transactions', MIRAE_TRANSACTIONS, MAP).plan, 'kr-statements/mirae-isa-transactions-2024.pdf')
  assert.match(detect('detect_mirae_balance', MIRAE_BALANCE, MAP).plan, /^kr-statements\/mirae-general-balance-20241231-1234\.pdf$/)
})

test('a 미래에셋 certificate whose 계좌번호 the map does not declare is refused, naming the entry to add', () => {
  // With no map file at all the refusal says the file is missing instead (mirae-account-identity.test.ts).
  for (const map of [{ brokerageAccounts: [] }]) {
    for (const [detector, pages] of [['detect_mirae_transactions', MIRAE_TRANSACTIONS], ['detect_mirae_balance', MIRAE_BALANCE]] as const) {
      const out = detect(detector, [...pages], map)
      assert.equal(out.plan, undefined)
      assert.match(out.remedy, /brokerageAccounts/)
      assert.match(out.remedy, /"institution": "mirae"/)
    }
  }
})

test('a Hana USD history PDF is recognised by the account number the map declares', () => {
  const out = detect('detect_hana_fx_history', HANA_PDF, MAP)
  assert.match(out.plan, /^fx-statements\/hana-usd-history-.+\.pdf$/)
  assert.ok(out.evidence.includes('account ...00042'))
})

test('a Hana USD history PDF with no matching map entry is refused, naming the entry to add', () => {
  for (const map of [undefined, { bankAccounts: [{ ...MAP.bankAccounts[0], accountNumber: '000-000000-00099' }] }]) {
    const out = detect('detect_hana_fx_history', HANA_PDF, map)
    assert.equal(out.plan, undefined)
    assert.match(out.remedy, /bankAccounts/)
    assert.match(out.remedy, /"institution": "hana"/)
  }
})

test('an unreadable map is reported as such, not as an unknown account', () => {
  const out = detect('detect_mirae_balance', MIRAE_BALANCE, '{ not json')
  assert.match(out.reason, /could not be read/)
  assert.match(detect('detect_hana_fx_history', HANA_PDF, '{ not json').reason, /could not be read/)
})
