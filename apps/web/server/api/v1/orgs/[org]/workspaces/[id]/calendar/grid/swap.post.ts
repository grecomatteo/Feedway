import { swapGridPosts } from '@app/application'
import { calendarGridSwapRoute } from '@app/contracts'

// Two scheduled posts of the grid swap their times (plan 09 Task 12): both or neither.
export default defineApiRoute(
  calendarGridSwapRoute,
  ({ actor, params, body, ip }) =>
    swapGridPosts(useDeps(), actor, { ...body, workspaceId: params.id }, { ip }),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
