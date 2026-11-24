import { getPlatformMonitoring } from '@app/application'
import { platformMonitoringRoute } from '@app/contracts'

export default defineApiRoute(platformMonitoringRoute, async ({ actor, ip }) =>
  monitoringDto(await getPlatformMonitoring(monitoringDeps(useDeps()), actor, { ip })),
)
