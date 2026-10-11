import assert from 'node:assert/strict'
import test from 'node:test'
import { buildInvestmentEpisodes, type ClosedLot, type OpenLot } from '../lib/asset-events'

const lot = (id: number, acquiredDate: string, costKrw: number) => ({ id, market: 'KR', ticker: 'AAA', name: 'Invented', acquiredDate, costKrw })
const closed = (id: number, acquiredDate: string, costKrw: number, soldDate: string, realizedKrw: number): ClosedLot => ({ ...lot(id, acquiredDate, costKrw), soldDate, realizedKrw })
const open = (id: number, acquiredDate: string, costKrw: number, marketValueKrw: number | null, estimatedTaxKrw: number | null = 0): OpenLot => ({ ...lot(id, acquiredDate, costKrw), marketValueKrw, estimatedTaxKrw })

test('selling down to an observation lot ends the episode; a rebuy starts a new one, and the leftover gain stays with the first', () => {
  const episodes = buildInvestmentEpisodes({
    closed: [closed(1, '2024-01-10', 30_000_000, '2024-06-01', 8_000_000)],
    open: [open(2, '2024-01-10', 300_000, 500_000), open(3, '2025-03-01', 20_000_000, 26_000_000, 1_300_000)],
    dividends: [],
  })
  assert.equal(episodes.length, 2)
  assert.deepEqual([episodes[0].start, episodes[0].end, episodes[0].peakCostKrw], ['2024-01-10', '2024-06-01', 30_300_000])
  assert.equal(episodes[0].realizedKrw, 8_000_000)
  assert.equal(episodes[0].unrealizedKrw, 200_000)
  assert.deepEqual([episodes[1].start, episodes[1].end, episodes[1].unrealizedKrw, episodes[1].estimatedTaxKrw], ['2025-03-01', null, 6_000_000, 1_300_000])
})

test('two accounts of one ticker are one stream: a sale in one does not end the episode while the other holds enough', () => {
  const episodes = buildInvestmentEpisodes({
    closed: [closed(1, '2024-01-10', 5_000_000, '2024-03-01', 1_000_000)],
    open: [open(2, '2024-02-01', 4_000_000, 5_000_000)],
    dividends: [],
  })
  assert.equal(episodes.length, 1)
  assert.equal(episodes[0].end, null)
  assert.equal(episodes[0].gainKrw, 1_000_000 + 1_000_000)
})

test('dividends inside an episode add to its gain; an unpriced open lot is counted, not valued', () => {
  const [episode] = buildInvestmentEpisodes({
    closed: [],
    open: [open(1, '2024-01-10', 12_000_000, null, null)],
    dividends: [{ market: 'KR', ticker: 'AAA', date: '2024-05-01', amountKrw: 400_000 }],
  })
  assert.equal(episode.dividendsKrw, 400_000)
  assert.equal(episode.unrealizedKrw, 0)
  assert.equal(episode.unpricedLots, 1)
  assert.equal(episode.estimatedTaxKrw, null)
})

test('a ticker that never reaches the floor makes no episode', () => {
  assert.deepEqual(buildInvestmentEpisodes({ closed: [closed(1, '2024-01-10', 500_000, '2024-02-01', 50_000)], open: [], dividends: [] }), [])
})
