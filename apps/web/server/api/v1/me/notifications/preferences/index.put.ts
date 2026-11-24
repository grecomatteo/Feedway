import { notificationKinds, saveMyNotificationSettings } from '@app/application'
import type { Weekday } from '@app/domain'
import { saveMyNotificationSettingsRoute } from '@app/contracts'

export default defineApiRoute(saveMyNotificationSettingsRoute, ({ session, body }) =>
  saveMyNotificationSettings({ uow: useDeps().uow, kinds: notificationKinds() }, session.user.id, {
    ...body,
    digest: { ...body.digest, days: body.digest.days as Weekday[] },
  }),
)
