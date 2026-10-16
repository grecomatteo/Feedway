import type { QueueName } from '@app/application'

export interface QueueDefinition {
  name: QueueName
  /** pg-boss queue policy: decides what the queue allows to be pending or active at once. */
  policy: 'standard' | 'short' | 'singleton' | 'stately' | 'exclusive'
}

export const QUEUES: readonly QueueDefinition[] = [{ name: 'system.selftest', policy: 'short' }]

export const QUEUE_NAMES: readonly QueueName[] = QUEUES.map((q) => q.name)

/** Applied to every queue; a failed job is retried with exponential backoff. */
export const QUEUE_DEFAULTS = { retryLimit: 3, retryBackoff: true, retryDelay: 5 } as const
