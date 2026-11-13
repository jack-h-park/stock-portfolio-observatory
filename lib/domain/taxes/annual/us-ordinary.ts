import type { AnnualRulePack } from './rules'

export function formWholeDollars(minor: bigint): bigint {
  return minor < 0n ? -((-minor + 50n) / 100n) : (minor + 50n) / 100n
}
export function nonnegativeWholeTax(numerator: bigint, denominator: bigint = 10000n): bigint {
  if (numerator < 0n || denominator <= 0n) throw new Error('Invalid tax rational from pinned rules')
  return (numerator + denominator / 2n) / denominator
}
function decimalUsdCents(usd: string): bigint {
  const match = /^(\d+)\.(\d{2})$/.exec(usd)
  if (!match) throw new Error('Invalid pinned worksheet subtraction')
  return BigInt(match[1]) * 100n + BigInt(match[2])
}

/** Exact USD numerator / 10,000; eligibility belongs to the enclosing component. */
export function ordinaryTaxNumerator(taxable: bigint, status: 'single' | 'mfj', pack: AnnualRulePack, trace: { label: string }[], context = ''): bigint {
  if (taxable < 0n) throw new Error('Negative ordinary subcalculation base')
  const prefix = context ? `${context}: ` : ''
  if (taxable < 100000n) {
    const row = pack.data.usOrdinary.tableRows.find(row => taxable >= BigInt(row[0]) && taxable < BigInt(row[1]))
    if (!row) throw new Error('Pinned Tax Table interval missing')
    const wholeTax = BigInt(row[status === 'single' ? 2 : 3])
    trace.push({ label: `${prefix}2025 Pub 1040 Tax Table: ${row[0]}<=taxableIncome<${row[1]}; column=${status}; taxWholeUsd=${wholeTax}` })
    return wholeTax * 10000n
  }
  const row = pack.data.usOrdinary.worksheet[status].find(row =>
    (row.fromInclusive ? taxable >= BigInt(row.fromUsd) : taxable > BigInt(row.fromUsd)) &&
    (row.toUsdInclusive === null || taxable <= BigInt(row.toUsdInclusive)))
  if (!row) throw new Error('Pinned Tax Computation Worksheet interval missing')
  const numerator = taxable * BigInt(row.rateBasisPoints) - decimalUsdCents(row.subtractUsd) * 100n
  trace.push({ label: `${prefix}2025 Pub 1040 Worksheet ${status}: from=${row.fromUsd}; fromInclusive=${row.fromInclusive}; toInclusive=${row.toUsdInclusive ?? 'unbounded'}; rateBasisPoints=${row.rateBasisPoints}; subtractUsd=${row.subtractUsd}; exactTaxUsd=${numerator}/10000${context ? '; intermediate-not-rounded' : `; roundedWholeUsd=${nonnegativeWholeTax(numerator)}`}` })
  return numerator
}
