import type { AnnualEstimateInput, AmountKey } from './contracts'
import type { AnnualRulePack } from './rules'
import { ordinaryTaxNumerator } from './us-ordinary'

/** Complete eligible 25-line QDCG worksheet; exact USD numerator / 10,000 through line 25. */
export function qualifiedGainTaxNumerator(input: AnnualEstimateInput, pack: AnnualRulePack, formLine: (key: AmountKey) => bigint, trace: { label: string }[]): bigint {
  if (!('usQdcg' in pack.data)) throw new Error('Selected pack lacks QDCG rules')
  const rules = pack.data.usQdcg
  const status = input.filingStatus as 'single' | 'mfj'
  const min = (a: bigint, b: bigint) => a < b ? a : b
  const floor = (n: bigint) => n > 0n ? n : 0n
  const integer: bigint[] = []
  const tax: bigint[] = []
  const record = (n: number, numerator: bigint) => trace.push({ label: `QDCG line ${n}: exactUsd=${numerator}/10000; intermediate-not-rounded` })
  const wholeLine = (n: number, value: bigint) => { integer[n] = value; record(n, value * 10000n) }
  const taxLine = (n: number, numerator: bigint) => { tax[n] = numerator; record(n, numerator) }

  wholeLine(1, formLine('taxableIncome'))
  wholeLine(2, formLine('qualifiedDividends'))
  // Ordinary dividends establish the reviewed classification ceiling, not extra taxable income.
  formLine('ordinaryDividends')
  if (input.qdcgWorksheet?.state === 'schedule-d-reviewed') {
    wholeLine(3, floor(min(formLine('netLongTermGain'), formLine('netCapitalGain'))))
  } else if (input.qdcgWorksheet?.state === 'distributions-only-reviewed') {
    wholeLine(3, formLine('capitalGainDistributions'))
  } else throw new Error('Unreviewed QDCG gain-selection branch')
  wholeLine(4, integer[2] + integer[3])
  wholeLine(5, floor(integer[1] - integer[4]))
  wholeLine(6, BigInt(rules.thresholdsUsd[status].zeroRateCeiling))
  wholeLine(7, min(integer[1], integer[6]))
  wholeLine(8, min(integer[5], integer[7]))
  wholeLine(9, integer[7] - integer[8])
  wholeLine(10, min(integer[1], integer[4]))
  wholeLine(11, integer[9])
  wholeLine(12, integer[10] - integer[11])
  wholeLine(13, BigInt(rules.thresholdsUsd[status].fifteenRateCeiling))
  wholeLine(14, min(integer[1], integer[13]))
  wholeLine(15, integer[5] + integer[9])
  wholeLine(16, floor(integer[14] - integer[15]))
  wholeLine(17, min(integer[12], integer[16]))
  taxLine(18, integer[17] * BigInt(rules.ratesBasisPoints.fifteen))
  wholeLine(19, integer[9] + integer[17])
  wholeLine(20, integer[10] - integer[19])
  taxLine(21, integer[20] * BigInt(rules.ratesBasisPoints.twenty))
  taxLine(22, ordinaryTaxNumerator(integer[5], status, pack, trace, 'QDCG ordinary subcalculation line 22'))
  taxLine(23, tax[18] + tax[21] + tax[22])
  taxLine(24, ordinaryTaxNumerator(integer[1], status, pack, trace, 'QDCG ordinary subcalculation line 24'))
  taxLine(25, min(tax[23], tax[24]))
  return tax[25]
}
