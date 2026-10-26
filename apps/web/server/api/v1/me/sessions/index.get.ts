import { listMySessions } from '@app/application'
import { mySessionsRoute } from '@app/contracts'

export default defineApiRoute(mySessionsRoute, async ({ session }) => {
  const sessions = await listMySessions(useDeps(), session.user, session.session.id)
  return {
    items: sessions.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
      lastActiveAt: s.lastActiveAt.toISOString(),
    })),
  }
})
