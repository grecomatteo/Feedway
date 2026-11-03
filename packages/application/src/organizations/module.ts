import type { ModuleDefinition } from '../module-definition.js'

export const organizationsModule: ModuleDefinition = {
  name: 'organizations',
  permissions: ['organization.settings.view', 'organization.settings.manage'],
  queues: [],
}
