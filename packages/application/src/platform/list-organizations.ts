import { parseLimits, type OrganizationLimits } from '@app/domain'
import type { OrganizationRecord } from '../ports/repositories.js'
import type { Tx } from '../ports/tx.js'
import {
  assertPlatform,
  platformAuthor,
  type PlatformCaller,
  type PlatformDeps,
} from './platform-actor.js'
import { organizationNotFound } from './suspend-organization.js'

/** What the platform sees of an agency: never its content. */
export interface PlatformOrganization {
  id: string
  slug: string
  name: string
  status: 'active' | 'suspended'
  createdAt: Date
  limits: OrganizationLimits
  usage: {
    /** Members (disabled ones too) and open invites: what the `users` limit counts. */
    users: number
    /** Workspaces not archived. */
    workspaces: number
  }
}

async function describe(tx: Tx, organization: OrganizationRecord, now: Date) {
  const { id } = organization
  return {
    id,
    slug: organization.slug,
    name: organization.name,
    status: organization.status,
    createdAt: organization.createdAt,
    limits: parseLimits(organization.limits),
    usage: {
      users: (await tx.orgMembers.count(id)) + (await tx.invites.countOpen(id, now)),
      workspaces: await tx.workspaces.countActive(id),
    },
  }
}

/** Every agency with its status, usage and limits (`cli list-organizations`). */
export async function listOrganizations(
  deps: Pick<PlatformDeps, 'uow' | 'clock'>,
  caller: PlatformCaller,
): Promise<PlatformOrganization[]> {
  assertPlatform(caller, 'platform.organizations.manage')
  return deps.uow.runAsSystem('platform: list organizations', async (tx) => {
    await platformAuthor(tx, caller, { ip: null })
    const now = deps.clock.now()
    const result: PlatformOrganization[] = []
    for (const organization of await tx.organizations.listAll())
      result.push(await describe(tx, organization, now))
    return result
  })
}

/** The agency a CLI command names by its slug. */
export async function findOrganizationBySlug(
  deps: Pick<PlatformDeps, 'uow' | 'clock'>,
  caller: PlatformCaller,
  slug: string,
): Promise<PlatformOrganization> {
  assertPlatform(caller, 'platform.organizations.manage')
  return deps.uow.runAsSystem('platform: find an organization', async (tx) => {
    await platformAuthor(tx, caller, { ip: null })
    const organization = await tx.organizations.findBySlug(slug)
    if (!organization) throw organizationNotFound()
    return describe(tx, organization, deps.clock.now())
  })
}
