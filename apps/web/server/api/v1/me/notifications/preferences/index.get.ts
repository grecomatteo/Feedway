import { getMyNotificationPreferences, notificationKinds } from '@app/application'
import { myNotificationPreferencesRoute } from '@app/contracts'

export default defineApiRoute(myNotificationPreferencesRoute, ({ session }) =>
  getMyNotificationPreferences({ uow: useDeps().uow, kinds: notificationKinds() }, session.user.id),
)
