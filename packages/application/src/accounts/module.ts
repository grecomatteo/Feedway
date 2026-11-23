import { accountKind } from './notification-messages.js'
import type { ModuleDefinition } from '../module-definition.js'

/** Social accounts and their connections (ADR 019), with their sync and health jobs, the
 * daily run that queues them (§8.4) and the copy of their pictures (plan 04 Task 4). */
export const accountsModule: ModuleDefinition = {
  name: 'accounts',
  permissions: ['accounts.manage', 'workspace.accounts.assign'],
  queues: ['accounts.sync', 'accounts.health', 'accounts.daily', 'accounts.avatar'],
  notificationKinds: [
    // who scheduled posts on the account in the next 24 hours, and the Managers of each
    // workspace it is assigned to (plan 08, Scelta 4)
    accountKind({
      type: 'account.quota_low',
      level: 'warning',
      recipients: ['scheduler', 'workspace_managers'],
      defaultChannels: ['panel'],
    }),
    // §12.2: «Token non valido, account non sano, promemoria Meta», to Owner and Admin
    accountKind({
      type: 'account.token_invalid',
      level: 'critical',
      recipients: ['org_admins'],
      defaultChannels: ['panel', 'telegram', 'email'],
    }),
    accountKind({
      type: 'account.unhealthy',
      level: 'critical',
      recipients: ['org_admins'],
      defaultChannels: ['panel', 'telegram', 'email'],
    }),
    accountKind({
      type: 'meta.reminder',
      level: 'warning',
      recipients: ['org_admins'],
      defaultChannels: ['panel', 'telegram', 'email'],
    }),
  ],
}
