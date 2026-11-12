import { listMetaReminders } from '@app/application'
import { metaRemindersRoute } from '@app/contracts'

export default defineApiRoute(metaRemindersRoute, async ({ actor }) => {
  const items = await listMetaReminders(metaRemindersDeps(useDeps()), actor)
  return { items: items.map(metaReminderDto) }
})
