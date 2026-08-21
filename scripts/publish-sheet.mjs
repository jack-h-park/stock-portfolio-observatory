#!/usr/bin/env node
// publish-kr-sheet.mjs — write the Korean 미실현수익 정리 tab from the database.
//
// This is the second thing this app publishes rather than reads (the first is
// briefing-summary.json), and it exists for a narrow reason: the sheet is the
// only surface that is a TABLE. The Observatory is tailnet-only and the daily
// briefing is a fixed 08:00 document; neither can be sorted, filtered, or have
// a column of arithmetic dropped beside it. So the sheet stays — but it stops
// being maintained by hand.
//
// The sheet's other four Korean tabs were archived on 2026-08-04, after the
// parsers overtook the one hand-run extraction that filled them (916 dividends
// against 151, 11,232 transactions against 777). This tab is the remainder.
//
// THE SHEET KEEPS ITS FORMULAS. That is the whole design, not a concession.
// GOOGLEFINANCE prices the position live, which no snapshot in this database
// can do, and PE/EPS exist nowhere else at all — the `pe` and `eps` columns are
// null for all 140 positions. So the columns divide by owner:
//
//   writer  Account Ticker Name Quantity | Total Cost | DB Price | LT/ST Qty, Lot Count
//   sheet   Average Unit Cost | Current Price | Δ | PE EPS | Unrealized G/L, %
//
// which means every generated row must carry its formulas WITH it. A row
// written without them is not an error anywhere — that one ticker simply stops
// being priced, silently, forever. Holdings churn (47 → 48 already), so this is
// the normal case and not an edge one.
//
// WHY Δ IS A FORMULA. `Current Price` is GOOGLEFINANCE and `DB Price` is this
// morning's ingest, so the two legitimately disagree — and how MUCH they
// disagree is the only visible sign that a refresh has stopped. Computing it
// here would freeze it at write time and report nothing. The sheet recomputes
// it on every open, which is exactly when someone is looking.
//
// The gap this closes has been paid for twice: a Korean table that had not moved
// in a fortnight sat beside a same-morning summary in one document, and an FX
// rate frozen at 1300 ran every won figure 13% light for 203 days. Neither was a
// crash. Both were a number nobody could tell was old.
//
// Dry-run by default. Nothing is written without --apply.
//
// WHAT THE SHEET KEEPS, AND WHAT IT NO LONGER DUPLICATES. Only the columns the
// Observatory cannot serve: a sortable table of positions, priced live. The lot
// breakdown that used to sit on the right — long, short and unknown term
// quantities and a lot count — is gone from both markets. It duplicated
// `tax_lots`, which `/positions/<market>/<ticker>` and `/reconciliation` already
// present, and on the US sheet it was doing worse than duplicating: those four
// columns were SUMIFS against a `Tax Lot Summary` tab frozen at 2026-07-15, so
// generating the positions beside them would have put this morning's quantities
// next to a five-week-old lot split. Dropping them removes the cross-tab
// dependency entirely and leaves one generated tab per sheet.
//
// usage:
//   node scripts/publish-sheet.mjs --market KR|US [--apply] [--tab '<name>']
//
// env:
//   STOCK_SHEETS_SA_KEY  service-account JSON (default ~/.config/stock-portfolio-briefing/gcp-sheets-sa.json)
//   STOCK_KR_SHEET_ID / STOCK_US_SHEET_ID    spreadsheet id per market
//   STOCK_KR_SHEET_TAB / STOCK_US_SHEET_TAB  target tab
//   STOCK_DB_PATH        SQLite database

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createSign } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

const KEY_PATH = process.env.STOCK_SHEETS_SA_KEY
  || join(homedir(), '.config', 'stock-portfolio-briefing', 'gcp-sheets-sa.json')
const DB_PATH = process.env.STOCK_DB_PATH
  || join(homedir(), 'workspace', 'data', 'stock-management', 'outputs',
    'stock-portfolio-observatory', 'stock-portfolio-observatory.db')

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const arg = (name, def) => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def
}
const APPLY = has('--apply')

// What differs between the two sheets, and nothing else does.
//
// The quote lambda is the real difference. A Korean code carries no exchange, so
// GOOGLEFINANCE needs one prefixed and KOSDAQ has to be tried after KRX — see
// the note on FORMULAS below. A US ticker is its own symbol and needs neither.
//
// `hasName` is the other: `005930` does not say 삼성전자 and needs the column,
// while `RKLB` names its own company and the US broker strings are long enough
// to push the table sideways for nothing.
const MARKETS = {
  KR: {
    label: 'kr-sheet',
    sheetId: process.env.STOCK_KR_SHEET_ID || '<KR_SHEET_ID>',
    tab: process.env.STOCK_KR_SHEET_TAB || '미실현수익 정리 (자동)',
    hasName: true,
    totalLabel: '합계',
    receipt: 'kr-sheet-publish.json',
    quote: (cell, attr) => `IFERROR(GOOGLEFINANCE("KRX:"&${cell}, "${attr}"),`
      + `GOOGLEFINANCE("KOSDAQ:"&${cell}, "${attr}"))`,
  },
  US: {
    label: 'us-sheet',
    sheetId: process.env.STOCK_US_SHEET_ID || '<US_SHEET_ID>',
    tab: process.env.STOCK_US_SHEET_TAB || '미실현수익 정리 (자동)',
    hasName: false,
    totalLabel: 'Total',
    receipt: 'us-sheet-publish.json',
    quote: (cell, attr) => `GOOGLEFINANCE(${cell}, "${attr}")`,
  },
}

const MARKET = (arg('--market', 'KR') || '').toUpperCase()
const CONFIG = MARKETS[MARKET]
const LABEL = CONFIG?.label ?? 'sheet'
const die = (msg) => { console.error(`[${LABEL}] ${msg}`); process.exit(2) }
if (!CONFIG) die(`unknown --market ${MARKET || '(none)'} — expected KR or US`)
const SHEET_ID = CONFIG.sheetId
const TAB = arg('--tab', CONFIG.tab)

// ---------------------------------------------------------------------------
// Sheets REST, without the googleapis dependency
// ---------------------------------------------------------------------------
//
// A service-account JWT is ~30 lines against a package that would be the single
// largest dependency in this repo, for four endpoints. The rest of this app
// calls Yahoo, Frankfurter and Bithumb the same way.

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function accessToken(scope) {
  let key
  try {
    key = JSON.parse(readFileSync(KEY_PATH, 'utf8'))
  } catch (e) {
    die(`cannot read the service-account key at ${KEY_PATH} (${e.code ?? e.message}).\n`
      + `          Set STOCK_SHEETS_SA_KEY, or place the key there with chmod 600.`)
  }
  if (key.type !== 'service_account') die(`${KEY_PATH} is not a service-account key`)

  const now = Math.floor(Date.now() / 1000)
  const claim = {
    iss: key.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(claim))
  const sig = b64url(createSign('RSA-SHA256').update(`${head}.${body}`).sign(key.private_key))

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${head}.${body}.${sig}`,
    }),
  })
  if (!res.ok) die(`token exchange failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return { token: (await res.json()).access_token, email: key.client_email }
}

async function api(token, path, init = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
  })
  const text = await res.text()
  if (!res.ok) {
    // 403 on a write path is the ACL, not the scope: the token carries whatever
    // scope was asked for, and the sheet decides separately whether this
    // identity may edit. Say so, because the two look identical from here.
    const hint = res.status === 403 && init.method
      ? `\n          The service account may be a Viewer. It needs Editor on this sheet.`
      : ''
    die(`${init.method ?? 'GET'} ${path} → ${res.status} ${text.slice(0, 200)}${hint}`)
  }
  return text ? JSON.parse(text) : {}
}

// ---------------------------------------------------------------------------
// The layout
// ---------------------------------------------------------------------------
//
// Columns are the sheet's original order with `DB Price` and `Δ` inserted after
// `Current Price` — beside the number they exist to be compared against, since
// a comparison two screens apart is not one.

// The layout, declared once and lettered by position.
//
// Column letters used to be hard-coded (`E`, `G`, `I`…), which was fine while one
// market existed and wrong the moment a second one dropped the `Name` column:
// every formula would have addressed the cell one to its left. Each column now
// names the ones it reads, and `col()` resolves the letter.
const COLUMNS = [
  { header: 'Account', value: (h) => h.account },
  { header: 'Ticker', value: (h) => String(h.ticker) },
  ...(CONFIG.hasName ? [{ header: 'Name', value: (h) => h.name }] : []),
  { header: 'Quantity', value: (h) => h.quantity },
  { header: 'Average Unit Cost', formula: (r, c) => `=IFERROR(${c('Total Cost')}${r}/${c('Quantity')}${r},"")` },
  { header: 'Total Cost', value: (h) => h.native_cost },
  // KOSDAQ IS TRIED AFTER KRX on the Korean side. The hand-kept tab prefixed
  // every ticker `KRX:` and had no failures, because the KOSDAQ names it now
  // carries were not in it, and neither was the government bond the certificate
  // parser turned up. Generated from the database they arrive, and a `KRX:`
  // prefix does not resolve for a KOSDAQ code.
  //
  // AND THE FAILURE IS CONTAINED. `Current Price` once had no error wrapper, so
  // an #N/A flowed through into Unrealized G/L and from there into SUM, and the
  // portfolio's total gain read #N/A on account of one ticker. A quantity this
  // app cannot price should leave a blank cell, not erase the figure beside it.
  // A bond has no market symbol and never will, which is why the blank has to be
  // survivable.
  { header: 'Current Price', formula: (r, c) => `=IF(${c('Ticker')}${r}="","",IFERROR(${CONFIG.quote(`$${c('Ticker')}${r}`, 'price')},""))` },
  { header: 'DB Price', value: (h) => h.native_price ?? '' },
  // Δ IS A FORMULA ON PURPOSE. `Current Price` is live and `DB Price` is the last
  // ingest, so the two legitimately disagree — and how much they disagree is the
  // only visible sign that a refresh has stopped. Computed here it would freeze
  // at write time and report nothing.
  {
    header: 'Δ',
    formula: (r, c) => `=IF(OR(${c('Current Price')}${r}="",${c('DB Price')}${r}="",${c('DB Price')}${r}=0),"",`
      + `IFERROR(TEXT(${c('Current Price')}${r}/${c('DB Price')}${r}-1,"0.00%"),""))`,
  },
  { header: 'PE', formula: (r, c) => `=IFERROR(TEXT(${CONFIG.quote(`$${c('Ticker')}${r}`, 'pe')},"0.00"),"")` },
  { header: 'EPS', formula: (r, c) => `=IFERROR(${CONFIG.quote(`$${c('Ticker')}${r}`, 'eps')},"")` },
  {
    header: 'Unrealized G/L Amt.',
    formula: (r, c) => `=IF(OR(${c('Quantity')}${r}="",${c('Total Cost')}${r}="",${c('Current Price')}${r}=""),"",`
      + `IFERROR(${c('Current Price')}${r}*${c('Quantity')}${r}-${c('Total Cost')}${r},""))`,
  },
  {
    header: 'Unrealized Gain/Loss (%)',
    formula: (r, c) => `=IFERROR(TEXT(${c('Unrealized G/L Amt.')}${r}/${c('Total Cost')}${r},"0.00%"),"")`,
  },
]

const letter = (i) => {
  let n = i + 1
  let out = ''
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}
const LETTER_BY_HEADER = new Map(COLUMNS.map((c, i) => [c.header, letter(i)]))
const col = (header) => {
  const l = LETTER_BY_HEADER.get(header)
  if (!l) die(`layout error: no column named ${header}`)
  return l
}
// Provenance sits one blank column past the table.
const PROV = letter(COLUMNS.length + 1)
const LAST_COL = letter(COLUMNS.length + 2)

// ---------------------------------------------------------------------------

function readHoldings() {
  let db
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true })
  } catch (e) {
    die(`cannot open the database at ${DB_PATH} (${e.message})`)
  }
  const rows = db.prepare(`
    select account, ticker, name, quantity, native_cost, native_price, as_of_date
      from holdings
     where market = ? and quantity > 0
     order by account, ticker
  `).all(MARKET)
  db.close()
  if (!rows.length) die(`the database holds no ${MARKET} positions — refusing to publish an empty table`)
  return rows
}

function build(rows) {
  // Value cells go up RAW so a KRX code keeps its leading zeros: USER_ENTERED
  // reads 000660 as the number 660, and every quote built on that cell then
  // resolves to nothing.
  const raw = []
  const entered = []
  const first = 2

  raw.push({
    range: `'${TAB}'!A1:${LAST_COL}1`,
    values: [[...COLUMNS.map((c) => c.header), '', 'DB As Of', '']],
  })

  rows.forEach((h, i) => {
    const r = first + i
    COLUMNS.forEach((c, idx) => {
      const range = `'${TAB}'!${letter(idx)}${r}`
      if (c.value) raw.push({ range, values: [[c.value(h)]] })
      else entered.push({ range, values: [[c.formula(r, col)]] })
    })
  })

  // Total row. Summed by the sheet, not here, so it cannot disagree with the
  // rows above it after a manual filter or an edit.
  const total = first + rows.length
  const last = first + rows.length - 1
  const cost = col('Total Cost')
  const gl = col('Unrealized G/L Amt.')
  const pct = col('Unrealized Gain/Loss (%)')
  raw.push({ range: `'${TAB}'!A${total}`, values: [[CONFIG.totalLabel]] })
  entered.push({ range: `'${TAB}'!${cost}${total}`, values: [[`=SUM(${cost}${first}:${cost}${last})`]] })
  entered.push({ range: `'${TAB}'!${gl}${total}`, values: [[`=SUM(${gl}${first}:${gl}${last})`]] })
  entered.push({
    range: `'${TAB}'!${pct}${total}`,
    values: [[`=IFERROR(TEXT(${gl}${total}/${cost}${total},"0.00%"),"")`]],
  })

  // Provenance, off to the side. `DB As Of` is the ingest date the quantities
  // and DB Price came from; without it, Δ says two numbers differ but not which
  // one is the stale one.
  //
  // The NEWEST as-of across the accounts, not the first row's. The rows are
  // ordered by account, so "first" meant whichever account sorted first — and
  // the staleness check downstream compares this against the same maximum, so a
  // row-order accident would show as a permanent day of lag no republish clears.
  const asOf = rows.map((h) => h.as_of_date).filter(Boolean).sort().pop() ?? 'unknown'
  raw.push({
    range: `'${TAB}'!${PROV}1:${LAST_COL}4`,
    values: [
      ['DB As Of', asOf],
      ['Generated', new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z'],
      ['Source', `stock-portfolio-observatory · scripts/publish-sheet.mjs --market ${MARKET}`],
      ['Note', 'Generated. Anything edited here is overwritten on the next run.'],
    ],
  })

  return { raw, entered, rowCount: rows.length, asOf }
}

// ---------------------------------------------------------------------------

const scope = APPLY
  ? 'https://www.googleapis.com/auth/spreadsheets'
  : 'https://www.googleapis.com/auth/spreadsheets.readonly'
const { token, email } = await accessToken(scope)

const meta = await api(token, '?fields=properties.title,sheets.properties')
const tabs = meta.sheets.map((s) => s.properties)
const target = tabs.find((p) => p.title === TAB)

const rows = readHoldings()
const { raw, entered, rowCount, asOf } = build(rows)

console.error(`[${LABEL}] ${meta.properties.title}`)
console.error(`[${LABEL}] identity  ${email}`)
console.error(`[${LABEL}] tab       ${TAB}${target ? '' : '  (없음 — 생성 예정)'}`)
console.error(`[${LABEL}] rows      ${rowCount} positions + 합계, DB as-of ${asOf}`)
console.error(`[${LABEL}] writes    ${raw.length} raw range(s), ${entered.length} formula cell(s)`)

if (!APPLY) {
  console.error(`[${LABEL}] dry-run — nothing written. Re-run with --apply.`)
  const sample = rows[0]
  console.error(`[${LABEL}] sample    ${sample.account} ${sample.ticker} ${sample.name} `
    + `qty=${sample.quantity} cost=${sample.native_cost} dbPrice=${sample.native_price}`)
  process.exit(0)
}

if (!target) {
  await api(token, ':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: TAB, gridProperties: { rowCount: 1000, columnCount: 26 } } } }],
    }),
  })
  console.error(`[${LABEL}] created tab '${TAB}'`)
}

// Clear before writing: a shorter portfolio than last run would otherwise leave
// the tail of the previous one below the 합계 row, reading as live positions.
await api(token, `/values/${encodeURIComponent(`'${TAB}'!A1:${LAST_COL}1000`)}:clear`,
  { method: 'POST', body: '{}' })

for (const [data, valueInputOption] of [[raw, 'RAW'], [entered, 'USER_ENTERED']]) {
  await api(token, '/values:batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ valueInputOption, data }),
  })
}

console.error(`[${LABEL}] wrote ${rowCount} positions + 합계`)

// A receipt, so something other than a person can tell how old the sheet is.
//
// This tab is published by hand on purpose — a scheduled writer would make a
// network write to a shared document a side effect of an ingest. The cost of
// that choice is the one this file pays off: between 2026-08-04 and 08-20 the
// tab sat unpublished through the pre-2022 certificates, the split
// acquisition-date fix and the Korean dividend join, showing 48 positions where
// the database had 50 and a 76.42% return where it was 90.18%. It said
// `DB As Of 2026-07-31` the whole time, which is honest and useless: a date only
// reads as stale next to the one it should have been.
//
// So the ingest compares them, and it reads this file rather than the sheet —
// no credential and no network call is added to the ingest for a check. The
// limit that buys: this records what was PUBLISHED, not what the tab holds now,
// so a tab someone deleted or edited by hand still looks published. The failure
// being guarded is "nobody ran the publisher", and for that the receipt is exact.
const receiptPath = process.env.STOCK_KR_SHEET_RECEIPT_PATH
  || new URL(`../data/${CONFIG.receipt}`, import.meta.url).pathname
try {
  mkdirSync(new URL('.', `file://${receiptPath}`).pathname, { recursive: true })
  writeFileSync(receiptPath, `${JSON.stringify({
    publishedAt: new Date().toISOString(),
    dbAsOf: asOf,
    sheetId: SHEET_ID,
    tab: TAB,
    rows: rowCount,
  }, null, 2)}\n`)
  console.error(`[${LABEL}] receipt ${receiptPath}`)
} catch (e) {
  // The tab is already written by now. A failed receipt must not read as a
  // failed publish — it costs the staleness check, not the sheet.
  console.error(`WARNING: published the tab but could not write the receipt (${e.message})`)
}

// Report what the sheet could not price. A blank `Current Price` is a position
// whose row is otherwise complete and whose Unrealized G/L is therefore absent
// from the total — a quiet understatement unless it is named here. GOOGLEFINANCE
// evaluates asynchronously, so give it a moment before reading back.
await new Promise((r) => setTimeout(r, 4000))
// Read back only the two columns this needs, addressed by name rather than by
// the B..G the Korean layout happened to have.
const tickerCol = col('Ticker')
const priceCol = col('Current Price')
const back = await api(token,
  `/values/${encodeURIComponent(`'${TAB}'!${tickerCol}2:${priceCol}${rowCount + 1}`)}?valueRenderOption=UNFORMATTED_VALUE`)
const priceOffset = priceCol.charCodeAt(0) - tickerCol.charCodeAt(0)
const unpriced = (back.values ?? [])
  .filter((r) => {
    const v = r[priceOffset]
    return v === '' || v == null || String(v).includes('N/A')
  })
  .map((r) => r[0])
if (unpriced.length) {
  console.error(`[${LABEL}] ${unpriced.length} position(s) unpriced — their gain is missing from the total:`)
  for (const u of unpriced) console.error(`[${LABEL}]   ${u}`)
} else {
  console.error(`[${LABEL}] every position priced`)
}
