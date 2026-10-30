import type {
  IntegrationConfigs,
  IntegrationKind,
  IntegrationRecord,
  IntegrationStore,
  IntegrationView,
  KeyRing,
} from '@app/application'
import { DomainError } from '@app/domain'
import { parseSmtpConfig } from '../../mail/smtp/smtp-config.js'

const SECRET_MAX = 1024

/** Binds a sealed secret to its row: a value copied to another kind or owner does not open. */
const aadFor = (kind: IntegrationKind) => `integrations:platform:${kind}`

// Sealed form `v1.<keyVersion>.…` (SecretBox): the version says which key to keep for rotation.
function keyVersionOf(sealed: string): number {
  const version = Number(sealed.split('.')[1])
  if (!Number.isInteger(version) || version < 1) throw new Error('malformed sealed value')
  return version
}

const PARSERS: { [K in IntegrationKind]: (value: unknown) => IntegrationConfigs[K] | null } = {
  smtp: parseSmtpConfig,
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
    updatedAt: record.updatedAt,
  }
}

/**
 * Seals and opens the platform's integration secrets with `KeyRing.platform()`, inside the
 * caller's transaction (system scope: elsewhere the rows are invisible and unwritable).
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
      // control characters are never part of a real password or token
      if (secret.length === 0 || secret.length > SECRET_MAX || /[\u0000-\u001f\u007f]/.test(secret))
        throw new DomainError('VALIDATION', 'Segreto dell’integrazione non valido')
      const secretEnc = box().seal(secret, aadFor(kind))
      const record = await tx.integrations.upsertPlatform(kind, {
        config,
        secretEnc,
        keyVersion: keyVersionOf(secretEnc),
        updatedBy: replacement.updatedBy,
      })
      return viewOf(kind, record)
    },
  }
}
