import { and, eq, isNull, sql } from 'drizzle-orm'
import type {
  IdGenerator,
  IntegrationConfigs,
  IntegrationCredentialSource,
  IntegrationCredentials,
  IntegrationKind,
  IntegrationOwner,
  IntegrationStore,
  IntegrationView,
  KeyRing,
  Logger,
  SecretBox,
} from '@app/application'
import { DomainError } from '@app/domain'
import { parseSmtpConfig } from '../../mail/smtp/smtp-config.js'
import type { Db, DbExecutor } from '../client.js'
import { drizzleOrganizationKeys } from '../organizations/index.js'
import { integrations } from './schema.js'

type Row = typeof integrations.$inferSelect

const SECRET_MAX = 1024
const HINT_LENGTH = 4

/** Binds a sealed secret to its owner and kind: a value copied to another row does not open. */
const aadFor = (organizationId: string | null, kind: IntegrationKind) =>
  `integrations:${organizationId ?? 'platform'}:${kind}`

// Sealed form `v1.<keyVersion>.…` (SecretBox): the version says which key to keep for rotation.
function keyVersionOf(sealed: string): number {
  const version = Number(sealed.split('.')[1])
  if (!Number.isInteger(version) || version < 1) throw new Error('malformed sealed value')
  return version
}

const PARSERS: { [K in IntegrationKind]: (value: unknown) => IntegrationConfigs[K] | null } = {
  smtp: parseSmtpConfig,
}

function normalized<K extends IntegrationKind>(kind: K, config: IntegrationConfigs[K]) {
  // host names compare in lower case; the check below refuses anything else that is off
  const value = { ...config, host: config.host.trim().toLowerCase() }
  return PARSERS[kind](value)
}

function storedConfig<K extends IntegrationKind>(kind: K, row: Row): IntegrationConfigs[K] {
  const config = PARSERS[kind](row.config)
  // never the row itself in the error: it holds the sealed secret
  if (config === null) throw new Error(`stored ${kind} integration is not valid`)
  return config
}

function viewOf<K extends IntegrationKind>(
  kind: K,
  owner: IntegrationOwner,
  row: Row,
): IntegrationView<K> {
  return {
    kind,
    owner,
    config: storedConfig(kind, row),
    secretHint: row.secretHint,
    updatedBy: row.updatedBy,
    verifiedAt: row.verifiedAt,
    updatedAt: row.updatedAt,
  }
}

export interface IntegrationStoreDeps {
  db: Db
  keyRing: KeyRing
  ids: IdGenerator
  logger: Logger
}

/**
 * Integrations on Postgres. Each call opens its own transaction: an agency's row in that
 * agency's scope (row level security hides every other agency and the platform default), the
 * platform default in the system scope, logged like `runAsSystem`.
 */
export function createIntegrationStore(
  deps: IntegrationStoreDeps,
): IntegrationStore & IntegrationCredentialSource {
  const { db, keyRing, ids, logger } = deps

  function scoped<T>(
    organizationId: string | null,
    userId: string | null,
    reason: string,
    fn: (t: DbExecutor) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (t) => {
      if (organizationId === null) {
        logger.info({ reason }, 'system scope transaction')
        await t.execute(sql`select set_config('app.scope', 'system', true)`)
      } else {
        await t.execute(
          sql`select set_config('app.organization_id', ${organizationId}, true), set_config('app.user_id', ${userId ?? ''}, true)`,
        )
      }
      return fn(t)
    })
  }

  async function rowOf(t: DbExecutor, organizationId: string | null, kind: IntegrationKind) {
    const owner =
      organizationId === null
        ? isNull(integrations.organizationId)
        : eq(integrations.organizationId, organizationId)
    const [row] = await t
      .select()
      .from(integrations)
      .where(and(owner, eq(integrations.kind, kind)))
    return row ?? null
  }

  async function boxFor(t: DbExecutor, organizationId: string | null): Promise<SecretBox> {
    return organizationId === null
      ? keyRing.platform()
      : keyRing.forOrganization({ organizationKeys: drizzleOrganizationKeys(t) }, organizationId)
  }

  /** The agency's row, else the platform default, each read in its own scope. */
  async function find<T>(
    organizationId: string | null,
    kind: IntegrationKind,
    read: (t: DbExecutor, owner: string | null, row: Row) => Promise<T>,
  ): Promise<T | null> {
    if (organizationId !== null) {
      const own = await scoped(organizationId, null, '', async (t) => {
        const row = await rowOf(t, organizationId, kind)
        return row === null ? null : { value: await read(t, organizationId, row) }
      })
      if (own !== null) return own.value
    }
    return scoped(null, null, `integrations: platform default ${kind}`, async (t) => {
      const row = await rowOf(t, null, kind)
      return row === null ? null : read(t, null, row)
    })
  }

  const ownerOf = (organizationId: string | null): IntegrationOwner =>
    organizationId === null ? 'platform' : 'organization'

  return {
    get(organizationId, kind) {
      return find(organizationId, kind, (_t, owner, row) =>
        Promise.resolve(viewOf(kind, ownerOf(owner), row)),
      )
    },

    credentials(organizationId, kind) {
      return find(organizationId, kind, async (t, owner, row) => {
        const box = await boxFor(t, owner)
        const credentials: IntegrationCredentials<typeof kind> = {
          kind,
          owner: ownerOf(owner),
          config: storedConfig(kind, row),
          secret: box.open(row.secretEnc, aadFor(owner, kind)),
        }
        return credentials
      })
    },

    async replace(organizationId, kind, replacement) {
      const config = normalized(kind, replacement.config)
      if (config === null)
        throw new DomainError('VALIDATION', 'Impostazioni dell’integrazione non valide')
      const { secret } = replacement
      // control characters are never part of a real password or token
      if (secret.length === 0 || secret.length > SECRET_MAX || /[\u0000-\u001f\u007f]/.test(secret))
        throw new DomainError('VALIDATION', 'Segreto dell’integrazione non valido')
      const reason = `integrations: replace platform default ${kind}`
      return scoped(organizationId, replacement.updatedBy, reason, async (t) => {
        const box = await boxFor(t, organizationId)
        const secretEnc = box.seal(secret, aadFor(organizationId, kind))
        const values = {
          config,
          secretEnc,
          keyVersion: keyVersionOf(secretEnc),
          secretHint: secret.slice(-HINT_LENGTH),
          updatedBy: replacement.updatedBy,
          // new settings have not been tried yet
          verifiedAt: null,
        }
        const [row] = await t
          .insert(integrations)
          .values({ id: ids.newId(), organizationId, kind, ...values })
          .onConflictDoUpdate({
            target: [integrations.organizationId, integrations.kind],
            set: { ...values, updatedAt: sql`now()` },
          })
          .returning()
        if (!row) throw new Error('integration not stored')
        return viewOf(kind, ownerOf(organizationId), row)
      })
    },
  }
}
