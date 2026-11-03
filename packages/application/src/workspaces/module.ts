import type { ModuleDefinition } from '../module-definition.js'

export const workspacesModule: ModuleDefinition = {
  name: 'workspaces',
  permissions: [
    'workspace.view',
    'workspace.create',
    'workspace.members.manage',
    'workspace.content_settings.manage',
  ],
  queues: [],
}
