import { getAnnualRequiredAmounts, getAnnualComponentBlocker, validateAnnualEstimateInput, type AnnualComponentResult, type AnnualEstimateInput, type AmountKey } from './contracts'
import { getAnnualRulePack } from './rules'

export type FederalCalculatedComponent = 'us.regular.ordinary' | 'us.niit'

/** The explicit whole-dollar form mode; signed half ties move away from zero. */
function formWholeDollars(minor: bigint): bigint {
  return minor < 0n ? -((-minor + 50n) / 100n) : (minor + 50n) / 100n
}
function nonnegativeWholeTax(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n) throw new Error('Invalid negative tax from pinned rule data')
  return (numerator + denominator / 2n) / denominator
}
function decimalUsdCents(usd: string): bigint {
  const match = /^(\d+)\.(\d{2})$/.exec(usd)
  if (!match) throw new Error('Invalid pinned worksheet subtraction')
  return BigInt(match[1]) * 100n + BigInt(match[2])
}

/** Pure 2025 individual federal component calculation, with no return composition or I/O. */
export function calculateFederalComponent(value: AnnualEstimateInput, id: FederalCalculatedComponent): AnnualComponentResult {
  const input = validateAnnualEstimateInput(value)
  if (input.authority !== 'US:federal' || !input.requestedComponents.includes(id) || !['us.regular.ordinary', 'us.niit'].includes(id)) throw new Error('Federal component scope mismatch')
  const pack = getAnnualRulePack(input.taxYear, input.rulePackId)
  const inputRefs = getAnnualRequiredAmounts(input, id).filter(key => input.amounts[key])
  const sourceRefs = [...pack.readiness[id].sourceIds]
  const blocker = getAnnualComponentBlocker(input, id)
  if (blocker) return { id, ...blocker, amountMinor: null, sourceRefs, inputRefs, trace: [] }

  const trace: { label: string }[] = []
  const line = (key: AmountKey): bigint => {
    const amount = input.amounts[key]!
    const rounded = formWholeDollars(BigInt(amount.minor))
    trace.push({ label: `Form line ${key}: originalMinor=${amount.minor} USD; roundedWholeUsd=${rounded}; origin=${amount.origin}` })
    return rounded
  }
  const status = input.filingStatus as 'single' | 'mfj'
  let wholeTax: bigint
  if (id === 'us.regular.ordinary') {
    const taxable = line('taxableIncome')
    if (taxable < 100000n) {
      const row = pack.data.usOrdinary.tableRows.find(row => taxable >= BigInt(row[0]) && taxable < BigInt(row[1]))
      if (!row) throw new Error('Pinned Tax Table interval missing')
      wholeTax = BigInt(row[status === 'single' ? 2 : 3])
      trace.push({ label: `2025 Pub 1040 Tax Table: ${row[0]}<=taxableIncome<${row[1]}; column=${status}; taxWholeUsd=${wholeTax}` })
    } else {
      const row = pack.data.usOrdinary.worksheet[status].find(row =>
        (row.fromInclusive ? taxable >= BigInt(row.fromUsd) : taxable > BigInt(row.fromUsd)) &&
        (row.toUsdInclusive === null || taxable <= BigInt(row.toUsdInclusive)))
      if (!row) throw new Error('Pinned Tax Computation Worksheet interval missing')
      // Numerator in dollars / 10,000: subtract cents * 100, without rounding the product.
      const numerator = taxable * BigInt(row.rateBasisPoints) - decimalUsdCents(row.subtractUsd) * 100n
      wholeTax = nonnegativeWholeTax(numerator, 10000n)
      trace.push({ label: `2025 Pub 1040 Worksheet ${status}: from=${row.fromUsd}; fromInclusive=${row.fromInclusive}; toInclusive=${row.toUsdInclusive ?? 'unbounded'}; rateBasisPoints=${row.rateBasisPoints}; subtractUsd=${row.subtractUsd}; exactTaxUsd=${numerator}/10000; roundedWholeUsd=${wholeTax}` })
    }
  } else {
    const magi = line('niitMagi')
    const nii = line('netInvestmentIncome')
    const threshold = BigInt(pack.data.usNiit.thresholdsUsd[status])
    const excess = magi > threshold ? magi - threshold : 0n
    const base = nii < excess ? nii : excess
    const numerator = base * BigInt(pack.data.usNiit.rateBasisPoints)
    wholeTax = nonnegativeWholeTax(numerator, 10000n)
    trace.push({ label: `2025 Form 8960 individual lines 14-17: thresholdWholeUsd=${threshold}; excessWholeUsd=${excess}; cappedBaseWholeUsd=${base}; rateBasisPoints=${pack.data.usNiit.rateBasisPoints}; exactTaxUsd=${numerator}/10000; roundedWholeUsd=${wholeTax}` })
  }
  const amountMinor = String(wholeTax * 100n)
  trace.push({ label: `${id === 'us.niit' ? 'Form 8960 line 17' : 'Form 1040 line 16'}: amountMinor=${amountMinor} USD; whole-dollar form mode; component only` })
  return { id, mode: 'computed', amountMinor, reason: 'Calculated from supplied form-line bases in explicit 2025 whole-dollar form mode; no annual-total or settlement claim', sourceRefs, inputRefs, trace }
}
