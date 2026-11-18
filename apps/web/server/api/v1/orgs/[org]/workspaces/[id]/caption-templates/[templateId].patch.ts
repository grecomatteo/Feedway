import { updateCaptionTemplate } from '@app/application'
import { updateCaptionTemplateRoute } from '@app/contracts'

export default defineApiRoute(
  updateCaptionTemplateRoute,
  ({ actor, params, body }) =>
    updateCaptionTemplate(useDeps(), actor, {
      workspaceId: params.id,
      templateId: params.templateId,
      ...(body.kind === undefined ? {} : { kind: body.kind }),
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.body === undefined ? {} : { body: body.body }),
    }),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
