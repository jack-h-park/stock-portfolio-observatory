import fs from 'node:fs'
import path from 'node:path'

// Which brokerage export files to ingest, matched by PATTERN rather than by an
// exact name. The exact-name list this replaces embedded the export date
// (`chase-holdings-20260715.csv`), so the next download — a new date — was never
// read: the ingest kept silently using week-old data, and deleting an old file
// made a whole brokerage vanish with no error. Same failure class as the
// under-counting bugs this repo just fixed: nothing breaks, the number is just
// wrong.
//
// Every one of these filenames is typed by hand — no broker supplies a usable
// name — so they follow ONE grammar, and this file is the only thing that knows
// it:
//
//   <broker>-<doctype>[-<account>]-<period>[-<part>][-partial].<ext>
//
// Lowercase ASCII, hyphen-separated. What that bought: the previous names were
// per-broker inventions ('Chase - All Transactions - 20260723 Year-to-date.csv',
// '빗썸-거래내역확인서-2026년1-7월.pdf') and each needed its own hand-written
// regex. The Korean ones additionally needed Unicode normalisation to match at
// all — macOS returns Hangul filenames decomposed (NFD), so a composed literal
// written here matched nothing, silently and with no error. Broker and document
// type now read straight out of the name, so the specs below are rows in a table
// and that whole class of bug is gone rather than worked around.
//
// Each spec matches files in a subdir and selects among them:
//   pick 'latest' → the newest match only. Rotating exports whose name carries a
//                   date (broker tax-lot snapshots, year-to-date transactions).
//                   Ingesting an old AND a new year-to-date file would
//                   double-count every transaction they share.
//   pick 'all'    → every match. Stable historical archives that coexist and
//                   cover distinct periods (e.g. a complete year).
//   groupBy       → with 'latest', keep the newest match PER key. Robinhood
//                   keeps one year-to-date file per account.
//
// "Newest" = the period the filename declares, then mtime. The period is
// authoritative; mtime breaks ties. Within one spec+group every match shares the
// pattern, so the period shape is uniform and the string compare is well-defined.

const DIR_US_HOLDINGS = 'us-holdings'
const DIR_US_TRANSACTIONS = 'us-transactions'
const DIR_BITHUMB = 'crypto-bithumb'
const DIR_RH_CRYPTO = 'crypto-robinhood'

// Period shapes. The period says what a file COVERS, and that is exactly what
// decides whether the next download supersedes it or sits beside it — so the
// shape is the selection rule, not decoration:
//
//   YEAR    2025               a complete year. Archives coexist → 'all'.
//   ASOF    20260723           everything up to that date. The next export
//                              covers the same ground plus more, so only the
//                              newest may be read → 'latest'.
//   MONTH   202509             one calendar month → coexist, 'all'.
//   RANGE   2024-2025          an explicit window, for the files that are
//           20250101-20250430  neither a whole year nor an as-of snapshot.
//
// A period is never a summary of the coverage — it IS the coverage. `-partial`
// is a SUFFIX on top of one, never a replacement for one: a Bithumb export
// covering 2026-05-01~07-31 is `20260501-20260731-partial`, not `2026-partial`.
// Collapsing it to the year would throw away the months, which is the one thing
// the name is for; the suffix carries only the extra fact the export itself
// declared — 일부, the window is not final and the next download will extend it.
const YEAR = String.raw`\d{4}`
const ASOF = String.raw`\d{8}`
const MONTH = String.raw`\d{6}`
// Longest alternative first, so a range is never read as the year that starts it.
const RANGE = String.raw`\d{8}-\d{8}|\d{4}-\d{4}`

// Not one Bithumb document is a clean year: some cover a half, some a span of
// months, one a whole year. One alternation, most specific first.
const CRYPTO_PERIOD = [RANGE, YEAR].join('|')

// The filename token → the account label the database has always carried. These
// labels are the `account_type` and half the `account` on every Robinhood row,
// so the token is lowercased to fit the filename grammar and mapped back here.
// Renaming files must not rename accounts.
const ROBINHOOD_STRATEGIES = { agentic: 'Agentic', longterm: 'Long-term', midterm: 'Mid-term' }

// `since` is the earliest date the account could plausibly have produced, taken
// from its first transaction. It is the lower half of the date check below; the
// upper half is today. See `implausiblePeriod`.
const US_HOLDING_SPECS = [
  {
    brokerage: 'Chase',
    subdir: DIR_US_HOLDINGS,
    broker: 'chase', doctype: 'holdings', period: ASOF, ext: 'csv',
    pick: 'latest', since: '20250901',
  },
  {
    brokerage: 'Merrill',
    subdir: DIR_US_HOLDINGS,
    broker: 'merrill', doctype: 'holdings', period: ASOF, ext: 'csv',
    pick: 'latest', since: '20260301',
  },
  // The spec that was missing, and the gap it left is the reason this table
  // exists at all: Fidelity had a transactions spec and no holdings spec, so its
  // trades were read while its positions were structurally absent — roughly $51k
  // across five tickers at the peak, in a portfolio total that simply came out
  // smaller with nothing to say why. `us_brokerage_positions_ingested` now
  // exists to catch the next one, but a check that reports a missing source is
  // not a substitute for the source.
  {
    brokerage: 'Fidelity',
    subdir: DIR_US_HOLDINGS,
    broker: 'fidelity', doctype: 'holdings', period: ASOF, ext: 'csv',
    pick: 'latest', since: '20251001',
  },
]

const US_TRANSACTION_SPECS = [
  {
    brokerage: 'Chase',
    subdir: DIR_US_TRANSACTIONS,
    broker: 'chase', doctype: 'transactions', period: YEAR, ext: 'csv',
    pick: 'all', since: '20250901',
  },
  {
    brokerage: 'Chase',
    subdir: DIR_US_TRANSACTIONS,
    broker: 'chase', doctype: 'transactions', period: ASOF, ext: 'csv',
    pick: 'latest', since: '20250901',
  },
  {
    brokerage: 'Fidelity',
    subdir: DIR_US_TRANSACTIONS,
    broker: 'fidelity', doctype: 'transactions', period: YEAR, ext: 'csv',
    pick: 'all', since: '20251001',
  },
  {
    brokerage: 'Fidelity',
    subdir: DIR_US_TRANSACTIONS,
    broker: 'fidelity', doctype: 'transactions', period: ASOF, ext: 'csv',
    pick: 'latest', since: '20251001',
  },
  {
    brokerage: 'Merrill',
    subdir: DIR_US_TRANSACTIONS,
    broker: 'merrill', doctype: 'transactions', period: ASOF, ext: 'csv',
    pick: 'latest', since: '20260301',
  },
  {
    brokerage: 'Robinhood',
    subdir: DIR_US_TRANSACTIONS,
    broker: 'robinhood', doctype: 'transactions', accounts: 'agentic|longterm|midterm', period: ASOF, ext: 'csv',
    account: (m) => ROBINHOOD_STRATEGIES[m.groups.account.toLowerCase()],
    groupBy: (m) => m.groups.account.toLowerCase(),
    pick: 'latest', since: '20240601',
  },
  {
    brokerage: 'Robinhood',
    subdir: DIR_US_TRANSACTIONS,
    broker: 'robinhood', doctype: 'transactions', accounts: 'midterm', period: RANGE, ext: 'csv',
    account: 'Mid-term',
    pick: 'all', since: '20240601',
  },
]

// Crypto sources. All are 'all': every file covers a period the others do not,
// and no file supersedes another the way a re-downloaded year-to-date export
// does. The risk this trades for is OVERLAP rather than staleness — two
// statements covering the same months would double-count every trade in them —
// so the ingest asserts on the periods the documents themselves declare instead
// of on their filenames. A filename already lied once here: a statement named
// 2025년1-7월 held 2026-01-01~2026-07-31.
//
// The Bithumb activity exports in the same folder are read too, but ONLY as a
// reason lookup — never as a transaction source. They carry the same trades with
// no running balance, so ingesting them as movements would double every
// position.
//
// What they do have is 거래구분: where the PDF prints a bare 입금 with an empty
// 비고, the .xlsx names it ('혜택존 보상 - 랜덤박스', '포인트샵 입금'). Two real
// deposits are like that, and without the reason they cannot be told apart from
// the holder moving their own money in — so they were booked as transfers and
// their income went unrecorded. The subset claim held for movements and was
// wrong about this one column.
const CRYPTO_SPECS = [
  {
    venue: 'Bithumb',
    account: 'Bithumb',
    category: 'bithumb_statement',
    subdir: DIR_BITHUMB,
    broker: 'bithumb', doctype: 'statement', period: CRYPTO_PERIOD, ext: 'pdf',
    pick: 'all', since: '20240101',
  },
  {
    venue: 'Bithumb',
    account: 'Bithumb',
    category: 'bithumb_ledger',
    subdir: DIR_BITHUMB,
    broker: 'bithumb', doctype: 'activity', period: CRYPTO_PERIOD, ext: 'xlsx',
    pick: 'all', since: '20240101',
  },
  {
    venue: 'Robinhood',
    account: 'Robinhood Crypto',
    category: 'robinhood_crypto_statement',
    subdir: DIR_RH_CRYPTO,
    broker: 'robinhood', doctype: 'crypto-statement', period: MONTH, ext: 'pdf',
    pick: 'all', since: '20241101',
  },
]

// The grammar, assembled once. `accounts` is a regex fragment naming the
// accounts this spec accepts; it is captured so the same match feeds both the
// account label and groupBy.
function buildPattern(spec) {
  const segments = [spec.broker, spec.doctype]
  if (spec.accounts) segments.push(`(?<account>${spec.accounts})`)
  segments.push(`(?<period>${spec.period})`)
  // Optional on every spec: whether an export is final is a property of the
  // download, not of the broker, so any of them can arrive marked incomplete.
  return new RegExp(`^${segments.join('-')}(?<partial>-partial)?\\.${spec.ext}$`, 'i')
}

for (const spec of [...US_HOLDING_SPECS, ...US_TRANSACTION_SPECS, ...CRYPTO_SPECS]) {
  spec.pattern = buildPattern(spec)
}

function today() {
  const now = new Date()
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
}

// What the period covers, as YYYYMMDD. Every shape yields a real window — a
// `-partial` file still names the window it covers, the suffix only says more
// will be appended to it later.
function periodBounds(period) {
  let m
  if ((m = /^(\d{8})-(\d{8})$/.exec(period))) return { start: m[1], end: m[2] }
  if ((m = /^(\d{4})-(\d{4})$/.exec(period))) return { start: `${m[1]}0101`, end: `${m[2]}1231` }
  if (/^\d{8}$/.test(period)) return { start: period, end: period }
  if ((m = /^(\d{4})(\d{2})$/.exec(period))) {
    const last = new Date(Number(m[1]), Number(m[2]), 0).getDate()
    return { start: `${period}01`, end: `${period}${String(last).padStart(2, '0')}` }
  }
  if (/^\d{4}$/.test(period)) return { start: `${period}0101`, end: `${period}1231` }
  return { start: null, end: null }
}

// The date in a hand-typed filename, checked against the two things that can be
// known without opening the file: the account did not exist before `since`, and
// nothing can cover a period that has not happened yet.
//
// This is the check that was missing. `Robinhood - Agentic - 20060716
// Year-to-date.csv` sat on the refresh machine for weeks beside a correctly
// dated 20260716 copy — a mistyped year that only failed to matter because
// "newest" happens to sort 2026 above 2006. Nothing looked at the date itself.
// A uniform period is what makes looking at it possible.
function implausiblePeriod(period, since, now) {
  const { start, end } = periodBounds(period)
  if (!start) return `period '${period}' is not a shape this grammar defines`
  // The END is what must postdate the account: a complete-year archive legitimately
  // begins before the account was opened, and only its coverage has to overlap.
  if (since && end < since) return `covers ${end}, before this account existed (${since})`
  if (end > now) return `covers ${end}, which is in the future (today is ${now})`
  return null
}

function mtimeKey(filename) {
  try {
    return String(Math.round(fs.statSync(filename).mtimeMs)).padStart(20, '0')
  } catch {
    return '0'.padStart(20, '0')
  }
}

function resolveSpec(dataDir, spec, now) {
  const dir = path.join(dataDir, spec.subdir)
  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    // Directory absent — e.g. sample mode has no brokerage folders at all.
  }

  const matches = names
    .map((name) => ({ name, m: spec.pattern.exec(name) }))
    .filter((x) => x.m)
    .map((x) => ({ ...x, filename: path.join(dir, x.name) }))

  const entry = (x) => ({
    brokerage: spec.brokerage,
    venue: spec.venue,
    category: spec.category,
    account: typeof spec.account === 'function' ? spec.account(x.m) : spec.account,
    filename: x.filename,
  })
  const label = `${spec.brokerage ?? spec.venue} · ${spec.subdir}/${spec.pattern.source}`

  // Every match is judged, including the ones 'latest' is about to discard: a
  // superseded file with an impossible date is still a typo somebody should fix,
  // and staying quiet about it is how 20060716 survived.
  const problems = []
  for (const x of matches) {
    const gap = implausiblePeriod(x.m.groups.period, spec.since, now)
    if (gap) problems.push(`${spec.subdir}/${x.name}: ${gap}`)
  }

  if (matches.length === 0) return { files: [], missing: label, problems }
  if (spec.pick === 'all') return { files: matches.map(entry), missing: null, problems }

  const rankOf = (x) => `${x.m.groups.period}|${mtimeKey(x.filename)}`
  const best = new Map()
  for (const x of matches) {
    const key = spec.groupBy ? spec.groupBy(x.m) : '*'
    const prev = best.get(key)
    if (!prev || rankOf(x) > rankOf(prev)) best.set(key, x)
  }
  return { files: [...best.values()].map(entry), missing: null, problems }
}

function resolve(specs, dataDir) {
  const now = today()
  const files = []
  const missing = []
  const problems = []
  for (const spec of specs) {
    const found = resolveSpec(dataDir, spec, now)
    files.push(...found.files)
    if (found.missing) missing.push(found.missing)
    problems.push(...found.problems)
  }
  return { files, missing, problems }
}

export function resolveUsHoldingFiles(dataDir) {
  return resolve(US_HOLDING_SPECS, dataDir)
}

// ---------------------------------------------------------------------------
// Which tickers the US holdings files hold.
//
// This lives here, beside the resolver, because it had drifted from the ingest
// and drifted silently. `fetch-us-prices.mjs` carried its own copy that read
// Merrill by fixed column offsets — column 1 for the symbol — which is right for
// the tax-lot layout and reads the DESCRIPTION column of the flat one. The
// moment a flat Merrill export was filed, the price fetch went looking for
// quotes on `JPMORGAN`, `SCHWAB`, `INVESCO` and `ML`, failed to find four
// "tickers" that were never tickers, and exited non-zero — taking the whole
// refresh down before the ingest ran.
//
// A second parser for a format is a second parser to keep in step. This one is
// shared, header-driven, and tested against all three layouts on disk.
// ---------------------------------------------------------------------------

function parseCsv(body) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  const src = body.replace(/^﻿/, '')
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
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim())
    rows.push(row)
  }
  return rows
}

function csvObjects(rows, headerMatcher) {
  const headerIndex = rows.findIndex(headerMatcher)
  if (headerIndex < 0) return []
  const header = rows[headerIndex]
  return rows
    .slice(headerIndex + 1)
    .filter((r) => r.some((c) => c.length > 0))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

// Kept in step with the same names in scripts/ingest-stock-data.mjs. A position
// admitted here but not there gets a price nothing uses; one admitted there but
// not here shows up in the portfolio with no market value.
const CHASE_NON_POSITION_CLASSES = new Set(['Cash & Money Market Funds', 'Cash and Money Market Funds'])
const MERRILL_NON_POSITION_ROWS = new Set([
  'Balances',
  'Money accounts',
  'Cash balance',
  'Pending activity',
  'Total',
  'Reinvestments',
])
const US_CASH_EQUIVALENT_TICKERS = new Set(['SPAXX', 'QACDS', 'FDRXX', 'SPRXX'])
const TICKER_CELL = /^([A-Z][A-Z0-9.-]{0,11})\b/

/** Every ticker held across the resolved US holdings files, sorted. */
export function readUsHoldingTickers(files) {
  const tickers = new Set()
  const add = (value) => {
    const ticker = String(value ?? '').trim().replace(/\*+$/, '')
    if (ticker && !US_CASH_EQUIVALENT_TICKERS.has(ticker)) tickers.add(ticker)
  }

  for (const { brokerage, filename } of files) {
    // The Robinhood Gain/Loss reports are PDFs; their lots reach the price
    // fetch through the evidence snapshot instead.
    if (!filename.toLowerCase().endsWith('.csv') || !fs.existsSync(filename)) continue
    const rows = parseCsv(fs.readFileSync(filename, 'utf8')).filter((r) => r.some((c) => c.length > 0))

    if (brokerage === 'Chase') {
      for (const row of csvObjects(rows, (r) => r.includes('Account name') && r.includes('Ticker'))) {
        if (CHASE_NON_POSITION_CLASSES.has(String(row['Asset Class'] ?? '').trim())) continue
        add(row.Ticker)
      }
      continue
    }

    if (brokerage === 'Fidelity') {
      for (const row of csvObjects(rows, (r) => r.includes('Account number') && r.includes('Symbol'))) {
        if (!/^[A-Z0-9]{6,}$/.test(String(row['Account number'] ?? '').trim())) continue
        add(row.Symbol)
      }
      continue
    }

    if (brokerage === 'Merrill') {
      const headerIndex = rows.findIndex((r) => r.includes('Symbol'))
      const header = headerIndex >= 0 ? rows[headerIndex] : []
      // The flat layout puts the symbol in its own first column and shares the
      // table with a `Balances` block; the tax-lot layout indents everything by
      // one and repeats the symbol only on the position rows.
      if (headerIndex >= 0 && header.includes('Total Client Investment') && !header.includes('Cost Basis')) {
        const symbolAt = header.indexOf('Symbol')
        const quantityAt = header.indexOf('Quantity')
        for (const row of rows.slice(headerIndex + 1)) {
          const label = String(row[symbolAt] ?? '').trim()
          if (!label || MERRILL_NON_POSITION_ROWS.has(label)) continue
          if (!Number.isFinite(Number(String(row[quantityAt] ?? '').replace(/,/g, '')))) continue
          add(TICKER_CELL.exec(label)?.[1])
        }
      } else {
        for (const row of rows) {
          const symbol = TICKER_CELL.exec(String(row[1] ?? '').trim())?.[1]
          if (symbol && Number.isFinite(Number(String(row[2] ?? '').replace(/,/g, '')))) add(symbol)
        }
      }
    }
  }

  return [...tickers].sort()
}

export function resolveUsTransactionFiles(dataDir) {
  return resolve(US_TRANSACTION_SPECS, dataDir)
}

export function resolveCryptoFiles(dataDir) {
  return resolve(CRYPTO_SPECS, dataDir)
}
