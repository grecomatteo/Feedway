import { createCaptionTemplate } from '@app/application'
import { createCaptionTemplateRoute } from '@app/contracts'

export default defineApiRoute(
  createCaptionTemplateRoute,
  ({ actor, params, body, ip }) =>
    createCaptionTemplate(useDeps(), actor, { workspaceId: params.id, ...body }, { ip }),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
