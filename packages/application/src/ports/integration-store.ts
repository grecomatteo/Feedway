import type { MetaIntegrationConfig } from '@app/domain/platforms/meta'
import type { OrganizationKeysRepository } from './organization-keys.js'

/** Integrations configured from the panel (spec §8.3). Telegram and the heartbeat follow. */
export const INTEGRATION_KINDS = ['smtp', 'meta'] as const
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number]

/** Set once for the whole installation (organization null): SMTP only (ADR 017). */
export type PlatformIntegrationKind = 'smtp'
/** One per agency: the agency's own Meta app (ADR 019, 020). */
export type OrganizationIntegrationKind = 'meta'

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
  meta: MetaIntegrationConfig
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
  /** The platform refused these settings since they were saved or last tried with success. */
  rejectedAt: Date | null
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

/** An agency's row is replaced only over the version that was read, and only once tried. */
export interface OrganizationIntegrationReplacement<
  K extends OrganizationIntegrationKind = OrganizationIntegrationKind,
> {
  config: IntegrationConfigs[K]
  secret: string
  updatedBy: string
  /** `updatedAt` of the row read before the platform was called; null: there was none. */
  expectedVersion: Date | null
  /** When the platform accepted these settings; null: not tried. */
  verifiedAt: Date | null
}

/** A stored row as the database holds it: the secret still sealed. */
export interface IntegrationRecord {
  config: unknown
  secretEnc: string
  keyVersion: number
  updatedBy: string | null
  verifiedAt: Date | null
  rejectedAt: Date | null
  updatedAt: Date
}

export interface IntegrationRecordInput {
  config: unknown
  secretEnc: string
  keyVersion: number
  updatedBy: string | null
}

export interface OrganizationIntegrationRecordInput extends IntegrationRecordInput {
  verifiedAt: Date | null
}

/**
 * Rows of `integrations` in the current transaction. The platform's (organization null) exist
 * only in the system scope; an agency's only inside that agency (row level security).
 */
export interface IntegrationsRepository {
  findPlatform(kind: PlatformIntegrationKind): Promise<IntegrationRecord | null>
  /** Inserts or replaces the row; the verification is reset. */
  upsertPlatform(
    kind: PlatformIntegrationKind,
    input: IntegrationRecordInput,
  ): Promise<IntegrationRecord>
  /**
   * Marks the row as tried with success at `at`, only if it is still the version that was tried
   * (`version`, its `updatedAt` to the millisecond): settings changed meanwhile stay unverified.
   * `updatedAt` does not move. false: nothing marked.
   */
  markPlatformVerified(kind: PlatformIntegrationKind, at: Date, version: Date): Promise<boolean>
  findForOrganization(
    organizationId: string,
    kind: OrganizationIntegrationKind,
  ): Promise<IntegrationRecord | null>
  /**
   * Writes the agency's row only if it is still `expected` (its `updatedAt` to the millisecond;
   * null: no row yet). null: someone changed it meanwhile, nothing written.
   */
  upsertForOrganization(
    organizationId: string,
    kind: OrganizationIntegrationKind,
    input: OrganizationIntegrationRecordInput,
    expected: Date | null,
  ): Promise<IntegrationRecord | null>
  /** As `markPlatformVerified`, for an agency's row; a refusal noted before goes away. */
  markVerified(
    organizationId: string,
    kind: OrganizationIntegrationKind,
    at: Date,
    version: Date,
  ): Promise<boolean>
  /**
   * The platform refused the agency's settings at `at` (the secret was reset on Meta, say):
   * not verified any more, until a save or a successful test. Only if still `version`, so a
   * refusal of the old settings never marks new ones. false: nothing marked.
   */
  markRejected(
    organizationId: string,
    kind: OrganizationIntegrationKind,
    at: Date,
    version: Date,
  ): Promise<boolean>
}

/** What the store needs of a transaction. */
export interface IntegrationTx {
  integrations: IntegrationsRepository
}

/** An agency's secrets are sealed with its data key (ADR 007). */
export type OrganizationIntegrationTx = IntegrationTx & {
  organizationKeys: OrganizationKeysRepository
}

/**
 * Platform integrations with sealed secrets, inside the caller's `runAsSystem` transaction, so
 * the audit entry of a change sits in the same one. SMTP is platform only (ADR 017).
 * Authorization and the audit entry belong to the use case.
 */
export interface IntegrationStore {
  getPlatform<K extends PlatformIntegrationKind>(
    tx: IntegrationTx,
    kind: K,
  ): Promise<IntegrationView<K> | null>
  replacePlatform<K extends PlatformIntegrationKind>(
    tx: IntegrationTx,
    kind: K,
    replacement: IntegrationReplacement<K>,
  ): Promise<IntegrationView<K>>
  /** Internal, for the senders only: the secret in clear. */
  platformCredentials<K extends PlatformIntegrationKind>(
    tx: IntegrationTx,
    kind: K,
  ): Promise<IntegrationCredentials<K> | null>

  /** An agency's row, inside that agency's transaction; never the secret. */
  get<K extends OrganizationIntegrationKind>(
    tx: OrganizationIntegrationTx,
    organizationId: string,
    kind: K,
  ): Promise<IntegrationView<K> | null>
  /** Seals the secret with the agency's key. null: the row changed since `expectedVersion`. */
  replace<K extends OrganizationIntegrationKind>(
    tx: OrganizationIntegrationTx,
    organizationId: string,
    kind: K,
    replacement: OrganizationIntegrationReplacement<K>,
  ): Promise<IntegrationView<K> | null>
  /** Internal: the agency's secret in clear, for the connector that calls the platform. */
  credentials<K extends OrganizationIntegrationKind>(
    tx: OrganizationIntegrationTx,
    organizationId: string,
    kind: K,
  ): Promise<(IntegrationCredentials<K> & { updatedAt: Date }) | null>
}

/** Where the SMTP mailer reads the platform's settings at every send. */
export interface MailSettingsSource {
  isConfigured(): Promise<boolean>
  credentials(): Promise<IntegrationCredentials<'smtp'> | null>
}
