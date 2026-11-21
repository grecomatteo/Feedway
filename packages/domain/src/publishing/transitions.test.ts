import { describe, expect, it } from 'vitest'
import { TARGET_STATUSES, type TargetStatus } from './target-status.js'
import { canMoveTarget, type TargetMover } from './transitions.js'

// Every move of §9.3 with who makes it; every pair not listed here is refused.
const ALLOWED: Record<TargetMover, [TargetStatus, TargetStatus][]> = {
  panel: [
    ['draft', 'scheduled'],
    ['scheduled', 'draft'],
    ['scheduled', 'cancelled'],
    // P2: editing, «Riporta in bozza» and cancelling until nothing is publishing
    ['preparing', 'scheduled'],
    ['preparing', 'draft'],
    ['preparing', 'cancelled'],
    ['ready', 'scheduled'],
    ['ready', 'draft'],
    ['ready', 'cancelled'],
    ['retrying', 'scheduled'],
    ['retrying', 'draft'],
    ['retrying', 'cancelled'],
    // «Riprova» and cancelling one destination
    ['failed', 'scheduled'],
    ['failed', 'cancelled'],
    // P5: «Riprendi» and «Annulla» of a paused destination
    ['paused', 'scheduled'],
    ['paused', 'cancelled'],
    // «Riprova» from «Con problema» asks Meta first; «Segna come verificato»
    ['problem', 'unknown'],
    ['problem', 'confirmed'],
  ],
  worker: [
    ['scheduled', 'preparing'],
    ['scheduled', 'failed'],
    ['scheduled', 'paused'],
    // the client was archived (D-70): what has not gone out does not
    ['scheduled', 'cancelled'],
    ['preparing', 'ready'],
    ['preparing', 'retrying'],
    ['preparing', 'failed'],
    ['preparing', 'paused'],
    ['preparing', 'cancelled'],
    ['ready', 'publishing'],
    ['ready', 'preparing'],
    ['ready', 'retrying'],
    ['ready', 'failed'],
    ['ready', 'paused'],
    ['ready', 'cancelled'],
    ['publishing', 'published'],
    ['publishing', 'retrying'],
    ['publishing', 'failed'],
    ['publishing', 'unknown'],
    ['retrying', 'preparing'],
    ['retrying', 'publishing'],
    ['retrying', 'failed'],
    ['retrying', 'paused'],
    ['retrying', 'cancelled'],
    ['unknown', 'published'],
    ['unknown', 'confirmed'],
    ['unknown', 'retrying'],
    ['unknown', 'failed'],
    ['published', 'verifying'],
    ['verifying', 'confirmed'],
    ['verifying', 'problem'],
  ],
}

describe('canMoveTarget', () => {
  for (const by of ['panel', 'worker'] as const)
    for (const from of TARGET_STATUSES)
      for (const to of TARGET_STATUSES) {
        const expected = ALLOWED[by].some(([f, t]) => f === from && t === to)
        it(`${by}: ${from} → ${to} ${expected ? 'allowed' : 'refused'}`, () => {
          expect(canMoveTarget(from, to, by)).toBe(expected)
        })
      }

  it('every state but the last ones has a way out', () => {
    const terminal = new Set<TargetStatus>(['confirmed', 'cancelled'])
    for (const from of TARGET_STATUSES) {
      const out = TARGET_STATUSES.some(
        (to) => canMoveTarget(from, to, 'panel') || canMoveTarget(from, to, 'worker'),
      )
      expect(out, from).toBe(!terminal.has(from))
    }
  })

  it('the panel never moves a destination into the steps of the worker (unknown only from problem)', () => {
    const steps: TargetStatus[] = [
      'preparing',
      'ready',
      'publishing',
      'retrying',
      'published',
      'verifying',
    ]
    for (const from of TARGET_STATUSES)
      for (const to of steps)
        expect(canMoveTarget(from, to, 'panel'), `${from} → ${to}`).toBe(false)
  })

  it('the panel never touches a destination that is publishing, published or verifying', () => {
    for (const from of ['publishing', 'published', 'verifying', 'unknown'] as const)
      for (const to of TARGET_STATUSES)
        expect(canMoveTarget(from, to, 'panel'), `${from} → ${to}`).toBe(false)
  })

  it('the worker never schedules or brings back to draft', () => {
    for (const from of TARGET_STATUSES)
      for (const to of ['draft', 'scheduled'] as const)
        expect(canMoveTarget(from, to, 'worker'), `${from} → ${to}`).toBe(false)
  })

  it('the worker cancels only what has not started publishing (an archived client, D-70)', () => {
    const before = new Set<TargetStatus>(['scheduled', 'preparing', 'ready', 'retrying'])
    for (const from of TARGET_STATUSES)
      expect(canMoveTarget(from, 'cancelled', 'worker'), from).toBe(before.has(from))
  })

  it('a destination never stays where it is through a move', () => {
    for (const s of TARGET_STATUSES) {
      expect(canMoveTarget(s, s, 'panel')).toBe(false)
      expect(canMoveTarget(s, s, 'worker')).toBe(false)
    }
  })
})
