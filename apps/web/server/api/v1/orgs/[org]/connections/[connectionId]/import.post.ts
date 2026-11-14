import { importAccounts } from '@app/application'
import { importAccountsRoute } from '@app/contracts'

export default defineApiRoute(
  importAccountsRoute,
  async ({ actor, params, body, ip }) => {
    const result = await importAccounts(
      connectionsDeps(useDeps()),
      actor,
      {
        connectionId: params.connectionId,
        externalIds: body.externalIds,
        newWorkspaces: body.newWorkspaces ?? [],
        assignTo: body.assignTo ?? [],
      },
      { ip },
    )
    return {
      connection: connectionDto(result.connection),
      accounts: result.accounts.map(socialAccountDto(params.org)),
      created: result.created.map((w) => ({ id: w.id, name: w.name, slug: w.slug })),
      undo: result.undo,
    }
  },
  { rateLimit: CONNECTIONS_RATE_LIMIT },
)
