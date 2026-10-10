import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { writeSheetPayloads } from './sheet-payloads'

// Invented fixtures for the pension ingest. Every account number, quantity and
// amount here is made up; the repository is public.

export const TRANSACTION_COLUMNS = [
  'Date', 'Account', 'Type', 'Raw Type', 'Ticker', 'Name', 'Quantity',
  'Currency', 'Native Amount', 'FX Rate',
  'Amount (KRW)', 'Settlement (KRW)', 'Unit Price', 'Fee', 'Tax', 'Balance',
  'Source', 'Page',
]
export const DIVIDEND_COLUMNS = [
  'Date', 'Account', 'Symbol', 'Name', 'Currency', 'Native Amount', 'FX Rate',
  'Amount (KRW)', 'Type', 'Source', 'Page',
]
export const TAXLOT_COLUMNS = [
  'Account', 'Ticker', 'Name', 'Acquired Date', 'Open Quantity',
  'Currency', 'Native Cost Basis', 'Native Unit Cost',
  'Cost Basis (KRW)', 'Unit Cost', 'Holding Days', 'As Of Date', 'Tax Term', 'Source',
]
export const REALIZED_COLUMNS = [
  'Account', 'Ticker', 'Name', 'Acquired Date', 'Sold Date', 'Quantity Sold',
  'Currency', 'Native Cost Basis', 'Native Proceeds',
  'Cost Basis (KRW)', 'Proceeds (KRW)', 'Realized G/L (KRW)',
  'Holding Days', 'Tax Term', 'Source',
]

type Row = Record<string, string | number>

export function tsv(columns: string[], rows: Row[]) {
  return [columns.join('\t'), ...rows.map((r) => columns.map((c) => String(r[c] ?? '')).join('\t'))].join('\n') + '\n'
}

/**
 * The tax year every fixture sale falls in. Pinned in the scenario's
 * tax-policy.json: the ingest otherwise takes the current year, and from 2027 the
 * realized-for-tax-year set would be empty in both runs and compare equal no
 * matter what leaked into it.
 */
export const TAX_YEAR = '2026'

const STOCK = '미래에셋증권(종합)'
export const IRP = '미래에셋증권(IRP)'
export const GOLD = '미래에셋증권(금현물)'
export const SAMSUNG_PENSION = '삼성증권(연금저축)'

function tx(row: Row): Row {
  return { Currency: 'KRW', 'FX Rate': 1, Fee: 0, Tax: 0, Balance: 0, Page: 1, ...row }
}

/** The stock side: one 종합 account with a buy, a sale this year, a dividend and an open lot. */
export const STOCK_INPUTS = {
  transactions: [
    tx({ Date: '2025-03-04', Account: STOCK, Type: 'BUY', 'Raw Type': '매수', Ticker: '005930', Name: 'EXAMPLE CO', Quantity: 10, 'Native Amount': 500000, 'Amount (KRW)': 500000, 'Settlement (KRW)': 500000, 'Unit Price': 50000, Source: 'mirae-general-transactions-20250101-20261001.pdf' }),
    tx({ Date: '2026-02-10', Account: STOCK, Type: 'SELL', 'Raw Type': '매도', Ticker: '005930', Name: 'EXAMPLE CO', Quantity: 2, 'Native Amount': 140000, 'Amount (KRW)': 140000, 'Settlement (KRW)': 140000, 'Unit Price': 70000, Source: 'mirae-general-transactions-20250101-20261001.pdf' }),
    tx({ Date: '2025-11-20', Account: STOCK, Type: 'DIVIDEND', 'Raw Type': '배당금입금', Ticker: '005930', Name: 'EXAMPLE CO', Quantity: 0, 'Native Amount': 3610, 'Amount (KRW)': 3610, 'Settlement (KRW)': 3610, Source: 'mirae-general-transactions-20250101-20261001.pdf' }),
  ],
  dividends: [
    { Date: '2025-11-20', Account: STOCK, Symbol: '005930', Name: 'EXAMPLE CO', Currency: 'KRW', 'Native Amount': 3610, 'FX Rate': 1, 'Amount (KRW)': 3610, Type: '배당금입금', Source: 'mirae-general-transactions-20250101-20261001.pdf', Page: 1 },
  ],
  taxlots: [
    { Account: STOCK, Ticker: '005930', Name: 'EXAMPLE CO', 'Acquired Date': '2025-03-04', 'Open Quantity': 8, Currency: 'KRW', 'Native Cost Basis': 400000, 'Native Unit Cost': 50000, 'Cost Basis (KRW)': 400000, 'Unit Cost': 50000, 'Holding Days': 400, 'As Of Date': '2026-10-01', 'Tax Term': 'Long-term', Source: 'mirae-general-transactions-20250101-20261001.pdf' },
  ],
  realized: [
    { Account: STOCK, Ticker: '005930', Name: 'EXAMPLE CO', 'Acquired Date': '2025-03-04', 'Sold Date': '2026-02-10', 'Quantity Sold': 2, Currency: 'KRW', 'Cost Basis (KRW)': 100000, 'Proceeds (KRW)': 140000, 'Realized G/L (KRW)': 40000, 'Holding Days': 343, 'Tax Term': 'Short-term', Source: 'mirae-general-transactions-20250101-20261001.pdf' },
  ],
}

/**
 * The pension and gold side, as Task 3's extractors emit it: IRP DEPOSIT and
 * TRUST_OUT; 삼성 DEPOSIT, a BUY after its snapshot, INTEREST and a REINVEST,
 * all with a blank ticker; gold BUY in grams with its open lot, a FEE and an
 * INTEREST. A realized row on the pension account proves the tax-year set
 * leaves it out, though today's extractor writes none.
 */
export const PENSION_INPUTS = {
  transactions: [
    tx({ Date: '2026-03-02', Account: IRP, Type: 'DEPOSIT', 'Raw Type': '계좌대체입금', 'Native Amount': 1000000, 'Amount (KRW)': 1000000, 'Settlement (KRW)': 1000000, Source: 'mirae-irp-transactions-20200101-20261008.pdf' }),
    tx({ Date: '2026-03-03', Account: IRP, Type: 'TRUST_OUT', 'Raw Type': '신탁계약출금', 'Native Amount': 1000000, 'Amount (KRW)': 1000000, 'Settlement (KRW)': 1000000, Source: 'mirae-irp-transactions-20200101-20261008.pdf' }),
    tx({ Date: '2026-01-10', Account: SAMSUNG_PENSION, Type: 'DEPOSIT', 'Raw Type': 'Deposit', 'Native Amount': 500000, 'Amount (KRW)': 500000, 'Settlement (KRW)': 500000, Source: 'samsung-pension-transactions-20231024-20261008.pdf' }),
    tx({ Date: '2026-02-01', Account: SAMSUNG_PENSION, Type: 'BUY', 'Raw Type': 'Buy', Name: 'Example equity fund A', Quantity: 100000, 'Native Amount': 100000, 'Amount (KRW)': 100000, 'Settlement (KRW)': 100000, Source: 'samsung-pension-transactions-20231024-20261008.pdf' }),
    tx({ Date: '2026-01-31', Account: SAMSUNG_PENSION, Type: 'INTEREST', 'Raw Type': 'Interest', 'Native Amount': 123, 'Amount (KRW)': 123, 'Settlement (KRW)': 123, Source: 'samsung-pension-transactions-20231024-20261008.pdf' }),
    tx({ Date: '2025-11-01', Account: SAMSUNG_PENSION, Type: 'REINVEST', 'Raw Type': 'Reinvestment', Name: 'Example bond fund B', Quantity: 5000, 'Native Amount': 5000, 'Amount (KRW)': 5000, 'Settlement (KRW)': 5000, Source: 'samsung-pension-transactions-20231024-20261008.pdf' }),
    tx({ Date: '2026-01-15', Account: GOLD, Type: 'BUY', 'Raw Type': '금현물매수입고', Ticker: 'M04020000', Name: 'Gold 99.99 1Kg', Quantity: 10, 'Native Amount': 1500000, 'Amount (KRW)': 1500000, 'Settlement (KRW)': 1500000, 'Unit Price': 150000, Source: 'mirae-gold-transactions-20230101-20261008.pdf' }),
    tx({ Date: '2026-02-01', Account: GOLD, Type: 'FEE', 'Raw Type': '금현물보관수수료', 'Native Amount': 300, 'Amount (KRW)': 300, 'Settlement (KRW)': 300, Source: 'mirae-gold-transactions-20230101-20261008.pdf' }),
    tx({ Date: '2026-03-31', Account: GOLD, Type: 'INTEREST', 'Raw Type': '예탁금이용료입금', 'Native Amount': 50, 'Amount (KRW)': 50, 'Settlement (KRW)': 50, Source: 'mirae-gold-transactions-20230101-20261008.pdf' }),
  ],
  dividends: [
    { Date: '2026-01-31', Account: SAMSUNG_PENSION, Symbol: '', Name: '', Currency: 'KRW', 'Native Amount': 123, 'FX Rate': 1, 'Amount (KRW)': 123, Type: 'Interest', Source: 'samsung-pension-transactions-20231024-20261008.pdf', Page: 1 },
    { Date: '2026-03-31', Account: GOLD, Symbol: '', Name: '', Currency: 'KRW', 'Native Amount': 50, 'FX Rate': 1, 'Amount (KRW)': 50, Type: '예탁금이용료입금', Source: 'mirae-gold-transactions-20230101-20261008.pdf', Page: 1 },
  ],
  taxlots: [
    { Account: GOLD, Ticker: 'M04020000', Name: 'Gold 99.99 1Kg', 'Acquired Date': '2026-01-15', 'Open Quantity': 10, Currency: 'KRW', 'Native Cost Basis': 1500000, 'Native Unit Cost': 150000, 'Cost Basis (KRW)': 1500000, 'Unit Cost': 150000, 'Holding Days': 266, 'As Of Date': '2026-10-08', 'Tax Term': 'Short-term', Source: 'mirae-gold-transactions-20230101-20261008.pdf' },
  ],
  realized: [
    { Account: SAMSUNG_PENSION, Ticker: 'EXAMPLEFUND', Name: 'Example equity fund A', 'Acquired Date': '2025-01-02', 'Sold Date': '2026-04-01', 'Quantity Sold': 1000, Currency: 'KRW', 'Cost Basis (KRW)': 1000, 'Proceeds (KRW)': 99000, 'Realized G/L (KRW)': 98000, 'Holding Days': 454, 'Tax Term': 'Long-term', Source: 'samsung-pension-transactions-20231024-20261008.pdf' },
  ],
}

export const PENSION_MAP = {
  accounts: {},
  pensionAccounts: [
    { token: 'irp', account: IRP, wrapper: 'irp', institution: '미래에셋증권' },
    { token: 'pension-savings', account: SAMSUNG_PENSION, wrapper: 'pension_savings', institution: '삼성증권', accountNumber: '00000000-00' },
  ],
}

export const IRP_HOLDINGS_CSV = [
  'type,name,ticker,quantity,cost_krw,value_krw',
  'ETF,Example 200 ETF,069500,10,300000,350000',
  'FUND,Example TDF fund,,,1000000,1100000',
  'CASH,Example cash sweep,,,0,50000',
].join('\n') + '\n'

export function evidence() {
  return {
    generatedAt: '2026-10-08T00:00:00Z',
    certificates: [
      {
        token: 'irp', kind: 'balance-certificate', asOf: '2025-12-31',
        totalKrw: 2000000, contributionsCumulativeKrw: null, employerCumulativeKrw: null, ownCumulativeKrw: null,
        cashKrw: null, products: [], source: 'pension/evidence/irp-balance-certificate-20251231.pdf',
      },
      {
        token: 'pension-savings', kind: 'balance-certificate', asOf: '2025-12-31',
        totalKrw: 1050000, contributionsCumulativeKrw: null, employerCumulativeKrw: null, ownCumulativeKrw: null,
        cashKrw: 50000,
        products: [
          { name: 'Example equity fund A', quantity: 600000, costKrw: 900000, valueKrw: 700000 },
          { name: 'Example bond fund B', quantity: null, costKrw: 280000, valueKrw: 300000 },
        ],
        source: 'pension/evidence/pension-savings-balance-certificate-20251231.pdf',
      },
    ],
    findings: [],
  }
}

export const KR_PRICES = {
  prices: [
    { ticker: '005930', price: 75000, asOfDate: '2026-10-08' },
    { ticker: '069500', price: 36000, asOfDate: '2026-10-08' },
  ],
  missing: [],
}

/** The KRX gold price step's output, as fetch-gold-price writes it. */
export const GOLD_PRICES = {
  source: 'Naver Finance KRX gold (M04020000)',
  code: 'M04020000',
  unit: 'KRW/g',
  fetchedAt: '2026-10-08T07:00:00.000Z',
  latest: { date: '2026-10-08', price: 160000 },
  history: [
    { date: '2026-10-07', price: 159000 },
    { date: '2026-10-08', price: 160000 },
  ],
}

/**
 * Write one scenario into `dir` and return the env that points the ingest at it.
 * `withPensions` adds the pension and gold rows to the same statement TSVs, plus
 * the snapshot CSV, evidence, map, the ETF price and the gold price.
 */
export function writeScenario(
  dir: string,
  { withPensions, etfPriced = true }: { withPensions: boolean; etfPriced?: boolean }
) {
  writeSheetPayloads(dir)
  const kr = path.join(dir, 'kr-statements')
  mkdirSync(kr, { recursive: true })
  const pick = (key: keyof typeof STOCK_INPUTS) =>
    withPensions ? [...STOCK_INPUTS[key], ...PENSION_INPUTS[key]] : STOCK_INPUTS[key]
  writeFileSync(path.join(kr, 'transactions.tsv'), tsv(TRANSACTION_COLUMNS, pick('transactions')), 'utf8')
  writeFileSync(path.join(kr, 'dividends.tsv'), tsv(DIVIDEND_COLUMNS, pick('dividends')), 'utf8')
  writeFileSync(path.join(kr, 'taxlots.tsv'), tsv(TAXLOT_COLUMNS, pick('taxlots')), 'utf8')
  writeFileSync(path.join(kr, 'realized.tsv'), tsv(REALIZED_COLUMNS, pick('realized')), 'utf8')

  const prices = {
    ...KR_PRICES,
    prices: KR_PRICES.prices.filter((p) => etfPriced || p.ticker !== '069500'),
  }
  writeFileSync(path.join(dir, 'kr-prices.json'), JSON.stringify(prices), 'utf8')

  const taxPolicy = { jurisdictions: [{ code: 'US', manualAssumptions: { taxInputYear: TAX_YEAR } }] }
  writeFileSync(path.join(dir, 'tax-policy.json'), JSON.stringify(taxPolicy), 'utf8')

  const env: Record<string, string> = {
    STOCK_KR_STATEMENTS_DIR: kr,
    STOCK_KR_PRICES_PATH: path.join(dir, 'kr-prices.json'),
    STOCK_TAX_POLICY_PATH: path.join(dir, 'tax-policy.json'),
  }
  if (withPensions) {
    const pension = path.join(dir, 'pension')
    mkdirSync(pension, { recursive: true })
    writeFileSync(path.join(pension, 'irp-holdings-20261008.csv'), IRP_HOLDINGS_CSV, 'utf8')
    writeFileSync(path.join(dir, 'pension-evidence.json'), JSON.stringify(evidence()), 'utf8')
    writeFileSync(path.join(dir, 'accounts.local.json'), JSON.stringify(PENSION_MAP), 'utf8')
    writeFileSync(path.join(dir, 'gold-prices.json'), JSON.stringify(GOLD_PRICES), 'utf8')
    env.STOCK_PENSION_DIR = pension
    env.STOCK_PENSION_EVIDENCE_PATH = path.join(dir, 'pension-evidence.json')
    env.STOCK_ACCOUNT_MAP_PATH = path.join(dir, 'accounts.local.json')
    env.STOCK_GOLD_PRICES_PATH = path.join(dir, 'gold-prices.json')
  }
  return env
}
