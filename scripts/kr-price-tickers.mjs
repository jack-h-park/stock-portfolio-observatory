// kr-price-tickers.mjs — which tickers fetch-kr-prices asks Yahoo about.
//
// Two sources: the KR holdings payload, and the ETF rows of the hand-made pension
// snapshots (`pension/<token>-holdings-<YYYYMMDD>.csv`), whose ETFs are marked
// at the KR price when one exists. Rows of a non-security asset class (the
// 미래에셋 금현물 account's KRX gold code) are left out: Yahoo has no quote for
// them, and gold is priced by its own step.
import fs from 'node:fs'
import path from 'node:path'
import { assetClassFor } from './account-map.mjs'

const SNAPSHOT_NAME = /-holdings-\d{8}\.csv$/

function text(value) {
  return value == null ? '' : String(value).trim()
}

/** Minimal RFC 4180 reader: quoted cells may hold commas and doubled quotes. */
function parseCsv(raw) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  const src = raw.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell.trim())
      cell = ''
    } else if (ch === '\n') {
      row.push(cell.trim())
      rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') cell += ch
  }
  if (cell.length || row.length) {
    row.push(cell.trim())
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c))
}

/** ETF tickers in every pension snapshot under `pensionDir`. A missing directory holds none. */
export function pensionEtfTickers(pensionDir) {
  if (!pensionDir || !fs.existsSync(pensionDir)) return []
  const tickers = []
  for (const name of fs.readdirSync(pensionDir)) {
    if (!SNAPSHOT_NAME.test(name)) continue
    const [header = [], ...rows] = parseCsv(fs.readFileSync(path.join(pensionDir, name), 'utf8'))
    const columns = header.map((h) => h.toLowerCase())
    const typeAt = columns.indexOf('type')
    const tickerAt = columns.indexOf('ticker')
    if (typeAt < 0 || tickerAt < 0) continue
    for (const cells of rows) {
      if (text(cells[typeAt]).toUpperCase() !== 'ETF') continue
      const ticker = text(cells[tickerAt]).replace(/^'/, '')
      if (ticker) tickers.push(ticker)
    }
  }
  return tickers
}

/** Sorted, de-duplicated tickers to price. `holdingsRows` are the payload's TSV rows. */
export function krPriceTickers({ holdingsRows, pensionDir, accountMap }) {
  const fromHoldings = holdingsRows
    .filter((r) => text(r.Account).toLowerCase() !== 'total')
    .filter((r) => assetClassFor({ account: text(r.Account) }, accountMap) === 'security')
    .map((r) => text(r.Ticker).replace(/^'/, ''))
  return [...new Set([...fromHoldings, ...pensionEtfTickers(pensionDir)].filter(Boolean))].sort()
}
