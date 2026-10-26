import { getOrganizationSettings } from '@app/application'
import { organizationSettingsRoute } from '@app/contracts'

export default defineApiRoute(organizationSettingsRoute, ({ actor }) =>
  getOrganizationSettings(identityDeps(useDeps()), actor),
)
