import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

// The pension and gold documents the filer has to recognise: 미래에셋 IRP and
// 금현물 거래내역증명서, the 삼성 연금저축 ledger, the hand-made pension holdings
// snapshot, and the year-end 잔고현황 / 잔고증명서 kept as evidence.
//
// Every fixture is invented. The text on each page is the real documents'
// LAYOUT — titles, labels, where the 기준일 and the 계좌유형 sit — with every
// account number, name and amount made up, because the labels are what the
// detectors read and this repository is public.

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const PY = process.env.STOCK_PYTHON_BIN || 'python3'

/**
 * A minimal PDF whose pages carry `pages[i]` as lines of text.
 *
 * Hangul goes through a CID font (Adobe-Korea1, UniKS-UCS2-H), which needs no
 * embedded font file: pdfminer maps the codes back to Unicode from its own
 * CMaps. That keeps the fixtures dependency-free, so they run in CI, which
 * installs only pdfplumber.
 */
function pdfOf(pages: string[][]): Buffer {
  const hex = (s: string) => Buffer.from(s, 'utf16le').swap16().toString('hex').toUpperCase()
  const objs: (string | null)[] = []
  const add = (body: string | null) => objs.push(body)
  const font = add('<< /Type /Font /Subtype /Type0 /BaseFont /HYGoThic-Medium /Encoding /UniKS-UCS2-H /DescendantFonts [ 2 0 R ] >>')
  add('<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYGoThic-Medium /CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 1 >> /FontDescriptor 3 0 R /DW 1000 >>')
  add('<< /Type /FontDescriptor /FontName /HYGoThic-Medium /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>')
  const pagesId = add(null)
  const kids: number[] = []
  for (const lines of pages) {
    const ops = lines.map((line, i) => `BT /F1 8 Tf 20 ${800 - i * 14} Td <${hex(line)}> Tj ET`).join('\n')
    const content = add(`<< /Length ${Buffer.byteLength(ops)} >>\nstream\n${ops}\nendstream`)
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 842 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`))
  }
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

const PENSION_MAP = {
  pensionAccounts: [
    { token: 'irp', account: '미래에셋증권(IRP)', wrapper: 'irp', institution: '미래에셋증권' },
    { token: 'pension-savings', account: '삼성증권(연금저축)', wrapper: 'pension_savings', institution: '삼성증권' },
  ],
}

/** Run the filer over an inbox holding `files`, with the test's own account map (or none), and return its plan. */
function fileDownloads(files: Record<string, string | Buffer>, map?: object) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'pension-inbox-'))
  mkdirSync(path.join(dataDir, 'inbox'), { recursive: true })
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dataDir, 'inbox', name), body)
  const mapPath = path.join(dataDir, map ? 'map.json' : 'no-map.json')
  if (map) writeFileSync(mapPath, JSON.stringify(map))
  const result = spawnSync(PY, ['scripts/file-downloads.py', '--dry-run'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, STOCK_DATA_DIR: dataDir, STOCK_ACCOUNT_MAP_PATH: mapPath, STOCK_PDF_PASSWORD: '' },
  })
  assert.equal(result.status, 0, `filer exited ${result.status}: ${result.stderr}`)
  return result.stdout
}

// --- 미래에셋 거래내역증명서: the IRP and the 금현물 accounts -------------------
//
// Which account a certificate belongs to is the account map's entry for the full
// 계좌번호 it prints (scripts/mirae_accounts.py). These numbers are invented.

const MIRAE_NUMBERS = { irp: '900-000000001', gold: '900-000000002', cma: '900-000000003', general: '900-000000004' }
const MIRAE_MAP = {
  ...PENSION_MAP,
  pensionAccounts: [{ ...PENSION_MAP.pensionAccounts[0], accountNumber: MIRAE_NUMBERS.irp }, PENSION_MAP.pensionAccounts[1]],
  brokerageAccounts: [
    { institution: 'mirae', accountNumber: MIRAE_NUMBERS.gold, kind: 'gold' },
    { institution: 'mirae', accountNumber: MIRAE_NUMBERS.general, kind: 'general' },
  ],
  bankAccounts: [{ institution: 'mirae', kind: 'cma', accountNumber: MIRAE_NUMBERS.cma, currency: 'KRW', alias: '예시 CMA' }],
}

const miraeCertificate = (accountType: string, number: string, window = '2020/01/01 ~ 2026/10/10') =>
  pdfOf([
    ['거래내역 증 명 서', 'N O. 2026-001-00000099', '제공내역(provided information)', window, '미래에셋증권 대표이사 예시대표'],
    [
      '계좌정보 페이지: 01/01',
      `계좌번호 ${number} 계좌유형 ${accountType} 고객명 예시고객 거래일자 20200101 ~ 20261010`,
      '거래구분 CMA자동매매 제외 상품구분 전체 종목구분 전체 CMARP/MMW포함 N',
    ],
  ])

test('a 미래에셋 IRP certificate files by the pensionAccounts entry for its 계좌번호', () => {
  const out = fileDownloads({ '거래내역증명서_20261010_1.pdf': miraeCertificate('퇴직연금_개인IRP', MIRAE_NUMBERS.irp) }, MIRAE_MAP)
  assert.match(out, /→ kr-statements\/mirae-irp-transactions-20200101-20261010\.pdf/)
  assert.match(out, /\*\*\*\*0001 is irp in the account map/)
  assert.doesNotMatch(out, /900-?000000001/)
})

test('a 미래에셋 금현물 certificate files as gold, named for its whole window rather than as an as-of', () => {
  const out = fileDownloads({ '거래내역증명서_20261010_2.pdf': miraeCertificate('금현물', MIRAE_NUMBERS.gold, '2026/01/01 ~ 2026/10/10') }, MIRAE_MAP)
  assert.match(out, /→ kr-statements\/mirae-gold-transactions-20260101-20261010\.pdf/)
})

// The CMA is a deposit account, so it files as a bank statement and never
// reaches the KR statement extractor's mirae-* glob.
test('a 미래에셋 certificate whose number the map lists as the CMA files as the CMA bank statement', () => {
  const out = fileDownloads({ 'x.pdf': miraeCertificate('종합_CMA', MIRAE_NUMBERS.cma) }, MIRAE_MAP)
  assert.match(out, /→ bank-statements\/mirae-cma-20200101-20261010\.pdf/)
  assert.doesNotMatch(out, /kr-statements\/mirae-general/)
})

test('a 미래에셋 certificate whose number the map lists as the general account files as it', () => {
  const out = fileDownloads({ 'x.pdf': miraeCertificate('종합', MIRAE_NUMBERS.general) }, MIRAE_MAP)
  assert.match(out, /→ kr-statements\/mirae-general-transactions-20200101-20261010-99\.pdf/)
})

test('a recognisable 계좌유형 does not file a certificate whose number the map lacks', () => {
  for (const type of ['퇴직연금_개인IRP', '종합', '예시유형']) {
    const out = fileDownloads({ 'x.pdf': miraeCertificate(type, '900-000000099') }, MIRAE_MAP)
    assert.match(out, /recognised but not filed[\s\S]*\*\*\*\*0099 is not in the account map/)
  }
  const out = fileDownloads({ 'x.pdf': miraeCertificate('종합', MIRAE_NUMBERS.general) })
  assert.match(out, /recognised but not filed[\s\S]*not in the account map/)
})

// --- 삼성증권 연금저축 ledger ---------------------------------------------------

const samsungLedger = (accountText: string, dateLine = 'Reference All Date 2023-10-24 ~ 2025-12-31') =>
  pdfOf([
    [
      'LEDGER A/C TRANSACTIONS DETAIL',
      '[2026-10-08 02:24:44]',
      `Account No. 00000000-15 ${accountText} Name 예시고객(EXAMPLE NAME)`,
      dateLine,
      'Trade Date Trade Type Trade Qty. Trade Amt.',
    ],
  ])

test('the 삼성 연금저축 ledger files by the period line it prints', () => {
  const out = fileDownloads({ '삼성증권_연금저축_거래내역확인서_00000.pdf': samsungLedger('연금저축 CMA(비대면)(회사지원)') })
  assert.match(out, /→ kr-statements\/samsung-pension-transactions-20231024-20251231\.pdf/)
})

test('a 삼성 ledger with no period line is refused, and one that is not 연금저축 is not claimed', () => {
  const noPeriod = fileDownloads({ 'a.pdf': samsungLedger('연금저축 CMA(비대면)', 'Reference All') })
  assert.match(noPeriod, /recognised but not filed[\s\S]*a\.pdf[\s\S]*Date YYYY-MM-DD ~ YYYY-MM-DD/)
  const other = fileDownloads({ 'b.pdf': samsungLedger('종합 CMA(비대면)') })
  assert.match(other, /unidentified[\s\S]*b\.pdf/)
})

// --- the hand-made pension holdings snapshot -----------------------------------

const HOLDINGS = [
  'type,name,ticker,quantity,cost_krw,value_krw',
  'ETF,예시 200,069500,3,90000,100000',
  'FUND,예시증권자투자신탁(주식)종류C-Pe,,,500000,550000',
  'CASH,예시현금성자산,,,0,12345',
].join('\n')
const LEGACY_HOLDINGS = ['type,name,quantity,cost_krw,value_krw', 'CASH,예시현금성자산,,0,12345'].join('\n')

test('a pension holdings CSV is filed under the name that carries its account and date', () => {
  assert.match(fileDownloads({ 'irp-holdings-20261008.csv': HOLDINGS }, PENSION_MAP), /→ pension\/irp-holdings-20261008\.csv/)
  assert.match(
    fileDownloads({ 'pension-savings-holdings-20261008.csv': LEGACY_HOLDINGS }, PENSION_MAP),
    /→ pension\/pension-savings-holdings-20261008\.csv/
  )
})

test('a pension holdings CSV saved with a UTF-8 BOM still matches its header', () => {
  assert.match(fileDownloads({ 'irp-holdings-20261008.csv': '\uFEFF' + HOLDINGS }, PENSION_MAP), /→ pension\/irp-holdings-20261008\.csv/)
})

test('a BOM that survives decoding is stripped before the exact header match', () => {
  // Document.lines decodes with utf-8-sig, which removes one BOM. A file that was
  // re-saved with a BOM on top of one still starts its header with U+FEFF.
  assert.match(fileDownloads({ 'irp-holdings-20261008.csv': '\uFEFF\uFEFF' + HOLDINGS }, PENSION_MAP), /→ pension\/irp-holdings-20261008\.csv/)
})

test('a pension holdings CSV whose name carries no known account is refused with the name to use', () => {
  const unknown = fileDownloads({ 'other-holdings-20261008.csv': HOLDINGS }, PENSION_MAP)
  assert.match(unknown, /recognised but not filed[\s\S]*other-holdings-20261008\.csv/)
  assert.match(unknown, /<token>-holdings-YYYYMMDD\.csv/)
  assert.match(unknown, /irp, pension-savings/)
  const unnamed = fileDownloads({ 'Download.csv': HOLDINGS }, PENSION_MAP)
  assert.match(unnamed, /recognised but not filed[\s\S]*Download\.csv[\s\S]*<token>-holdings-YYYYMMDD\.csv/)
  const noMap = fileDownloads({ 'irp-holdings-20261008.csv': HOLDINGS })
  assert.match(noMap, /recognised but not filed[\s\S]*pensionAccounts/)
})

// --- year-end evidence ----------------------------------------------------------

const IRP_BALANCE_STATUS = pdfOf([
  [
    '퇴직연금 잔고현황',
    '기준일자 : 2025-12-31',
    '1 / 2',
    '● 고객정보',
    '가입자명 예시고객 주민번호 000000-1******',
    '제도유형 개인형IRP 가입일자 2021년09월23일',
    '플랜번호 000-000-000 해당통화 KRW',
    '● 상품별 자산현황',
  ],
  ['합 계 1,000,000 1 1,100,000', '위와 같이 퇴직연금 잔고현황을 확인합니다.', '2026년 10월 08일 미래에셋증권'],
])

const irpBalanceCertificate = (title: string) =>
  pdfOf([
    [
      title,
      '인쇄자 : 온라인 발급 Page : 1 / 2',
      '계좌번호 계 좌 명 부 기 명 실명확인번호',
      '000-00-000000-0 예시고객',
      '기 준 일 자 발 급 일 시 용 도 출 력 평 가',
      '2024-12-31 2026-10-08 10:00:00 관공서제출용 계좌별 세전',
      '▶ 유가증권잔고',
      '신탁 1,100,000',
      '미래에셋증권 대표이사 예시대표',
    ],
    [
      '보 유 유 가 증 권 상 세 명 세 서',
      '계좌번호 : 000-00-000000-0 기 준 일 : 2024-12-31 발 급 번 호 : 2026-001-00000001',
      '종 목 명 수 량 매 입 단 가 기 준 가 평 가 금 액 비 고',
      '개인형IRP 1,000,000.00 1,100,000 신탁',
      '▷ 상장주식, 코스닥상장주식, 선물옵션, 금현물은 기준일자의 현재가',
      '▷ 신탁수익증권 : 좌, 투자계약증권 : 주',
    ],
  ])

const samsungBalanceCertificate = (asOf = '2025.12.31') =>
  pdfOf([
    [
      '[ 발급번호 : 000000 ] 1/3 페이지',
      '잔 고 증 명 서',
      '성명 예시고객',
      `기준일자 ${asOf} 발급일자 2026.10.08 08:50 용도 확인용`,
      '현금잔고(1) 부채잔고(2)',
      '2.계좌별내역',
      '삼성증권주식회사 (Tel : 0000-0000)',
    ],
    [
      '[ 발급번호 : 000000 ] 2/3페이지',
      '【유가증권 상세내역】',
      '계좌번호 종목명 구분 수량 가격 평가금액 매입금액',
      '00000000-15 예시MMF 수익증권 1,000 1,000.00 1,000 1,000',
    ],
  ])

test('the IRP 잔고현황 files as year-end evidence, dated by its 기준일자', () => {
  const out = fileDownloads({ '잔고현황.pdf': IRP_BALANCE_STATUS }, PENSION_MAP)
  assert.match(out, /→ pension\/evidence\/irp-balance-status-20251231\.pdf/)
})

test('both titles of the IRP 잔고증명서 file as evidence, and the 미래에셋 balance detector stands aside', () => {
  for (const title of ['특 정 (종 목) 잔 고 증 명 서', '잔 고 증 명 서']) {
    const out = fileDownloads({ 'cert.pdf': irpBalanceCertificate(title) }, PENSION_MAP)
    assert.match(out, /→ pension\/evidence\/irp-balance-certificate-20241231\.pdf/, title)
    assert.doesNotMatch(out, /recognised but not filed/, title)
  }
})

test('the 삼성 연금저축 잔고증명서 files as evidence by its own 기준일자, in either year form', () => {
  assert.match(
    fileDownloads({ 's.pdf': samsungBalanceCertificate('2025.12.31') }, PENSION_MAP),
    /→ pension\/evidence\/pension-savings-balance-certificate-20251231\.pdf/
  )
  assert.match(
    fileDownloads({ 's.pdf': samsungBalanceCertificate('24.12.31') }, PENSION_MAP),
    /→ pension\/evidence\/pension-savings-balance-certificate-20241231\.pdf/
  )
})

test('evidence whose account the map does not declare is refused, naming the map entry it needs', () => {
  const out = fileDownloads({ 's.pdf': samsungBalanceCertificate(), 'cert.pdf': irpBalanceCertificate('잔 고 증 명 서') })
  assert.match(out, /recognised but not filed[\s\S]*pensionAccounts/)
  assert.doesNotMatch(out, /→ pension\/evidence/)
})

test('an unpinned 삼성 certificate still files, but says what it was matched on and recommends pinning', () => {
  const out = fileDownloads({ 's.pdf': samsungBalanceCertificate() }, PENSION_MAP)
  assert.match(out, /→ pension\/evidence\/pension-savings-balance-certificate-20251231\.pdf/)
  assert.match(out, /matched on issuer, title and 수익증권 only/)
  assert.match(out, /set accountNumber/)
})

test('a pinned accountNumber must match the 삼성 certificate', () => {
  const pinned = {
    pensionAccounts: PENSION_MAP.pensionAccounts.map((entry) =>
      entry.institution === '삼성증권' ? { ...entry, accountNumber: '11111111-15' } : entry
    ),
  }
  const out = fileDownloads({ 's.pdf': samsungBalanceCertificate() }, pinned)
  assert.match(out, /recognised but not filed[\s\S]*accountNumber/)
  const matching = {
    pensionAccounts: PENSION_MAP.pensionAccounts.map((entry) =>
      entry.institution === '삼성증권' ? { ...entry, accountNumber: '00000000-15' } : entry
    ),
  }
  assert.match(
    fileDownloads({ 's.pdf': samsungBalanceCertificate() }, matching),
    /→ pension\/evidence\/pension-savings-balance-certificate-20251231\.pdf[\s\S]*계좌번호 matches the map/
  )
})
