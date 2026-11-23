import type { ModuleDefinition } from '../module-definition.js'
import { anonymizeNotifications } from './anonymize.js'

/**
 * The notifications of stage 8 (§12, plan 08): the kinds are the modules' that write the events;
 * this module delivers them.
 */
export const notificationsModule: ModuleDefinition = {
  name: 'notifications',
  permissions: [],
  queues: ['notify.dispatch', 'notify.deliver', 'notify.deliver_platform', 'telegram.poll'],
  onUserAnonymized: anonymizeNotifications,
}
