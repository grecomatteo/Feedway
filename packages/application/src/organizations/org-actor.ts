import { DomainError, type OrgActor } from '@app/domain'
import type { UnitOfWork } from '../ports/unit-of-work.js'

const notFound = () => new DomainError('NOT_FOUND', 'Agenzia non trovata')

/**
 * Who acts inside an agency. Only an active membership counts: a platform administrator who
 * is not a member gets no actor (spec §5.1), and the agency's existence is not revealed.
 */
export async function resolveOrgActor(
  deps: { uow: UnitOfWork },
  input: { userId: string; organizationSlug: string },
): Promise<OrgActor> {
  const { userId, organizationSlug } = input
  const found = await deps.uow.run({ userId }, async (tx) => {
    const user = await tx.users.findById(userId)
    if (!user || user.status !== 'active') return null
    const membership = (await tx.orgMembers.listForUser(userId)).find(
      (m) => m.slug === organizationSlug && m.status === 'active',
    )
    return membership ? { user, membership } : null
  })
  if (!found) throw notFound()
  const { user, membership } = found
  if (membership.organizationStatus === 'suspended')
    throw new DomainError('ORGANIZATION_SUSPENDED', 'Questa agenzia è sospesa')

  const organizationId = membership.organizationId
  const memberships = await deps.uow.run({ organizationId, userId }, async (tx) => {
    if (user.lastOrganizationId !== organizationId)
      await tx.users.setLastOrganization(userId, organizationId)
    return tx.workspaceMembers.rolesOf(organizationId, userId)
  })
  return {
    userId,
    platformRole: user.platformRole,
    organizationId,
    orgRole: membership.role,
    memberships,
  }
}
