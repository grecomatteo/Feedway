import { importAccounts } from '@app/application'
import { importAccountsRoute } from '@app/contracts'

export default defineApiRoute(
  importAccountsRoute,
  async ({ actor, params, body, ip }) => {
    const result = await importAccounts(
      connectionsDeps(useDeps()),
      actor,
      { connectionId: params.connectionId, externalIds: body.externalIds },
      { ip },
    )
    return {
      connection: connectionDto(result.connection),
      accounts: result.accounts.map(socialAccountDto(params.org)),
    }
  },
  { rateLimit: CONNECTIONS_RATE_LIMIT },
)
