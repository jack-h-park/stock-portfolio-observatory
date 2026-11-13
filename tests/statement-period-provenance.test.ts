import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { readStatementPeriodEvidence } from '../lib/domain/assets/statement-periods'

const minimalPdf = String.raw`
def pdf_bytes(text):
 stream=("BT /F1 12 Tf 30 700 Td ("+text+") Tj ET").encode('ascii')
 objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream']
 data=b'%PDF-1.4\n';offsets=[0]
 for i,obj in enumerate(objects,1):
  offsets.append(len(data));data+=str(i).encode()+b' 0 obj\n'+obj+b'\nendobj\n'
 xref=len(data);data+=b'xref\n0 6\n0000000000 65535 f \n'
 for offset in offsets[1:]:data+=f'{offset:010d} 00000 n \n'.encode()
 return data+b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+str(xref).encode()+b'\n%%EOF\n'
`

const receipt = (source = 'example.pdf', end = '2026-06-30') => ({ source, sha256: 'a'.repeat(64), page: 1, start: '2026-01-01', end })
const metadata = (state = 'declared', sources = [receipt()]) => ({ statementPeriods: { schemaVersion: 1, accounts: { Example: { state, sources } } } })

test('declared receipts bind to the exact account and retain independent source/date provenance', () => {
  const input = metadata('declared', [receipt('older.pdf'), receipt('newer.pdf', '2026-07-31')])
  const result = readStatementPeriodEvidence(input, 'Example')
  assert.equal(result.state, 'declared')
  assert.equal(result.periodEnd, '2026-07-31')
  assert.equal(result.sources.length, 2)
  assert.equal(result.sources[0].page, 1)
  assert.equal(readStatementPeriodEvidence(input, 'Another').periodEnd, null)
  assert.equal(readStatementPeriodEvidence({ accounts: { Example: '2026-12-31' } }, 'Example').state, 'unconfirmed')
  assert.deepEqual(readStatementPeriodEvidence(input, 'Example'), result)
  result.sources[0].end = 'changed'
  assert.equal(input.statementPeriods.accounts.Example.sources[0].end, '2026-06-30')
})

test('conflicts cannot be masked by older valid receipts or invalid/ambiguous metadata', () => {
  const conflict = readStatementPeriodEvidence(metadata('conflicting'), 'Example')
  assert.equal(conflict.state, 'conflicting'); assert.equal(conflict.periodEnd, null)
  for (const bad of [
    { ...receipt(), start: '2026-07-01' }, { ...receipt(), end: '2026-02-30' },
    { ...receipt(), source: '../private.pdf' }, { ...receipt(), source: 'folder\\file.pdf' },
    { ...receipt(), sha256: '' }, { ...receipt(), page: 2 },
  ]) assert.equal(readStatementPeriodEvidence(metadata('declared', [receipt('valid.pdf'), bad]), 'Example').periodEnd, null)
  const duplicate = metadata('declared', [receipt(), { ...receipt(), end: '2026-07-31' }])
  assert.equal(readStatementPeriodEvidence(duplicate, 'Example').state, 'conflicting')
  assert.equal(readStatementPeriodEvidence({ statementPeriods: { schemaVersion: 9, accounts: {} } }, 'Example').state, 'unconfirmed')
})

test('KR extractor preserves explicit periods separately from pins and flags source-row contradictions', () => {
  const script = path.resolve(import.meta.dirname, '../scripts/extract-kr-statements.py')
  const code = `
import importlib.util,json,tempfile,hashlib
from pathlib import Path
${minimalPdf}
spec=importlib.util.spec_from_file_location('extract',${JSON.stringify(script)})
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as folder:
 root=Path(folder)
 (root/'old.pdf').write_bytes(pdf_bytes('2026/01/01 ~ 2026/06/30'))
 (root/'new.pdf').write_bytes(pdf_bytes('2026/07/01 ~ 2026/07/31'))
 (root/'missing.pdf').write_bytes(pdf_bytes('No period printed'))
 declared={('Example','old.pdf'):('2026-01-01','2026-06-30'),('Example','new.pdf'):('2026-07-01','2026-07-31'),('Unknown','missing.pdf'):(None,None)}
 rows=[{'Account':'Example','Source':'new.pdf','Date':'2026-07-20'}]
 periods=m.statement_period_receipts(declared,rows,root)
 m.write_as_of(root/'as-of.json',{'Example':'2026-12-31'},periods)
 output=json.loads((root/'as-of.json').read_text())
 assert output['accounts']['Example']=='2026-12-31'
 assert output['statementPeriods']['accounts']['Example']['state']=='declared'
 assert output['statementPeriods']['accounts']['Example']['sources'][1]['end']=='2026-07-31'
 assert output['statementPeriods']['accounts']['Example']['sources'][0]['sha256']==hashlib.sha256((root/'old.pdf').read_bytes()).hexdigest()
 assert output['statementPeriods']['accounts']['Unknown']['state']=='unconfirmed'
 rows[0]['Date']='2026-08-01'
 conflict=m.statement_period_receipts(declared,rows,root)
 assert conflict['accounts']['Example']['state']=='conflicting'
 declared[('Example','new.pdf')]=('2026-07-31','2026-07-01')
 assert m.statement_period_receipts(declared,[],root)['accounts']['Example']['state']=='conflicting'
 missing=m.statement_period_receipts({('Lost','absent.pdf'):('2026-01-01','2026-06-30')},[],root)
 assert missing['accounts']['Lost']['state']=='unconfirmed'
 print('ok')
`
  assert.equal(execFileSync('python3', ['-c', code], { encoding: 'utf8' }).trim(), 'ok')
})

test('duplicate conflicts are permutation-independent and transcription locators cannot claim PDF page evidence', () => {
  const versions = [receipt(), { ...receipt(), end: '2026-07-31' }]
  assert.deepEqual(readStatementPeriodEvidence(metadata('declared', versions), 'Example'), readStatementPeriodEvidence(metadata('declared', [...versions].reverse()), 'Example'))
  assert.equal(readStatementPeriodEvidence(metadata('declared', [{ ...receipt(), source: 'example.txt' }]), 'Example').periodEnd, null)
})

test('PDF receipts read each part independently and reject replacement/transcription evidence', () => {
  const script = path.resolve(import.meta.dirname, '../scripts/extract-kr-statements.py')
  const code = `
import importlib.util,tempfile,hashlib
from pathlib import Path
${minimalPdf}
spec=importlib.util.spec_from_file_location('extract',${JSON.stringify(script)})
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as folder:
 root=Path(folder);span=('2026-01-01','2026-06-30')
 (root/'part-1of2.pdf').write_bytes(pdf_bytes('2026/01/01 ~ 2026/06/30'))
 (root/'part-2of2.pdf').write_bytes(pdf_bytes('No period on this part'))
 declared={('Example','part-1of2.pdf'):span,('Example','part-2of2.pdf'):span}
 result=m.statement_period_receipts(declared,[],root)
 assert result['accounts']['Example']['state']=='unconfirmed'
 assert [r['source'] for r in result['accounts']['Example']['sources']]==['part-1of2.pdf']
 expected={'part-1of2.pdf':hashlib.sha256((root/'part-1of2.pdf').read_bytes()).hexdigest()}
 (root/'part-1of2.pdf').write_bytes(pdf_bytes('2026/07/01 ~ 2026/07/31'))
 replaced=m.statement_period_receipts({('Example','part-1of2.pdf'):span},[],root,expected_digests=expected)
 assert replaced['accounts']['Example']['state']=='unconfirmed'
 assert replaced['accounts']['Example']['sources']==[]
 (root/'example.txt').write_text('2026/01/01 ~ 2026/06/30')
 transcript=m.statement_period_receipts({('Example','example.txt'):span},[],root)
 assert transcript['accounts']['Example']['state']=='unconfirmed'
 print('ok')
`
  assert.equal(execFileSync('python3', ['-c', code], { encoding: 'utf8' }).trim(), 'ok')
})
