// pension-ids.mjs — the stable id a pension fund or cash row is stored under.
//
// A fund has no ticker, so it used to be numbered by its row in the snapshot
// (`PENSION:<token>:<n>`), and the same fund changed id whenever a snapshot
// listed its rows in another order. The id is now a slug of the fund's name: the
// first 10 hex characters of sha1 over the NFC-normalised, whitespace-collapsed
// name. Cash keeps its kind in the id (`PENSION:<token>:cash:<slug>`) so the
// readers that split ETF/FUND/CASH and the PFIC count can tell it apart.

import { createHash } from 'node:crypto'

/** The name as the slug sees it: NFC, every whitespace run one space, trimmed. */
export function normalizePensionName(name) {
  return String(name ?? '').normalize('NFC').replace(/\s+/g, ' ').trim()
}

export function pensionNameSlug(name) {
  return createHash('sha1').update(normalizePensionName(name), 'utf8').digest('hex').slice(0, 10)
}

export function pensionProductId(token, name, cash) {
  return cash ? `PENSION:${token}:cash:${pensionNameSlug(name)}` : `PENSION:${token}:${pensionNameSlug(name)}`
}
