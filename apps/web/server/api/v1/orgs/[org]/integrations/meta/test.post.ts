import { testMetaIntegration } from '@app/application'
import { testMetaIntegrationRoute } from '@app/contracts'

export default defineApiRoute(
  testMetaIntegrationRoute,
  ({ actor, ip }) => testMetaIntegration(metaIntegrationDeps(useDeps()), actor, { ip }),
  { rateLimit: META_INTEGRATION_RATE_LIMIT },
)
