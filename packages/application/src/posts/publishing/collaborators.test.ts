import { describe, expect, test } from 'vitest'
import { collaboratorsOutcomeOf } from './collaborators.js'

// What the page of the outcome says of the invitations (D-125), from what the publisher sent
// and what the worker read.

const sent = (dropped: { platformCode: string } | null = null) => ({
  platform: 'instagram',
  collaborators: { names: ['forno.luce', 'mulino'], dropped },
})
const target = (over: Record<string, unknown> = {}) => ({
  metaIds: sent(),
  collaborators: null,
  externalPostId: '17890000000000001',
  status: 'confirmed' as const,
  ...over,
})

describe('the invitations on the page of the outcome', () => {
  test('out with the post and never read: waiting', () => {
    expect(collaboratorsOutcomeOf(target())?.people.map((p) => p.status)).toEqual([
      'waiting',
      'waiting',
    ])
  })

  test('read: the answer of each name, «unknown» for one Meta does not list', () => {
    const outcome = collaboratorsOutcomeOf(
      target({
        collaborators: {
          readAt: '2026-11-27T10:00:00.000Z',
          people: [{ username: 'Forno.Luce', status: 'accepted' }],
        },
      }),
    )
    expect(outcome).toEqual({
      people: [
        { username: 'forno.luce', status: 'accepted' },
        { username: 'mulino', status: 'unknown' },
      ],
      notSentCode: null,
      readAt: '2026-11-27T10:00:00.000Z',
    })
  })

  test('refused by Meta: not sent, with its code, whatever became of the post', () => {
    const outcome = collaboratorsOutcomeOf(
      target({ metaIds: sent({ platformCode: '100' }), externalPostId: null, status: 'failed' }),
    )
    expect(outcome?.people.map((p) => p.status)).toEqual(['not_sent', 'not_sent'])
    expect(outcome?.notSentCode).toBe('100')
  })

  test('a container made, but no post out: nothing to tell', () => {
    expect(collaboratorsOutcomeOf(target({ externalPostId: null, status: 'failed' }))).toBeNull()
    expect(collaboratorsOutcomeOf(target({ externalPostId: null, status: 'ready' }))).toBeNull()
    expect(collaboratorsOutcomeOf(target({ status: 'cancelled' }))).toBeNull()
  })

  test('no invitations sent: nothing', () => {
    expect(collaboratorsOutcomeOf(target({ metaIds: { platform: 'instagram' } }))).toBeNull()
  })
})
