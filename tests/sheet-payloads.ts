import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The sheet payloads the ingest reads unconditionally, headers only.
 *
 * Every end-to-end ingest test needs these present or the run dies on a missing
 * file before it reaches anything worth asserting. They carry no rows: a test
 * supplies its own data through the source it is actually exercising, and an
 * empty payload keeps the rest of the pipeline quiet rather than mixing another
 * broker's fixtures into the result.
 */
export const PAYLOAD_HEADERS: Record<string, string> = {
  'summary.noapost.tsv':
    'Account\tTicker\tName\tQuantity\tAverage Unit Cost\tTotal Cost\tCurrent Price\tPE\tEPS\tUnrealized G/L Amt.\tUnrealized Gain/Loss (%)\tLong-Term Qty\tShort-Term Qty\tLot Count',
  'taxlots.tsv':
    'Account\tTicker\tName\tAcquired Date\tOpen Quantity\tCost Basis (KRW)\tUnit Cost\tHolding Days as of 2026-07-15\tTax Term\tSource',
  'transactions.tsv':
    'Date\tAccount\tType\tRaw Type\tTicker\tName\tQuantity\tAmount (KRW)\tSettlement (KRW)\tUnit Price\tFee\tTax\tBalance\tSource\tPage',
  'dividends.tsv': 'Date\tAccount\tSymbol\tName\tAmount (KRW)\tType\tSource\tPage',
  'realized.tsv':
    'Account\tTicker\tName\tAcquired Date\tSold Date\tQuantity Sold\tCost Basis (KRW)\tProceeds (KRW)\tRealized G/L (KRW)\tHolding Days\tTax Term\tSource',
}

/** Write them into a scratch data dir. */
export function writeSheetPayloads(dir: string) {
  const out = path.join(dir, '.codex_sheet_payloads')
  mkdirSync(out, { recursive: true })
  for (const [name, header] of Object.entries(PAYLOAD_HEADERS)) {
    writeFileSync(path.join(out, name), header + '\n', 'utf8')
  }
}
