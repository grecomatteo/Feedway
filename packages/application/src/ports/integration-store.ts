/** Integrations configured from the panel (spec §8.3). Meta, Telegram and the heartbeat follow. */
export const INTEGRATION_KINDS = ['smtp'] as const
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number]

/** Only encrypted SMTP: implicit TLS (465) or STARTTLS made mandatory (587, 2525). */
export const SMTP_PORTS = [465, 587, 2525] as const
export type SmtpPort = (typeof SMTP_PORTS)[number]

export interface SmtpConfig {
  host: string
  port: SmtpPort
  security: 'tls' | 'starttls'
  username: string
  /** The sender address of every email. */
  from: string
}

export interface IntegrationConfigs {
  smtp: SmtpConfig
}

/**
 * What the panel may show. Nothing of the secret comes back, not even its last characters
 * (ADR 017): only that one is set, and since when.
 */
export interface IntegrationView<K extends IntegrationKind = IntegrationKind> {
  kind: K
  config: IntegrationConfigs[K]
  secretSet: true
  updatedBy: string | null
  verifiedAt: Date | null
  updatedAt: Date
}

/** For the adapter that sends, and only for it: the secret in clear. Never logged or returned. */
export interface IntegrationCredentials<K extends IntegrationKind = IntegrationKind> {
  kind: K
  config: IntegrationConfigs[K]
  secret: string
}

export interface IntegrationReplacement<K extends IntegrationKind = IntegrationKind> {
  config: IntegrationConfigs[K]
  secret: string
  /** The platform administrator who changed it; null from the command line. */
  updatedBy: string | null
}

/** A stored row as the database holds it: the secret still sealed. */
export interface IntegrationRecord {
  config: unknown
  secretEnc: string
  keyVersion: number
  updatedBy: string | null
  verifiedAt: Date | null
  updatedAt: Date
}

export interface IntegrationRecordInput {
  config: unknown
  secretEnc: string
  keyVersion: number
  updatedBy: string | null
}

/**
 * Platform rows of `integrations` (organization null) in the current transaction. They exist only
 * in the system scope: elsewhere row level security hides them and refuses the writes. The
 * agency rows arrive with the integrations of stage 3 (Meta, Telegram).
 */
export interface IntegrationsRepository {
  findPlatform(kind: IntegrationKind): Promise<IntegrationRecord | null>
  /** Inserts or replaces the row; the verification is reset. */
  upsertPlatform(kind: IntegrationKind, input: IntegrationRecordInput): Promise<IntegrationRecord>
  /**
   * Marks the row as tried with success at `at`, only if it is still the version that was tried
   * (`version`, its `updatedAt` to the millisecond): settings changed meanwhile stay unverified.
   * `updatedAt` does not move. false: nothing marked.
   */
  markPlatformVerified(kind: IntegrationKind, at: Date, version: Date): Promise<boolean>
}

/** What the store needs of a transaction. */
export interface IntegrationTx {
  integrations: IntegrationsRepository
}

/**
 * Platform integrations with sealed secrets, inside the caller's `runAsSystem` transaction, so
 * the audit entry of a change sits in the same one. SMTP is platform only (ADR 017).
 * Authorization and the audit entry belong to the use case.
 */
export interface IntegrationStore {
  getPlatform<K extends IntegrationKind>(
    tx: IntegrationTx,
    kind: K,
  ): Promise<IntegrationView<K> | null>
  replacePlatform<K extends IntegrationKind>(
    tx: IntegrationTx,
    kind: K,
    replacement: IntegrationReplacement<K>,
  ): Promise<IntegrationView<K>>
  /** Internal, for the senders only: the secret in clear. */
  platformCredentials<K extends IntegrationKind>(
    tx: IntegrationTx,
    kind: K,
  ): Promise<IntegrationCredentials<K> | null>
}

/** Where the SMTP mailer reads the platform's settings at every send. */
export interface MailSettingsSource {
  isConfigured(): Promise<boolean>
  credentials(): Promise<IntegrationCredentials | null>
}
