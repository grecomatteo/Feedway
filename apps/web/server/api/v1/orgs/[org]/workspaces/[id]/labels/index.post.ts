import { createLabel } from '@app/application'
import { createLabelRoute } from '@app/contracts'

export default defineApiRoute(
  createLabelRoute,
  ({ actor, params, body, ip }) =>
    createLabel(useDeps(), actor, { workspaceId: params.id, ...body }, { ip }),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
