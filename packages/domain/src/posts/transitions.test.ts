import { describe, expect, it } from 'vitest'
import { POST_STATUSES, type PostStatus } from './post.js'
import { canTransition, postStatusOf } from './transitions.js'

const allowed: [PostStatus, PostStatus][] = [
  ['draft', 'scheduled'],
  ['scheduled', 'draft'],
  ['scheduled', 'cancelled'],
]

describe('canTransition', () => {
  for (const from of POST_STATUSES)
    for (const to of POST_STATUSES) {
      const expected = allowed.some(([f, t]) => f === from && t === to)
      it(`${from} → ${to}: ${expected ? 'allowed' : 'refused'}`, () => {
        expect(canTransition(from, to)).toBe(expected)
      })
    }
})

describe('postStatusOf', () => {
  it('a post without destinations is a draft', () => {
    expect(postStatusOf([])).toBe('draft')
  })
  it('follows its destinations', () => {
    expect(postStatusOf(['draft', 'draft'])).toBe('draft')
    expect(postStatusOf(['scheduled', 'scheduled'])).toBe('scheduled')
    expect(postStatusOf(['cancelled'])).toBe('cancelled')
  })
  it('one scheduled destination makes it scheduled', () => {
    expect(postStatusOf(['cancelled', 'scheduled'])).toBe('scheduled')
  })
  it('cancelled only when every destination is', () => {
    expect(postStatusOf(['cancelled', 'draft'])).toBe('draft')
  })
})
