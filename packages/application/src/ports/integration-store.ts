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

/** Whose row answered: the agency's own, or the platform default it falls back to. */
export type IntegrationOwner = 'organization' | 'platform'

/**
 * What the panel may show. The secret never comes back: only its last 4 characters.
 */
export interface IntegrationView<K extends IntegrationKind = IntegrationKind> {
  kind: K
  owner: IntegrationOwner
  config: IntegrationConfigs[K]
  secretHint: string
  updatedBy: string | null
  verifiedAt: Date | null
  updatedAt: Date
}

/** For the adapter that sends, and only for it: the secret in clear. Never logged or returned. */
export interface IntegrationCredentials<K extends IntegrationKind = IntegrationKind> {
  kind: K
  owner: IntegrationOwner
  config: IntegrationConfigs[K]
  secret: string
}

export interface IntegrationReplacement<K extends IntegrationKind = IntegrationKind> {
  config: IntegrationConfigs[K]
  secret: string
  /** The user who changed it; null from the command line of the platform. */
  updatedBy: string | null
}

/**
 * Integrations per agency, with the platform default (`organizationId` null). An agency's rows
 * are read and written only in that agency's scope; the platform's only in the system scope.
 * Authorization (Owner, platform administrator) and the audit entry belong to the use case.
 */
export interface IntegrationStore {
  /** The agency's own, else the platform default; null when neither exists. */
  get<K extends IntegrationKind>(
    organizationId: string | null,
    kind: K,
  ): Promise<IntegrationView<K> | null>
  /** Validates the config, seals the secret and replaces the row (verification is reset). */
  replace<K extends IntegrationKind>(
    organizationId: string | null,
    kind: K,
    replacement: IntegrationReplacement<K>,
  ): Promise<IntegrationView<K>>
}

/** Internal port of the senders (the SMTP mailer): same fallback as `get`, secret in clear. */
export interface IntegrationCredentialSource {
  credentials<K extends IntegrationKind>(
    organizationId: string | null,
    kind: K,
  ): Promise<IntegrationCredentials<K> | null>
}
