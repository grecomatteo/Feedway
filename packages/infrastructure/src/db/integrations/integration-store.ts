import type {
  IntegrationConfigs,
  IntegrationKind,
  IntegrationRecord,
  IntegrationStore,
  IntegrationView,
  KeyRing,
  OrganizationIntegrationKind,
  PlatformIntegrationKind,
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
      const config = PARSERS[kind]({
        ...replacement.config,
        host: replacement.config.host.trim().toLowerCase(),
      })
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
  }
}
