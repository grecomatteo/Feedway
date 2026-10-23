import { DomainError } from '@app/domain'
import { isUuid } from '../identity/index.js'
import {
  assertPlatform,
  NO_REQUEST,
  platformAuthor,
  type PlatformCaller,
  type PlatformDeps,
  type PlatformRequest,
} from './platform-actor.js'

export const organizationNotFound = () => new DomainError('NOT_FOUND', 'Agenzia non trovata')

async function setOrganizationStatus(
  deps: Pick<PlatformDeps, 'uow' | 'clock'>,
  caller: PlatformCaller,
  organizationId: string,
  status: 'active' | 'suspended',
  request: PlatformRequest,
): Promise<void> {
  assertPlatform(caller, 'platform.organizations.manage')
  if (!isUuid(organizationId)) throw organizationNotFound()
  const reason = status === 'suspended' ? 'suspend' : 'reactivate'
  await deps.uow.runAsSystem(`platform: ${reason} an organization`, async (tx) => {
    const author = await platformAuthor(tx, caller, request)
    if (!(await tx.organizations.findByIdForUpdate(organizationId))) throw organizationNotFound()
    // already in that status: nothing to record
    if (!(await tx.organizations.setStatus(organizationId, status, deps.clock.now()))) return
    await tx.audit.record({
      organizationId: null,
      actorId: author.actorId,
      source: author.source,
      action: status === 'suspended' ? 'organization.suspended' : 'organization.reactivated',
      entity: 'organization',
      entityId: organizationId,
      workspaceId: null,
      ip: author.ip,
    })
  })
}

/**
 * Its members get 403 `ORGANIZATION_SUSPENDED` on every route of the agency from the next
 * request (resolveOrgActor); they keep their other agencies, so no session is closed.
 */
export function suspendOrganization(
  deps: Pick<PlatformDeps, 'uow' | 'clock'>,
  caller: PlatformCaller,
  organizationId: string,
  request: PlatformRequest = NO_REQUEST,
): Promise<void> {
  return setOrganizationStatus(deps, caller, organizationId, 'suspended', request)
}

export function reactivateOrganization(
  deps: Pick<PlatformDeps, 'uow' | 'clock'>,
  caller: PlatformCaller,
  organizationId: string,
  request: PlatformRequest = NO_REQUEST,
): Promise<void> {
  return setOrganizationStatus(deps, caller, organizationId, 'active', request)
}
