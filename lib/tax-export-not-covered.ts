/**
 * What the tax worksheet does not cover, in the order the notes file lists it.
 *
 * The English text goes into the notes file a US preparer receives, so it does
 * not change; the /realized page reads the same entries by code and shows a
 * translation where the language calls for one. Kept free of imports so a copy
 * module can read it; lib/tax-export re-exports it.
 */
export const NOT_COVERED_NOTES = [
  {
    code: 'worksheet',
    text: 'This is a worksheet, not a filing. Rows marked replay are this repo\'s FIFO estimate; rows marked 1099b are the broker\'s filed figures.',
  },
  {
    code: 'adjustments',
    text: 'On 1099b rows the gain is the broker\'s filed gain, and adjustment_usd is its difference from proceeds minus cost (wash-sale and basis adjustments); the adjustment code is not stored, so Form 8949 column f is omitted. Replay rows carry no adjustment, and wash sales are not computed for them.',
  },
  {
    code: 'box_codes',
    text: 'Box codes appear only on 1099b rows. Crypto rows have no box here; 1099-DA is not parsed by this app.',
  },
  {
    code: 'korea_dollars',
    text: 'Korea-account lots are measured in dollars: cost at the acquisition-date rate, proceeds at the sale-date rate. This is the repo\'s reading of the IRS method, to be confirmed with the preparer.',
  },
  {
    code: 'gold_collectibles',
    text: 'Physical gold (KRX) sales are included as collectibles (collectible=true), matched first in, first out so each row carries the holding period of the purchase it consumed. Purchase commissions are added to cost and sale commissions are taken out of proceeds, in won, then converted at the acquisition-date and sale-date rates. The gain on long-term collectibles is taxed at a different maximum rate than a stock\'s; this export does not compute any tax.',
  },
  {
    code: 'not_included',
    text: 'Not included: other owners\' accounts, pension wrappers, dividends and interest, FBAR, Korean-side gains and tax.',
  },
  {
    code: 'shared_alias',
    text: 'Two accounts that carry an identical stored label cannot be told apart by the export, and share one alias.',
  },
] as const

export type NotCoveredCode = (typeof NOT_COVERED_NOTES)[number]['code']

/** The English text of each entry, keyed by code, for the `en` half of the page copy. */
export const NOT_COVERED_TEXT = Object.fromEntries(NOT_COVERED_NOTES.map((note) => [note.code, note.text])) as Record<NotCoveredCode, string>
