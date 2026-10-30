import type { PlatformMailSettings } from '@app/application'

/** What leaves for the panel: dates as ISO strings, the password only as "set". */
export function mailSettingsDto(view: PlatformMailSettings) {
  return {
    host: view.host,
    port: view.port,
    security: view.security,
    username: view.username,
    from: view.from,
    passwordSet: view.secretSet,
    verifiedAt: view.verifiedAt?.toISOString() ?? null,
    updatedAt: view.updatedAt.toISOString(),
  }
}
