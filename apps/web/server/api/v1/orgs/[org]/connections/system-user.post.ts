import { connectWithToken } from '@app/application'
import { connectSystemUserRoute } from '@app/contracts'

export default defineApiRoute(
  connectSystemUserRoute,
  async ({ actor, session, body, ip }) => {
    const result = await connectWithToken(
      connectionsDeps(useDeps()),
      actor,
      session.session,
      { kind: 'meta_system_user', token: body.token },
      { ip },
    )
    return {
      outcome: result.outcome,
      permissions: result.permissions,
      connection: result.connection === null ? null : connectionDto(result.connection),
      accounts: result.accounts.map(importableDto),
    }
  },
  { rateLimit: CONNECTIONS_RATE_LIMIT },
)
