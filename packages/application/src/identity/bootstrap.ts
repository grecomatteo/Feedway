import { DomainError, LINK_TTL_MS } from '@app/domain'
import { activationUrl, type IdentityDeps } from './identity-deps.js'

export const DEFAULT_ORGANIZATION_NAME = 'La mia agenzia'

/**
 * The link that creates the platform administrator and the first agency. Valid one hour; a new
 * link replaces the previous ones. Refused once a platform administrator exists.
 */
export async function createBootstrapLink(
  deps: Pick<IdentityDeps, 'uow' | 'clock' | 'ids' | 'tokens' | 'config'>,
): Promise<{ url: string }> {
  const email = deps.config.bootstrapOwnerEmail
  if (email === null)
    throw new DomainError('VALIDATION', 'Manca BOOTSTRAP_OWNER_EMAIL: è l’email del primo account')
  const { token, hash } = deps.tokens.generate()
  await deps.uow.runAsSystem('bootstrap link', async (tx) => {
    if (await tx.users.platformAdminExists())
      throw new DomainError('CONFLICT', 'Account principale già creato')
    const now = deps.clock.now()
    await tx.invites.expireOpen('bootstrap', now)
    await tx.invites.create({
      id: deps.ids.newId(),
      organizationId: null,
      purpose: 'bootstrap',
      email,
      existingUserId: null,
      tokenHash: hash,
      invitedBy: null,
      orgRole: null,
      memberships: [],
      expiresAt: new Date(now.getTime() + LINK_TTL_MS.bootstrap),
    })
  })
  return { url: activationUrl(deps.config.panelUrl, token) }
}
