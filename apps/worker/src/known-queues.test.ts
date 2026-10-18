import { expect, test } from 'vitest'
import { KNOWN_QUEUES } from '@app/config'
import { QUEUE_NAMES } from '@app/infrastructure'

// config validates WORKER_QUEUES without depending on infrastructure: the two lists must agree
test('config knows exactly the registered queues', () => {
  expect([...KNOWN_QUEUES].sort()).toEqual([...QUEUE_NAMES].sort())
})
