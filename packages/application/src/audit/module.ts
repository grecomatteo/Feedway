import type { ModuleDefinition } from '../module-definition.js'

export const auditModule: ModuleDefinition = {
  name: 'audit',
  permissions: ['audit.view_all', 'audit.view_workspace'],
  queues: [],
}
