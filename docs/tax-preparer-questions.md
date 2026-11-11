# Open questions for the tax preparer

The app computes figures for a US filer's worksheet. It does not decide tax treatment, and several of its choices are the repository's reading of the rules, not a confirmed position. This page lists them in one place so they can be put to a preparer and the answers recorded next to the code that depends on them.

Each entry says what the app does today, where that lives, and what changes if the answer differs. Status is `open` until a preparer has answered; then write the answer, the date and who gave it, and change the code if needed.

## Physical gold (KRX 금현물)

### 1. Commissions: added to cost, taken out of proceeds

- **Status:** open
- **What the app does:** a purchase's commission and the VAT on it are added to that lot's cost. A sale's commission and VAT are taken out of its proceeds, split across the lots it consumes by grams. This is the usual treatment of buying and selling expenses for a capital asset.
- **Where:** `scripts/gold-lots.mjs` (`matchGoldLots`), fed by `scripts/ingest-stock-data.mjs`; the chart's gold scope uses the same cost.
- **If the answer differs:** the won gain of every gold slice changes by the commission. A different treatment is a one-line change in the matcher.

### 2. Gold as a collectible, and the long-term rate

- **Status:** open
- **What the app does:** every gold row is marked `collectible=true`. The worksheet notes and `tax:realized --include-gold` report its gain by term apart from stocks, because the maximum long-term rate on collectibles differs from the one on stocks (28% is the figure usually cited). No tax is computed and no rate is applied anywhere.
- **Open point:** whether gold held as a spot position at a Korean exchange account is a collectible for this purpose, or is treated like a security or a foreign financial instrument.
- **Where:** `lib/tax-export.ts` (`collectibleByTerm`), `lib/cli/tax-realized.ts` (`gainTotals`).
- **If the answer differs:** only the grouping changes. The per-slice dollar gain is the same either way.

### 3. First in, first out as the lot identification method

- **Status:** open
- **What the app does:** a sale takes grams from the oldest purchase first, and a purchase on the day of a sale is matched before it. Each slice carries the holding period of the purchase it consumed (long term when held more than 365 days).
- **Open point:** whether FIFO is the right default here, or the account permits and the filer wants specific identification.
- **Where:** `scripts/gold-lots.mjs`.
- **If the answer differs:** the split between short and long term changes, and so may the total gain.

### 4. Won-to-dollar conversion

- **Status:** open
- **What the app does:** a lot's cost is converted at the USD/KRW rate of its acquisition date and its proceeds at the rate of the sale date, each from the stored daily rate table. The gain is the difference in dollars, so it includes currency movement.
- **Open point:** the same reading is applied to every Korea-account lot. It is the repository's reading of the IRS method and the notes file says so.
- **Where:** `scripts/ingest-stock-data.mjs` (`historicalUsdKrwOn`, `usdOn`).

### 5. Reporting the gold account

- **Status:** open
- **Open point:** whether the gold account counts as a foreign financial account for FBAR and FATCA purposes, and how it is valued there. The app reports no FBAR figure for it.

## Stocks, ETFs and crypto

### 6. Wash sales are not computed for replayed lots

- **Status:** open
- **What the app does:** a lot rebuilt from transactions (`basis_source=replay`) has no wash-sale adjustment. A lot from a broker's 1099-B uses the broker's filed gain, and `adjustment_usd` is the difference between that gain and proceeds minus cost.
- **Open point:** whether the filer has any replacement purchases within the window on replayed lots that need a manual adjustment.
- **Check that is still undone:** no 1099-B row in the current data has a non-zero adjustment (five rows, all sales in 2025, none with a wash sale), so the path that shows a broker's adjustment has only been exercised in tests. The first real wash-sale row should be compared against the broker's form.

### 7. Form 8949 boxes and covered status

- **Status:** open
- **What the app does:** the box letter is the stored one on a 1099-B row and blank on every other row. It is never derived. Crypto rows have no box because 1099-DA is not parsed.
- **Open point:** which box the preparer assigns to replayed and crypto rows.

### 8. Sale year

- **Status:** open
- **What the app does:** a row belongs to the year of its sale date as stored, and the worksheet's "today" uses the Los Angeles calendar. A sale late in the day in Korea can fall on a different calendar date in the US.
- **Open point:** which date convention the preparer wants for sales near a year end.

## Where answers go

Write each answer under its entry (answer, date, who gave it) and, if the code changes, link the pull request. Do not put account numbers, balances or names of other people on this page; the repository is public.
