import { createLabel } from '@app/application'
import { createLabelRoute } from '@app/contracts'

export default defineApiRoute(
  createLabelRoute,
  ({ actor, params, body }) => createLabel(useDeps(), actor, { workspaceId: params.id, ...body }),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
