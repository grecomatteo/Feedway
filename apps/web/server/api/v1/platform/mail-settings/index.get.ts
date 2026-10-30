import { getPlatformMailSettings } from '@app/application'
import { platformMailSettingsRoute } from '@app/contracts'

export default defineApiRoute(platformMailSettingsRoute, async ({ actor, ip }) => {
  const view = await getPlatformMailSettings(platformMailDeps(useDeps()), actor, { ip })
  return { settings: view === null ? null : mailSettingsDto(view) }
})
