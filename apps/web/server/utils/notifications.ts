import { notificationKinds, type CentreDeps, type CentreItem } from '@app/application'
import type { NotificationItem } from '@app/contracts'

/** What the notification centre needs from the process's dependencies (plan 08 Task 6). */
export function centreDeps(): CentreDeps {
  const deps = useDeps()
  return {
    uow: deps.uow,
    clock: deps.clock,
    t: deps.translate,
    panelUrl: deps.config.panelUrl,
    defaultTimezone: deps.config.defaultTimezone,
    kinds: notificationKinds(),
  }
}

export const notificationJson = (item: CentreItem): NotificationItem => ({
  ...item,
  createdAt: item.createdAt.toISOString(),
  readAt: item.readAt?.toISOString() ?? null,
  deliveries: item.deliveries.map((d) => ({ ...d, sentAt: d.sentAt?.toISOString() ?? null })),
})
