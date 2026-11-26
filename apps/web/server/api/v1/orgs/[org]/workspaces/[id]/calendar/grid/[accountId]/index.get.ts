import { getGrid } from '@app/application'
import { calendarGridRoute } from '@app/contracts'

// Instagram's grid of a client's account (plan 09 Task 12): the only route of the panel that
// reads Meta. A few openings a minute are plenty; each one is one call to Meta, counted for the
// person and for the account.
export default defineApiRoute(
  calendarGridRoute,
  async ({ actor, params }) => {
    await limitAccount(GRID_ACCOUNT_READS_LIMIT, actor.organizationId, params.accountId)
    return getGrid(useDeps(), actor, { workspaceId: params.id, accountId: params.accountId })
  },
  { rateLimit: GRID_READS_RATE_LIMIT },
)
