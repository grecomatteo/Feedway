import {
  can,
  DomainError,
  organizationName,
  type OrgActor,
  type OrgRole,
  type TwoFactorPolicy,
} from '@app/domain'
import { assertRecentReauth } from '../identity/index.js'
import type { AuthSessionInfo } from '../ports/auth.js'
import type { Clock } from '../ports/clock.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

export interface OrganizationsDeps {
  uow: UnitOfWork
  clock: Clock
  config: {
    /** REQUIRE_2FA: an agency may ask more, never less. */
    require2fa: TwoFactorPolicy
  }
}

/** An agency in the switcher. */
export interface MyOrganization {
  id: string
  slug: string
  name: string
  role: OrgRole
  /** A suspended agency is listed, so the panel can say why it does not open. */
  status: 'active' | 'suspended'
}

/** The agencies where the person has an active membership (spec §6.5, switcher). */
export async function listMyOrganizations(
  deps: { uow: UnitOfWork },
  user: { userId: string },
): Promise<MyOrganization[]> {
  const { userId } = user
  return deps.uow.run({ userId }, async (tx) => {
    const me = await tx.users.findById(userId)
    if (!me || me.status !== 'active' || me.anonymizedAt !== null) return []
    return (await tx.orgMembers.listForUser(userId))
      .filter((m) => m.status === 'active')
      .map((m) => ({
        id: m.organizationId,
        slug: m.slug,
        name: m.name,
        role: m.role,
        status: m.organizationStatus,
      }))
  })
}

export interface OrganizationSettingsDto {
  id: string
  name: string
  slug: string
  /** The agency's own rule; null keeps the platform's. */
  require2fa: TwoFactorPolicy | null
  platformRequire2fa: TwoFactorPolicy
}

const TWO_FACTOR_POLICIES: readonly TwoFactorPolicy[] = ['admins', 'all']

/** As `listForUser` reads it: a value we do not know counts as the strictest. */
function storedPolicy(settings: Record<string, unknown>): TwoFactorPolicy | null {
  const value = settings.require2fa
  if (value === undefined || value === null) return null
  return value === 'admins' ? 'admins' : 'all'
}

const notFound = () => new DomainError('NOT_FOUND', 'Agenzia non trovata')

/** Owner and Admin (read only) see the agency's settings (spec §10.2). */
export async function getOrganizationSettings(
  deps: Pick<OrganizationsDeps, 'uow' | 'config'>,
  actor: OrgActor,
): Promise<OrganizationSettingsDto> {
  const { organizationId } = actor
  if (!can(actor, 'organization.settings.view', { organizationId }))
    throw new DomainError('FORBIDDEN', 'Non hai i permessi per vedere le impostazioni')
  const organization = await deps.uow.run({ organizationId, userId: actor.userId }, (tx) =>
    tx.organizations.findById(organizationId),
  )
  if (!organization) throw notFound()
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    require2fa: storedPolicy(organization.settings),
    platformRequire2fa: deps.config.require2fa,
  }
}

export interface OrganizationSettingsInput {
  name?: string
  require2fa?: TwoFactorPolicy
}

const cannotManage = () =>
  new DomainError('FORBIDDEN', 'Solo l’Owner può cambiare le impostazioni dell’agenzia')

/**
 * Only the Owner, with a recent reauth (spec §15.2). The 2FA rule never goes below the
 * platform's. Raising it closes no session: whoever lacks the second factor is asked for it
 * on the next request (`second_factor_required`). The slug never changes: links depend on it.
 */
export async function updateOrganizationSettings(
  deps: OrganizationsDeps,
  actor: OrgActor,
  session: AuthSessionInfo,
  input: OrganizationSettingsInput,
  request: { ip: string | null },
): Promise<void> {
  if (session.userId !== actor.userId)
    throw new DomainError('UNAUTHENTICATED', 'Sessione scaduta: accedi di nuovo')
  const { organizationId } = actor
  if (!can(actor, 'organization.settings.manage', { organizationId })) throw cannotManage()

  let name: string | undefined
  if (input.name !== undefined) {
    const valid = organizationName(input.name)
    if (valid === null)
      throw new DomainError('VALIDATION', 'Il nome dell’agenzia va da 2 a 80 caratteri', {
        field: 'name',
      })
    name = valid
  }
  const { require2fa } = input
  if (require2fa !== undefined) {
    if (!(TWO_FACTOR_POLICIES as readonly string[]).includes(require2fa))
      throw new DomainError('VALIDATION', 'Valore non valido', { field: 'require2fa' })
    if (deps.config.require2fa === 'all' && require2fa !== 'all')
      throw new DomainError(
        'VALIDATION',
        'La piattaforma chiede il secondo fattore a tutti: l’agenzia non può chiedere meno',
        { field: 'require2fa' },
      )
  }
  assertRecentReauth(session, deps.clock.now())

  await deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    // the role is read again: a change since the actor was resolved must not pass
    const membership = await tx.orgMembers.find(organizationId, actor.userId)
    if (
      membership?.status !== 'active' ||
      !can({ ...actor, orgRole: membership.role }, 'organization.settings.manage', {
        organizationId,
      })
    )
      throw cannotManage()
    const organization = await tx.organizations.findByIdForUpdate(organizationId)
    if (!organization) throw notFound()
    if (organization.status !== 'active')
      throw new DomainError('ORGANIZATION_SUSPENDED', 'Questa agenzia è sospesa')

    const current = storedPolicy(organization.settings)
    const fields: string[] = []
    if (name !== undefined && name !== organization.name) fields.push('name')
    const policyChanged = require2fa !== undefined && require2fa !== current
    if (policyChanged) fields.push('require2fa')
    if (fields.length === 0) return

    await tx.organizations.update(organizationId, {
      ...(fields.includes('name') && name !== undefined ? { name } : {}),
      ...(policyChanged ? { settings: { require2fa } } : {}),
    })
    await tx.audit.record({
      organizationId,
      actorId: actor.userId,
      source: 'panel',
      action: 'organization.settings_changed',
      entity: 'organization',
      entityId: organizationId,
      workspaceId: null,
      ip: request.ip,
      // which fields, never the name itself
      data: { fields, ...(policyChanged ? { require2fa: { from: current, to: require2fa } } : {}) },
    })
  })
}
