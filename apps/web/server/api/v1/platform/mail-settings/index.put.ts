import { replacePlatformMailSettings } from '@app/application'
import { replacePlatformMailSettingsRoute } from '@app/contracts'

export default defineApiRoute(
  replacePlatformMailSettingsRoute,
  async ({ actor, session, body, ip }) => {
    const { password, security, ...rest } = body
    const view = await replacePlatformMailSettings(
      platformMailDeps(useDeps()),
      actor,
      {
        ...rest,
        ...(security !== undefined && { security }),
        ...(password !== undefined && { secret: password }),
      },
      { ip, session: session.session },
    )
    return { settings: mailSettingsDto(view) }
  },
  { rateLimit: PLATFORM_SETTINGS_RATE_LIMIT },
)
