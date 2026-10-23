import {
  availableSlug,
  DomainError,
  LINK_TTL_MS,
  normalizeEmail,
  organizationName,
} from '@app/domain'
import { activationUrl } from '../identity/index.js'
import {
  assertPlatform,
  NO_REQUEST,
  platformAuthor,
  type PlatformCaller,
  type PlatformDeps,
  type PlatformRequest,
} from './platform-actor.js'

export interface CreateOrganizationResult {
  organizationId: string
  slug: string
  /** The Owner's activation link (one hour); null when the Owner already had an account. */
  ownerActivationUrl: string | null
}

/**
 * A new agency with its data key and its Owner (spec §10.4). An email that already has an
 * account becomes Owner at once and finds the agency in the switcher; a new one gets an
 * activation link. Recorded on the platform log (`organization_id` null), never the agency's.
 */
export async function createOrganization(
  deps: PlatformDeps,
  caller: PlatformCaller,
  input: { name: string; ownerEmail: string },
  request: PlatformRequest = NO_REQUEST,
): Promise<CreateOrganizationResult> {
  assertPlatform(caller, 'platform.organizations.manage')
  const name = organizationName(input.name)
  if (name === null)
    throw new DomainError('VALIDATION', 'Il nome dell’agenzia va da 2 a 80 caratteri', {
      field: 'name',
    })
  const email = normalizeEmail(input.ownerEmail)
  if (email === null)
    throw new DomainError('VALIDATION', 'Scrivi un indirizzo email valido', {
      field: 'ownerEmail',
    })

  const { token, hash } = deps.tokens.generate()
  const created = await deps.uow.runAsSystem('platform: create an organization', async (tx) => {
    const author = await platformAuthor(tx, caller, request)
    const owner = await tx.users.findByEmail(email)
    // a disabled account would own an agency it cannot enter; re-enable it first
    if (owner && (owner.status !== 'active' || owner.anonymizedAt !== null))
      throw new DomainError('CONFLICT', 'L’account di questa email è disattivato: riattivalo prima')

    const organizationId = deps.ids.newId()
    const slug = await availableSlug(name, (s) => tx.organizations.slugExists(s))
    await tx.organizations.create({ id: organizationId, name, slug })
    await deps.keyRing.createOrganizationKey(tx, organizationId)

    let data: Record<string, unknown>
    if (owner) {
      await tx.orgMembers.addIfMissing({ organizationId, userId: owner.id, role: 'owner' })
      data = { ownerId: owner.id }
    } else {
      const inviteId = deps.ids.newId()
      await tx.invites.create({
        id: inviteId,
        organizationId,
        purpose: 'organization_owner',
        email,
        existingUserId: null,
        tokenHash: hash,
        invitedBy: author.actorId,
        orgRole: 'owner',
        memberships: [],
        expiresAt: new Date(deps.clock.now().getTime() + LINK_TTL_MS.organization_owner),
      })
      data = { inviteId }
    }
    await tx.audit.record({
      organizationId: null,
      actorId: author.actorId,
      source: author.source,
      action: 'organization.created',
      entity: 'organization',
      entityId: organizationId,
      workspaceId: null,
      ip: author.ip,
      data,
    })
    return { organizationId, slug, ownerHasAccount: owner !== null }
  })
  return {
    organizationId: created.organizationId,
    slug: created.slug,
    ownerActivationUrl: created.ownerHasAccount ? null : activationUrl(deps.config.panelUrl, token),
  }
}
