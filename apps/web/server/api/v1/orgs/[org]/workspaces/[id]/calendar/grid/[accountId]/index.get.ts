import { getGrid } from '@app/application'
import { calendarGridRoute } from '@app/contracts'

// Instagram's grid of a client's account (plan 09 Task 12): the only route of the panel that
// reads Meta. A few openings a minute are plenty; each one is one call to Meta, counted for the
// person and, once the account is known to be the client's, for the account.
export default defineApiRoute(
  calendarGridRoute,
  async ({ actor, params }) =>
    getGrid(
      useDeps(),
      actor,
      { workspaceId: params.id, accountId: params.accountId },
      {
        beforePlatform: () =>
          limitAccount(GRID_ACCOUNT_READS_LIMIT, actor.organizationId, params.accountId),
      },
    ),
  { rateLimit: GRID_READS_RATE_LIMIT },
)
