import { expect, test } from 'vitest'
import type { Tx } from '@app/application'
import { emptyPublishingHistory } from './publishing-history.js'

test('the empty history has no post on any account', async () => {
  const facts = await emptyPublishingHistory.forDestinations({} as Tx, {
    organizationId: 'org',
    accountIds: ['a', 'b'],
    at: new Date('2026-11-18T17:00:00Z'),
  })
  expect(facts.recentFingerprints.size).toBe(0)
  expect(facts.reelsLast24h.size).toBe(0)
  expect(facts.scheduledNear.size).toBe(0)
})
