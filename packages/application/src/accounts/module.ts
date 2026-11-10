import type { ModuleDefinition } from '../module-definition.js'

/** Social accounts and their connections (ADR 019); the health queues arrive with Task 10. */
export const accountsModule: ModuleDefinition = {
  name: 'accounts',
  permissions: ['accounts.manage', 'workspace.accounts.assign'],
  queues: [],
}
