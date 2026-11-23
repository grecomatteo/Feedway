import { expect, test } from 'vitest'
import { CLAIM_MS, DELIVERY_ATTEMPTS, afterFailure } from './delivery.js'

const at = new Date('2026-11-23T18:00:00Z')

test('a failed send is tried again after 1, 5 and 15 minutes, then it has failed', () => {
  expect(afterFailure(0, at)).toEqual({ retryAt: new Date('2026-11-23T18:01:00Z') })
  expect(afterFailure(1, at)).toEqual({ retryAt: new Date('2026-11-23T18:05:00Z') })
  expect(afterFailure(2, at)).toEqual({ retryAt: new Date('2026-11-23T18:15:00Z') })
  expect(afterFailure(3, at)).toEqual({ retryAt: null })
  expect(DELIVERY_ATTEMPTS).toBe(4)
})

test('a claim outlasts a send, so only a fallen process leaves one behind', () => {
  expect(CLAIM_MS).toBeGreaterThanOrEqual(2 * 60_000)
})
