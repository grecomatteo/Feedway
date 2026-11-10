import { can, DomainError, type OrgActor } from '@app/domain'
import {
  checkMetaIntegrationConfig,
  type MetaIntegrationConfig,
  type MetaIntegrationField,
} from '@app/domain/platforms/meta'
import { assertRecentReauth } from '../../identity/index.js'
import type { AuthSessionInfo } from '../../ports/auth.js'
import type { Clock } from '../../ports/clock.js'
import type { IntegrationStore } from '../../ports/integration-store.js'
import type { AppVerification, PlatformConnector } from '../../ports/platform-connector.js'
import type { Tx } from '../../ports/tx.js'
import type { UnitOfWork } from '../../ports/unit-of-work.js'

// Impostazioni → Integrazioni → Meta (spec §8.3, plan 03 Task 4): the agency's own Meta app.
// Meta is never called inside a transaction: read, call, then write over what was read.

/** The opaque app credentials the Meta connectors take (ADR 019). */
export interface MetaAppCredentials {
  appId: string
  appSecret: string
}

export interface MetaIntegrationDeps {
  uow: UnitOfWork
  clock: Clock
  integrations: IntegrationStore
  /** The Meta connector: only its app check is needed here. */
  meta: Pick<PlatformConnector<MetaAppCredentials>, 'verifyApp'>
}

/** What Owner and Admin see: the secret only as "set", through the row being there. */
export interface MetaIntegrationView extends MetaIntegrationConfig {
  verifiedAt: Date | null
  updatedAt: Date
}

export interface MetaIntegrationInput {
  appId: string
  /** Left out or empty: the stored one stays (the browser never sees it). */
  appSecret?: string
  configId?: string | null
  businessId?: string | null
  dataUseCheckupDueOn?: string | null
}

/** The fields an activity entry may name: the secret counts as a name, never as a value. */
export type MetaIntegrationChange = MetaIntegrationField | 'appSecret'

export type MetaTestResult = 'verified' | 'not_configured' | 'rejected' | 'unavailable'

const ENTITY = 'integration'

const FIELD_PROBLEMS: Record<MetaIntegrationField, string> = {
  appId: 'L’App ID è fatto solo di cifre',
  configId: 'L’ID configurazione è fatto solo di cifre',
  businessId: 'L’ID del Business Manager è fatto solo di cifre',
  dataUseCheckupDueOn: 'Scrivi una data valida',
}

const cannotView = () =>
  new DomainError('FORBIDDEN', 'Non hai i permessi per vedere le integrazioni')
const cannotManage = () =>
  new DomainError('FORBIDDEN', 'Solo l’Owner può cambiare le integrazioni dell’agenzia')

const rejected = () =>
  new DomainError('VALIDATION', 'Meta non accetta questo App ID con questo App Secret', {
    field: 'appSecret',
  })
const unavailable = () =>
  new DomainError('PLATFORM_UNAVAILABLE', 'Meta non risponde: riprova tra qualche minuto')

const viewOf = (found: {
  config: MetaIntegrationConfig
  verifiedAt: Date | null
  updatedAt: Date
}): MetaIntegrationView => ({
  ...found.config,
  verifiedAt: found.verifiedAt,
  updatedAt: found.updatedAt,
})

/** The role read again inside the transaction: a change since the actor was resolved counts. */
async function assertStillManages(tx: Tx, actor: OrgActor): Promise<void> {
  const { organizationId } = actor
  const membership = await tx.orgMembers.find(organizationId, actor.userId)
  if (
    membership?.status !== 'active' ||
    !can({ ...actor, orgRole: membership.role }, 'organization.settings.manage', {
      organizationId,
    })
  )
    throw cannotManage()
}

/** Owner, and Admin read only (spec §10.2); null while nothing is set. */
export async function getMetaIntegration(
  deps: Pick<MetaIntegrationDeps, 'uow' | 'integrations'>,
  actor: OrgActor,
): Promise<MetaIntegrationView | null> {
  const { organizationId } = actor
  if (!can(actor, 'organization.settings.view', { organizationId })) throw cannotView()
  const found = await deps.uow.run({ organizationId, userId: actor.userId }, (tx) =>
    deps.integrations.get(tx, organizationId, 'meta'),
  )
  return found === null ? null : viewOf(found)
}

/**
 * Replaces the agency's Meta app (Owner, with a recent reauth). The new settings are tried with
 * Meta first and saved only if Meta accepts them: refused credentials leave the stored ones as
 * they were. The activity entry names the fields that changed, never a value.
 */
export async function replaceMetaIntegration(
  deps: MetaIntegrationDeps,
  actor: OrgActor,
  session: AuthSessionInfo,
  input: MetaIntegrationInput,
  request: { ip: string | null },
): Promise<MetaIntegrationView> {
  if (session.userId !== actor.userId)
    throw new DomainError('UNAUTHENTICATED', 'Sessione scaduta: accedi di nuovo')
  const { organizationId, userId } = actor
  if (!can(actor, 'organization.settings.manage', { organizationId })) throw cannotManage()
  const checked = checkMetaIntegrationConfig({
    appId: input.appId,
    configId: input.configId,
    businessId: input.businessId,
    dataUseCheckupDueOn: input.dataUseCheckupDueOn,
  })
  if (!checked.ok) {
    const field = checked.field as MetaIntegrationField
    throw new DomainError('VALIDATION', FIELD_PROBLEMS[field], { field })
  }
  const config = checked.value
  assertRecentReauth(session, deps.clock.now())
  const scope = { organizationId, userId }

  const read = await deps.uow.run(scope, async (tx) => {
    await assertStillManages(tx, actor)
    return deps.integrations.credentials(tx, organizationId, 'meta')
  })
  const typed = input.appSecret === undefined || input.appSecret === '' ? null : input.appSecret
  const appSecret = typed ?? read?.secret
  if (appSecret === undefined)
    throw new DomainError('VALIDATION', 'Serve l’App Secret dell’app Meta', { field: 'appSecret' })
  const fields: MetaIntegrationChange[] = (
    ['appId', 'configId', 'businessId', 'dataUseCheckupDueOn'] as const
  ).filter((field) => read?.config[field] !== config[field])
  if (read === null || appSecret !== read.secret) fields.push('appSecret')
  if (read !== null && fields.length === 0) {
    const current = await deps.uow.run(scope, (tx) =>
      deps.integrations.get(tx, organizationId, 'meta'),
    )
    if (current !== null) return viewOf(current)
  }

  const verification = await deps.meta.verifyApp({ appId: config.appId, appSecret })
  if (!verification.ok) throw verification.reason === 'rejected' ? rejected() : unavailable()
  const verifiedAt = deps.clock.now()

  return deps.uow.run(scope, async (tx) => {
    await assertStillManages(tx, actor)
    const view = await deps.integrations.replace(tx, organizationId, 'meta', {
      config,
      secret: appSecret,
      updatedBy: userId,
      expectedVersion: read?.updatedAt ?? null,
      verifiedAt,
    })
    // someone saved other settings while Meta was answering: theirs stay
    if (view === null)
      throw new DomainError('CONFLICT', 'Le impostazioni di Meta sono cambiate nel frattempo')
    await tx.audit.record({
      organizationId,
      actorId: userId,
      source: 'panel',
      action: 'integration.meta_changed',
      entity: ENTITY,
      entityId: null,
      workspaceId: null,
      ip: request.ip,
      data: { fields },
    })
    return viewOf(view)
  })
}

function testResultOf(verification: AppVerification): MetaTestResult {
  return verification.ok ? 'verified' : verification.reason
}

/**
 * "Prova" (Owner): tries the stored app with Meta. Success marks it verified, unless it changed
 * while Meta was answering. Recorded with `{ ok, result }`.
 */
export async function testMetaIntegration(
  deps: MetaIntegrationDeps,
  actor: OrgActor,
  request: { ip: string | null },
): Promise<{ ok: boolean; result: MetaTestResult }> {
  const { organizationId, userId } = actor
  if (!can(actor, 'organization.settings.manage', { organizationId })) throw cannotManage()
  const scope = { organizationId, userId }
  const read = await deps.uow.run(scope, async (tx) => {
    await assertStillManages(tx, actor)
    return deps.integrations.credentials(tx, organizationId, 'meta')
  })
  const result: MetaTestResult =
    read === null
      ? 'not_configured'
      : testResultOf(
          await deps.meta.verifyApp({ appId: read.config.appId, appSecret: read.secret }),
        )
  const ok = result === 'verified'

  await deps.uow.run(scope, async (tx) => {
    await assertStillManages(tx, actor)
    if (ok && read !== null)
      await tx.integrations.markVerified(organizationId, 'meta', deps.clock.now(), read.updatedAt)
    await tx.audit.record({
      organizationId,
      actorId: userId,
      source: 'panel',
      action: 'integration.meta_tested',
      entity: ENTITY,
      entityId: null,
      workspaceId: null,
      ip: request.ip,
      data: { ok, result },
    })
  })
  return { ok, result }
}
