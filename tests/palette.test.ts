import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { ASSET_CLASS_COLOR, CHILDREN_COLOR, TONE_VAR, WRAPPER_COLOR, marketColor } from '@/lib/palette'
import { TONES, deltaTone } from '@/lib/tone'

test('crypto keeps its market colour in the asset-class palette', () => {
  assert.equal(ASSET_CLASS_COLOR.crypto, marketColor('CRYPTO'))
})

test('the chart key and the allocation key for pensions share one colour', () => {
  assert.equal(ASSET_CLASS_COLOR.pensions, ASSET_CLASS_COLOR.pension)
})

test('every tone has a chart colour', () => {
  for (const tone of TONES) assert.equal(typeof TONE_VAR[tone], 'string', tone)
})

test('currencies take the colour of the market that trades in them', () => {
  assert.equal(marketColor('KRW'), marketColor('KR'))
  assert.equal(marketColor('USD'), marketColor('US'))
})

test('wrapper and children colours are theme tokens', () => {
  for (const value of [...Object.values(WRAPPER_COLOR), CHILDREN_COLOR]) assert.match(value, /^var\(--/)
})

test('deltaTone: positive is success, negative is danger, zero and null are neutral', () => {
  assert.equal(deltaTone(1), 'success')
  assert.equal(deltaTone(-1), 'danger')
  assert.equal(deltaTone(0), 'neutral')
  assert.equal(deltaTone(null), 'neutral')
  assert.equal(deltaTone(undefined), 'neutral')
})
