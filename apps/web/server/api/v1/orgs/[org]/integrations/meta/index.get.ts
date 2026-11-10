import { getMetaIntegration } from '@app/application'
import { metaIntegrationRoute } from '@app/contracts'

export default defineApiRoute(metaIntegrationRoute, async ({ actor }) => {
  const view = await getMetaIntegration(metaIntegrationDeps(useDeps()), actor)
  return { integration: view === null ? null : metaIntegrationDto(view) }
})
