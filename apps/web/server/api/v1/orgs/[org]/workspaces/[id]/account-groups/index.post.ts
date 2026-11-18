import { createAccountGroup } from '@app/application'
import { createAccountGroupRoute } from '@app/contracts'

export default defineApiRoute(
  createAccountGroupRoute,
  ({ actor, params, body, ip }) =>
    createAccountGroup(useDeps(), actor, { workspaceId: params.id, ...body }, { ip }),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
