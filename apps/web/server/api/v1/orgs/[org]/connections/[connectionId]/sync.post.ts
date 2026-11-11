import { requestSync } from '@app/application'
import { syncConnectionRoute } from '@app/contracts'

export default defineApiRoute(syncConnectionRoute, async ({ actor, params }) => {
  await requestSync(syncRequestDeps(useDeps()), actor, { connectionId: params.connectionId })
  return { queued: true as const }
})
