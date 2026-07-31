// fetch-toss.mjs — pull the Toss Securities account straight from its Open API.
//
// Toss is 36 of the 47 Korean holdings and 84% of the Korean trades, and until
// now every one of them reached the dashboard by way of a spreadsheet somebody
// had to update by hand. That stopped happening on 2026-07-15. This is the path
// that does not depend on anyone remembering.
//
// Writes ONE raw snapshot and lets the extraction step shape it, so a change in
// how we model the data never costs another round of API calls: the snapshot is
// the record of what the broker said, timestamped.
//
// Auth: OAuth2 client credentials from TOSS_OPENAPI_CLIENT_ID / _CLIENT_SECRET.
// The API also enforces an IP allowlist — a machine whose address is not
// registered gets 403 `IP address not allowed` with perfectly valid keys, which
// is why the failure below prints the distinction instead of just "auth failed".

import fs from 'node:fs'
import path from 'node:path'
import { loadLocalEnv } from './env.mjs'

loadLocalEnv()

const BASE = process.env.TOSS_OPENAPI_BASE || 'https://openapi.tossinvest.com'
const CLIENT_ID = process.env.TOSS_OPENAPI_CLIENT_ID
const CLIENT_SECRET = process.env.TOSS_OPENAPI_CLIENT_SECRET
const OUT_PATH = process.env.STOCK_TOSS_SNAPSHOT_PATH || path.join(process.cwd(), 'data/toss-snapshot.json')

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('ERROR: TOSS_OPENAPI_CLIENT_ID / TOSS_OPENAPI_CLIENT_SECRET are not set (.env.local)')
  process.exit(1)
}


async function api(url, options = {}) {
  const res = await fetch(url, options)
  const body = await res.text()
  if (!res.ok) {
    let detail = body.slice(0, 300)
    try {
      const parsed = JSON.parse(body)
      detail = parsed.error_description || parsed.error?.message || detail
      if (parsed.error === 'access_denied' && /IP/i.test(parsed.error_description ?? '')) {
        detail += ' — the credentials are valid; this machine\'s public IP is not on the Toss allowlist'
      }
    } catch {}
    throw new Error(`${res.status} ${url.replace(BASE, '')}: ${detail}`)
  }
  return JSON.parse(body)
}

async function main() {
const token = (await api(`${BASE}/oauth2/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  }),
})).access_token

const auth = { Authorization: `Bearer ${token}` }
const accountsRaw = await api(`${BASE}/api/v1/accounts`, { headers: auth })
const accounts = accountsRaw.result ?? accountsRaw
const list = Array.isArray(accounts) ? accounts : [accounts]
if (!list.length) {
  console.error('ERROR: the token is valid but no account came back')
  process.exit(1)
}

const snapshot = { fetchedAt: new Date().toISOString(), base: BASE, accounts: [] }

for (const account of list) {
  const seq = account.accountSeq
  const headers = { ...auth, 'X-Tossinvest-Account': String(seq) }
  const holdings = (await api(`${BASE}/api/v1/holdings`, { headers })).result

  // Every closed order, oldest included: `from`/`to` omitted means the whole
  // period. The cursor is followed to exhaustion because a truncated history
  // silently understates cost basis — the lots it cannot see look like they
  // never existed.
  const orders = []
  let cursor = null
  let pages = 0
  do {
    const query = new URLSearchParams({ status: 'CLOSED', limit: '100' })
    if (cursor) query.set('cursor', cursor)
    const page = (await api(`${BASE}/api/v1/orders?${query}`, { headers })).result
    orders.push(...(page.orders ?? []))
    cursor = page.hasNext ? page.nextCursor : null
    pages += 1
    if (pages > 500) {
      console.error(`WARNING: stopped paginating orders after ${pages} pages — history may be incomplete`)
      break
    }
  } while (cursor)

  const filled = orders.filter((o) => o.status === 'FILLED')
  const dates = filled.map((o) => o.execution?.filledAt ?? o.orderedAt).filter(Boolean).sort()
  console.error(
    `[toss] account ${String(account.accountNo ?? seq).slice(0, 4)}…: ` +
    `${holdings?.items?.length ?? 0} holding(s), ${orders.length} closed order(s) ` +
    `(${filled.length} filled${dates.length ? `, ${dates[0].slice(0, 10)} → ${dates[dates.length - 1].slice(0, 10)}` : ''}) ` +
    `over ${pages} page(s)`
  )
  snapshot.accounts.push({ accountNo: account.accountNo, accountSeq: seq, accountType: account.accountType, holdings, orders })
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
fs.writeFileSync(OUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(`Wrote ${OUT_PATH} (${snapshot.accounts.length} account(s))`)
}

// A rejected top-level await is a module-evaluation failure, not an unhandled
// rejection, so Node prints a stack and buries the one line that says what to do
// — and "invalid secret" versus "this machine's IP is not registered" is the
// whole point of the message. Written with writeSync because stderr to a pipe is
// async and process.exit() tears the process down before it drains, which under
// a scheduler means the step fails with no reason given at all.
main().catch((error) => {
  fs.writeSync(2, `ERROR: ${error instanceof Error ? error.message : error}\n`)
  if (process.env.STOCK_DEBUG && error instanceof Error) fs.writeSync(2, `${error.stack}\n`)
  process.exit(1)
})
