import { expect, test } from 'vitest'
import type { QueueDefinition } from './queues.js'
import { QUEUE_NAMES, QUEUES } from './queues.js'

test('every registered queue declares a scope', () => {
  expect(QUEUES.map((q) => [q.name, q.scope])).toEqual([['system.selftest', 'system']])
  expect(QUEUE_NAMES).toEqual(['system.selftest'])
})

test('a queue definition cannot declare a scope other than its payload scope', () => {
  const wrong: QueueDefinition = {
    name: 'system.selftest',
    policy: 'short',
    // @ts-expect-error system.selftest is a system queue, not a user one
    scope: 'user',
  }
  expect(wrong.scope).toBe('user')
})
