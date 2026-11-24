import { isModuleEnabled, type ToggleableModule } from '@app/domain'
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

/**
 * Turns the agency's toggleable modules on or off (§7.3, plan 09 P2), from the worker's CLI
 * (`set-modules`): the modules given change, the others stay. The same state again writes
 * nothing.
 */
export async function setOrganizationModules(
  deps: Pick<PlatformDeps, 'uow'>,
  caller: PlatformCaller,
  organizationId: string,
  modules: Partial<Record<ToggleableModule, boolean>>,
  request: PlatformRequest = NO_REQUEST,
): Promise<void> {
  assertPlatform(caller, 'platform.organizations.manage')
  if (!isUuid(organizationId)) throw organizationNotFound()
  await deps.uow.runAsSystem('platform: set organization modules', async (tx) => {
    const author = await platformAuthor(tx, caller, request)
    const organization = await tx.organizations.findByIdForUpdate(organizationId)
    if (!organization) throw organizationNotFound()
    const changed = Object.entries(modules).filter(
      ([name, on]) => isModuleEnabled(organization.settings, name) !== on,
    )
    if (changed.length === 0) return
    const current = organization.settings.modules
    const next = {
      ...(typeof current === 'object' && current !== null ? current : {}),
      ...Object.fromEntries(changed),
    }
    await tx.organizations.setModules(organizationId, next)
    await tx.audit.record({
      organizationId: null,
      actorId: author.actorId,
      source: author.source,
      action: 'organization.settings_changed',
      entity: 'organization',
      entityId: organizationId,
      workspaceId: null,
      ip: author.ip,
      data: { modules: Object.fromEntries(changed) },
    })
  })
}
