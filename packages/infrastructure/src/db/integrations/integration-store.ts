import type {
  IntegrationConfigs,
  IntegrationKind,
  IntegrationRecord,
  IntegrationStore,
  IntegrationView,
  KeyRing,
  OrganizationIntegrationKind,
  PlatformIntegrationKind,
  TelegramBotCredentials,
  TelegramConfig,
  TelegramPollState,
} from '@app/application'
import { DomainError } from '@app/domain'
import { checkMetaIntegrationConfig } from '@app/domain/platforms/meta'
import { sealedKeyVersion } from '../../crypto/secret-box.js'
import { parseSmtpConfig } from '../../mail/smtp/smtp-config.js'

const SECRET_MAX = 1024

/** Binds a sealed secret to its row: a value copied to another kind or owner does not open. */
const aadFor = (kind: PlatformIntegrationKind) => `integrations:platform:${kind}`
const orgAadFor = (organizationId: string, kind: OrganizationIntegrationKind) =>
  `integrations:org:${organizationId}:${kind}`

const PARSERS: { [K in IntegrationKind]: (value: unknown) => IntegrationConfigs[K] | null } = {
  smtp: parseSmtpConfig,
  meta: (value) => {
    const checked = checkMetaIntegrationConfig(value)
    return checked.ok ? checked.value : null
  },
  telegram: (value) => {
    const { botId, botUsername } = (value ?? {}) as { botId?: unknown; botUsername?: unknown }
    // Telegram's own rule for a bot's username; the id is the number before the token's colon
    return Number.isSafeInteger(botId) &&
      (botId as number) > 0 &&
      typeof botUsername === 'string' &&
      /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(botUsername)
      ? { botId: botId as number, botUsername }
      : null
  },
  heartbeat: () => ({}),
}

/** Control characters are never part of a real password, token or app secret. */
function checkSecret(secret: string): void {
  if (secret.length === 0 || secret.length > SECRET_MAX || /[\u0000-\u001f\u007f]/.test(secret))
    throw new DomainError('VALIDATION', 'Segreto dell’integrazione non valido')
}

function storedConfig<K extends IntegrationKind>(
  kind: K,
  record: IntegrationRecord,
): IntegrationConfigs[K] {
  const config = PARSERS[kind](record.config)
  // never the record in the error: it holds the sealed secret
  if (config === null) throw new Error(`stored ${kind} integration is not valid`)
  return config
}

function viewOf<K extends IntegrationKind>(kind: K, record: IntegrationRecord): IntegrationView<K> {
  return {
    kind,
    config: storedConfig(kind, record),
    secretSet: true,
    updatedBy: record.updatedBy,
    verifiedAt: record.verifiedAt,
    rejectedAt: record.rejectedAt,
    updatedAt: record.updatedAt,
  }
}

/**
 * Seals and opens the platform's integration secrets with `KeyRing.platform()`, inside the
 * caller's transaction (system scope: elsewhere the rows are invisible and unwritable), and an
 * agency's with that agency's data key, inside the agency's transaction.
 */
export function createIntegrationStore(deps: { keyRing: KeyRing }): IntegrationStore {
  const box = () => deps.keyRing.platform()
  return {
    async getPlatform(tx, kind) {
      const record = await tx.integrations.findPlatform(kind)
      return record === null ? null : viewOf(kind, record)
    },

    async platformCredentials(tx, kind) {
      const record = await tx.integrations.findPlatform(kind)
      if (record === null) return null
      return {
        kind,
        config: storedConfig(kind, record),
        secret: box().open(record.secretEnc, aadFor(kind)),
      }
    },

    async replacePlatform(tx, kind, replacement) {
      // host names compare in lower case; the parser refuses anything else that is off
      const raw: object = replacement.config
      const config = PARSERS[kind](
        'host' in raw && typeof raw.host === 'string'
          ? { ...raw, host: raw.host.trim().toLowerCase() }
          : raw,
      )
      if (config === null)
        throw new DomainError('VALIDATION', 'Impostazioni dell’integrazione non valide')
      const { secret } = replacement
      checkSecret(secret)
      const secretEnc = box().seal(secret, aadFor(kind))
      const record = await tx.integrations.upsertPlatform(kind, {
        config,
        secretEnc,
        keyVersion: sealedKeyVersion(secretEnc),
        updatedBy: replacement.updatedBy,
      })
      return viewOf(kind, record)
    },

    async get(tx, organizationId, kind) {
      const record = await tx.integrations.findForOrganization(organizationId, kind)
      return record === null ? null : viewOf(kind, record)
    },

    async credentials(tx, organizationId, kind) {
      const record = await tx.integrations.findForOrganization(organizationId, kind)
      if (record === null) return null
      const sealer = await deps.keyRing.forOrganization(tx, organizationId)
      return {
        kind,
        config: storedConfig(kind, record),
        secret: sealer.open(record.secretEnc, orgAadFor(organizationId, kind)),
        updatedAt: record.updatedAt,
      }
    },

    async replace(tx, organizationId, kind, replacement) {
      const config = PARSERS[kind](replacement.config)
      if (config === null)
        throw new DomainError('VALIDATION', 'Impostazioni dell’integrazione non valide')
      checkSecret(replacement.secret)
      const sealer = await deps.keyRing.forOrganization(tx, organizationId)
      const secretEnc = sealer.seal(replacement.secret, orgAadFor(organizationId, kind))
      const record = await tx.integrations.upsertForOrganization(
        organizationId,
        kind,
        {
          config,
          secretEnc,
          keyVersion: sealedKeyVersion(secretEnc),
          updatedBy: replacement.updatedBy,
          verifiedAt: replacement.verifiedAt,
        },
        replacement.expectedVersion,
      )
      return record === null ? null : viewOf(kind, record)
    },

    async telegramBots(tx) {
      const rows = await tx.integrations.listTelegram()
      const bots: TelegramBotCredentials[] = []
      const unreadable: (string | null)[] = []
      for (const row of rows) {
        const { organizationId } = row
        let secret: string
        let config: TelegramConfig
        try {
          config = storedConfig('telegram', row)
          secret =
            organizationId === null
              ? box().open(row.secretEnc, aadFor('telegram'))
              : (await deps.keyRing.forOrganization(tx, organizationId)).open(
                  row.secretEnc,
                  orgAadFor(organizationId, 'telegram'),
                )
        } catch {
          // a key lost or a row damaged stops this bot only, never the others
          unreadable.push(organizationId)
          continue
        }
        bots.push({
          organizationId,
          ...config,
          token: secret,
          state: pollStateOf(row.state),
          rejectedAt: row.rejectedAt,
          updatedAt: row.updatedAt,
        })
      }
      return { bots, unreadable }
    },
  }
}

/** Only what `telegram.poll` wrote, each field checked: anything else starts afresh. */
function pollStateOf(value: unknown): TelegramPollState {
  const { botId, offset } = (value ?? {}) as { botId?: unknown; offset?: unknown }
  return {
    ...(Number.isSafeInteger(botId) ? { botId: botId as number } : {}),
    ...(Number.isSafeInteger(offset) ? { offset: offset as number } : {}),
  }
}
