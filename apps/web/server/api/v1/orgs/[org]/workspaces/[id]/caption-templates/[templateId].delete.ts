import { deleteCaptionTemplate } from '@app/application'
import { deleteCaptionTemplateRoute } from '@app/contracts'

export default defineApiRoute(
  deleteCaptionTemplateRoute,
  async ({ actor, params, ip }) => {
    await deleteCaptionTemplate(
      useDeps(),
      actor,
      {
        workspaceId: params.id,
        templateId: params.templateId,
      },
      { ip },
    )
    return { deleted: true as const }
  },
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
