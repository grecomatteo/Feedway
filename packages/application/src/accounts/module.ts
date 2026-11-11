import type { ModuleDefinition } from '../module-definition.js'

/** Social accounts and their connections (ADR 019), with their sync and health jobs (§8.4). */
export const accountsModule: ModuleDefinition = {
  name: 'accounts',
  permissions: ['accounts.manage', 'workspace.accounts.assign'],
  queues: ['accounts.sync', 'accounts.health'],
}
