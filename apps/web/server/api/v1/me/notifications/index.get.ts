import { listMyNotifications } from '@app/application'
import { myNotificationsRoute } from '@app/contracts'

export default defineApiRoute(myNotificationsRoute, async ({ session, query }) => {
  const page = await listMyNotifications(centreDeps(), session.user.id, {
    organizationId: query.organizationId ?? null,
    workspaceId: query.workspaceId ?? null,
    level: query.level ?? null,
    kind: query.kind ?? null,
    unreadOnly: query.unread === 'true',
    cursor: query.cursor ?? null,
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  })
  return { ...page, items: page.items.map(notificationJson) }
})
