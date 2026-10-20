/**
 * Who a job belongs to (plan §4): an `organization` job carries `organizationId` and its handler
 * opens `uow.run` in that agency; a `user` job carries `userId` and opens `uow.run({ userId })`;
 * only `system` jobs may use `runAsSystem`.
 */
export type QueueScope = 'organization' | 'user' | 'system'

type ScopeFields = {
  organization: { organizationId: string }
  user: { userId: string }
  system: object
}

/** The data of a job in a queue of scope `S`: the scope's ids are required by the type. */
export type ScopedPayload<S extends QueueScope, D extends object> = D & ScopeFields[S]

/** Every queue: its scope and its own data. Adding a queue starts here. */
interface JobDefinitions {
  'system.selftest': { scope: 'system'; data: { requestedAt: string } }
  'identity.security_email': { scope: 'user'; data: SecurityEmailData }
  'identity.password_reset_email': { scope: 'user'; data: PasswordResetEmailData }
}

/** "Password dimenticata": the link holds the reset token, so the job is kept one hour only. */
export interface PasswordResetEmailData {
  url: string
}

/** The kinds of security email; the texts are `email.security.<kind>.*` in it.json. */
export const SECURITY_EMAIL_KINDS = [
  'new_device',
  'password_changed',
  'password_reset',
  'email_changed',
  'totp_enabled',
  'totp_disabled',
  'backup_codes_regenerated',
  'passkey_added',
  'passkey_removed',
] as const

export type SecurityEmailKind = (typeof SECURITY_EMAIL_KINDS)[number]

export interface SecurityEmailData {
  kind: SecurityEmailKind
  /** ISO 8601 */
  occurredAt: string
  /** Readable browser and system, e.g. "Safari su iOS"; never the device id. */
  deviceLabel: string
  /** Already shortened (last IPv4 octet zero, IPv6 /48). */
  ip: string | null
  /**
   * Where to write instead of the account's address: for `email_changed` the old address,
   * since the account already holds the new one (Task 25).
   */
  notifyEmail?: string
}

export type QueueName = keyof JobDefinitions

export type JobPayloads = {
  [N in QueueName]: ScopedPayload<JobDefinitions[N]['scope'], JobDefinitions[N]['data']>
}

export type QueueScopes = { [N in QueueName]: JobDefinitions[N]['scope'] }

export interface JobQueue {
  send<N extends QueueName>(
    name: N,
    data: JobPayloads[N],
    opts?: { singletonKey?: string; startAfter?: Date },
  ): Promise<string | null>
  work<N extends QueueName>(
    name: N,
    handler: (job: { id: string; data: JobPayloads[N] }) => Promise<void>,
    opts?: { concurrency?: number },
  ): Promise<void>
  ping(): Promise<void>
  stop(opts: { graceful: boolean; timeoutMs: number }): Promise<void>
}
