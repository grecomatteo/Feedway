import type { QueueName, QueueScopes } from '@app/application'

export interface QueueDefinition<N extends QueueName = QueueName> {
  name: N
  /** pg-boss queue policy: decides what the queue allows to be pending or active at once. */
  policy: 'standard' | 'short' | 'singleton' | 'stately' | 'exclusive'
  /** Must match the scope in JobPayloads: the type below rejects a mismatch. */
  scope: QueueScopes[N]
  /**
   * How long pg-boss keeps a job, in seconds: waiting (`retentionSeconds`) and after it ends
   * (`deleteAfterSeconds`). Unset: the pg-boss defaults (14 and 7 days).
   */
  retention?: { retentionSeconds: number; deleteAfterSeconds: number }
}

const REGISTRY: { [N in QueueName]: Omit<QueueDefinition<N>, 'name'> } = {
  'system.selftest': { policy: 'short', scope: 'system' },
  'identity.security_email': { policy: 'standard', scope: 'user' },
  // the data holds a reset link: gone after an hour, when the link has expired anyway
  'identity.password_reset_email': {
    policy: 'standard',
    scope: 'user',
    retention: { retentionSeconds: 3600, deleteAfterSeconds: 3600 },
  },
  // ids only; a notice still waiting after three days is no longer news
  'identity.account_locked_notice': {
    policy: 'standard',
    scope: 'system',
    retention: { retentionSeconds: 3 * 86_400, deleteAfterSeconds: 86_400 },
  },
  'identity.account_locked_notice_email': {
    policy: 'standard',
    scope: 'system',
    retention: { retentionSeconds: 3 * 86_400, deleteAfterSeconds: 86_400 },
  },
  // the data holds the recovery link: gone after its 30 minutes
  'identity.account_recovery_email': {
    policy: 'standard',
    scope: 'user',
    retention: { retentionSeconds: 1800, deleteAfterSeconds: 1800 },
  },
  // the data holds the confirmation link to the new address: gone after its hour
  'identity.email_change': {
    policy: 'standard',
    scope: 'user',
    retention: { retentionSeconds: 3600, deleteAfterSeconds: 3600 },
  },
}

export const QUEUES: readonly QueueDefinition[] = (Object.keys(REGISTRY) as QueueName[]).map(
  (name) => ({ name, ...REGISTRY[name] }),
)

export const QUEUE_NAMES: readonly QueueName[] = QUEUES.map((q) => q.name)

/** Applied to every queue; a failed job is retried with exponential backoff. */
export const QUEUE_DEFAULTS = { retryLimit: 3, retryBackoff: true, retryDelay: 5 } as const
