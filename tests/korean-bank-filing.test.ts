import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const hana = [['거래내역조회'], [], ['계좌번호', '123-456', '', '예금종류', '수신', '', '조회기간', '2026-01-01 ~ 2026-11-14'], ['잔액', '20'], ['거래일시', '적요', '출금액', '입금액', '잔액'], ['2026-10-01 12:00:00', 'sample', '0', '10', '20']]
const kb = [['조회기간', '2026-01-01 ~ 2026-11-14'], ['계좌번호', '999-111'], ['예금종류', 'checking'], ['거래일시', '적요', '보낸분/받는분', '송금메모', '출금액', '입금액', '잔액'], ['2026-10-01 12:00:00', 'sample', '', '', '0', '10', '20']]
const map = {bankAccounts:[{institution:'hana',kind:'checking',currency:'KRW',accountNumber:'123-456',alias:'Hana example'},{institution:'kb',kind:'checking',currency:'KRW',accountNumber:'999-111',alias:'KB example'}]}

function detect(rows: string[][], accountMap: object = map, conversionFails = false) {
  const dir = mkdtempSync(path.join(tmpdir(), 'bank-filer-'))
  writeFileSync(path.join(dir, 'map.json'), JSON.stringify(accountMap))
  const script = `
import importlib.util,json,sys
from pathlib import Path
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
f=load('filer','scripts/file-downloads.py'); b=load('bank','scripts/extract-bank-statements.py')
rows=json.loads(sys.argv[1])
def read_rows(p,findings):
 if sys.argv[3]=='fail': raise FileNotFoundError('no converted workbook')
 return rows
b._xls_rows=read_rows
f._bank_statement_module=lambda: b
class Doc:
 suffix='.xls'
 path=Path(sys.argv[2])
out=f.detect_korean_bank_xls(Doc())
if isinstance(out,f.Plan): print(json.dumps({'plan':out.subdir+'/'+out.name}))
elif isinstance(out,f.Refusal): print(json.dumps({'reason':out.reason}))
else: print('null')
`
  const input = path.join(dir, 'unknown.xls')
  writeFileSync(input, Buffer.concat([Buffer.from('d0cf11e0a1b11ae1','hex'), Buffer.from(['거래내역조회', ...rows.flat()].join(' '),'utf16le')]))
  return JSON.parse(execFileSync('python3',['-c',script,JSON.stringify(rows),input,conversionFails?'fail':'ok'],{cwd:root,env:{...process.env,STOCK_ACCOUNT_MAP_PATH:path.join(dir,'map.json')},encoding:'utf8'}))
}

test('content identifies Hana and KB accounts and declared query periods, independent of incoming name', () => {
  assert.equal(detect(hana).plan,'bank-statements/hana-deposit-3456-20260101-20261114.xls')
  assert.equal(detect(kb).plan,'bank-statements/kb-deposit-9111-20260101-20261114.xls')
  assert.equal(detect(hana,{bankAccounts:[{...map.bankAccounts[0],accountNumber:'123456'}]}).plan,'bank-statements/hana-deposit-3456-20260101-20261114.xls')
})

test('unknown account and invalid or reversed periods are refused', () => {
  assert.equal(detect(hana,{bankAccounts:[]}), null)
  assert.match(detect(hana,{bankAccounts:[...map.bankAccounts,{institution:'hana',kind:'savings',currency:'KRW',accountNumber:'123-456'}]}).reason,/ambiguous/)
  const reversed=structuredClone(hana); reversed[2][7]='2026-11-14 ~ 2026-01-01'
  assert.match(detect(reversed).reason,/period/)
  const malformed=structuredClone(kb); malformed[3]=['거래일시','적요','잔액']
  assert.match(detect(malformed).reason,/header|columns/)
})

test('conversion failure leaves the document unidentified instead of aborting the filer', () => {
  assert.equal(detect(hana,map,true),null)
})

test('synthetic Hana and KB BIFF workbooks are identified and filed by the actual converter', t => {
  const check = spawnSync('python3',['-c',"import importlib.util; s=importlib.util.spec_from_file_location('fx','scripts/extract-fx-ledger.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);raise SystemExit(0 if m.soffice_binary() else 1)"],{cwd:root})
  if (check.status !== 0) return t.skip('soffice unavailable')
  const dir=mkdtempSync(path.join(tmpdir(),'biff-filer-'))
  mkdirSync(path.join(dir,'inbox'))
  writeFileSync(path.join(dir,'map.json'),JSON.stringify(map))
  copyFileSync(path.join(root,'tests/fixtures/korean-bank/hana-synthetic.xls'),path.join(dir,'inbox','hana.xls'))
  copyFileSync(path.join(root,'tests/fixtures/korean-bank/kb-synthetic.xls'),path.join(dir,'inbox','kb.xls'))
  const output=execFileSync('python3',['scripts/file-downloads.py'],{cwd:root,env:{...process.env,STOCK_DATA_DIR:dir,STOCK_ACCOUNT_MAP_PATH:path.join(dir,'map.json')},encoding:'utf8',timeout:120000})
  assert.match(output,/bank-statements\/hana-deposit-3456-20260101-20261114\.xls/)
  assert.match(output,/bank-statements\/kb-deposit-9111-20260101-20261114\.xls/)
})
