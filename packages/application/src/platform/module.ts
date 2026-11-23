import type { ModuleDefinition } from '../module-definition.js'

export const platformModule: ModuleDefinition = {
  name: 'platform',
  permissions: [
    'platform.organizations.manage',
    'platform.users.manage',
    'platform.integrations.manage',
  ],
  queues: ['system.selftest'],
  // §12.2 and plan 08, Scelta 10: the web sends the worker's two, with the platform's bot
  notificationKinds: [
    {
      type: 'system.worker_down',
      level: 'critical',
      recipients: ['platform_admins'],
      defaultChannels: ['telegram', 'email'],
    },
    {
      type: 'system.worker_up',
      level: 'success',
      recipients: ['platform_admins'],
      defaultChannels: ['telegram', 'email'],
    },
    {
      type: 'system.backup_failed',
      level: 'critical',
      recipients: ['platform_admins'],
      defaultChannels: ['panel', 'telegram', 'email'],
    },
  ],
}
