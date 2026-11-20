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
    ['preparing', 'ready'],
    ['preparing', 'retrying'],
    ['preparing', 'failed'],
    ['preparing', 'paused'],
    ['ready', 'publishing'],
    ['ready', 'preparing'],
    ['ready', 'failed'],
    ['ready', 'paused'],
    ['publishing', 'published'],
    ['publishing', 'retrying'],
    ['publishing', 'failed'],
    ['publishing', 'unknown'],
    ['retrying', 'preparing'],
    ['retrying', 'publishing'],
    ['retrying', 'paused'],
    ['unknown', 'published'],
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

  it('the panel never moves a destination into the steps of the worker', () => {
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

  it('the worker never schedules, cancels or brings back to draft', () => {
    for (const from of TARGET_STATUSES)
      for (const to of ['draft', 'scheduled', 'cancelled'] as const)
        expect(canMoveTarget(from, to, 'worker'), `${from} → ${to}`).toBe(false)
  })

  it('a destination never stays where it is through a move', () => {
    for (const s of TARGET_STATUSES) {
      expect(canMoveTarget(s, s, 'panel')).toBe(false)
      expect(canMoveTarget(s, s, 'worker')).toBe(false)
    }
  })
})
