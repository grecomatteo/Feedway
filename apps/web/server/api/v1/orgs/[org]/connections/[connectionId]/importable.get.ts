import { listImportable } from '@app/application'
import { importableAccountsRoute } from '@app/contracts'

export default defineApiRoute(
  importableAccountsRoute,
  async ({ actor, params }) => {
    const result = await listImportable(connectionsDeps(useDeps()), actor, {
      connectionId: params.connectionId,
    })
    return {
      connection: connectionDto(result.connection),
      accounts: result.accounts.map(importableDto),
    }
  },
  { rateLimit: CONNECTIONS_RATE_LIMIT },
)
