import fs from 'node:fs'
import path from 'node:path'

// Which brokerage export files to ingest, matched by PATTERN rather than by an
// exact name. The exact-name list this replaces embedded the export date
// (`Chase-taxlots-20260715.csv`), so the next download — a new date — was never
// read: the ingest kept silently using week-old data, and deleting an old file
// made a whole brokerage vanish with no error. Same failure class as the
// under-counting bugs this repo just fixed: nothing breaks, the number is just
// wrong.
//
// Each spec matches files in a subdir and selects among them:
//   pick 'latest' → the newest match only. Rotating exports whose name carries a
//                   date (broker tax-lot snapshots, year-to-date transactions).
//                   Ingesting an old AND a new year-to-date file would
//                   double-count every transaction they share.
//   pick 'all'    → every match. Stable historical archives that coexist and
//                   cover distinct periods (e.g. "2025 Full").
//   groupBy       → with 'latest', keep the newest match PER key. Robinhood
//                   keeps one year-to-date file per account.
//
// "Newest" = the last 8-digit run (YYYYMMDD) in the name, then mtime. The name
// is authoritative when it carries a date; mtime breaks ties and orders the
// dateless historical files. Within one spec+group every match shares the
// pattern, so date presence is uniform and the string compare is well-defined.

const HOLDINGS_DIR = '미국증권사 보유종목 현황 (Tax Lot 구분 포함)'
const TX_DIR = '미국증권사 거래내역 (CSV)'

const US_HOLDING_SPECS = [
  { brokerage: 'Chase', subdir: HOLDINGS_DIR, pattern: /^Chase-taxlots-\d{8}\.csv$/i, pick: 'latest' },
  { brokerage: 'Merrill', subdir: HOLDINGS_DIR, pattern: /^Merrill-ExportData.*\.csv$/i, pick: 'latest' },
]

const US_TRANSACTION_SPECS = [
  { brokerage: 'Chase', subdir: TX_DIR, pattern: /^Chase - All Transactions - \d{4} Full\.csv$/i, pick: 'all' },
  { brokerage: 'Chase', subdir: TX_DIR, pattern: /^Chase - All Transactions - \d{8} Year-to-date\.csv$/i, pick: 'latest' },
  { brokerage: 'Fidelity', subdir: TX_DIR, pattern: /^Fidelity - All History - \d{4} Full\.csv$/i, pick: 'all' },
  { brokerage: 'Fidelity', subdir: TX_DIR, pattern: /^Fidelity - All History - \d{8} Year-to-date\.csv$/i, pick: 'latest' },
  { brokerage: 'Merrill', subdir: TX_DIR, pattern: /^Merrill - All Activities - \d{8} Year-to-date\.csv$/i, pick: 'latest' },
  {
    brokerage: 'Robinhood',
    subdir: TX_DIR,
    pattern: /^Robinhood - (Agentic|Long-term|Mid-term) - \d{8} Year-to-date\.csv$/i,
    account: (m) => m[1],
    groupBy: (m) => m[1],
    pick: 'latest',
  },
  { brokerage: 'Robinhood', account: 'Mid-term', subdir: TX_DIR, pattern: /^Robinhood - Mid-term - 2024~2025\.csv$/i, pick: 'all' },
]

function dateKey(name) {
  const runs = name.match(/\d{8}/g)
  return runs ? runs[runs.length - 1] : ''
}

function mtimeKey(filename) {
  try {
    return String(Math.round(fs.statSync(filename).mtimeMs)).padStart(20, '0')
  } catch {
    return '0'.padStart(20, '0')
  }
}

function resolveSpec(dataDir, spec) {
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
    account: typeof spec.account === 'function' ? spec.account(x.m) : spec.account,
    filename: x.filename,
  })
  const label = `${spec.brokerage} · ${spec.subdir}/${spec.pattern.source}`

  if (matches.length === 0) return { files: [], missing: label }
  if (spec.pick === 'all') return { files: matches.map(entry), missing: null }

  const rankOf = (x) => `${dateKey(x.name)}|${mtimeKey(x.filename)}`
  const best = new Map()
  for (const x of matches) {
    const key = spec.groupBy ? spec.groupBy(x.m) : '*'
    const prev = best.get(key)
    if (!prev || rankOf(x) > rankOf(prev)) best.set(key, x)
  }
  return { files: [...best.values()].map(entry), missing: null }
}

function resolve(specs, dataDir) {
  const files = []
  const missing = []
  for (const spec of specs) {
    const { files: found, missing: gap } = resolveSpec(dataDir, spec)
    files.push(...found)
    if (gap) missing.push(gap)
  }
  return { files, missing }
}

export function resolveUsHoldingFiles(dataDir) {
  return resolve(US_HOLDING_SPECS, dataDir)
}

export function resolveUsTransactionFiles(dataDir) {
  return resolve(US_TRANSACTION_SPECS, dataDir)
}
