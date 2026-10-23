import { DomainError, parseLimits, validLimits, type OrganizationLimits } from '@app/domain'
import { isUuid } from '../identity/index.js'
import {
  assertPlatform,
  NO_REQUEST,
  platformAuthor,
  type PlatformCaller,
  type PlatformDeps,
  type PlatformRequest,
} from './platform-actor.js'
import { organizationNotFound } from './suspend-organization.js'

const sameLimits = (a: OrganizationLimits, b: OrganizationLimits) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())

/** Replaces the agency's limits as a whole: a key left out is unlimited (spec §6.5). */
export async function setOrganizationLimits(
  deps: Pick<PlatformDeps, 'uow'>,
  caller: PlatformCaller,
  organizationId: string,
  limits: OrganizationLimits,
  request: PlatformRequest = NO_REQUEST,
): Promise<void> {
  assertPlatform(caller, 'platform.organizations.manage')
  const valid = validLimits(limits)
  if (valid === null)
    throw new DomainError('VALIDATION', 'Ogni limite è un numero intero da 0 in su', {
      field: 'limits',
    })
  if (!isUuid(organizationId)) throw organizationNotFound()
  await deps.uow.runAsSystem('platform: set organization limits', async (tx) => {
    const author = await platformAuthor(tx, caller, request)
    const organization = await tx.organizations.findByIdForUpdate(organizationId)
    if (!organization) throw organizationNotFound()
    if (sameLimits(parseLimits(organization.limits), valid)) return
    await tx.organizations.setLimits(organizationId, valid)
    await tx.audit.record({
      organizationId: null,
      actorId: author.actorId,
      source: author.source,
      action: 'organization.limits_changed',
      entity: 'organization',
      entityId: organizationId,
      workspaceId: null,
      ip: author.ip,
      data: { limits: valid },
    })
  })
}
