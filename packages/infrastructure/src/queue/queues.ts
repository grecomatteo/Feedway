import type { QueueName, QueueScopes } from '@app/application'

export interface QueueDefinition<N extends QueueName = QueueName> {
  name: N
  /** pg-boss queue policy: decides what the queue allows to be pending or active at once. */
  policy: 'standard' | 'short' | 'singleton' | 'stately' | 'exclusive'
  /** Must match the scope in JobPayloads: the type below rejects a mismatch. */
  scope: QueueScopes[N]
}

const REGISTRY: { [N in QueueName]: Omit<QueueDefinition<N>, 'name'> } = {
  'system.selftest': { policy: 'short', scope: 'system' },
}

export const QUEUES: readonly QueueDefinition[] = (Object.keys(REGISTRY) as QueueName[]).map(
  (name) => ({ name, ...REGISTRY[name] }),
)

export const QUEUE_NAMES: readonly QueueName[] = QUEUES.map((q) => q.name)

/** Applied to every queue; a failed job is retried with exponential backoff. */
export const QUEUE_DEFAULTS = { retryLimit: 3, retryBackoff: true, retryDelay: 5 } as const
