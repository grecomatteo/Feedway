import type { ModuleDefinition } from '../module-definition.js'

export const platformModule: ModuleDefinition = {
  name: 'platform',
  permissions: [
    'platform.organizations.manage',
    'platform.users.manage',
    'platform.integrations.manage',
  ],
  queues: ['system.selftest'],
}
