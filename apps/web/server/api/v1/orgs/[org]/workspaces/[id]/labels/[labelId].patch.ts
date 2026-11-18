import { updateLabel } from '@app/application'
import { updateLabelRoute } from '@app/contracts'

export default defineApiRoute(
  updateLabelRoute,
  ({ actor, params, body }) =>
    updateLabel(useDeps(), actor, {
      workspaceId: params.id,
      labelId: params.labelId,
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.color === undefined ? {} : { color: body.color }),
    }),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
