import { replaceMetaIntegration } from '@app/application'
import { replaceMetaIntegrationRoute } from '@app/contracts'

export default defineApiRoute(
  replaceMetaIntegrationRoute,
  async ({ actor, session, body, ip }) => {
    const { appSecret, configId, businessId, dataUseCheckupDueOn, appId, appLive } = body
    const view = await replaceMetaIntegration(
      metaIntegrationDeps(useDeps()),
      actor,
      session.session,
      {
        appId,
        ...(appSecret !== undefined && { appSecret }),
        ...(configId !== undefined && { configId }),
        ...(businessId !== undefined && { businessId }),
        ...(dataUseCheckupDueOn !== undefined && { dataUseCheckupDueOn }),
        ...(appLive !== undefined && { appLive }),
      },
      { ip },
    )
    return { integration: metaIntegrationDto(view) }
  },
  { rateLimit: META_INTEGRATION_RATE_LIMIT },
)
