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
// usage:
//   node scripts/publish-kr-sheet.mjs [--apply] [--tab '<name>']
//
// env:
//   STOCK_SHEETS_SA_KEY  service-account JSON (default ~/.config/stock-portfolio-briefing/gcp-sheets-sa.json)
//   STOCK_KR_SHEET_ID    spreadsheet id
//   STOCK_KR_SHEET_TAB   target tab (default '미실현수익 정리 (자동)')
//   STOCK_DB_PATH        SQLite database

import { readFileSync } from 'node:fs'
import { createSign } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

const KEY_PATH = process.env.STOCK_SHEETS_SA_KEY
  || join(homedir(), '.config', 'stock-portfolio-briefing', 'gcp-sheets-sa.json')
const SHEET_ID = process.env.STOCK_KR_SHEET_ID || '<KR_SHEET_ID>'
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
const TAB = arg('--tab', process.env.STOCK_KR_SHEET_TAB || '미실현수익 정리 (자동)')

const die = (msg) => { console.error(`[kr-sheet] ${msg}`); process.exit(2) }

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

const COLUMNS = [
  'Account', 'Ticker', 'Name', 'Quantity', 'Average Unit Cost', 'Total Cost',
  'Current Price', 'DB Price', 'Δ', 'PE', 'EPS',
  'Unrealized G/L Amt.', 'Unrealized Gain/Loss (%)',
  'Long-Term Qty', 'Short-Term Qty', 'Lot Count',
]

// Formula columns, keyed by their letter. Taken from the hand-maintained tab —
// these have priced this portfolio for a year — with two changes.
//
// KOSDAQ IS TRIED AFTER KRX. The old tab prefixed every ticker `KRX:` and had
// no failures, because the three KOSDAQ names it now carries were not in it
// (035900, 086520, 403850) and neither was the ₩498,120 government bond the
// certificate parser turned up. Generated from the database, they arrive — and
// `KRX:035900` does not resolve, so the row returned #N/A.
//
// AND THE FAILURE IS CONTAINED. `Current Price` had no error wrapper, so an
// #N/A there flowed through `OR(...,G="")` into Unrealized G/L and from there
// into SUM, and the portfolio's total unrealized gain read #N/A on account of
// one ticker. A quantity this app cannot price should leave a blank cell, not
// erase the figure beside it. KR103502GA34 never will resolve — a bond has no
// market symbol — which is exactly why the blank has to be survivable.
const px = (r, attr) => `IFERROR(GOOGLEFINANCE("KRX:"&$B${r}, "${attr}"),`
  + `GOOGLEFINANCE("KOSDAQ:"&$B${r}, "${attr}"))`

const FORMULAS = {
  E: (r) => `=IFERROR(F${r}/D${r},"")`,
  G: (r) => `=IF($B${r}="","",IFERROR(${px(r, 'price')},""))`,
  I: (r) => `=IF(OR(G${r}="",H${r}="",H${r}=0),"",IFERROR(TEXT(G${r}/H${r}-1,"0.00%"),""))`,
  J: (r) => `=IFERROR(TEXT(${px(r, 'pe')},"0.00"),"")`,
  K: (r) => `=IFERROR(${px(r, 'eps')},"")`,
  L: (r) => `=IF(OR(D${r}="",F${r}="",G${r}=""),"",IFERROR(G${r}*D${r}-F${r},""))`,
  M: (r) => `=IFERROR(TEXT(L${r}/F${r},"0.00%"),"")`,
}

const LAST_COL = 'S' // P is Lot Count; R/S carry the provenance block

// ---------------------------------------------------------------------------

function readHoldings() {
  let db
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true })
  } catch (e) {
    die(`cannot open the database at ${DB_PATH} (${e.message})`)
  }
  const rows = db.prepare(`
    select account, ticker, name, quantity, native_cost, native_price,
           long_term_qty, short_term_qty, lot_count, as_of_date
      from holdings
     where market = 'KR' and quantity > 0
     order by account, ticker
  `).all()
  db.close()
  if (!rows.length) die('the database holds no Korean positions — refusing to publish an empty table')
  return rows
}

function build(rows) {
  // Value cells go up RAW so a KRX ticker keeps its leading zeros: USER_ENTERED
  // would read 000660 as the number 660 and the GOOGLEFINANCE lookups built on
  // $B would all resolve to nothing.
  const raw = []
  const entered = []
  const first = 2

  raw.push({ range: `'${TAB}'!A1:${LAST_COL}1`, values: [[...COLUMNS, '', 'DB As Of', '']] })

  rows.forEach((h, i) => {
    const r = first + i
    raw.push({
      range: `'${TAB}'!A${r}:D${r}`,
      values: [[h.account, String(h.ticker), h.name, h.quantity]],
    })
    raw.push({ range: `'${TAB}'!F${r}`, values: [[h.native_cost]] })
    raw.push({ range: `'${TAB}'!H${r}`, values: [[h.native_price ?? '']] })
    raw.push({
      range: `'${TAB}'!N${r}:P${r}`,
      values: [[h.long_term_qty ?? '', h.short_term_qty ?? '', h.lot_count ?? '']],
    })
    for (const [col, make] of Object.entries(FORMULAS)) {
      entered.push({ range: `'${TAB}'!${col}${r}`, values: [[make(r)]] })
    }
  })

  // Total row. Summed by the sheet, not here, so it cannot disagree with the
  // rows above it after a manual filter or an edit.
  const total = first + rows.length
  const last = first + rows.length - 1
  raw.push({ range: `'${TAB}'!A${total}`, values: [['합계']] })
  entered.push({ range: `'${TAB}'!F${total}`, values: [[`=SUM(F${first}:F${last})`]] })
  entered.push({ range: `'${TAB}'!L${total}`, values: [[`=SUM(L${first}:L${last})`]] })
  entered.push({ range: `'${TAB}'!M${total}`, values: [[`=IFERROR(TEXT(L${total}/F${total},"0.00%"),"")`]] })

  // Provenance, off to the side. `DB As Of` is the ingest date the quantities
  // and DB Price came from; without it, Δ says two numbers differ but not which
  // one is the stale one.
  const asOf = rows.find((h) => h.as_of_date)?.as_of_date ?? 'unknown'
  raw.push({
    range: `'${TAB}'!R1:S4`,
    values: [
      ['DB As Of', asOf],
      ['Generated', new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z'],
      ['Source', 'stock-portfolio-observatory · scripts/publish-kr-sheet.mjs'],
      ['Note', '이 탭은 자동 생성됩니다. 손으로 고친 값은 다음 실행에 사라집니다.'],
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

console.error(`[kr-sheet] ${meta.properties.title}`)
console.error(`[kr-sheet] identity  ${email}`)
console.error(`[kr-sheet] tab       ${TAB}${target ? '' : '  (없음 — 생성 예정)'}`)
console.error(`[kr-sheet] rows      ${rowCount} positions + 합계, DB as-of ${asOf}`)
console.error(`[kr-sheet] writes    ${raw.length} raw range(s), ${entered.length} formula cell(s)`)

if (!APPLY) {
  console.error('[kr-sheet] dry-run — nothing written. Re-run with --apply.')
  const sample = rows[0]
  console.error(`[kr-sheet] sample    ${sample.account} ${sample.ticker} ${sample.name} `
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
  console.error(`[kr-sheet] created tab '${TAB}'`)
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

console.error(`[kr-sheet] wrote ${rowCount} positions + 합계`)

// Report what the sheet could not price. A blank `Current Price` is a position
// whose row is otherwise complete and whose Unrealized G/L is therefore absent
// from the total — a quiet understatement unless it is named here. GOOGLEFINANCE
// evaluates asynchronously, so give it a moment before reading back.
await new Promise((r) => setTimeout(r, 4000))
const back = await api(token,
  `/values/${encodeURIComponent(`'${TAB}'!B2:G${rowCount + 1}`)}?valueRenderOption=UNFORMATTED_VALUE`)
const unpriced = (back.values ?? [])
  .filter((r) => r[5] === '' || r[5] == null || String(r[5]).includes('N/A'))
  .map((r) => `${r[0]} ${r[1]}`)
if (unpriced.length) {
  console.error(`[kr-sheet] ${unpriced.length} position(s) unpriced — their gain is missing from 합계:`)
  for (const u of unpriced) console.error(`[kr-sheet]   ${u}`)
} else {
  console.error('[kr-sheet] every position priced')
}
