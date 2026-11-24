import type { MetaIntegrationConfig } from '@app/domain/platforms/meta'
import type { OrganizationKeysRepository } from './organization-keys.js'

/** Integrations configured from the panel (spec §8.3); Telegram and the heartbeat of stage 8. */
export const INTEGRATION_KINDS = ['smtp', 'meta', 'telegram', 'heartbeat'] as const
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number]

/**
 * Set once for the whole installation (organization null): SMTP (ADR 017), the platform's
 * Telegram bot and the external watch (plan 08).
 */
export type PlatformIntegrationKind = 'smtp' | 'telegram' | 'heartbeat'
/** One per agency: its own Meta app (ADR 019, 020) and, if it wants one, its own bot. */
export type OrganizationIntegrationKind = 'meta' | 'telegram'

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

/** A Telegram bot (plan 08 Scelta 8): its token is the secret, its name comes from `getMe`. */
export interface TelegramConfig {
  /** Telegram's id of the bot: one integration per bot, or two pollers would split its updates */
  botId: number
  botUsername: string
}

/** The external watch (§16.7): the address to call is the secret, nothing else is kept. */
export type HeartbeatConfig = Record<string, never>

export interface IntegrationConfigs {
  smtp: SmtpConfig
  meta: MetaIntegrationConfig
  telegram: TelegramConfig
  heartbeat: HeartbeatConfig
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
  /** What the jobs keep between runs, never a secret */
  state: unknown
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
  /** Removes the platform's row (a bot taken away). false: there was none. */
  deletePlatform(kind: PlatformIntegrationKind): Promise<boolean>
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
  /**
   * Removes the agency's row only if it is still `version` (its `updatedAt` to the millisecond):
   * a row saved by someone else meanwhile stays. false: nothing removed.
   */
  deleteForOrganization(
    organizationId: string,
    kind: OrganizationIntegrationKind,
    version: Date,
  ): Promise<boolean>
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
  /** As `markRejected`, for the platform's row. */
  markPlatformRejected(kind: PlatformIntegrationKind, at: Date, version: Date): Promise<boolean>
  /** The system scope only: every Telegram bot, the platform's and the agencies'. */
  listTelegram(): Promise<(IntegrationRecord & { organizationId: string | null })[]>
  /**
   * Keeps a job's state on the row (the `getUpdates` offset), only if the row is still `version`:
   * a bot replaced meanwhile starts from its own. `updatedAt` does not move. false: not kept.
   */
  saveState(
    organizationId: string | null,
    kind: IntegrationKind,
    state: object,
    version: Date,
  ): Promise<boolean>
  /**
   * What a job keeps on a platform row between runs (`integrations.state`, never a secret): the
   * last outcome of the external watch. null: no row.
   */
  platformState(kind: PlatformIntegrationKind): Promise<unknown>
  /** Replaces the state of the platform row, if there is one; `updatedAt` does not move. */
  savePlatformState(kind: PlatformIntegrationKind, state: object): Promise<boolean>
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
  /**
   * The system scope only: every Telegram bot with its token opened, and the owners of the bots
   * whose token cannot be opened (a key lost, a row damaged).
   */
  telegramBots(
    tx: OrganizationIntegrationTx,
  ): Promise<{ bots: TelegramBotCredentials[]; unreadable: (string | null)[] }>
}

/** What `telegram.poll` keeps on a bot's row between runs. */
export interface TelegramPollState {
  /** The bot the links and the offset are of: another id means a new bot, its links start again */
  botId?: number
  /** The next `getUpdates` offset: the updates before it were handled */
  offset?: number
}

/** A Telegram bot with its token, for `telegram.poll` and the channel only (system scope). */
export interface TelegramBotCredentials {
  /** null: the platform's */
  organizationId: string | null
  botId: number
  botUsername: string
  token: string
  state: TelegramPollState
  rejectedAt: Date | null
  updatedAt: Date
}

/** Where the SMTP mailer reads the platform's settings at every send. */
export interface MailSettingsSource {
  isConfigured(): Promise<boolean>
  credentials(): Promise<IntegrationCredentials<'smtp'> | null>
}
