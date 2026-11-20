import { expect, test } from 'vitest'
import { DISCARD_KEY, idsToDiscard, roundIds, withRoundIds } from './meta-ids.js'

test('the ids of the round leave out those to throw away', () => {
  expect(roundIds(null)).toBeNull()
  expect(roundIds({ [DISCARD_KEY]: { containerId: '1' } })).toBeNull()
  expect(roundIds({ containerId: '2', [DISCARD_KEY]: { containerId: '1' } })).toEqual({
    containerId: '2',
  })
})

test('the ids to throw away are an object, or nothing', () => {
  expect(idsToDiscard({ containerId: '2' })).toBeNull()
  expect(idsToDiscard({ [DISCARD_KEY]: 'x' })).toBeNull()
  expect(idsToDiscard({ [DISCARD_KEY]: { photos: ['1'] } })).toEqual({ photos: ['1'] })
})

test('saving the ids of the round keeps those still to throw away', () => {
  expect(withRoundIds(null, { a: '1' })).toEqual({ a: '1' })
  expect(withRoundIds({ [DISCARD_KEY]: { a: '0' }, a: '9' }, { a: '1' })).toEqual({
    a: '1',
    [DISCARD_KEY]: { a: '0' },
  })
})
