import { describe, expect, it } from 'vitest'
import { postStatusFromTargets } from './post-status.js'

// Scelta 3 of plan 07, in its order; cancelled destinations never count.
describe('postStatusFromTargets', () => {
  it('without destinations, a draft', () => {
    expect(postStatusFromTargets([])).toBe('draft')
  })

  it('cancelled when every destination is', () => {
    expect(postStatusFromTargets(['cancelled', 'cancelled'])).toBe('cancelled')
  })

  it('one paused destination comes first', () => {
    expect(postStatusFromTargets(['paused', 'publishing', 'failed'])).toBe('paused')
    expect(postStatusFromTargets(['paused', 'cancelled'])).toBe('paused')
  })

  it('one destination on its way makes it «In pubblicazione»', () => {
    for (const s of ['preparing', 'ready', 'publishing', 'retrying', 'unknown'] as const) {
      expect(postStatusFromTargets([s, 'confirmed'])).toBe('publishing')
      expect(postStatusFromTargets([s, 'failed'])).toBe('publishing')
      expect(postStatusFromTargets([s, 'scheduled'])).toBe('publishing')
    }
  })

  it('a failure with others out or still scheduled is partial', () => {
    expect(postStatusFromTargets(['failed', 'confirmed'])).toBe('partial')
    expect(postStatusFromTargets(['failed', 'published'])).toBe('partial')
    expect(postStatusFromTargets(['failed', 'verifying'])).toBe('partial')
    expect(postStatusFromTargets(['failed', 'problem'])).toBe('partial')
  })

  it('failed when no destination came out, cancelled ones aside', () => {
    expect(postStatusFromTargets(['failed'])).toBe('failed')
    expect(postStatusFromTargets(['failed', 'failed', 'cancelled'])).toBe('failed')
  })

  it('a problem without failures', () => {
    expect(postStatusFromTargets(['problem', 'confirmed'])).toBe('problem')
    expect(postStatusFromTargets(['problem'])).toBe('problem')
  })

  it('published when every destination is out, verified or not', () => {
    expect(postStatusFromTargets(['published', 'verifying', 'confirmed'])).toBe('published')
    expect(postStatusFromTargets(['confirmed', 'cancelled'])).toBe('published')
  })

  it('a failure is never hidden behind «Programmato»', () => {
    expect(postStatusFromTargets(['scheduled', 'failed'])).not.toBe('scheduled')
  })

  it('a destination scheduled again next to one that ended: on its way, never «Programmato»', () => {
    // «Riprova» on one account while the other is out or did not go out (review R6)
    expect(postStatusFromTargets(['scheduled', 'confirmed'])).toBe('publishing')
    expect(postStatusFromTargets(['scheduled', 'published'])).toBe('publishing')
    expect(postStatusFromTargets(['scheduled', 'failed'])).toBe('publishing')
    expect(postStatusFromTargets(['scheduled', 'problem'])).toBe('publishing')
    expect(postStatusFromTargets(['scheduled', 'confirmed', 'cancelled'])).toBe('publishing')
  })

  it('then the rules of stage 6', () => {
    expect(postStatusFromTargets(['scheduled', 'scheduled'])).toBe('scheduled')
    expect(postStatusFromTargets(['scheduled', 'cancelled'])).toBe('scheduled')
    expect(postStatusFromTargets(['draft', 'draft'])).toBe('draft')
    expect(postStatusFromTargets(['draft', 'cancelled'])).toBe('draft')
  })
})
