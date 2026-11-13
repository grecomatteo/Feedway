import { listConnections, syncWaitSeconds } from '@app/application'
import { listConnectionsRoute } from '@app/contracts'

export default defineApiRoute(listConnectionsRoute, async ({ actor }) => {
  const deps = useDeps()
  const connections = await listConnections(connectionsDeps(deps), actor)
  return {
    items: await Promise.all(
      connections.map(async (c) => ({
        ...connectionDto(c),
        syncRetryAfterSeconds: await syncWaitSeconds(deps, c.id),
      })),
    ),
  }
})
