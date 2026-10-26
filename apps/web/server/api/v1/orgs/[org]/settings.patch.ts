import { getOrganizationSettings, updateOrganizationSettings } from '@app/application'
import { updateOrganizationSettingsRoute } from '@app/contracts'

export default defineApiRoute(
  updateOrganizationSettingsRoute,
  async ({ actor, session, body, ip }) => {
    const deps = identityDeps(useDeps())
    await updateOrganizationSettings(deps, actor, session.session, body, { ip })
    return getOrganizationSettings(deps, actor)
  },
)
