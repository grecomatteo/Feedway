import type { ModuleDefinition } from '../module-definition.js'
import { anonymizeNotifications } from './anonymize.js'

/**
 * The notifications of stage 8 (§12, plan 08): the kinds are the modules' that write the events;
 * this module delivers them. Task 5 adds its queues (dispatch and delivery).
 */
export const notificationsModule: ModuleDefinition = {
  name: 'notifications',
  permissions: [],
  queues: [],
  onUserAnonymized: anonymizeNotifications,
}
