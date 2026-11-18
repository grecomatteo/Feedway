import { createCaptionTemplate } from '@app/application'
import { createCaptionTemplateRoute } from '@app/contracts'

export default defineApiRoute(
  createCaptionTemplateRoute,
  ({ actor, params, body }) =>
    createCaptionTemplate(useDeps(), actor, { workspaceId: params.id, ...body }),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
