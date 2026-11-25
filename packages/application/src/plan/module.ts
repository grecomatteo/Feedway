import type { ModuleDefinition } from '../module-definition.js'
import { planCalendarEntries } from './calendar-entries.js'
import { planDigestSections, planKind } from './notification-messages.js'

/**
 * The editorial plan (spec §11.12, plan 09): contents to prepare before the posts exist. It
 * depends on `posts`, never the other way round. It can be turned off for an agency (P2): its
 * routes answer «not found» and the calendar asks it nothing.
 */
export const planModule: ModuleDefinition = {
  name: 'plan',
  permissions: ['plan.view', 'plan.edit', 'plan.prepare'],
  queues: ['plan.due_scan'],
  notificationKinds: [
    // §12.2: «Contenuto da preparare entro domani», to who may prepare it (plan 09 Task 8)
    planKind({
      type: 'plan.due_soon',
      level: 'warning',
      recipients: ['workspace_preparers'],
      defaultChannels: ['panel', 'telegram'],
    }),
  ],
  // §12.4: «Da preparare», after the posts of today
  digestSections: planDigestSections,
  calendarEntries: planCalendarEntries,
}
