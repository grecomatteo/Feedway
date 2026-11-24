import type { ModuleDefinition } from '../module-definition.js'
import { planCalendarEntries } from './calendar-entries.js'

/**
 * The editorial plan (spec §11.12, plan 09): contents to prepare before the posts exist. It
 * depends on `posts`, never the other way round. It can be turned off for an agency (P2): its
 * routes answer «not found» and the calendar asks it nothing.
 */
export const planModule: ModuleDefinition = {
  name: 'plan',
  permissions: ['plan.view', 'plan.edit', 'plan.prepare'],
  queues: [],
  calendarEntries: planCalendarEntries,
}
