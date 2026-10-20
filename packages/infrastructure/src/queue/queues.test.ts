import { expect, test } from 'vitest'
import type { QueueDefinition } from './queues.js'
import { QUEUE_NAMES, QUEUES } from './queues.js'

test('every registered queue declares a scope', () => {
  expect(QUEUES.map((q) => [q.name, q.scope])).toEqual([
    ['system.selftest', 'system'],
    ['identity.security_email', 'user'],
    ['identity.password_reset_email', 'user'],
  ])
  expect(QUEUE_NAMES).toEqual([
    'system.selftest',
    'identity.security_email',
    'identity.password_reset_email',
  ])
})

test('a reset link does not stay in the queue tables past its hour', () => {
  expect(QUEUES.find((q) => q.name === 'identity.password_reset_email')?.retention).toEqual({
    retentionSeconds: 3600,
    deleteAfterSeconds: 3600,
  })
})

test('a queue definition cannot declare a scope other than its payload scope', () => {
  const wrong: QueueDefinition<'system.selftest'> = {
    name: 'system.selftest',
    policy: 'short',
    // @ts-expect-error system.selftest is a system queue, not a user one
    scope: 'user',
  }
  expect(wrong.scope).toBe('user')
})
