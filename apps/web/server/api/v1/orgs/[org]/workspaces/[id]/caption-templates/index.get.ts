import { listCaptionTemplates } from '@app/application'
import { listCaptionTemplatesRoute } from '@app/contracts'

export default defineApiRoute(listCaptionTemplatesRoute, ({ actor, params }) =>
  listCaptionTemplates(useDeps(), actor, { workspaceId: params.id }),
)
