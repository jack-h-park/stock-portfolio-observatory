import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

// Extraction of the pension and gold sources: the 미래에셋 IRP and 금현물
// 거래내역증명서 through the 미래에셋 parser, the 삼성 연금저축 ledger through the
// 삼성 parser, and the year-end 잔고현황 / 잔고증명서 into pension-evidence.json.
//
// The parsers read what pdfplumber hands back: page text and extracted tables.
// These tests replace pdfplumber with a stub that returns exactly that, from a
// JSON page fixture, so the fixtures are the documents' LAYOUT (cell positions,
// stacked lines, labels) with every name, account number and amount invented.
// The table detection itself is pdfplumber's and is exercised on the real files
// by hand, not here: this repository is public.

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const PY = process.env.STOCK_PYTHON_BIN || 'python3'

const PDFPLUMBER_STUB = `
import builtins, json

class _Page:
    def __init__(self, data):
        self._data = data
    def extract_text(self):
        return self._data.get("text", "")
    def extract_tables(self):
        return self._data.get("tables", [])

class _Pdf:
    def __init__(self, data):
        self.pages = [_Page(p) for p in data["pages"]]
    def __enter__(self):
        return self
    def __exit__(self, *exc):
        return False
    def close(self):
        pass

def open(path, password=None):
    with builtins.open(path, encoding="utf-8") as fh:
        return _Pdf(json.load(fh))
`

type Cell = string | null
type Table = Cell[][]
type Page = { text?: string; tables?: Table[] }

function stubDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'pdfplumber-stub-'))
  writeFileSync(path.join(dir, 'pdfplumber.py'), PDFPLUMBER_STUB, 'utf8')
  return dir
}

function writeDoc(file: string, pages: Page[]) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ pages }), 'utf8')
}

// --- 미래에셋 거래내역증명서 -----------------------------------------------------

const blank = () => Array<Cell>(12).fill('')

const MIRAE_HEADER: Table = [
  ['거래내역', ...Array(11).fill(null)],
  ['거래일자', '거래종류', null, null, '종목번호 / 기타', '수수료', '거래금액', '예수금잔액', '외화거래금액', '외화예수금', '미수총잔고', '미수발생금액'],
  ['거래번호', '원번호', '거래수량', '단가', '종목명', '제세금합', '입출금액', '유가잔고', '외화입출금액', '외화유가잔고', '통화코드', '미수변제금액'],
  ['상대금융기관', null, '상대계좌번호', null, '상대고객명', '(CD기)은행', null, '대출상환금액', '대출이자금액', '환율', '처리점', '처리시각'],
]

type MiraeRecord = {
  date: string; type: string; code?: string; fee?: string; amount?: string; cash?: string
  no?: string; qty?: string; price?: string; name?: string; tax?: string; flow?: string; held?: string
  counterparty?: string; branch?: string
}

/** One transaction: the certificate's three physical rows (A, B, C). */
function miraeRecord(r: MiraeRecord): Table {
  const a = blank(), b = blank(), c = blank()
  a[0] = r.date; a[1] = r.type; a[4] = r.code ?? ''; a[5] = r.fee ?? ''; a[6] = r.amount ?? ''; a[7] = r.cash ?? ''
  b[0] = r.no ?? '1'; b[1] = '0'; b[2] = r.qty ?? ''; b[3] = r.price ?? ''; b[4] = r.name ?? ''
  b[5] = r.tax ?? ''; b[6] = r.flow ?? ''; b[7] = r.held ?? ''
  c[0] = r.counterparty ?? ''; c[10] = r.branch ?? 'Direct0'; c[11] = '10:00:00'
  return [a, b, c]
}

function miraeCertificate(accountType: string, window: string, records: MiraeRecord[]): Page[] {
  return [
    { text: `거래내역 증 명 서\nN O. 2026-001-00000099\n제공내역(provided information)\n${window}\n미래에셋증권 대표이사 예시대표`, tables: [] },
    {
      text: `계좌정보 페이지: 01/01\n계좌번호 000-00 계좌유형 ${accountType} 고객명 예시고객`,
      tables: [
        [['계좌번호', '000-00', '계좌유형', accountType, '고객명', '예시고객', '거래일자', '20200101 ~ 20261010', null, null, null]],
        [...MIRAE_HEADER, ...records.flatMap(miraeRecord)],
      ],
    },
  ]
}

const IRP_RECORDS: MiraeRecord[] = [
  { date: '2021/09/23', type: '계좌대체입금', amount: '1,000,000', cash: '1,000,000', flow: '1,000,000', counterparty: '미래에셋증권' },
  // The B row's 종목명 cell holds the customer's name on this type, not a product.
  { date: '2021/09/23', type: '신탁계약출금', code: 'R0000000001', amount: '1,000,000', cash: '0', name: '예시고객', flow: '1,000,000', counterparty: '미래에셋증권(신탁)' },
]

const GOLD = 'M04020000'
const GOLD_NAME = '금 현물 99.99_1Kg'
const GOLD_RECORDS: MiraeRecord[] = [
  { date: '2026/01/02', type: '계좌대체입금', amount: '900,000', cash: '900,000', flow: '900,000', counterparty: '미래에셋증권' },
  { date: '2026/01/05', type: '금현물매수입고', code: GOLD, amount: '300,000', qty: '2', price: '150,000', name: GOLD_NAME, held: '2' },
  { date: '2026/01/05', type: '금현물매수출금', code: GOLD, amount: '300,000', cash: '600,000', name: GOLD_NAME, flow: '300,000' },
  { date: '2026/02/03', type: '금현물매수입고', code: GOLD, fee: '1,000', amount: '480,000', qty: '3', price: '160,000', name: GOLD_NAME, held: '5' },
  { date: '2026/02/03', type: '금현물매수출금', code: GOLD, fee: '1,000', amount: '481,000', cash: '119,000', name: GOLD_NAME, flow: '481,000' },
  { date: '2026/02/27', type: '금현물보관수수료', fee: '500', amount: '500', cash: '118,500', flow: '500' },
  { date: '2026/02/27', type: '금현물보관수수료세금', fee: '50', amount: '50', cash: '118,450', flow: '50' },
]

// --- 삼성증권 연금저축 ledger -----------------------------------------------------

const SAMSUNG_HEADER: Table = [
  ['Trade Date', 'Trade Type', 'Trade Qty.', 'Trade Amt.', 'Tax/Loan rate\nCommission/\nFee', 'Remaining Cash.\nFund Evaluation\nPrice', 'Rcv Acct Name', 'Tender Amount', 'Currency Code\nForeign Trade\nAmt.', 'Estimate\nExchange Amt.\nForeign Cash\nReserve.', 'User Location', 'Time'],
  ['Trade Num', 'Stock Name', 'Trade Cost', 'Calculated Amt', null, null, 'Rcv Acct Num', 'Credit/Loan Amt', null, null, null, 'User Name'],
]

/** One ledger row: every cell holds two or three stacked values. */
function ledgerRow(date: string, no: string, typeAndName: string, qtyPrice: string, amount: string, balance: string, counterparty = '', currency = '0'): Cell[] {
  return [`${date}\n${no}`, typeAndName, qtyPrice, amount, '0\n0', balance, counterparty, '0', currency, '0', 'Digital Business\nOperation Support\nTeam', '10:00:00']
}

const SAMSUNG_ROWS: Cell[][] = [
  ledgerRow('2024/01/02', '1', 'Deposit', '0\n0.00', '500,000\n500,000', '500,000\n0', '예시은행'),
  ledgerRow('2024/01/03', '2', 'Buy\n(1234567)Example Target\nDate Fund C-Pe', '400,000\n1,000.00', '400,000\n400,000', '100,000\n400,000', '', 'KRW\n0'),
  ledgerRow('2024/02/01', '3', 'Interest\nSamsung NewType MMF D2(CP)', '0\n0.00', '120\n120', '100,120\n400,000'),
  ledgerRow('2024/02/01', '4', 'Reinvestment\n(7654321)Samsung NewType MMF D2(CP)', '120\n1,000.00', '120\n120', '100,000\n400,120', '', 'KRW\n0'),
  ledgerRow('2024/03/04', '5', 'Sell\n(1234567)Example Target\nDate Fund C-Pe', '100,000\n1,010.00', '101,000\n101,000', '201,000\n303,000', '', 'KRW\n0'),
  ledgerRow('2024/03/05', '6', 'After Hours Sell\n(1234567)Example Target\nDate Fund C-Pe', '50,000\n1,020.00', '51,000\n51,000', '252,000\n255,000', '', 'KRW\n0'),
]

function samsungLedger(totalDeposit: string): Page[] {
  return [
    {
      text: 'LEDGER A/C TRANSACTIONS DETAIL\n[2026-10-08 02:24:44]\nAccount No. 0000000000-15 연금저축 CMA(비대면)(회사지원) Name 예시고객(EXAMPLE NAME)\nReference All Date 2024-01-01 ~ 2025-12-31',
      tables: [
        [
          ['Account No.', '0000000000-15 연금저축 CMA(비대면)(회사지원)', 'Name', '예시고객(EXAMPLE NAME)'],
          ['Reference', 'All', 'Date', '2024-01-01 ~ 2025-12-31'],
        ],
        [...SAMSUNG_HEADER, ...SAMSUNG_ROWS],
      ],
    },
    {
      text: `Total Deposit(A) ${totalDeposit} Total Debit(B) 0 Balance(A-B) ${totalDeposit}\n- The End -\nSAMSUNG SECURITIES CO. , LTD`,
      tables: [[['Total Deposit(A)', totalDeposit, 'Total Debit(B)', '0', '', 'Balance(A-B)', totalDeposit]]],
    },
  ]
}

type Row = Record<string, string>

function readTsv(file: string): Row[] {
  const [head, ...lines] = readFileSync(file, 'utf8').trimEnd().split('\n')
  const cols = head.split('\t')
  return lines.map((line) => Object.fromEntries(line.split('\t').map((v, i) => [cols[i], v])))
}

// Total Deposit(A) is the Deposit rows plus the Interest credited: 500,000 + 120.
function runKrExtract(samsungTotal = '500,120') {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'pension-extract-'))
  const outDir = path.join(dataDir, 'out')
  const statements = path.join(dataDir, 'kr-statements')
  writeDoc(path.join(statements, 'mirae-irp-transactions-20200101-20261010.pdf'),
    miraeCertificate('퇴직연금_개인IRP', '2020/01/01 ~ 2026/10/10', IRP_RECORDS))
  writeDoc(path.join(statements, 'mirae-gold-transactions-20260101-20261010.pdf'),
    miraeCertificate('금현물', '2026/01/01 ~ 2026/10/10', GOLD_RECORDS))
  writeDoc(path.join(statements, 'samsung-pension-transactions-20240101-20251231.pdf'), samsungLedger(samsungTotal))
  const result = spawnSync(PY, ['scripts/extract-kr-statements.py'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONPATH: stubDir(),
      STOCK_DATA_DIR: dataDir,
      STOCK_KR_STATEMENTS_DIR: outDir,
      STOCK_TOSS_SNAPSHOT_PATH: path.join(dataDir, 'no-toss.json'),
      STOCK_PDF_PASSWORD: '',
      STOCK_KR_AS_OF: '',
    },
  })
  assert.equal(result.status, 0, `extractor exited ${result.status}: ${result.stderr}`)
  const report = JSON.parse(readFileSync(path.join(outDir, 'extract-report.json'), 'utf8'))
  const kinds = new Set<string>(report.findings.map((f: { kind: string }) => f.kind))
  return { transactions: readTsv(path.join(outDir, 'transactions.tsv')), kinds, findings: report.findings, stdout: result.stdout }
}

let shared: ReturnType<typeof runKrExtract> | undefined
const krRun = () => (shared ??= runKrExtract())
const byAccount = (account: string) => krRun().transactions.filter((r) => r.Account === account)

test('(a) the IRP certificate: 계좌대체입금 is a DEPOSIT and 신탁계약출금 a TRUST_OUT, under 미래에셋증권(IRP)', () => {
  const rows = byAccount('미래에셋증권(IRP)')
  assert.deepEqual(rows.map((r) => [r.Type, r['Raw Type']]), [['DEPOSIT', '계좌대체입금'], ['TRUST_OUT', '신탁계약출금']])
  assert.equal(rows[0]['Amount (KRW)'], '1000000.0')
  // The trust row carries the customer's name in 종목명 and a contract code in
  // 종목번호; neither is a security, and the name must not reach a TSV.
  assert.equal(rows[1].Name, '')
  assert.equal(rows[1].Ticker, '')
  assert.ok(!krRun().kinds.has('mirae-unmapped-type'), JSON.stringify(krRun().findings))
})

test('(b) the gold certificate: purchases in grams, the 매수출금 cash legs dropped, storage fees as FEE', () => {
  const rows = byAccount('미래에셋증권(금현물)')
  const buys = rows.filter((r) => r.Type === 'BUY')
  assert.equal(buys.length, 2)
  for (const buy of buys) {
    assert.equal(buy.Ticker, GOLD)
    assert.equal(buy.Name, GOLD_NAME)
    assert.equal(Number(buy['Native Amount']), Number(buy.Quantity) * Number(buy['Unit Price']))
  }
  assert.deepEqual(buys.map((r) => Number(r.Quantity)), [2, 3])
  assert.ok(!rows.some((r) => r['Raw Type'] === '금현물매수출금'), 'a cash leg was kept')
  assert.deepEqual(rows.filter((r) => r.Type === 'FEE').map((r) => r['Raw Type']), ['금현물보관수수료', '금현물보관수수료세금'])
  // A transfer between the owner's own accounts stays internal on this account.
  assert.equal(rows.find((r) => r['Raw Type'] === '계좌대체입금')?.Type, 'INTERNAL_TRANSFER')
  // 유가잔고 is the running gram balance; the walk agrees with it.
  assert.ok(!krRun().kinds.has('share-balance-break'), JSON.stringify(krRun().findings))
})

test('(c) the 삼성 연금저축 ledger: English types, the pension label, and a passing totals check', () => {
  const rows = byAccount('삼성증권(연금저축)')
  assert.deepEqual(rows.map((r) => r.Type), ['DEPOSIT', 'BUY', 'INTEREST', 'REINVEST', 'SELL', 'SELL'])
  assert.deepEqual(rows.map((r) => r['Raw Type']), ['Deposit', 'Buy', 'Interest', 'Reinvestment', 'Sell', 'After Hours Sell'])
  const buy = rows[1]
  assert.equal(buy.Name, 'Example Target Date Fund C-Pe')
  assert.equal(Number(buy.Quantity), 400000)
  assert.equal(Number(buy['Native Amount']), 400000)
  const { kinds, findings } = krRun()
  for (const kind of ['totals-break', 'no-totals', 'samsung-unmapped-type', 'samsung-unresolved-symbol', 'share-balance-break']) {
    assert.ok(!kinds.has(kind), `${kind}: ${JSON.stringify(findings)}`)
  }
})

test('(c) a ledger whose Total Deposit disagrees with its Deposit rows is reported', () => {
  const run = runKrExtract('600,000')
  assert.ok(run.kinds.has('totals-break'), JSON.stringify(run.findings))
})

// --- year-end evidence ---------------------------------------------------------

function balanceStatus(): Page[] {
  return [
    {
      text: '퇴직연금 잔고현황\n기준일자 : 2025-12-31\n제도유형 개인형IRP 가입일자 2021년09월23일\n● 상품별 자산현황',
      tables: [
        [['기준일자 :', '2025-12-31', null, null, null]],
        [
          ['가입자명', '예시고객', '주민번호', '000000-1******', null],
          ['제도유형', '개인형IRP', '가입일자', '2021년09월23일', null],
          ['플랜번호', '000-000-000', '해당통화', 'KRW', null],
        ],
        [
          ['* 납입원본 누계 (A)', null, null, '10,000,000', '원', null, null, null, null, null, null, null, null],
          ['손익금 누계 (B)', null, null, '2,000,000', '원', null, null, null, null, null, null, null, null],
          ['지급 누계 (C)', null, null, '0', '원', null, null, null, null, null, null, null, null],
          ['적립금 잔액 (A+B-C)', null, null, '12,000,000', '원', null, null, null, null, null, null, null, null],
          ['* 사용자부담금 0 원 / 가입자부담금 10,000,000 원', null, null, null, null, null, null, null, null, null, null, null, null],
        ],
        [
          ['상품명', null, '매입원금', '잔고수량', '평가금액', '자산기관'],
          ['미래에셋증권현금성자산', null, '0', '100,000', '100,000', '미래에셋증권'],
          ['예시자산운용 예시TDF2045\n증권자투자신탁(퇴직연금)', null, '5,000,000', '4,000,000', '6,000,000', '예시자산운용'],
        ],
      ],
    },
    {
      text: '위와 같이 퇴직연금 잔고현황을 확인합니다.\n2026년 10월 08일 미래에셋증권\n1 / 2',
      tables: [
        [
          // The page footer glued into the last product row, as on the real page 2.
          ['TIGER 예시지수\nETF', null, '4,000,000', '100', '5,900,000', '미래에셋증2권/ 2', '', '', ''],
          ['합 계', null, '9,000,000', '4,000,200', '12,000,000', ''],
        ],
      ],
    },
  ]
}

function irpBalanceCertificate(withTotal = true): Page[] {
  return [
    {
      text: `잔 고 증 명 서\n인쇄자 : 온라인 발급 Page : 1 / 2\n▶ 유가증권잔고\n${withTotal ? '잔고평가금액총액 합계 (1) - (2) - (3) + (4) ￦12,000,000' : ''}\n미래에셋증권 대표이사 예시대표`,
      tables: [
        [
          ['계좌번호', '000-000000-00-0', null, null, null, null],
          ['기 준 일 자', '발 급 일 시', '용 도', '출 력', '평 가', null],
          ['2025-12-31', '2026-01-29 10:00:00', '관공서제출용', '계좌별', '세전', null],
        ],
        [['구 분', '수 량', '평 가 금 액 ( 원 )', '비 고'], ['신탁', '', '12,000,000', '']],
      ],
    },
    {
      text: '보 유 유 가 증 권 상 세 명 세 서',
      tables: [[
        ['종 목 명', '수 량', '매 입 단 가', '기 준 가', '평 가 금 액', '비 고'],
        ['000-000000-00-0', null, null, null, null, null],
        ['개인형IRP', '', '10,000,000.00', '', withTotal ? '12,000,000' : '', '신탁'],
      ]],
    },
  ]
}

const SAMSUNG_FUNDS: [string, string, string, string, string][] = [
  ['삼성예시MMF-CP', '1,000,000', '1,000.00', '1,000,000', '1,000,000'],
  ['삼성예시TDF2045증권자투자신탁\nH[주식혼합-재간접형]\nC-Pe', '2,000,000', '1,100.00', '2,200,000', '2,000,000'],
  ['삼성예시미국S&P500인덱스\n증권자투자신탁\nC-Pe', '2,000,000', '1,200.00', '2,400,000', '2,000,000'],
  ['삼성예시코리아밸류\n증권자투자신탁C-Pe', '2,000,000', '1,050.00', '2,100,000', '2,000,000'],
  ['삼성예시글로벌채권\n증권자투자신탁C-Pe', '2,000,000', '1,000.00', '2,000,000', '2,000,000'],
  ['삼성예시나스닥100인덱스\n증권자투자신탁C-Pe', '2,000,000', '1,125.00', '2,250,000', '2,000,000'],
]

function samsungBalanceCertificate(): Page[] {
  return [
    {
      text: '[ 발급번호 : 000000 ] 1/3 페이지\n잔 고 증 명 서\n기준일자 25.12.31 발급일자 26.10.08 10:00 용도 확인용\n삼성증권주식회사 (Tel : 0000-0000)',
      tables: [
        [['기준일자', '25.12.31', '발급일자', '26.10.08 10:00', '용도', '확인용']],
        [
          ['현금잔고(1)', null, '부채잔고(2)', null, '총 유가증권 평가금액(3)', '총 잔고(1-2+3)'],
          ['원화', '외화(원화환산)', '원화', '외화(원화환산)', null, null],
          ['50,000', '0', '0', '0', '11,950,000', '12,000,000'],
        ],
        [
          ['계좌번호', '현금', '부채잔고', '유가증권 평가금액', '총 계좌잔고'],
          ['0000000000-15', '50,000', '0', '11,950,000', '12,000,000'],
          ['합계', '50,000', '0', '11,950,000', '12,000,000'],
        ],
      ],
    },
    {
      text: '【현금 상세내역】\n【유가증권 상세내역】',
      tables: [
        [['계좌번호', '통화', '잔고', '기준환율', '원화환산', '미수금'], ['0000000000-15', 'KRW', '50,000', '', '50,000', '0']],
        [
          ['계좌번호', '종목명', '구분', '수량', '가격', '평가금액', '매입금액'],
          ...SAMSUNG_FUNDS.map(([name, qty, price, value, cost], i) => [i === 0 ? '0000000000-15' : '', name, '수익증권', qty, price, value, cost]),
        ],
      ],
    },
    { text: '본 증명서는 확인용입니다.', tables: [] },
  ]
}

function runEvidence(docs: Record<string, Page[]>) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'pension-evidence-'))
  for (const [name, pages] of Object.entries(docs)) writeDoc(path.join(dataDir, 'pension', 'evidence', name), pages)
  const out = path.join(dataDir, 'out', 'pension-evidence.json')
  const result = spawnSync(PY, ['scripts/extract-pension-evidence.py'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: stubDir(), STOCK_DATA_DIR: dataDir, STOCK_PENSION_EVIDENCE_PATH: out, STOCK_PDF_PASSWORD: '' },
  })
  assert.equal(result.status, 0, `evidence extractor exited ${result.status}: ${result.stderr}`)
  return JSON.parse(readFileSync(out, 'utf8'))
}

test('(d) year-end evidence: the IRP 잔고현황, the IRP 잔고증명서 and the 삼성 잔고증명서', () => {
  const evidence = runEvidence({
    'irp-balance-status-20251231.pdf': balanceStatus(),
    'irp-balance-certificate-20251231.pdf': irpBalanceCertificate(),
    'pension-savings-balance-certificate-20251231.pdf': samsungBalanceCertificate(),
  })
  assert.match(evidence.generatedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.deepEqual(evidence.findings, [])
  const [irpCertificate, irpStatus, samsung] = evidence.certificates
  assert.deepEqual(irpStatus, {
    token: 'irp', kind: 'balance-status', asOf: '2025-12-31',
    totalKrw: 12000000, contributionsCumulativeKrw: 10000000, employerCumulativeKrw: 0, ownCumulativeKrw: 10000000,
    cashKrw: null,
    products: [
      { name: '미래에셋증권현금성자산', quantity: 100000, costKrw: 0, valueKrw: 100000 },
      { name: '예시자산운용 예시TDF2045 증권자투자신탁(퇴직연금)', quantity: 4000000, costKrw: 5000000, valueKrw: 6000000 },
      { name: 'TIGER 예시지수 ETF', quantity: 100, costKrw: 4000000, valueKrw: 5900000 },
    ],
    source: 'pension/evidence/irp-balance-status-20251231.pdf',
  })
  assert.deepEqual(irpCertificate, {
    token: 'irp', kind: 'balance-certificate', asOf: '2025-12-31',
    totalKrw: 12000000, contributionsCumulativeKrw: null, employerCumulativeKrw: null, ownCumulativeKrw: null,
    cashKrw: null, products: [],
    source: 'pension/evidence/irp-balance-certificate-20251231.pdf',
  })
  assert.equal(samsung.token, 'pension-savings')
  assert.equal(samsung.kind, 'balance-certificate')
  assert.equal(samsung.asOf, '2025-12-31')
  assert.equal(samsung.totalKrw, 12000000)
  assert.equal(samsung.cashKrw, 50000)
  assert.equal(samsung.contributionsCumulativeKrw, null)
  assert.equal(samsung.products.length, 6)
  assert.deepEqual(samsung.products[0], { name: '삼성예시MMF-CP', quantity: 1000000, costKrw: 1000000, valueKrw: 1000000 })
  assert.equal(samsung.products[2].name, '삼성예시미국S&P500인덱스 증권자투자신탁 C-Pe')
  assert.equal(samsung.products.reduce((s: number, p: { valueKrw: number }) => s + p.valueKrw, 0) + samsung.cashKrw, samsung.totalKrw)
  assert.equal(samsung.source, 'pension/evidence/pension-savings-balance-certificate-20251231.pdf')
})

test('(d) a certificate whose total cannot be read is a finding, not a zero', () => {
  const evidence = runEvidence({ 'irp-balance-certificate-20251231.pdf': irpBalanceCertificate(false) })
  assert.equal(evidence.certificates[0].totalKrw, null)
  assert.deepEqual(evidence.findings.map((f: { kind: string }) => f.kind), ['evidence-total-unparsed'])
})

test('(d) no evidence directory writes an empty file rather than failing', () => {
  const evidence = runEvidence({})
  assert.deepEqual(evidence.certificates, [])
})

// --- 삼성 주식보상 ledger: the type/name split is shared with the pension ledger ---

test('a three-line 주식보상 type cell keeps its type and joins the wrapped name', () => {
  const harness = `
import importlib.util, json, sys
sys.path.insert(0, "scripts")
import samsung_statements as ss
print(json.dumps([ss.split_type_and_name(c) for c in json.loads(sys.argv[1])], ensure_ascii=False))
`
  const cells = ['타사출고\nKODEX 예시\n지수200', '배당금입금\n예시전자', '이용료입금']
  const result = spawnSync(PY, ['-c', harness, JSON.stringify(cells)], {
    cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, PYTHONPATH: stubDir() },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), [['타사출고', 'KODEX 예시 지수200'], ['배당금입금', '예시전자'], ['이용료입금', '']])
})

// --- 미래에셋 CMA (발행어음형): a deposit account, read by the bank extractor ---

// The certificate prints its issue filter on page 2. `거래구분 CMA자동매매 제외`
// leaves the 발행어음 sweeps out, so its 예수금잔액 is only the cash left after
// them. `거래구분 전체` keeps them. `CMARP/MMW포함 N` is an RP/MMW flag that both
// kinds print, so it decides nothing.
type CmaFilter = 'excluded' | 'included' | 'unknown'
function cmaCertificate(filter: CmaFilter, records: MiraeRecord[]): Page[] {
  const pages = miraeCertificate('종합_CMA', '2026/01/01 ~ 2026/10/10', records)
  const line = {
    excluded: '거래구분 CMA자동매매 제외 상품구분 전체 종목구분 전체 CMARP/MMW포함 N',
    included: '거래구분 전체 상품구분 전체 종목구분 전체 CMARP/MMW포함 N',
    unknown: '상품구분 전체 종목구분 전체 CMARP/MMW포함 N',
  }[filter]
  pages[1].text = `${pages[1].text}\n${line}`
  return pages
}

const SWEEP = { code: 'KMB000000001', name: '발행어음CMA(개인)' }
// The real shape: a 매수 prints no 예수금잔액 and its 거래수량 equals the amount
// (units are won of principal); a sell's 거래금액 is gross proceeds, 제세금합 the
// tax, 입출금액 the net cash, and 거래수량 the principal redeemed.
const CMA_RECORDS: MiraeRecord[] = [
  { date: '2026/01/02', type: '이체입금', amount: '1,000,000', cash: '1,000,000', flow: '1,000,000' },
  { date: '2026/01/02', type: 'CMA 발행어음 매수', ...SWEEP, amount: '900,000', qty: '900,000', flow: '900,000' },
  { date: '2026/01/05', type: 'CMA 발행어음 중도매도', ...SWEEP, amount: '300,100', qty: '300,000', tax: '15', flow: '300,085', cash: '400,085' },
  { date: '2026/01/05', type: '오픈뱅킹출금', amount: '350,000', cash: '50,085', flow: '350,000' },
  { date: '2026/01/05', type: 'CMA 발행어음 매수', ...SWEEP, amount: '50,000', qty: '50,000', flow: '50,000' },
  { date: '2026/02/02', type: 'CMA 발행어음 만기매도', ...SWEEP, amount: '650,200', qty: '650,000', tax: '30', flow: '650,170', cash: '650,255' },
  { date: '2026/02/02', type: '예탁금이용료입금', amount: '10', tax: '1', flow: '9', cash: '650,264' },
]

function runBank(files: Record<string, Page[]>, map?: object) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'mirae-cma-'))
  for (const [name, pages] of Object.entries(files)) writeDoc(path.join(dataDir, 'bank-statements', name), pages)
  const mapPath = path.join(dataDir, 'map.json')
  if (map) writeFileSync(mapPath, JSON.stringify(map))
  const out = path.join(dataDir, 'bank-balances.json')
  const result = spawnSync(PY, ['scripts/extract-bank-statements.py'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: stubDir(), STOCK_DATA_DIR: dataDir, STOCK_BANK_BALANCES_PATH: out, STOCK_ACCOUNT_MAP_PATH: mapPath, STOCK_PDF_PASSWORD: '' },
  })
  assert.equal(result.status, 0, `bank extractor exited ${result.status}: ${result.stderr}`)
  return JSON.parse(readFileSync(out, 'utf8'))
}

const REMEDY = /re-issue the 거래내역증명서 with CMA자동매매 포함, or provide a 잔고증명서/
const CASH_ONLY = CMA_RECORDS.filter((r) => !r.type.includes('발행어음'))

test('a CMA certificate issued with CMA자동매매 제외 writes no balances and says how to get a usable one', () => {
  const doc = runBank({ 'mirae-cma-20260101-20261010.pdf': cmaCertificate('excluded', CASH_ONLY) })
  assert.deepEqual(doc.accounts, [])
  assert.equal(doc.findings.length, 1, JSON.stringify(doc.findings))
  assert.match(doc.findings[0], /mirae-cma-20260101-20261010\.pdf/)
  assert.match(doc.findings[0], REMEDY)
})

test('a CMA certificate with no sign that the sweeps are included fails closed', () => {
  const doc = runBank({ 'mirae-cma-20260101-20261010.pdf': cmaCertificate('unknown', CASH_ONLY) })
  assert.deepEqual(doc.accounts, [])
  assert.equal(doc.findings.length, 1, JSON.stringify(doc.findings))
  assert.match(doc.findings[0], REMEDY)
})

test('발행어음 rows are a sign the sweeps are included even without 거래구분 전체', () => {
  const doc = runBank({ 'mirae-cma-20260101-20261010.pdf': cmaCertificate('unknown', CMA_RECORDS) })
  assert.deepEqual(doc.findings, [])
  assert.equal(doc.accounts.length, 1)
})

test('a CMA with its sweeps: the balance is 예수금 plus 발행어음 principal, moved only by transfers and interest', () => {
  const map = { bankAccounts: [{ institution: 'mirae', kind: 'cma', currency: 'KRW', alias: '예시 CMA' }] }
  const doc = runBank({ 'mirae-cma-20260101-20261010.pdf': cmaCertificate('included', CMA_RECORDS) }, map)
  assert.deepEqual(doc.findings, [])
  assert.equal(doc.accounts.length, 1)
  const [account] = doc.accounts
  assert.equal(account.account, '예시 CMA')
  assert.equal(account.institution, 'mirae')
  assert.equal(account.kind, 'cma')
  assert.equal(account.currency, 'KRW')
  assert.equal(account.derived, false)
  // Day 1: 100,000 cash + 900,000 principal. Day 2: +85 net interest, −350,000
  // out; the late 매수 moves cash into principal and leaves the total alone.
  // Day 3: +170 net interest on the 만기 sell, +9 deposit interest.
  assert.deepEqual(account.balances, [
    { date: '2026-01-02', balance: 1000000 },
    { date: '2026-01-05', balance: 650085 },
    { date: '2026-02-02', balance: 650264 },
  ])
  assert.deepEqual(account.continuityBreaks, [])
})

test('without a map entry the CMA is named 미래에셋 CMA, and a row whose cash does not add up is a break', () => {
  const gap = CMA_RECORDS.map((r) => (r.type === '오픈뱅킹출금' ? { ...r, flow: '340,000' } : r))
  const doc = runBank({ 'mirae-cma-20260101-20261010.pdf': cmaCertificate('included', gap) })
  assert.equal(doc.accounts[0].account, '미래에셋 CMA')
  assert.equal(doc.accounts[0].continuityBreaks.length, 1)
})

test('an unknown 거래종류 is reported once per kind, with its row count', () => {
  const odd = [...CMA_RECORDS, { date: '2026/02/03', type: '예시정정', amount: '1', cash: '650,264' }, { date: '2026/02/04', type: '예시정정', amount: '1', cash: '650,264' }]
  const doc = runBank({ 'mirae-cma-20260101-20261010.pdf': cmaCertificate('included', odd) })
  assert.equal(doc.findings.length, 1, JSON.stringify(doc.findings))
  assert.match(doc.findings[0], /예시정정.*2 row\(s\)/)
})
